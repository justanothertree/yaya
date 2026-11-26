-- ROLLBACK for docs/2026-11-25-db-speed-tidy.DRAFT.sql: its indexes dropped, and the 54 policies
-- back to calling `auth.uid()` per row, exactly as they were.
--
-- It deletes no rows and changes no answer: an index is never what a query's result depends on,
-- and the policies go back to text that, with the wrapper taken off, is what the draft started
-- from — checked here the same way the draft checks itself. Only the indexes this draft would
-- have built are named, so an index that was already there under another name is never touched.
--
-- db-guards runs it after the draft and requires what every member can see, change and delete to
-- be what it was before either ran.

do $$
declare
  idx constant text[] := array[
    'finance.allocations_family_account_id_idx', 'finance.family_accounts_user_id_idx',
    'public.bug_report_reporter_idx', 'public.chat_messages_user_id_idx',
    'public.chat_reads_room_id_idx', 'public.chat_room_members_user_id_idx',
    'public.chat_song_files_message_id_idx', 'public.chronicle_entries_activity_idx',
    'public.chronicle_exercise_links_activity_idx', 'public.chronicle_exercise_links_owner_idx',
    'public.chronicle_goal_days_owner_idx', 'public.chronicle_plans_activity_idx',
    'public.chronicle_sets_person_id_idx', 'public.circuit_group_members_user_id_idx',
    'public.circuit_groups_created_by_idx', 'public.circuit_log_comments_log_id_idx',
    'public.circuit_log_comments_user_id_idx', 'public.circuit_log_reactions_user_id_idx',
    'public.circuit_logs_picture_idx', 'public.circuit_movies_created_by_idx',
    'public.circuit_movies_group_id_idx', 'public.circuit_people_owner_user_id_idx',
    'public.circuit_person_claims_decided_by_idx', 'public.circuit_person_claims_user_id_idx',
    'public.circuit_person_groups_added_by_idx', 'public.circuit_person_groups_group_id_idx',
    'public.circuit_ratings_picture_idx', 'public.circuit_watchlist_added_by_idx',
    'public.circuit_watchlist_group_id_idx', 'public.friendships_requested_by_idx',
    'public.friendships_user_b_idx', 'public.invites_created_by_idx', 'public.invites_used_by_idx',
    'public.lab_comments_removed_by_idx', 'public.lab_demos_changed_by_idx',
    'public.lab_matches_rematch_of_idx', 'public.lab_results_demo_id_idx',
    'public.park_room_invites_user_id_idx', 'public.pools_owner_user_id_idx',
    'public.profile_room_invites_user_id_idx', 'public.push_deliveries_device_id_idx',
    'public.push_outbox_user_id_idx', 'public.score_history_player_id_idx',
    'public.site_content_updated_by_idx', 'public.trophies_leaderboard_id_idx'
  ];
  i text;
begin
  if array_length(idx, 1) <> 45 then
    raise exception 'db speed tidy rollback: expected 45 index names, found %', array_length(idx, 1);
  end if;
  foreach i in array idx loop
    if to_regclass(i) is not null then
      execute format('drop index %s', i);
    end if;
  end loop;
end;
$$;

do $$
declare
  want constant text[][] := array[
    ['finance', 'allocations', 'allocations_select'],
    ['finance', 'executed_trades', 'executed_trades_select'],
    ['finance', 'family_accounts', 'family_accounts_select'],
    ['finance', 'user_preferences', 'Users can manage own preferences'],
    ['public', 'account_features', 'account_features_self_read'],
    ['public', 'activity_reads', 'activity_reads_own_insert'],
    ['public', 'activity_reads', 'activity_reads_own_select'],
    ['public', 'activity_reads', 'activity_reads_own_update'],
    ['public', 'admin_users', 'admin_users_select_self'],
    ['public', 'bug_report', 'report a bug'],
    ['public', 'chat_reads', 'chat_reads_own_select'],
    ['public', 'chat_reads', 'chat_reads_own_update'],
    ['public', 'chat_reads', 'chat_reads_own_write'],
    ['public', 'circuit_group_members', 'cgm_delete'],
    ['public', 'circuit_group_members', 'cgm_insert'],
    ['public', 'circuit_group_members', 'cgm_update'],
    ['public', 'circuit_groups', 'cg_delete'],
    ['public', 'circuit_groups', 'cg_insert'],
    ['public', 'circuit_groups', 'cg_modify'],
    ['public', 'circuit_groups', 'cg_select'],
    ['public', 'circuit_log_comments', 'circuit_log_comments_not_suspended'],
    ['public', 'circuit_log_comments', 'clc_delete'],
    ['public', 'circuit_log_comments', 'clc_insert'],
    ['public', 'circuit_log_comments', 'clc_update'],
    ['public', 'circuit_log_reactions', 'circuit_log_reactions_not_suspended'],
    ['public', 'circuit_log_reactions', 'clr_delete'],
    ['public', 'circuit_log_reactions', 'clr_insert'],
    ['public', 'circuit_logs', 'circuit_logs_not_suspended'],
    ['public', 'circuit_movies', 'circuit_movies_delete'],
    ['public', 'circuit_movies', 'circuit_movies_insert'],
    ['public', 'circuit_movies', 'circuit_movies_not_suspended'],
    ['public', 'circuit_movies', 'circuit_movies_update'],
    ['public', 'circuit_people', 'circuit_people_insert'],
    ['public', 'circuit_people', 'circuit_people_not_suspended'],
    ['public', 'circuit_person_groups', 'cpg_delete'],
    ['public', 'circuit_ratings', 'circuit_ratings_delete'],
    ['public', 'circuit_ratings', 'circuit_ratings_insert'],
    ['public', 'circuit_ratings', 'circuit_ratings_not_suspended'],
    ['public', 'circuit_ratings', 'circuit_ratings_update'],
    ['public', 'circuit_watchlist', 'circuit_watchlist_delete'],
    ['public', 'circuit_watchlist', 'circuit_watchlist_not_suspended'],
    ['public', 'friendships', 'friendships_select'],
    ['public', 'pool_people', 'pool_people_delete'],
    ['public', 'pool_people', 'pool_people_insert'],
    ['public', 'pool_people', 'pool_people_not_suspended'],
    ['public', 'pool_votes', 'pool_votes_delete'],
    ['public', 'pool_votes', 'pool_votes_insert'],
    ['public', 'pool_votes', 'pool_votes_not_suspended'],
    ['public', 'pools', 'pools_delete'],
    ['public', 'pools', 'pools_insert'],
    ['public', 'pools', 'pools_not_suspended'],
    ['public', 'pools', 'pools_update'],
    ['public', 'profiles', 'profiles_select'],
    ['public', 'user_roles', 'user_roles_select_self']
  ];
  wrapped constant text := '( SELECT auth.uid() AS uid)';
  w text[];
  p record;
  q_new text;
  c_new text;
  sql text;
  after record;
begin
  foreach w slice 1 in array want loop
    select pol.oid, pol.polcmd, pol.polpermissive, pol.polroles,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as chk
      into p
      from pg_policy pol
     where pol.polrelid = to_regclass(format('%I.%I', w[1], w[2])) and pol.polname = w[3];
    if p.oid is null then
      raise exception 'db speed tidy rollback: no policy "%" on %.%', w[3], w[1], w[2];
    end if;
    q_new := replace(p.qual, wrapped, 'auth.uid()');
    c_new := replace(p.chk, wrapped, 'auth.uid()');
    continue when q_new is not distinct from p.qual and c_new is not distinct from p.chk;
    sql := format('alter policy %I on %I.%I', w[3], w[1], w[2]);
    if q_new is not null then sql := sql || format(' using (%s)', q_new); end if;
    if c_new is not null then sql := sql || format(' with check (%s)', c_new); end if;
    execute sql;
    select pol.polcmd, pol.polpermissive, pol.polroles,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as chk
      into after
      from pg_policy pol where pol.oid = p.oid;
    if after.polcmd <> p.polcmd or after.polpermissive <> p.polpermissive
       or after.polroles <> p.polroles
       or after.qual is distinct from q_new or after.chk is distinct from c_new then
      raise exception 'db speed tidy rollback: "%" on %.% did not come back as it was', w[3], w[1], w[2];
    end if;
  end loop;
end;
$$;
