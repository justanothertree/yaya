-- ✅ APPLIED to production 22 Nov 2026 as migration `circuit_creator_staple`, version
-- 20261122234003: md5(statements[1]) = 4daaca0334cd4319008bd58e6abff849, this file's body. The
-- record is supabase/migrations/20261122234003_circuit_creator_staple.sql.
--
-- (as drafted) Found while drafting §19e (#456); the plan is
-- docs/2026-11-22-circuit-creator-staple-plan.md.
--
-- A circuit's creator could put ANY person into their own circuit, and so read that person.
--
-- `cpg_write` is one policy for every command on circuit_person_groups, and its third branch is
-- "you created this circuit", with nothing asked about the PERSON. That branch is right for taking
-- somebody out of your circuit, which is managing it, and wrong for putting somebody in, because
-- `circuit_can_see_person` lets every member of a circuit see the people in it, whatever their own
-- visibility says. So a member who knows a person's id can make a circuit, add the person, and read
-- every day they logged: a private board included. Measured on CI's database, as a seeded member:
-- 0 of a private person's logs before, all of them after (the plan has the run).
--
-- After this, ADDING a person to a circuit (insert, or an update that moves a row) needs what it
-- already needed for everybody else: you own the person and you are in the circuit, or you are the
-- admin. REMOVING one is unchanged, the creator's bypass included. No row is changed or removed:
-- whatever was added before stays, and the plan has a read-only query that lists those rows.
--
-- The client never writes this table (it only reads it); every add goes through a SECURITY
-- DEFINER function, which RLS does not apply to. So nothing on screen changes.
--
-- It refuses to run unless the table's policies are exactly cpg_select and cpg_write, cpg_write is
-- the permissive all-commands policy it was written against, and its two expressions are the same
-- and still hold the creator branch.

do $mig$
declare
  v_qual  text;
  v_check text;
  v_names text;
begin
  select string_agg(polname, ',' order by polname) into v_names
    from pg_policy where polrelid = 'public.circuit_person_groups'::regclass;
  if v_names is distinct from 'cpg_select,cpg_write' then
    raise exception 'circuit_person_groups has policies %, not cpg_select,cpg_write', v_names;
  end if;
  select pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    into v_qual, v_check
    from pg_policy
   where polrelid = 'public.circuit_person_groups'::regclass and polname = 'cpg_write'
     and polcmd = '*' and polpermissive
     and polroles = array['authenticated'::regrole]::oid[];
  if v_qual is null or v_qual is distinct from v_check
     or position('created_by = auth.uid()' in v_qual) = 0
     or position('circuit_can_edit_person(person_id)' in v_qual) = 0 then
    raise exception 'cpg_write is not the policy this was written against: %', coalesce(v_qual, 'missing');
  end if;
end $mig$;

drop policy cpg_write on public.circuit_person_groups;

-- Taking a person out of a circuit: exactly what cpg_write allowed, the creator's bypass included.
create policy cpg_delete on public.circuit_person_groups
  for delete to authenticated
  using (
    public.is_admin()
    or (public.circuit_can_edit_person(person_id) and public.circuit_is_member(group_id))
    or exists (select 1 from public.circuit_groups g
                where g.id = circuit_person_groups.group_id and g.created_by = auth.uid())
  );

-- Putting a person into a circuit: a person you own, into a circuit you are in, or the admin.
create policy cpg_insert on public.circuit_person_groups
  for insert to authenticated
  with check (
    public.is_admin()
    or (public.circuit_can_edit_person(person_id) and public.circuit_is_member(group_id))
  );

-- Moving a row is putting a person somewhere, so it asks the same, of the row before and after.
create policy cpg_update on public.circuit_person_groups
  for update to authenticated
  using (
    public.is_admin()
    or (public.circuit_can_edit_person(person_id) and public.circuit_is_member(group_id))
  )
  with check (
    public.is_admin()
    or (public.circuit_can_edit_person(person_id) and public.circuit_is_member(group_id))
  );
