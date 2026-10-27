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
