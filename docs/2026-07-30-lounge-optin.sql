-- ============================================================================
-- ✅ APPLIED 2026-08-01 by Evan. Verify returned opted_in = 0, i.e. nobody is in
-- The Lounge until they choose to be. The "Join The Lounge" UI shipped alongside.
--
-- Make The Lounge opt-in instead of automatic.
--
-- Today chat_room_member() treats the lounge as "anyone with an unsuspended
-- profile", so every account is silently dropped into one open room with every
-- other account. This adds an explicit switch, default OFF.
--
-- Because list_chat_overview() filters on `where chat_room_member(r.id)`, the
-- Lounge simply stops appearing for anyone who hasn't opted in — no client
-- change is required for it to disappear.
--
-- The "Join The Lounge" invite card now sits at the bottom of the chat
-- conversation list (src/circuit/ui/Chat.tsx), with Leave in the room's header.
--
-- Self-contained: safe to run before or after 2026-07-30-anon-lockdown.sql.
-- ============================================================================

alter table public.profiles
  add column if not exists lounge_opt_in boolean not null default false;

comment on column public.profiles.lounge_opt_in is
  'Opt-in to The Lounge, the open room shared by every account. Default false: '
  'members are never placed in a room with people they did not choose.';

-- Same function as before, with the lounge branch now requiring the opt-in.
CREATE OR REPLACE FUNCTION public.chat_room_member(p_room uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.chat_rooms r
    where r.id = p_room and (
      (r.kind = 'circuit' and exists (
        select 1 from public.circuit_group_members m
        where m.group_id = r.group_id and m.user_id = auth.uid()))
      or (r.kind = 'lounge' and exists (
        select 1 from public.profiles p
        where p.user_id = auth.uid()
          and coalesce(p.suspended, false) = false
          and coalesce(p.lounge_opt_in, false) = true))
      or (r.kind = 'dm' and exists (
        select 1 from public.chat_room_members cm
        where cm.room_id = r.id and cm.user_id = auth.uid()))
    )
  );
$function$;

revoke all on function public.chat_room_member(uuid) from public, anon;
grant execute on function public.chat_room_member(uuid) to authenticated;

-- The switch itself. Self-only, so there is no way to opt someone else in.
create or replace function public.set_lounge_opt_in(p_on boolean)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update public.profiles
     set lounge_opt_in = coalesce(p_on, false)
   where user_id = v_uid;
  return coalesce(p_on, false);
end;
$function$;

revoke all on function public.set_lounge_opt_in(boolean) from public, anon;
grant execute on function public.set_lounge_opt_in(boolean) to authenticated;

-- Let the client read its own setting without a whole profile fetch.
create or replace function public.my_lounge_opt_in()
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce((select lounge_opt_in from public.profiles where user_id = auth.uid()), false);
$function$;

revoke all on function public.my_lounge_opt_in() from public, anon;
grant execute on function public.my_lounge_opt_in() to authenticated;

-- OPTIONAL — opt yourself in (there is no button yet):
-- update public.profiles set lounge_opt_in = true
--  where user_id = '<your-user-uuid>';


-- ============================================================================
-- VERIFY — nobody is in the Lounge until they choose to be.
-- ============================================================================
select count(*) as opted_in from public.profiles where lounge_opt_in;

-- ROLLBACK: restore the lounge branch to
--   (r.kind = 'lounge' and exists (select 1 from public.profiles p
--    where p.user_id = auth.uid() and coalesce(p.suspended, false) = false))
-- and optionally: alter table public.profiles drop column lounge_opt_in;
