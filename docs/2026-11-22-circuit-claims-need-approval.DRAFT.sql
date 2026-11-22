-- ⛔ DRAFT — NOT APPLIED. Nothing here runs until Evan approves it. The plan is
-- docs/2026-11-22-circuit-claims-plan.md, and the question it answers is OPEN-DECISIONS §19e.
--
-- A Circuit person changes hands only when an admin approves a claim.
--
-- FOUR WAYS put an account on somebody's board today, and none of them checks that the account IS
-- that person:
--   1. claim_person, "This is me": any member of a circuit the person is in, first come;
--   2. add_self_to_circuit, "Add me" with a typed name: adopts an unclaimed person of that name;
--   3. _circuit_add_self, joining with a code: adopts an unclaimed person of your first name, which
--      you set yourself;
--   4. a direct UPDATE of circuit_people.owner_user_id by the board's owner, which the update
--      policy allows, so a board can be handed to any account without that account agreeing.
-- Owning a person is owning the whole log: circuit_can_edit_person lets the owner edit or delete
-- every day of it, and the profile readers show it as theirs.
--
-- AFTER THIS, 1-3 record a request in circuit_person_claims and set no owner. An admin answers it
-- with admin_decide_person_claim, which is the only new way an owner is set. 4 is refused unless
-- the caller is an admin. A board somebody makes for themselves (Add me with a new name, a new
-- circuit) is unchanged, because that is not a claim on anybody.
--
-- NOT HERE, by decision (22 Nov): the claimed person confirming from their own account is a later
-- step of its own, and never through claim_person. Links made before this are left exactly as they
-- are; the plan says what is known about them.
--
-- It refuses to run unless the three functions are the exact text it was written against (the
-- text CI builds as production's; Check A reads production's own) and the table is not there yet.

do $mig$
declare
  v_claim text := md5(pg_get_functiondef('public.claim_person(text)'::regprocedure));
  v_add   text := md5(pg_get_functiondef('public.add_self_to_circuit(uuid, text, text)'::regprocedure));
  v_join  text := md5(pg_get_functiondef('public._circuit_add_self(uuid)'::regprocedure));
begin
  if v_claim <> '9dcb6353aa8b46a142837b01619b5d40'
  or v_add   <> 'bf6833376662902ffadb2ef66aa9f0fa'
  or v_join  <> '380d9993d2019c5113f4543aad254eaf' then
    raise exception 'not the text this was written against: claim_person %, add_self_to_circuit %, _circuit_add_self %',
      v_claim, v_add, v_join;
  end if;
  if to_regclass('public.circuit_person_claims') is not null then
    raise exception 'circuit_person_claims is already there';
  end if;
end $mig$;

-- ── the requests ────────────────────────────────────────────────────────────────────────────────
-- Deny-all, like every member table here: RLS on, no policy, no grant. Only the functions below
-- read or write it.
create table public.circuit_person_claims (
  id           uuid primary key default gen_random_uuid(),
  person_id    text not null references public.circuit_people(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  /* which door it came through, so the admin knows what was actually asserted:
     'asked' = pressed This is me; 'added' = typed this name into Add me;
     'joined' = joined with a code and their first name matched */
  via          text not null check (via in ('asked', 'added', 'joined')),
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users(id) on delete set null,
  constraint circuit_person_claims_decided check ((status = 'pending') = (decided_at is null))
);
create unique index circuit_person_claims_one_open
  on public.circuit_person_claims (person_id, user_id) where status = 'pending';
create index circuit_person_claims_waiting
  on public.circuit_person_claims (requested_at) where status = 'pending';
alter table public.circuit_person_claims enable row level security;
revoke all on table public.circuit_person_claims from public, anon, authenticated;

-- ── one place a request is written ─────────────────────────────────────────────────────────────
-- Answers with the caller's request as it stands afterwards: 'pending', or 'declined' when an admin
-- has already said no to this caller about this person, in which case nothing is written. Asking
-- twice is one request. Internal: the three doors call it and nobody else can.
--
-- ⚠️ ASKED BY EXISTENCE, NOT BY "THE LATEST ROW". A caller's requests for one person can only run
-- withdrawn, withdrawn, ... and then end in one pending, approved or declined: only a pending one
-- can be withdrawn, an approved one gives the person an owner (which shuts every door), and a
-- declined one stops here. So "is there a pending one" and "is there a declined one" are the whole
-- answer, and no tie between two timestamps can change it.
create function public._circuit_ask_for_person(p_person text, p_via text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'auth required'; end if;
  if exists (select 1 from circuit_person_claims c
              where c.person_id = p_person and c.user_id = v_me and c.status = 'pending') then
    return 'pending';
  end if;
  if exists (select 1 from circuit_person_claims c
              where c.person_id = p_person and c.user_id = v_me and c.status = 'declined') then
    return 'declined';
  end if;
  insert into circuit_person_claims (person_id, user_id, via)
  values (p_person, v_me, p_via)
  on conflict do nothing;
  return 'pending';
end $function$;
revoke all on function public._circuit_ask_for_person(text, text) from public, anon, authenticated;

-- ── door 1: This is me ─────────────────────────────────────────────────────────────────────────
-- The same rule about WHO may ask (an unclaimed person in a circuit you are in), and the same
-- refusal when they may not. What changes is that asking no longer makes it so.
create or replace function public.claim_person(p_person_id text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  /* ⚠️ A CLAIM IS A REQUEST (§19e). This used to set owner_user_id here, which handed a person's
     whole log to whichever member pressed first, with nothing to say it was them. An admin answers
     it now, in admin_decide_person_claim, and until then nothing about the person changes. */
  if not exists (
    select 1 from circuit_people cp
     where cp.id = p_person_id and cp.owner_user_id is null
       and exists (select 1 from circuit_person_groups pg
                   join circuit_group_members gm on gm.group_id = pg.group_id
                   where pg.person_id = p_person_id and gm.user_id = auth.uid())
  ) then
    raise exception 'cannot claim this person';
  end if;
  if public._circuit_ask_for_person(p_person_id, 'asked') = 'declined' then
    raise exception 'an admin has said no to this claim';
  end if;
end $function$;

-- ── door 2: Add me ─────────────────────────────────────────────────────────────────────────────
create or replace function public.add_self_to_circuit(p_group uuid, p_name text, p_color text default '#7c6af7'::text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id text;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if not exists (
    select 1 from circuit_group_members gm
    where gm.group_id = p_group and gm.user_id = auth.uid()
  ) then
    raise exception 'not a member of this circuit';
  end if;

  -- (a) reuse the caller's existing person (the one with the most logs = their real board)
  select cp.id into v_id
  from circuit_people cp
  left join circuit_logs cl on cl.person_id = cp.id
  where cp.owner_user_id = auth.uid()
  group by cp.id
  order by count(cl.id) desc, cp.id
  limit 1;

  -- (b) else an unclaimed, same-name person already shared into this circuit is ASKED FOR, not
  --     adopted (§19e): a typed name is not evidence of being anybody. No blank board is made
  --     beside it, which is what this branch was always for, and the answer is that person's id.
  --     One the caller has withdrawn, or an admin has refused them, is passed over, so a second
  --     Add me makes them a board of their own.
  if v_id is null and coalesce(btrim(p_name), '') <> '' then
    select cp.id into v_id
    from circuit_people cp
    join circuit_person_groups g on g.person_id = cp.id and g.group_id = p_group
    where cp.owner_user_id is null
      and lower(btrim(cp.name)) = lower(btrim(p_name))
      and not exists (select 1 from circuit_person_claims c
                       where c.person_id = cp.id and c.user_id = auth.uid()
                         and c.status in ('declined', 'withdrawn'))
    limit 1;
    if v_id is not null then
      perform public._circuit_ask_for_person(v_id, 'added');
      return v_id;
    end if;
  end if;

  -- (c) else create a fresh person owned by the caller
  if v_id is null then
    if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
    v_id := gen_random_uuid()::text;
    insert into circuit_people (id, name, color, owner_user_id)
      values (v_id, btrim(p_name), coalesce(nullif(btrim(p_color), ''), '#7c6af7'), auth.uid());
  end if;

  -- share into the circuit (idempotent)
  insert into circuit_person_groups (person_id, group_id, added_by, added_at)
    values (v_id, p_group, auth.uid(), now())
    on conflict do nothing;

  return v_id;
end;
$function$;

-- ── door 3: joining with a code (and creating a circuit, where it can never match) ─────────────
create or replace function public._circuit_add_self(p_group uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_pid text;
  v_name text;
begin
  if auth.uid() is null then return; end if;

  select coalesce(nullif(btrim(first_name), ''), nullif(btrim(username), ''), 'Me')
    into v_name
  from profiles where user_id = auth.uid();

  -- (a) a board you already own (the one with the most logs = your real history)
  select cp.id into v_pid
  from circuit_people cp
  left join circuit_logs cl on cl.person_id = cp.id
  where cp.owner_user_id = auth.uid()
  group by cp.id
  order by count(cl.id) desc, cp.id
  limit 1;

  -- (b) else an UNCLAIMED person of your name already in this circuit is ASKED FOR (§19e), not
  -- adopted: a first name is something you type in your own settings. No blank board is made
  -- beside it, so a returning member still lands on their own history once an admin says so.
  if v_pid is null and v_name is not null then
    select cp.id into v_pid
    from circuit_people cp
    join circuit_person_groups pg on pg.person_id = cp.id and pg.group_id = p_group
    left join circuit_logs cl on cl.person_id = cp.id
    where cp.owner_user_id is null and lower(btrim(cp.name)) = lower(btrim(v_name))
      and not exists (select 1 from circuit_person_claims c
                       where c.person_id = cp.id and c.user_id = auth.uid()
                         and c.status in ('declined', 'withdrawn'))
    group by cp.id
    order by count(cl.id) desc, cp.id
    limit 1;
    if v_pid is not null then
      perform public._circuit_ask_for_person(v_pid, 'joined');
      return;
    end if;
  end if;

  -- (c) else a genuinely new member: give them a fresh board
  if v_pid is null then
    v_pid := gen_random_uuid()::text;
    insert into circuit_people (id, name, color, owner_user_id)
      values (v_pid, coalesce(v_name, 'Me'), '#7c6af7', auth.uid());
  end if;

  insert into circuit_person_groups (person_id, group_id, added_by)
    values (v_pid, p_group, auth.uid())
  on conflict do nothing;
end $function$;

-- ── door 4: the table itself ───────────────────────────────────────────────────────────────────
-- The update policy lets an owner change any column of their own person, owner_user_id included,
-- so a board could be handed to an account that never agreed. Not SECURITY DEFINER on purpose:
-- current_user is what tells a member's own UPDATE ('authenticated') from the functions above,
-- which run as their owner. An admin keeps the direct write, like every other admin bypass on
-- this table. The same owner sent back unchanged (the board's ordinary save) is not a change.
create function public.circuit_person_owner_guard()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.owner_user_id is distinct from old.owner_user_id
     and current_user in ('authenticated', 'anon')
     and not coalesce(public.is_admin(), false) then
    raise exception 'a board changes hands only when an admin approves a claim';
  end if;
  return new;
end $function$;
revoke all on function public.circuit_person_owner_guard() from public, anon, authenticated;
create trigger circuit_people_owner_guard
  before update of owner_user_id on public.circuit_people
  for each row execute function public.circuit_person_owner_guard();

-- ── the member's side: what they asked for, and taking it back ─────────────────────────────────
create function public.my_person_claims()
 returns table (id uuid, person_id text, person_name text, status text,
                requested_at timestamptz, decided_at timestamptz)
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select c.id, c.person_id, cp.name, c.status, c.requested_at, c.decided_at
    from circuit_person_claims c
    join circuit_people cp on cp.id = c.person_id
   where c.user_id = auth.uid()
   order by c.requested_at desc
   limit 100;
$function$;
revoke all on function public.my_person_claims() from public, anon, authenticated;
grant execute on function public.my_person_claims() to authenticated;

-- Somebody else's request, or one already answered, gets the same sentence as one that does not
-- exist, so this cannot be used to find out who asked for whom.
create function public.withdraw_person_claim(p_claim uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update circuit_person_claims
     set status = 'withdrawn', decided_at = now(), decided_by = auth.uid()
   where id = p_claim and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'no such claim'; end if;
end $function$;
revoke all on function public.withdraw_person_claim(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_person_claim(uuid) to authenticated;

-- ── the admin's side ───────────────────────────────────────────────────────────────────────────
-- What is waiting, with what the admin needs to decide and nothing of the log itself: whose board,
-- who asked and how, how many days it holds, which circuits the two share now, and whether the
-- person is only in one of those because the asker put it there.
create function public.admin_list_person_claims()
 returns table (id uuid, person_id text, person_name text, user_id uuid, username text,
                first_name text, via text, requested_at timestamptz, logs integer,
                circuits text[], added_by_them boolean)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
  select c.id, c.person_id, cp.name, c.user_id, p.username::text, p.first_name, c.via,
         c.requested_at,
         (select count(*)::int from circuit_logs l where l.person_id = c.person_id),
         coalesce((select array_agg(g.name order by g.name)
                     from circuit_person_groups pg
                     join circuit_groups g on g.id = pg.group_id
                     join circuit_group_members gm
                       on gm.group_id = pg.group_id and gm.user_id = c.user_id
                    where pg.person_id = c.person_id), '{}'::text[]),
         exists (select 1 from circuit_person_groups pg
                  where pg.person_id = c.person_id and pg.added_by = c.user_id)
    from circuit_person_claims c
    join circuit_people cp on cp.id = c.person_id
    left join profiles p on p.user_id = c.user_id
   where c.status = 'pending'
   order by c.requested_at, c.id;
end $function$;
revoke all on function public.admin_list_person_claims() from public, anon, authenticated;
grant execute on function public.admin_list_person_claims() to authenticated;

-- The only new way an owner is set. Approving one request declines the others for that person,
-- because the person is somebody's now. The PERSON is locked before the request, so two approvals
-- of two requests for one person queue rather than deadlock or both succeed.
create function public.admin_decide_person_claim(p_claim uuid, p_approve boolean)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me     uuid := auth.uid();
  v_person text;
  v_owner  uuid;
  c        circuit_person_claims;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_approve is null then raise exception 'approve or decline'; end if;

  select cl.person_id into v_person from circuit_person_claims cl where cl.id = p_claim;
  if v_person is null then raise exception 'no such claim'; end if;
  select cp.owner_user_id into v_owner from circuit_people cp where cp.id = v_person for update;
  select * into c from circuit_person_claims cl where cl.id = p_claim for update;
  /* gone between the two reads: the person was deleted, and the request with it */
  if c.id is null then raise exception 'no such claim'; end if;
  if c.status <> 'pending' then raise exception 'that claim has already been answered'; end if;

  if not p_approve then
    update circuit_person_claims
       set status = 'declined', decided_at = now(), decided_by = v_me
     where id = c.id;
    return 'declined';
  end if;

  if v_owner is not null then raise exception 'this person already belongs to an account'; end if;
  if coalesce(public.is_suspended(c.user_id), false) then
    raise exception 'that account is suspended';
  end if;
  update circuit_people set owner_user_id = c.user_id where id = c.person_id;
  update circuit_person_claims
     set status = 'approved', decided_at = now(), decided_by = v_me
   where id = c.id;
  update circuit_person_claims
     set status = 'declined', decided_at = now(), decided_by = v_me
   where person_id = c.person_id and status = 'pending';
  return 'approved';
end $function$;
revoke all on function public.admin_decide_person_claim(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_decide_person_claim(uuid, boolean) to authenticated;
