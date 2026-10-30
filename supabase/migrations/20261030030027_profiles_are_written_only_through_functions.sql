-- ✅ APPLIED 30 Oct 2026 as `profiles_are_written_only_through_functions`.
--
-- A member could rewrite their own profile row, every column of it.
--
-- ⚠️ THE WORST COLUMN WAS NOT ONE OF THE NEW ONES. `authenticated` held table-level UPDATE on
-- `public.profiles` and the `profiles_update` policy allowed `user_id = auth.uid()`, so a member
-- could set `suspended = false` on themselves. **A suspended member could un-suspend
-- themselves**, and that predates the feed by a long way. `age_band` and `feed_opt_in` — added
-- four hours earlier by `feed_waits_for_an_adult` — simply walked into a door that was already
-- open: a minor could have marked themselves an adult and opted themselves into the feed.
--
-- Measured before the fix, as a member, in a rolled-back transaction: `age_band` SUCCEEDED,
-- `feed_opt_in` SUCCEEDED, `suspended` SUCCEEDED. Also `username` and `activity_visibility`.
--
-- ⚠️ A COLUMN-LEVEL REVOKE WOULD NOT HAVE WORKED ON ITS OWN, which is worth knowing rather than
-- rediscovering. `has_column_privilege` is satisfied by a TABLE-level grant, so revoking
-- `update (suspended)` while `update` on the table remains changes nothing. The table grant has
-- to go first; after that a column grant could add specific columns back. None are added back
-- here, because none are needed.
--
-- ⚠️ NOTHING LEGITIMATE USED THE GRANT. Every write path was enumerated before revoking: 12
-- functions touch this table and **all 12 are SECURITY DEFINER owned by postgres**, so they run
-- with the owner's rights and never consulted the caller's. The only direct client access to
-- `profiles` is a SELECT of three nickname columns in AccountSettings, and a SELECT in the admin
-- panel. SELECT is therefore kept; INSERT, UPDATE and DELETE are not.
--
-- Verified after: as a member, `age_band`, `feed_opt_in`, `suspended`, `username` and
-- `activity_visibility` all answer `permission denied for table profiles`, a second-row INSERT is
-- refused, and SELECT still works. And the other direction, which matters just as much —
-- `set_my_activity_visibility`, `set_my_nicknames`, `update_my_profile`, `set_my_public_page` and
-- `set_lounge_opt_in` all still work for a member, `admin_set_feed_consent` still refuses one,
-- and still works for an admin.
--
-- ⚠️ THE POLICIES GO TOO, DELIBERATELY. `profiles_insert` and `profiles_update` are inert without
-- the grant, and CLAUDE.md §3 is explicit that an entry which cannot be used is still an entry
-- somebody must reason about at every review. Worse, leaving them means a future re-grant —
-- the schema's default ACL is generous — would silently reopen member self-update. Their
-- definitions, for restoration: both were
--   `insert: with check ((user_id = auth.uid()) OR is_admin())`
--   `update: using ((user_id = auth.uid()) OR is_admin()) with check (same)`
-- for role `authenticated`. `profiles_select` stays, because SELECT stays.
--
-- The standing re-runnable version of this check is `docs/2026-10-30-profiles-write-lock.sql`.

revoke insert, update, delete on public.profiles from public, anon, authenticated;

drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_insert on public.profiles;

comment on table public.profiles is
  'Member profiles. WRITES GO THROUGH SECURITY DEFINER FUNCTIONS ONLY -- authenticated holds SELECT and nothing else, and there are no INSERT/UPDATE policies. Members could previously update every column of their own row, including suspended (un-suspending themselves), age_band and feed_opt_in. All 12 writers are SECURITY DEFINER owned by postgres, so none of them needs the grant.';

create or replace function public.my_profile_writable_columns()
returns table (col text, written_by text)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select * from (values
    ('first_name, middle_name, last_name, email, phone, birthday, address, venmo, cashapp, zelle', 'update_my_profile'),
    ('nickname, circuit_nickname, snake_nickname', 'set_my_nicknames'),
    ('activity_visibility', 'set_my_activity_visibility'),
    ('public_page', 'set_my_public_page'),
    ('lounge_opt_in', 'set_lounge_opt_in'),
    ('lounge_display_name', 'set_lounge_display_name'),
    ('page_style', 'set_my_page_style'),
    ('profile_look', 'set_my_profile_look'),
    ('suspended', 'admin_set_suspended (admin only)'),
    ('age_band, feed_opt_in', 'admin_set_feed_consent (admin only)'),
    ('username, first_name, email, role', 'admin_update_member (admin only)')
  ) as t(col, written_by);
$function$;

revoke all on function public.my_profile_writable_columns() from public, anon;
grant execute on function public.my_profile_writable_columns() to authenticated;
