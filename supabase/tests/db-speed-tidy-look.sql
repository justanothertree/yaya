-- One look at what the 25 tables' policies let each kind of caller do, for the database speed
-- tidy-up (docs/applied/2026-11-25-db-speed-tidy.DRAFT.sql), recorded under a phase name.
--
-- HOW TO RUN: db-guards.yml, three times — before the draft, after it, and after its rollback:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v phase=before -f supabase/tests/db-speed-tidy-look.sql
-- then db-speed-tidy-compare.sql says whether the looks agree.
--
-- WHAT IS LOOKED AT, for anon and for each of four members (an admin, the admin's friend, nobody's
-- friend, a suspended member) in every table:
--   seen      how many rows SELECT returns, and a hash of them;
--   updated   how many rows an UPDATE setting one column to itself reaches;
--   deleted   how many rows a DELETE reaches.
-- The UPDATE and the DELETE run in a subtransaction that is always rolled back, so nothing changes;
-- an error is recorded as its SQLSTATE and compared like any other answer.
-- And the policies themselves (command, roles, kind, both expressions) and which of the draft's
-- indexes exist, so the comparison can say exactly what moved.

\set ON_ERROR_STOP 1
select set_config('tidy.phase', :'phase', false);

create schema if not exists tidy_check;
create table if not exists tidy_check.looks (
  phase text, who text, tbl text, what text, answer text, primary key (phase, who, tbl, what));
create table if not exists tidy_check.policies (
  phase text, tbl text, pol text, cmd text, kind boolean, roles text, qual text, chk text,
  primary key (phase, tbl, pol));
create table if not exists tidy_check.indexes (phase text, name text, primary key (phase, name));

do $$
declare
  phase constant text := current_setting('tidy.phase');
  tables constant text[] := array[
    'finance.allocations', 'finance.executed_trades', 'finance.family_accounts',
    'finance.user_preferences', 'public.account_features', 'public.activity_reads',
    'public.admin_users', 'public.bug_report', 'public.chat_reads', 'public.circuit_group_members',
    'public.circuit_groups', 'public.circuit_log_comments', 'public.circuit_log_reactions',
    'public.circuit_logs', 'public.circuit_movies', 'public.circuit_people',
    'public.circuit_person_groups', 'public.circuit_ratings', 'public.circuit_watchlist',
    'public.friendships', 'public.pool_people', 'public.pool_votes', 'public.pools',
    'public.profiles', 'public.user_roles'];
  who constant text[][] := array[
    ['anon', ''], ['owner', '1'], ['friend', '2'], ['stranger', '3'], ['suspended', '4']];
  w text[];
  t text;
  col text;
  n bigint;
  h text;
  seen text;
  upd text;
  del text;
  got text[] := '{}';
begin
  if exists (select 1 from tidy_check.looks where looks.phase = current_setting('tidy.phase')) then
    raise exception 'db speed tidy look: phase % was already looked at', phase;
  end if;
  foreach w slice 1 in array who loop
    foreach t in array tables loop
      /* the column an UPDATE sets to itself: the table's first, which none of these generate */
      select a.attname into col from pg_attribute a
       where a.attrelid = t::regclass and a.attnum > 0 and not a.attisdropped
       order by a.attnum limit 1;

      perform set_config('request.jwt.claims',
        case when w[2] = '' then json_build_object('role', 'anon')::text
             else json_build_object('sub', '00000000-0000-4000-a000-00000000000' || w[2],
                                    'role', 'authenticated')::text end, true);
      execute format('set local role %I', case when w[2] = '' then 'anon' else 'authenticated' end);

      begin
        execute format('select count(*), md5(coalesce(string_agg(x::text, %L order by x::text), %L)) from %s x',
                       chr(10), '', t) into n, h;
        seen := n || ' ' || h;
      exception when others then
        seen := 'error ' || sqlstate;
      end;

      upd := null;
      begin
        execute format('update %s set %I = %I', t, col, col);
        get diagnostics n = row_count;
        upd := n::text;
        raise exception using errcode = 'QT001', message = 'roll the update back';
      exception
        when sqlstate 'QT001' then null;
        when others then upd := 'error ' || sqlstate;
      end;

      del := null;
      begin
        execute format('delete from %s', t);
        get diagnostics n = row_count;
        del := n::text;
        raise exception using errcode = 'QT001', message = 'roll the delete back';
      exception
        when sqlstate 'QT001' then null;
        when others then del := 'error ' || sqlstate;
      end;

      execute 'reset role';
      got := got || array[w[1], t, 'seen', seen] || array[w[1], t, 'updated', upd]
                 || array[w[1], t, 'deleted', del];
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);

  for i in 1 .. array_length(got, 1) / 4 loop
    insert into tidy_check.looks
    values (phase, got[i * 4 - 3], got[i * 4 - 2], got[i * 4 - 1], got[i * 4]);
  end loop;

  /* schema.table always, whatever the search path would print */
  insert into tidy_check.policies
  select phase, n.nspname || '.' || c.relname, pol.polname, pol.polcmd::text, pol.polpermissive,
         pol.polroles::regrole[]::text,
         pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid)
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where (n.nspname || '.' || c.relname) = any (tables);

  insert into tidy_check.indexes
  select phase, n.nspname || '.' || c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'i' and n.nspname in ('public', 'finance') and c.relname like '%\_idx'
     and c.relname = any (array[
       'allocations_family_account_id_idx', 'family_accounts_user_id_idx', 'bug_report_reporter_idx',
       'chat_messages_user_id_idx', 'chat_reads_room_id_idx', 'chat_room_members_user_id_idx',
       'chat_song_files_message_id_idx', 'chronicle_entries_activity_idx',
       'chronicle_exercise_links_activity_idx', 'chronicle_exercise_links_owner_idx',
       'chronicle_goal_days_owner_idx', 'chronicle_plans_activity_idx', 'chronicle_sets_person_id_idx',
       'circuit_group_members_user_id_idx', 'circuit_groups_created_by_idx',
       'circuit_log_comments_log_id_idx', 'circuit_log_comments_user_id_idx',
       'circuit_log_reactions_user_id_idx', 'circuit_logs_picture_idx',
       'circuit_movies_created_by_idx', 'circuit_movies_group_id_idx',
       'circuit_people_owner_user_id_idx', 'circuit_person_claims_decided_by_idx',
       'circuit_person_claims_user_id_idx', 'circuit_person_groups_added_by_idx',
       'circuit_person_groups_group_id_idx', 'circuit_ratings_picture_idx',
       'circuit_watchlist_added_by_idx', 'circuit_watchlist_group_id_idx',
       'friendships_requested_by_idx', 'friendships_user_b_idx', 'invites_created_by_idx',
       'invites_used_by_idx', 'lab_comments_removed_by_idx', 'lab_demos_changed_by_idx',
       'lab_matches_rematch_of_idx', 'lab_results_demo_id_idx', 'park_room_invites_user_id_idx',
       'pools_owner_user_id_idx', 'profile_room_invites_user_id_idx',
       'push_deliveries_device_id_idx', 'push_outbox_user_id_idx', 'score_history_player_id_idx',
       'site_content_updated_by_idx', 'trophies_leaderboard_id_idx']);

  raise notice 'db speed tidy look: % answers recorded as "%"', array_length(got, 1) / 4, phase;
end;
$$;
