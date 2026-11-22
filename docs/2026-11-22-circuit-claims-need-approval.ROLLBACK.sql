-- ROLLBACK for docs/applied/2026-11-22-circuit-claims-need-approval.DRAFT.sql. ⛔ Not applied, like the draft.
--
-- Puts the three claim functions back byte for byte (this is their text in the schema baseline,
-- which CI builds as production's), then drops what the draft added. Check A of
-- docs/2026-11-22-circuit-claims-need-approval.checks.sql should then read as it did before.
--
-- ⚠️ IT DOES NOT UNDO AN APPROVAL. A person an admin gave to an account keeps that owner; this
-- file only forgets the requests themselves, pending and answered. Nothing else is lost: the
-- table holds no member's words or work.
--
-- ⚠️ AND IT REOPENS ALL FOUR DOORS the draft closed, first come and by name, so roll back only
-- to fix a fault in the draft itself.

drop trigger if exists circuit_people_owner_guard on public.circuit_people;
drop function if exists public.circuit_person_owner_guard();
drop function if exists public.admin_decide_person_claim(uuid, boolean);
drop function if exists public.admin_list_person_claims();
drop function if exists public.withdraw_person_claim(uuid);
drop function if exists public.my_person_claims();

CREATE OR REPLACE FUNCTION "public"."claim_person"("p_person_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  update circuit_people set owner_user_id = auth.uid()
   where id = p_person_id and owner_user_id is null
     and exists (select 1 from circuit_person_groups pg
                 join circuit_group_members gm on gm.group_id = pg.group_id
                 where pg.person_id = p_person_id and gm.user_id = auth.uid());
  if not found then raise exception 'cannot claim this person'; end if;
end $$;


CREATE OR REPLACE FUNCTION "public"."add_self_to_circuit"("p_group" "uuid", "p_name" "text", "p_color" "text" DEFAULT '#7c6af7'::"text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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

  -- (b) else claim an unclaimed, same-name person already shared into this circuit
  --     (returning crew whose caretaken record is here — don't spawn a blank beside it)
  if v_id is null and coalesce(btrim(p_name), '') <> '' then
    select cp.id into v_id
    from circuit_people cp
    join circuit_person_groups g on g.person_id = cp.id and g.group_id = p_group
    where cp.owner_user_id is null
      and lower(btrim(cp.name)) = lower(btrim(p_name))
    limit 1;
    if v_id is not null then
      update circuit_people set owner_user_id = auth.uid() where id = v_id;
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
$$;


CREATE OR REPLACE FUNCTION "public"."_circuit_add_self"("p_group" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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

  -- (b) else an UNCLAIMED person of your name already in this circuit — adopt it, so a
  -- returning member lands on their own history instead of a blank second board
  if v_pid is null and v_name is not null then
    select cp.id into v_pid
    from circuit_people cp
    join circuit_person_groups pg on pg.person_id = cp.id and pg.group_id = p_group
    left join circuit_logs cl on cl.person_id = cp.id
    where cp.owner_user_id is null and lower(btrim(cp.name)) = lower(btrim(v_name))
    group by cp.id
    order by count(cl.id) desc, cp.id
    limit 1;
    if v_pid is not null then
      update circuit_people set owner_user_id = auth.uid() where id = v_pid;
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
end $$;


drop function if exists public._circuit_ask_for_person(text, text);
drop table if exists public.circuit_person_claims;
