-- TRUNCATE, TRIGGER and REFERENCES are the three privileges in the schema's default ACL that no
-- RLS policy can ever restrain and that PostgREST never emits. `pg_default_acl` on `public` hands
-- them to anon and authenticated on every new table, so this is a correction, not a feature.
--
-- Applied 27 Oct 2026 as migration `revoke_truncate_trigger_references_api_roles`.
-- Evidence, the undo script, and the residual supabase_admin gap:
--   docs/2026-10-26-truncate-grants-sweep.sql
--
-- Measured before applying, in a rolled-back transaction: a scratch table with RLS enabled and
-- policies for `authenticated` only, holding three rows. As anon the INSERT was refused and the
-- TRUNCATE emptied it. There is no TRUNCATE policy type, so RLS never applies to it; what stood
-- between anon and an empty table was PostgREST having no verb that emits one.
--
-- SELECT/INSERT/UPDATE/DELETE are deliberately untouched: 15 tables carry policies declared
-- `TO public`, which includes anon, so those grants are load-bearing on published pages. A survey
-- asking `roles::text like '%anon%'` says zero such tables, and is wrong — `{public}` does not
-- contain the string "anon".
--
-- service_role is left alone. It is the server-side key, never in a browser, and an admin task may
-- legitimately want to empty a table.
--
-- ⚠️ ON REPLAY, the `v_before = 0` assertion assumes the tables were created with the schema's
-- default ACL still intact — i.e. this runs AFTER the tables exist and BEFORE the
-- `alter default privileges` at the bottom has taken effect for them. That is the real order of
-- events and the order a replay produces. Run it twice in a row and the second pass will raise,
-- on purpose: an empty sweep means the question is wrong, not that the schema is clean.

do $$
declare
  r record;
  v_before int := 0;
  v_after int := 0;
  v_done int := 0;
  v_failed text[] := '{}';
begin
  -- the default-privileges line at the end only amends the entry for the role that runs it
  if current_user <> 'postgres' then
    raise exception 'must run as postgres so the default-privileges change attaches there; am %', current_user;
  end if;

  select count(*) into v_before
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p','v','m')
     and (has_table_privilege('anon', c.oid, 'TRUNCATE')
       or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
       or has_table_privilege('anon', c.oid, 'TRIGGER')
       or has_table_privilege('authenticated', c.oid, 'TRIGGER')
       or has_table_privilege('anon', c.oid, 'REFERENCES')
       or has_table_privilege('authenticated', c.oid, 'REFERENCES'));

  if v_before = 0 then
    raise exception 'nothing is exposed -- the survey query is wrong, not the schema';
  end if;

  /* ⚠️ views and matviews too. The first draft filtered relkind in ('r','p') and would have
     walked past `leaderboard_with_trophies`, a VIEW carrying TRIGGER for anon. TRUNCATE and
     REFERENCES on a view are meaningless; TRIGGER is not — it is the privilege for attaching one,
     and an INSTEAD OF trigger on a view is a real thing. */
  for r in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p','v','m')
     order by c.relname
  loop
    begin
      /* `from public, anon` and not `from public` alone: anon holds these DIRECTLY here */
      execute format(
        'revoke truncate, trigger, references on public.%I from public, anon, authenticated',
        r.relname);
      v_done := v_done + 1;
    exception when others then
      -- collect it and name it; the raise below rolls everything back rather than forcing it
      v_failed := v_failed || format('%s (%s)', r.relname, sqlerrm);
    end;
  end loop;

  if array_length(v_failed, 1) > 0 then
    raise exception 'not forcing it through -- these objects refused: %', array_to_string(v_failed, '; ');
  end if;

  select count(*) into v_after
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p','v','m')
     and (has_table_privilege('anon', c.oid, 'TRUNCATE')
       or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
       or has_table_privilege('anon', c.oid, 'TRIGGER')
       or has_table_privilege('authenticated', c.oid, 'TRIGGER')
       or has_table_privilege('anon', c.oid, 'REFERENCES')
       or has_table_privilege('authenticated', c.oid, 'REFERENCES'));

  raise notice 'swept % objects: % exposed before, % after', v_done, v_before, v_after;

  if v_after > 0 then
    raise exception 'still % object(s) with truncate/trigger/references for an api role', v_after;
  end if;
end $$;

-- future tables created BY POSTGRES. The supabase_admin default-ACL entry cannot be amended from
-- here: pg_has_role(current_user,'supabase_admin','member') is false and this project's postgres
-- is not a superuser. It affects 0 tables today (supabase_admin owns none in public) and would
-- need the dashboard or Supabase support.
alter default privileges in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
