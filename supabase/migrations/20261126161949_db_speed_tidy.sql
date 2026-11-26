-- ✅ APPLIED to production 26 Nov 2026 at 11:19 AM EST as migration `db_speed_tidy`, version
-- 20261126161949, with Evan's approval that morning. Production recorded md5(statements[1]) =
-- acb001909c394f034cd6df49eaf0106c (12,462 bytes), this file's body byte for byte.
-- Before it (Check A, docs/2026-11-25-db-speed-tidy.checks.sql): the advisors flagged exactly the
-- draft's 47 unindexed foreign keys and 54 auth_rls_initplan policies; 90 policies in public and
-- finance, 54 of them calling auth.uid() bare; none of the 45 index names taken. After (Check B):
-- all 45 indexes valid, b-tree, on exactly their columns; the 54 wrapped and none bare; every
-- policy's definition, with the wrapper taken off, the same as before (62725dd4…); and the
-- advisors reporting neither lint. Live, as anon and as each of the 14 members: all 2,852 answers
-- — what each can SELECT in the 82 RLS tables, and what every policy that applies to them admits
-- of those rows — the same before and after (57a61de8…), with no table's contents moving between
-- the looks; the same look with auth.uid() swapped for a stranger's moved (6c8bb723…), so it can
-- tell. Why: docs/applied/2026-11-25-db-speed-tidy.DRAFT.sql. Undo:
-- docs/2026-11-25-db-speed-tidy.ROLLBACK.sql.

-- ── part 1: an index under each unindexed foreign key ─────────────────────────────────────────
do $$
declare
  /* schema, table, column, and the foreign key(s) on that column the advisors named */
  want constant text[][] := array[
    ['finance', 'allocations', 'family_account_id', 'allocations_family_account_fk', ''],
    ['finance', 'family_accounts', 'user_id', 'family_accounts_user_fk', ''],
    ['public', 'bug_report', 'reporter', 'bug_report_reporter_fkey', ''],
    ['public', 'chat_messages', 'user_id', 'chat_messages_user_id_fkey', ''],
    ['public', 'chat_reads', 'room_id', 'chat_reads_room_id_fkey', ''],
    ['public', 'chat_room_members', 'user_id', 'chat_room_members_user_id_fkey', ''],
    ['public', 'chat_song_files', 'message_id', 'chat_song_files_message_id_fkey', ''],
    ['public', 'chronicle_entries', 'activity', 'chronicle_entries_activity_fkey', ''],
    ['public', 'chronicle_exercise_links', 'activity', 'chronicle_exercise_links_activity_fkey', ''],
    ['public', 'chronicle_exercise_links', 'owner', 'chronicle_exercise_links_owner_fkey', ''],
    ['public', 'chronicle_goal_days', 'owner', 'chronicle_goal_days_owner_fkey', ''],
    ['public', 'chronicle_plans', 'activity', 'chronicle_plans_activity_fkey', ''],
    ['public', 'chronicle_sets', 'person_id', 'chronicle_sets_person_id_fkey', ''],
    ['public', 'circuit_group_members', 'user_id', 'circuit_group_members_user_id_fkey', ''],
    ['public', 'circuit_groups', 'created_by', 'circuit_groups_created_by_fkey', ''],
    ['public', 'circuit_log_comments', 'log_id', 'circuit_log_comments_log_id_fkey', ''],
    ['public', 'circuit_log_comments', 'user_id', 'circuit_log_comments_user_id_fkey', ''],
    ['public', 'circuit_log_reactions', 'user_id', 'circuit_log_reactions_user_id_fkey', ''],
    ['public', 'circuit_logs', 'picture', 'circuit_logs_picture_fkey', ''],
    ['public', 'circuit_movies', 'created_by', 'circuit_movies_created_by_fkey', ''],
    ['public', 'circuit_movies', 'group_id', 'circuit_movies_group_id_fkey', ''],
    ['public', 'circuit_people', 'owner_user_id', 'circuit_people_owner_user_id_fkey', ''],
    ['public', 'circuit_person_claims', 'decided_by', 'circuit_person_claims_decided_by_fkey', ''],
    ['public', 'circuit_person_claims', 'user_id', 'circuit_person_claims_user_id_fkey', ''],
    ['public', 'circuit_person_groups', 'added_by', 'circuit_person_groups_added_by_fkey', ''],
    ['public', 'circuit_person_groups', 'group_id', 'circuit_person_groups_group_id_fkey', ''],
    ['public', 'circuit_ratings', 'picture', 'circuit_ratings_picture_fkey', ''],
    ['public', 'circuit_watchlist', 'added_by', 'circuit_watchlist_added_by_fkey', ''],
    ['public', 'circuit_watchlist', 'group_id', 'circuit_watchlist_group_id_fkey', ''],
    ['public', 'friendships', 'requested_by', 'friendships_requested_by_fkey', ''],
    ['public', 'friendships', 'user_b', 'friendships_user_b_fkey', ''],
    ['public', 'invites', 'created_by', 'invites_created_by_fkey', ''],
    ['public', 'invites', 'used_by', 'invites_used_by_fkey', ''],
    ['public', 'lab_comments', 'removed_by', 'lab_comments_removed_by_fkey', ''],
    ['public', 'lab_demos', 'changed_by', 'lab_demos_changed_by_fkey', ''],
    ['public', 'lab_matches', 'rematch_of', 'lab_matches_rematch_of_fkey', ''],
    ['public', 'lab_results', 'demo_id', 'lab_results_demo_id_fkey', ''],
    ['public', 'park_room_invites', 'user_id', 'park_room_invites_user_id_fkey', ''],
    ['public', 'pools', 'owner_user_id', 'pools_owner_user_id_fkey', ''],
    ['public', 'profile_room_invites', 'user_id', 'profile_room_invites_user_id_fkey', ''],
    ['public', 'push_deliveries', 'device_id', 'push_deliveries_device_id_fkey', ''],
    ['public', 'push_outbox', 'user_id', 'push_outbox_user_id_fkey', ''],
    ['public', 'score_history', 'player_id', 'fk_scorehistory_player', 'score_history_player_id_fkey'],
    ['public', 'site_content', 'updated_by', 'site_content_updated_by_fkey', ''],
    ['public', 'trophies', 'leaderboard_id', 'fk_trophies_leaderboard', 'trophies_leaderboard_id_fkey']
  ];
  w text[];
  rel regclass;
  att smallint;
  fk text;
  built int := 0;
  absent int := 0;
  covered int := 0;
begin
  if array_length(want, 1) <> 45 then
    raise exception 'db speed tidy: expected 45 columns in the list, found %', array_length(want, 1);
  end if;
  foreach w slice 1 in array want loop
    rel := to_regclass(format('%I.%I', w[1], w[2]));
    if rel is null then
      absent := absent + 1;
      raise notice 'db speed tidy: %.% is not on this database, skipped', w[1], w[2];
      continue;
    end if;
    select a.attnum into att from pg_attribute a
     where a.attrelid = rel and a.attname = w[3] and a.attnum > 0 and not a.attisdropped;
    if att is null then
      raise exception 'db speed tidy: %.% has no column %', w[1], w[2], w[3];
    end if;
    foreach fk in array w[4:5] loop
      continue when fk = '';
      if not exists (select 1 from pg_constraint c
                      where c.conrelid = rel and c.conname = fk and c.contype = 'f'
                        and c.conkey = array[att]) then
        raise exception 'db speed tidy: %.% has no foreign key % on % alone', w[1], w[2], fk, w[3];
      end if;
    end loop;
    if exists (select 1 from pg_index i where i.indrelid = rel and i.indkey[0] = att) then
      covered := covered + 1;
      raise notice 'db speed tidy: %.%(%) already leads an index, skipped', w[1], w[2], w[3];
      continue;
    end if;
    execute format('create index %I on %I.%I (%I)', w[2] || '_' || w[3] || '_idx', w[1], w[2], w[3]);
    built := built + 1;
  end loop;
  raise notice 'db speed tidy: % indexes built, % tables not here, % columns already covered',
    built, absent, covered;
end;
$$;

-- ── part 2: `auth.uid()` once per query in the 54 policies, meaning unchanged ─────────────────
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
  /* how Postgres prints `(select auth.uid())` back, and a stand-in for it while bare calls are
     replaced, so a call that is already wrapped is never wrapped twice */
  wrapped constant text := '( SELECT auth.uid() AS uid)';
  hold constant text := chr(1) || 'held' || chr(1);
  w text[];
  rel regclass;
  p record;
  q_old text;
  c_old text;
  q_new text;
  c_new text;
  sql text;
  after record;
  done int := 0;
  already int := 0;
begin
  if array_length(want, 1) <> 54 then
    raise exception 'db speed tidy: expected 54 policies in the list, found %', array_length(want, 1);
  end if;
  foreach w slice 1 in array want loop
    rel := to_regclass(format('%I.%I', w[1], w[2]));
    select pol.oid, pol.polcmd, pol.polpermissive, pol.polroles,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as chk
      into p
      from pg_policy pol
     where pol.polrelid = rel and pol.polname = w[3];
    if rel is null or p.oid is null then
      raise exception 'db speed tidy: no policy "%" on %.%', w[3], w[1], w[2];
    end if;
    q_old := p.qual;
    c_old := p.chk;
    /* nothing bare left in either: done before, so there is nothing to change */
    if coalesce(position('auth.uid()' in replace(q_old, wrapped, '')), 0) = 0
       and coalesce(position('auth.uid()' in replace(c_old, wrapped, '')), 0) = 0 then
      already := already + 1;
      continue;
    end if;
    q_new := replace(replace(replace(q_old, wrapped, hold), 'auth.uid()', '(select auth.uid())'), hold, wrapped);
    c_new := replace(replace(replace(c_old, wrapped, hold), 'auth.uid()', '(select auth.uid())'), hold, wrapped);
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
       or after.polroles <> p.polroles then
      raise exception 'db speed tidy: "%" on %.% changed its command, roles or kind', w[3], w[1], w[2];
    end if;
    if replace(after.qual, wrapped, 'auth.uid()') is distinct from q_old
       or replace(after.chk, wrapped, 'auth.uid()') is distinct from c_old then
      raise exception 'db speed tidy: "%" on %.% would mean something else: % / % became % / %',
        w[3], w[1], w[2], q_old, c_old, after.qual, after.chk;
    end if;
    if position('auth.uid()' in replace(coalesce(after.qual, ''), wrapped, '')) > 0
       or position('auth.uid()' in replace(coalesce(after.chk, ''), wrapped, '')) > 0 then
      raise exception 'db speed tidy: "%" on %.% still calls auth.uid() per row', w[3], w[1], w[2];
    end if;
    done := done + 1;
  end loop;
  if done + already <> 54 then
    raise exception 'db speed tidy: % policies rewritten and % already done, which is not 54', done, already;
  end if;
  raise notice 'db speed tidy: % policies rewritten, % were already done, each checked unchanged in meaning',
    done, already;
end;
$$;
