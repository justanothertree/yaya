-- ✅ APPLIED to production 22 Nov 2026 at 6:40 PM EST as migration `circuit_creator_staple`,
-- version 20261122234003, with Evan's approval of #458 that evening. Production recorded
-- md5(statements[1]) = 4daaca0334cd4319008bd58e6abff849, this file's body byte for byte.
-- Before it: circuit_person_groups had exactly cpg_select and cpg_write, cpg_write the text CI built
-- (59fb9c7a…). After: cpg_delete, cpg_insert, cpg_select, cpg_update, and the rows' fingerprint
-- unchanged (fd470718…), so nothing was removed. Live, as a member and rolled back: the member made
-- a circuit and was refused adding somebody else's private board to it, which stayed at 0 days
-- seen; their own board still went in, and as creator they still took it out. Why:
-- docs/2026-11-22-circuit-creator-staple-plan.md.

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