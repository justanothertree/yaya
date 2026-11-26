-- Do two looks at the 25 tables agree? For the database speed tidy-up
-- (docs/2026-11-25-db-speed-tidy.DRAFT.sql) — see db-speed-tidy-look.sql for what a look holds.
--
-- HOW TO RUN: db-guards.yml, after each look but the first:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v want=after -f supabase/tests/db-speed-tidy-compare.sql
-- It raises, listing every disagreement, if anything a member could see, change or delete moved.
--
-- `after` is the draft: the 54 policies must differ from `before` ONLY by `auth.uid()` having
-- become `( SELECT auth.uid() AS uid)`, every other policy must be untouched, and every index the
-- draft names must exist on each of its tables that this database has.
-- `rolled_back` is its rollback: every policy exactly as `before`, and none of those indexes left.

\set ON_ERROR_STOP 1
select set_config('tidy.want', :'want', false);

do $$
declare
  want constant text := current_setting('tidy.want');
  wrapped constant text := '( SELECT auth.uid() AS uid)';
  flagged constant text[] := array[
    'finance.allocations.allocations_select', 'finance.executed_trades.executed_trades_select',
    'finance.family_accounts.family_accounts_select', 'finance.user_preferences.Users can manage own preferences',
    'public.account_features.account_features_self_read', 'public.activity_reads.activity_reads_own_insert',
    'public.activity_reads.activity_reads_own_select', 'public.activity_reads.activity_reads_own_update',
    'public.admin_users.admin_users_select_self', 'public.bug_report.report a bug', 'public.chat_reads.chat_reads_own_select',
    'public.chat_reads.chat_reads_own_update', 'public.chat_reads.chat_reads_own_write', 'public.circuit_group_members.cgm_delete',
    'public.circuit_group_members.cgm_insert', 'public.circuit_group_members.cgm_update', 'public.circuit_groups.cg_delete',
    'public.circuit_groups.cg_insert', 'public.circuit_groups.cg_modify', 'public.circuit_groups.cg_select',
    'public.circuit_log_comments.circuit_log_comments_not_suspended', 'public.circuit_log_comments.clc_delete',
    'public.circuit_log_comments.clc_insert', 'public.circuit_log_comments.clc_update',
    'public.circuit_log_reactions.circuit_log_reactions_not_suspended', 'public.circuit_log_reactions.clr_delete',
    'public.circuit_log_reactions.clr_insert', 'public.circuit_logs.circuit_logs_not_suspended',
    'public.circuit_movies.circuit_movies_delete', 'public.circuit_movies.circuit_movies_insert',
    'public.circuit_movies.circuit_movies_not_suspended', 'public.circuit_movies.circuit_movies_update',
    'public.circuit_people.circuit_people_insert', 'public.circuit_people.circuit_people_not_suspended',
    'public.circuit_person_groups.cpg_delete', 'public.circuit_ratings.circuit_ratings_delete',
    'public.circuit_ratings.circuit_ratings_insert', 'public.circuit_ratings.circuit_ratings_not_suspended',
    'public.circuit_ratings.circuit_ratings_update', 'public.circuit_watchlist.circuit_watchlist_delete',
    'public.circuit_watchlist.circuit_watchlist_not_suspended', 'public.friendships.friendships_select',
    'public.pool_people.pool_people_delete', 'public.pool_people.pool_people_insert',
    'public.pool_people.pool_people_not_suspended', 'public.pool_votes.pool_votes_delete',
    'public.pool_votes.pool_votes_insert', 'public.pool_votes.pool_votes_not_suspended', 'public.pools.pools_delete',
    'public.pools.pools_insert', 'public.pools.pools_not_suspended', 'public.pools.pools_update',
    'public.profiles.profiles_select', 'public.user_roles.user_roles_select_self'];
  /* the draft's index list, as schema.table and the index it gets */
  idx constant text[][] := array[
    ['finance.allocations', 'allocations_family_account_id_idx'], ['finance.family_accounts', 'family_accounts_user_id_idx'],
    ['public.bug_report', 'bug_report_reporter_idx'], ['public.chat_messages', 'chat_messages_user_id_idx'],
    ['public.chat_reads', 'chat_reads_room_id_idx'], ['public.chat_room_members', 'chat_room_members_user_id_idx'],
    ['public.chat_song_files', 'chat_song_files_message_id_idx'], ['public.chronicle_entries', 'chronicle_entries_activity_idx'],
    ['public.chronicle_exercise_links', 'chronicle_exercise_links_activity_idx'],
    ['public.chronicle_exercise_links', 'chronicle_exercise_links_owner_idx'],
    ['public.chronicle_goal_days', 'chronicle_goal_days_owner_idx'], ['public.chronicle_plans', 'chronicle_plans_activity_idx'],
    ['public.chronicle_sets', 'chronicle_sets_person_id_idx'], ['public.circuit_group_members', 'circuit_group_members_user_id_idx'],
    ['public.circuit_groups', 'circuit_groups_created_by_idx'], ['public.circuit_log_comments', 'circuit_log_comments_log_id_idx'],
    ['public.circuit_log_comments', 'circuit_log_comments_user_id_idx'],
    ['public.circuit_log_reactions', 'circuit_log_reactions_user_id_idx'], ['public.circuit_logs', 'circuit_logs_picture_idx'],
    ['public.circuit_movies', 'circuit_movies_created_by_idx'], ['public.circuit_movies', 'circuit_movies_group_id_idx'],
    ['public.circuit_people', 'circuit_people_owner_user_id_idx'],
    ['public.circuit_person_claims', 'circuit_person_claims_decided_by_idx'],
    ['public.circuit_person_claims', 'circuit_person_claims_user_id_idx'],
    ['public.circuit_person_groups', 'circuit_person_groups_added_by_idx'],
    ['public.circuit_person_groups', 'circuit_person_groups_group_id_idx'],
    ['public.circuit_ratings', 'circuit_ratings_picture_idx'], ['public.circuit_watchlist', 'circuit_watchlist_added_by_idx'],
    ['public.circuit_watchlist', 'circuit_watchlist_group_id_idx'], ['public.friendships', 'friendships_requested_by_idx'],
    ['public.friendships', 'friendships_user_b_idx'], ['public.invites', 'invites_created_by_idx'],
    ['public.invites', 'invites_used_by_idx'], ['public.lab_comments', 'lab_comments_removed_by_idx'],
    ['public.lab_demos', 'lab_demos_changed_by_idx'], ['public.lab_matches', 'lab_matches_rematch_of_idx'],
    ['public.lab_results', 'lab_results_demo_id_idx'], ['public.park_room_invites', 'park_room_invites_user_id_idx'],
    ['public.pools', 'pools_owner_user_id_idx'], ['public.profile_room_invites', 'profile_room_invites_user_id_idx'],
    ['public.push_deliveries', 'push_deliveries_device_id_idx'], ['public.push_outbox', 'push_outbox_user_id_idx'],
    ['public.score_history', 'score_history_player_id_idx'], ['public.site_content', 'site_content_updated_by_idx'],
    ['public.trophies', 'trophies_leaderboard_id_idx']];
  fails text[] := '{}';
  r record;
  i text[];
  wanted int := 0;
  rewritten int := 0;
  differs int;
  saw int;
begin
  if not exists (select 1 from tidy_check.looks where phase = want) then
    raise exception 'db speed tidy compare: nothing was looked at as "%"', want;
  end if;

  /* 1. what every caller could see, change and delete */
  for r in
    select b.who, b.tbl, b.what, b.answer as was, a.answer as now
      from tidy_check.looks b
      left join tidy_check.looks a on a.phase = want and a.who = b.who and a.tbl = b.tbl and a.what = b.what
     where b.phase = 'before' and a.answer is distinct from b.answer
  loop
    fails := fails || format('%s %s %s: %s, now %s', r.who, r.what, r.tbl, r.was, coalesce(r.now, 'not looked at'));
  end loop;

  /* 2. the policies themselves */
  for r in
    select b.tbl, b.pol, b.cmd as cmd0, b.kind as kind0, b.roles as roles0, b.qual as q0, b.chk as c0,
           a.cmd, a.kind, a.roles, a.qual, a.chk,
           (b.tbl || '.' || b.pol) = any (flagged) as flag
      from tidy_check.policies b
      left join tidy_check.policies a on a.phase = want and a.tbl = b.tbl and a.pol = b.pol
     where b.phase = 'before'
  loop
    if r.cmd is null then
      fails := fails || format('policy %s on %s is gone', r.pol, r.tbl);
      continue;
    end if;
    if r.cmd <> r.cmd0 or r.kind <> r.kind0 or r.roles <> r.roles0 then
      fails := fails || format('policy %s on %s changed its command, kind or roles', r.pol, r.tbl);
    end if;
    if want = 'after' and r.flag then
      if replace(r.qual, wrapped, 'auth.uid()') is distinct from r.q0
         or replace(r.chk, wrapped, 'auth.uid()') is distinct from r.c0 then
        fails := fails || format('policy %s on %s means something else: %s / %s became %s / %s',
                                 r.pol, r.tbl, r.q0, r.c0, r.qual, r.chk);
      elsif position('auth.uid()' in replace(coalesce(r.qual, '') || coalesce(r.chk, ''), wrapped, '')) > 0 then
        fails := fails || format('policy %s on %s still calls auth.uid() per row', r.pol, r.tbl);
      else
        rewritten := rewritten + 1;
      end if;
    elsif r.qual is distinct from r.q0 or r.chk is distinct from r.c0 then
      fails := fails || format('policy %s on %s changed: %s / %s became %s / %s',
                               r.pol, r.tbl, r.q0, r.c0, r.qual, r.chk);
    end if;
  end loop;
  if want = 'after' and rewritten <> 54 then
    fails := fails || format('%s of the 54 policies were rewritten', rewritten);
  end if;

  /* 3. the indexes, on whichever of their tables this database has */
  foreach i slice 1 in array idx loop
    if to_regclass(i[1]) is null then continue; end if;
    wanted := wanted + 1;
    if want = 'after' and not exists (select 1 from tidy_check.indexes x
                                       where x.phase = want and x.name = split_part(i[1], '.', 1) || '.' || i[2]) then
      fails := fails || format('no index %s on %s', i[2], i[1]);
    end if;
  end loop;
  if want = 'rolled_back' and exists (select 1 from tidy_check.indexes where phase = want) then
    fails := fails || format('the rollback left indexes: %s',
                             (select string_agg(name, ', ') from tidy_check.indexes where phase = want));
  end if;

  /* how much the look could tell apart, said so a thin fixture cannot pass as a thorough one */
  select count(*) into differs from (
    select tbl from tidy_check.looks where phase = 'before' and what = 'seen'
     group by tbl having count(distinct answer) > 1) d;
  select count(distinct tbl) into saw from tidy_check.looks
   where phase = 'before' and what = 'seen' and answer ~ '^[1-9]';
  raise notice 'db speed tidy compare: % of 25 tables show different rows to different callers; % show rows to somebody; % of the draft''s 45 index tables are on this database',
    differs, saw, wanted;
  if differs < 15 then
    fails := fails || format('only %s of 25 tables told the callers apart, so this look proves little', differs);
  end if;

  if array_length(fails, 1) > 0 then
    raise exception E'db speed tidy compare (%): % problem(s)\n  %', want, array_length(fails, 1),
      array_to_string(fails, E'\n  ');
  end if;
  raise notice 'db speed tidy compare (%): every answer the same, for all 5 callers in all 25 tables',
    want;
end;
$$;
