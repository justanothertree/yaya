-- Read-only checks for docs/applied/2026-11-25-db-speed-tidy.DRAFT.sql. Nothing here writes: every
-- statement is a SELECT, a set_config or a SET LOCAL ROLE, and the role and settings end with the
-- transaction. Run each section as ONE call (execute_sql runs a call as one transaction, which is
-- what lets SET LOCAL ROLE reach the statements after it).
--
-- CI proved the draft on fixture rows (supabase/tests/db-speed-tidy-*.sql). These ask the same
-- question of production's own rows, from the outside: what anon and every member can SEE, and
-- which of the rows they can see each policy's own expressions admit, before and after.

-- ── CHECK A1 and B1: the policies and the indexes ─────────────────────────────────────────────
-- Expect, BEFORE: policies 90, unwrapped_digest D (write it down), wrapped 0, bare 54,
--   index_names_taken 0, indexes_built 0.
-- Expect, AFTER: policies 90, unwrapped_digest exactly D, wrapped 54, bare 0,
--   index_names_taken 45, indexes_built 45 (each one valid, b-tree, on exactly its column).
-- `unwrapped_digest` fingerprints every policy in public and finance — table, name, command,
-- permissive or restrictive, roles, USING and WITH CHECK — with `( SELECT auth.uid() AS uid)`
-- written back as `auth.uid()`. So it is the same number before and after exactly when the only
-- thing that moved anywhere is the wrapper.
with want(sch, tbl, col) as (values
  ('finance', 'allocations', 'family_account_id'), ('finance', 'family_accounts', 'user_id'),
  ('public', 'bug_report', 'reporter'), ('public', 'chat_messages', 'user_id'),
  ('public', 'chat_reads', 'room_id'), ('public', 'chat_room_members', 'user_id'),
  ('public', 'chat_song_files', 'message_id'), ('public', 'chronicle_entries', 'activity'),
  ('public', 'chronicle_exercise_links', 'activity'), ('public', 'chronicle_exercise_links', 'owner'),
  ('public', 'chronicle_goal_days', 'owner'), ('public', 'chronicle_plans', 'activity'),
  ('public', 'chronicle_sets', 'person_id'), ('public', 'circuit_group_members', 'user_id'),
  ('public', 'circuit_groups', 'created_by'), ('public', 'circuit_log_comments', 'log_id'),
  ('public', 'circuit_log_comments', 'user_id'), ('public', 'circuit_log_reactions', 'user_id'),
  ('public', 'circuit_logs', 'picture'), ('public', 'circuit_movies', 'created_by'),
  ('public', 'circuit_movies', 'group_id'), ('public', 'circuit_people', 'owner_user_id'),
  ('public', 'circuit_person_claims', 'decided_by'), ('public', 'circuit_person_claims', 'user_id'),
  ('public', 'circuit_person_groups', 'added_by'), ('public', 'circuit_person_groups', 'group_id'),
  ('public', 'circuit_ratings', 'picture'), ('public', 'circuit_watchlist', 'added_by'),
  ('public', 'circuit_watchlist', 'group_id'), ('public', 'friendships', 'requested_by'),
  ('public', 'friendships', 'user_b'), ('public', 'invites', 'created_by'),
  ('public', 'invites', 'used_by'), ('public', 'lab_comments', 'removed_by'),
  ('public', 'lab_demos', 'changed_by'), ('public', 'lab_matches', 'rematch_of'),
  ('public', 'lab_results', 'demo_id'), ('public', 'park_room_invites', 'user_id'),
  ('public', 'pools', 'owner_user_id'), ('public', 'profile_room_invites', 'user_id'),
  ('public', 'push_deliveries', 'device_id'), ('public', 'push_outbox', 'user_id'),
  ('public', 'score_history', 'player_id'), ('public', 'site_content', 'updated_by'),
  ('public', 'trophies', 'leaderboard_id')),
pol as (
  select schemaname, tablename, policyname, permissive, roles::text as roles, cmd,
         coalesce(qual, '-') as qual, coalesce(with_check, '-') as chk
    from pg_policies where schemaname in ('public', 'finance'))
select (select count(*) from want) as listed,
       (select count(*) from pol) as policies,
       (select md5(string_agg(concat_ws(' | ', schemaname, tablename, policyname, permissive, roles, cmd,
                                        replace(qual, '( SELECT auth.uid() AS uid)', 'auth.uid()'),
                                        replace(chk, '( SELECT auth.uid() AS uid)', 'auth.uid()')),
                              E'\n' order by schemaname, tablename, policyname)) from pol) as unwrapped_digest,
       (select count(*) from pol where position('( SELECT auth.uid() AS uid)' in qual || chk) > 0) as wrapped,
       (select count(*) from pol
         where position('auth.uid()' in replace(qual || chk, '( SELECT auth.uid() AS uid)', '')) > 0) as bare,
       (select count(*) from want w join pg_class i on i.relname = w.tbl || '_' || w.col || '_idx'
          join pg_namespace n on n.oid = i.relnamespace and n.nspname = w.sch) as index_names_taken,
       (select count(*) from want w
          join pg_index x on x.indrelid = to_regclass(format('%I.%I', w.sch, w.tbl))
          join pg_class i on i.oid = x.indexrelid and i.relname = w.tbl || '_' || w.col || '_idx'
          join pg_am am on am.oid = i.relam and am.amname = 'btree'
          join pg_attribute a on a.attrelid = x.indrelid and a.attname = w.col
         where x.indisvalid and x.indnkeyatts = 1 and x.indkey[0] = a.attnum) as indexes_built,
       now() as at;

-- ── CHECK A2 and B2: what every caller sees, run as ONE call ──────────────────────────────────
-- For anon and for each member in turn (by auth.users id, so nobody is named), as their own role
-- with their own claims, exactly as the API would ask:
--   seen    — every RLS table in public and finance: how many rows they can SELECT, and a hash of
--             those rows;
--   using / check — every policy that applies to their role, its own USING and WITH CHECK
--             expressions evaluated over the rows they can see: how many each admits, and a hash.
--             That is how the INSERT, UPDATE and DELETE policies are asked anything without
--             writing a row.
-- An answer can be `nogrant` (the role may not SELECT the table at all) or `error <sqlstate>` —
-- anon reading chat_messages, for one, is refused because its policy calls a function anon may
-- not execute, which is what the API answers too. Both are answers, and both must hold still.
-- Caller 0 is this session's own role, which RLS does not bind, so its `seen` is the tables'
-- whole contents: the CHURN DETECTOR. Production is live, and a member chatting between the two
-- looks moves a table; the comparison only means something for tables whose contents held still.
-- Expect AFTER: `users`, `answers`, `asked` and `errors` as before, and `everything` exactly the
-- before value — or, if `contents` moved, every table whose content hash is unchanged showing an
-- unchanged look, and then both looks taken again in a quieter minute.
do $$
declare
  /* '' is this session's own role (the contents), then anon, then every member by id */
  callers constant text[] := array['', 'anon'] || (select array_agg(id::text order by id) from auth.users);
  who text;
  i int := 0;
  q record;
  v text;
  answers text[] := '{}';
begin
  foreach who in array callers loop
    if who = 'anon' then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      execute 'set local role anon';
    elsif who <> '' then
      perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
    for q in
      select c.oid as rel, c.oid::regclass::text || '|seen' as k,
             format('select count(*) || '':'' || md5(coalesce(string_agg(row(%1$I.*)::text, '','' order by row(%1$I.*)::text), '''')) from %2$s',
                    c.relname, c.oid::regclass) as sql
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'finance') and c.relkind = 'r' and c.relrowsecurity
      union all
      select p.polrelid, p.polrelid::regclass::text || '|' || p.polname || '|' || e.part,
             format('select count(*) || '':'' || md5(coalesce(string_agg(row(%1$I.*)::text, '','' order by row(%1$I.*)::text), '''')) from %2$s where (%3$s)',
                    c.relname, p.polrelid::regclass, e.expr)
        from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
       cross join lateral (values ('using', pg_get_expr(p.polqual, p.polrelid)),
                                  ('check', pg_get_expr(p.polwithcheck, p.polrelid))) e(part, expr)
       where n.nspname in ('public', 'finance') and e.expr is not null
         and (p.polroles = '{0}' or (select r.oid from pg_roles r where r.rolname = current_user) = any (p.polroles))
       order by 2
    loop
      begin
        if has_table_privilege(q.rel, 'select') then
          execute q.sql into v;
        else
          v := 'nogrant';
        end if;
      exception when others then
        v := 'error ' || sqlstate;
      end;
      answers := answers || (i || '/' || q.k || '=' || v);
    end loop;
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
    i := i + 1;
  end loop;
  perform set_config('tidy.answers', array_to_string(answers, ';'), true);
end;
$$;
with entries as (
  select split_part(e, '/', 1)::int as i,
         split_part(substr(e, strpos(e, '/') + 1), '=', 1) as k,
         split_part(substr(e, strpos(e, '/') + 1), '=', 2) as v
    from regexp_split_to_table(current_setting('tidy.answers'), ';') e),
tabled as (select *, split_part(k, '|', 1) as tbl from entries),
per_table as (
  select tbl,
         max(v) filter (where i = 0 and k = tbl || '|seen') as content,
         left(md5(string_agg(i || '/' || k || '=' || v, ';' order by i, k) filter (where i > 0)), 10) as look
    from tabled group by tbl)
select (select count(*) from auth.users) as users,
       (select count(distinct i) from entries) - 1 as callers,
       (select count(*) from entries where i > 0) as answers,
       (select count(*) from entries where i > 0 and v ~ '^[0-9]') as asked,
       (select count(*) from entries where i > 0 and v like 'error%') as errors,
       (select count(distinct tbl) from tabled where i > 0 and k like '%|seen' and v ~ '^[1-9]') as tables_showing_rows,
       (select count(*) from (select tbl from tabled where i > 0 and k like '%|seen' group by tbl
                               having count(distinct v) > 1) d) as tables_telling_callers_apart,
       (select md5(string_agg(i || '/' || k || '=' || v, ';' order by i, k)) from entries where i > 0) as everything,
       (select md5(string_agg(tbl || '=' || content, ';' order by tbl)) from per_table) as contents,
       (select string_agg(tbl || ' ' || left(md5(content), 8) || ' ' || look, E'\n' order by tbl) from per_table) as tables,
       now() as at;

-- ── WHAT THEY SAID, 26 Nov 2026 (applied 11:19 AM EST as 20261126161949_db_speed_tidy) ──────────
-- Advisors before (16:12 UTC): unindexed_foreign_keys 47 and auth_rls_initplan 54, exactly the
--   draft's two lists. After (16:21 UTC): neither lint. unused_index went 10 -> 50 because 40 of
--   the new indexes are minutes old and have not been read yet; it is an INFO lint, not a reason
--   to drop any of them. multiple_permissive_policies 12, unchanged and out of scope.
-- A1 (16:15 UTC): listed 45, policies 90, unwrapped_digest 62725dd471d819e905d05b389631c906,
--   wrapped 0, bare 54, index_names_taken 0, indexes_built 0.
-- B1 (16:21 UTC): listed 45, policies 90, unwrapped_digest 62725dd471d819e905d05b389631c906,
--   wrapped 54, bare 0, index_names_taken 45, indexes_built 45.
-- A2 (16:17 UTC) and B2 (16:20 UTC), identical: users 14, callers 15, answers 2852, asked 2121,
--   errors 6, tables_showing_rows 31, tables_telling_callers_apart 32,
--   everything 57a61de8620b99242da3a00190426387, contents 80c5c5a5d434fdc5845cafb063fd8369.
-- MADE TO FAIL (16:22 UTC): the same look with `( SELECT auth.uid() AS uid)` replaced by a
--   stranger's id in every policy expression gave everything 6c8bb723e5ed56c2fbf3e96ae3bcb2f5,
--   so a rewrite that broke whose rows a policy means would have shown.
-- The record: md5(statements[1]) = acb001909c394f034cd6df49eaf0106c, 12,462 bytes, the draft's
--   body byte for byte.
