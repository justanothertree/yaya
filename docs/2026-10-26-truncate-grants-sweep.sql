-- NOT APPLIED -- NEEDS EVAN'S GO-AHEAD. It touches every table in `public`, so the desktop
-- app's auto-mode classifier declined it as a shared-resource change, which is the right
-- instinct for a sweep this wide. The evidence is below; the migration at the bottom is ready.
--
-- FOUND WHILE WIRING circuit_ratings INTO THE ACTIVITY FEED.
--
-- 17 tables let `anon` TRUNCATE them. 27 let `authenticated`. CLAUDE.md section 3 already
-- records why that is not covered by "RLS makes that grant inert": there is no TRUNCATE policy
-- type, so RLS never applies to it. What stands between anon and an empty table is PostgREST
-- having no verb that emits one -- the API's surface, not a privilege check.
--
-- MEASURED ON THIS DATABASE rather than taken from the note, in a rolled-back transaction: a
-- scratch table with RLS enabled and policies for `authenticated` only, holding three rows.
--
--   set local role anon;
--   insert into public.zz_acl_probe values (9,'x');   -- refused
--   truncate public.zz_acl_probe;                     -- ALLOWED
--   select count(*) from public.zz_acl_probe;         -- 0
--
-- The insert was refused and the truncate emptied the table. That is the configuration
-- circuit_ratings is in right now, holding 475 ratings -- the table this tick just wired into
-- the public-facing activity catalogue, which is how it came up.
--
-- Nobody granted these. `pg_default_acl` on `public` hands `arwdDxtm` to anon and authenticated
-- on every new table, so each table has to be CORRECTED rather than configured. The tables that
-- look right -- circuit_logs, circuit_people, circuit_movies, all sitting at four authenticated
-- privileges -- are the ones somebody got to. circuit_ratings is the sibling that was missed,
-- and sixteen others alongside it: chat_messages (47 rows), player_registry (128),
-- score_history (126), leaderboard (25), pools, pool_votes, pool_people, site_content,
-- trophies, activity_reads, chat_reads, chat_rooms, chat_room_members, round_results, and --
-- exactly the profile_blocks story from section 3 -- profile_rooms and profile_room_invites,
-- which have RLS on and ZERO policies and still carry the grants.
--
-- AND THE FIRST VERSION OF THIS SWEEP WOULD HAVE BROKEN THE SITE, which is the part worth
-- keeping. The obvious fix is to revoke everything from anon, justified by a survey saying no
-- table has a policy for anon. That survey asked `pg_policies.roles::text like '%anon%'` -- and
-- a policy written with no TO clause is `{public}`, which INCLUDES anon. Asked properly:
--
--   select count(distinct tablename) from pg_policies
--    where schemaname = 'public'
--      and (roles @> array['anon']::name[] or roles @> array['public']::name[]);   -- 15
--
-- Fifteen tables, not zero. Those SELECT grants are load-bearing on published pages. A clean
-- number from a question with a hole in it, arguing for the change I was already going to make
-- -- section 2's own warning, met from the inside.
--
-- SO THE CUT IS NARROW AND PROVABLE: the three privileges that no policy can ever restrain and
-- the API never emits. TRUNCATE is not covered by RLS at all. TRIGGER lets a role attach a
-- trigger to the table. REFERENCES lets it point a foreign key at it. None of the three is
-- reachable through PostgREST, so revoking them cannot change what any page does.
--
-- SELECT, INSERT, UPDATE and DELETE are deliberately left exactly as they are. Whether anon
-- should hold those is a real per-table question -- fifteen tables say yes through a `{public}`
-- policy -- and it is not one to answer in a loop over `pg_class`.

do $$
declare
  r record;
  v_before int := 0;
  v_after int := 0;
  v_tables int := 0;
begin
  select count(*) into v_before
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'TRUNCATE')
       or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
       or has_table_privilege('anon', c.oid, 'TRIGGER')
       or has_table_privilege('authenticated', c.oid, 'TRIGGER')
       or has_table_privilege('anon', c.oid, 'REFERENCES')
       or has_table_privilege('authenticated', c.oid, 'REFERENCES'));

  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relowner = (select relowner from pg_class where oid = 'public.profiles'::regclass)
  loop
    /* `from public, anon` and not `from public` alone: anon holds these DIRECTLY here, so a
       revoke aimed at PUBLIC leaves it untouched (CLAUDE.md section 3). */
    execute format(
      'revoke truncate, trigger, references on public.%I from public, anon, authenticated',
      r.relname);
    v_tables := v_tables + 1;
  end loop;

  select count(*) into v_after
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'TRUNCATE')
       or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
       or has_table_privilege('anon', c.oid, 'TRIGGER')
       or has_table_privilege('authenticated', c.oid, 'TRIGGER')
       or has_table_privilege('anon', c.oid, 'REFERENCES')
       or has_table_privilege('authenticated', c.oid, 'REFERENCES'));

  raise notice 'swept % tables: % exposed before, % after', v_tables, v_before, v_after;

  /* assert both directions, so a no-op cannot pass as a fix */
  if v_after > 0 then
    raise exception 'still % table(s) with truncate/trigger/references for an api role', v_after;
  end if;
  if v_before = 0 then
    raise exception 'nothing was exposed -- the survey query is wrong, not the schema';
  end if;
end $$;

-- and stop the schema handing them out again on the next table anybody creates
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;

-- AFTERWARDS, the standing check (belongs in docs/rpc-inventory.md as a query, never a list):
--
--   select c.relname,
--          has_table_privilege('anon', c.oid, 'TRUNCATE') as anon_truncate,
--          has_table_privilege('authenticated', c.oid, 'TRUNCATE') as authed_truncate
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relkind = 'r'
--      and (has_table_privilege('anon', c.oid, 'TRUNCATE')
--        or has_table_privilege('authenticated', c.oid, 'TRUNCATE'));
--
-- Zero rows is the healthy answer. A row means a table was created after this ran and before
-- the default-privileges line above took effect -- or that somebody re-granted.


-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- APPROVED AND APPLIED, 27 Oct 2026.  migration: revoke_truncate_trigger_references_api_roles
--
-- Evan's conditions, and what each turned out to mean here:
--
--   "run it as the postgres role, because the stop-future-tables part only covers tables
--    created by whoever runs it"
--      Already satisfied: current_user AND session_user are both `postgres`, and postgres owns
--      all 48 tables in public. The migration asserts current_user = 'postgres' rather than
--      assuming it, so it refuses rather than half-applying if that ever changes.
--
--   "if it fails because some table has a different owner, report which table and don't force it"
--      No table has a different owner -- one owner, postgres, 48 of 48. The per-table revoke is
--      still wrapped so a failure is COLLECTED rather than thrown, and the whole migration then
--      raises with the list, so nothing is forced and nothing is half-done.
--
-- ⚠️ AND THE CONDITION FOUND A REAL GAP THAT I HAD MISSED. pg_default_acl on public holds TWO
-- entries, not one:
--
--   defaclrole = postgres        -> {anon=arwdDxtm, authenticated=arwdDxtm, ...}
--   defaclrole = supabase_admin  -> {anon=arwdDxtm, authenticated=arwdDxtm, ...}
--
-- `alter default privileges` only ever amends the entry for the role running it. As postgres I
-- can fix the first. I CANNOT fix the second: pg_has_role(current_user,'supabase_admin','member')
-- is false, and this project's postgres is not a superuser (rolsuper = false). So:
--
--   * every table created by postgres from now on starts without these three  -- FIXED
--   * a table created in public by supabase_admin would still start with them -- NOT FIXED,
--     and not fixable from here. It affects 0 tables today (supabase_admin owns none), and it
--     would need the dashboard or Supabase support to change.
--
-- That is exactly the hole the "run it as postgres" advice was pointing at, and the honest
-- version of the answer is that running as postgres closes the half that is reachable.
--
-- ⚠️ VIEWS ARE IN SCOPE TOO, which the first draft got wrong. The undo script below named
-- `leaderboard_with_trophies` -- a VIEW -- and the loop filtered relkind in ('r','p'), so it
-- would have walked straight past it. TRUNCATE and REFERENCES on a view are meaningless, but
-- TRIGGER is not: it is the privilege for attaching a trigger, and an INSTEAD OF trigger on a
-- view is a real thing. relkind is ('r','p','v','m') now.
--
-- service_role is deliberately left alone. It is the server-side key, never in a browser, and
-- an admin task may legitimately want to empty a table.
--
-- ─── THE BACKUP ───────────────────────────────────────────────────────────────────────────
-- Generated FROM the live state immediately before applying, so this restores exactly what was
-- there rather than approximately. A grant change is reversible; this is what reverses it.
--
-- grant REFERENCES, TRIGGER, TRUNCATE on public.account_features to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.activity_reads to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.activity_reads to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.bug_report to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.chat_messages to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.chat_messages to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.chat_reads to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.chat_reads to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.chat_room_members to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.chat_room_members to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.chat_rooms to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.chat_rooms to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.circuit_group_members to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.circuit_groups to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.circuit_log_comments to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.circuit_log_reactions to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.circuit_person_groups to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.circuit_ratings to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.circuit_ratings to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.friendships to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.invites to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.leaderboard to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.leaderboard to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.leaderboard_with_trophies to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.leaderboard_with_trophies to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.player_registry to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.player_registry to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.pool_people to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.pool_people to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.pool_votes to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.pool_votes to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.pools to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.pools to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.profile_room_invites to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.profile_room_invites to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.profile_rooms to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.profile_rooms to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.round_results to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.round_results to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.score_history to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.score_history to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.site_content to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.site_content to authenticated;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.trophies to anon;
-- grant REFERENCES, TRIGGER, TRUNCATE on public.trophies to authenticated;
--
-- plus, to undo the default-privileges line:
--   alter default privileges in schema public
--     grant truncate, trigger, references on tables to anon, authenticated;
