-- ✅ APPLIED 29 Oct 2026 as `admin_delete_member_counts_accounts`.
--
-- Two minutes after 20261029153952_family_fund_safety.sql, and only about the wording of the
-- refusal that file added. The behaviour is identical.
--
-- ⚠️ IT IS A SEPARATE FILE BECAUSE IT WAS A SEPARATE MIGRATION. The correction was originally
-- folded back into the family_fund_safety FILE while the live database kept both rows, so the
-- directory had seven files against eight applied versions and the file of that name no longer
-- matched the migration of that name. Nothing would ever have contradicted that: the end state
-- was right, every grant and constraint checked out, and the only way to notice was to count the
-- two lists against each other. Evan did.
--
-- WHAT WAS WRONG WITH IT. `family_fund_safety` makes deleting a login RESTRICT rather than
-- CASCADE, so somebody's fund account can no longer vanish with their password. A raw foreign-key
-- violation is not a sentence anybody can act on, so `admin_delete_member` counts the accounts
-- first and says so — and said:
--
--   that person owns 1 fund account(s) — reassign or delete them first
--
-- That string is rendered on the admin screen. "1 fund account(s)" is the sort of thing nobody
-- notices in a migration and everybody notices in a room, and this project already has a `plural`
-- helper in src/finance/designation.ts for exactly the same reason. Verified both ends after
-- applying, by planting one account and then two on a non-admin member in rolled-back
-- transactions:
--
--   that person owns 1 fund account  — reassign or delete it first, or their holdings go with the login
--   that person owns 2 fund accounts — reassign or delete them first, or their holdings go with the login
--
-- Everything else in the function is byte for byte what the previous migration left.

create or replace function public.admin_delete_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
declare v_accounts int;
begin
  if not public.is_admin() then raise exception 'admin required'; end if;
  if p_user_id = auth.uid() then raise exception 'you cannot delete your own account'; end if;
  if exists(select 1 from public.admin_users a where a.user_id = p_user_id) then
    raise exception 'cannot delete an admin account';
  end if;

  /* ⚠️ COUNTED AND NAMED, BEFORE ANYTHING IS DELETED. The FK would refuse this anyway now, which
     is the safety; this is so the refusal says what to do about it. `finance` is qualified because
     this function's search_path does not include it.
     "1 fund account(s)" is the sort of thing nobody notices in a migration and everybody notices
     on the screen — this is admin-facing copy, so it is written out. */
  select count(*) into v_accounts from finance.family_accounts fa where fa.user_id = p_user_id;
  if v_accounts > 0 then
    raise exception
      'that person owns % — reassign or delete % first, or their holdings go with the login',
      v_accounts || (case when v_accounts = 1 then ' fund account' else ' fund accounts' end),
      case when v_accounts = 1 then 'it' else 'them' end;
  end if;

  delete from public.invites where used_by = p_user_id; -- clears the NO ACTION FK
  delete from public.user_roles where user_id = p_user_id; -- no FK / cascade
  delete from auth.users where id = p_user_id; -- cascades profiles + account_features + auth internals
end;
$function$;
