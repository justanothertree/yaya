-- ============================================================================
-- ✅ APPLIED 2026-08-19. Migration: circuit_membership_requires_an_invite_not_an_insert
--
-- Any member could join any circuit with no invite code — by inserting a row.
-- Found by sweeping WRITE policies after the read sweep; the read sweep could not see it.
--
-- THE HOLE
-- cgm_write was, for ALL commands:
--     is_admin() OR user_id = auth.uid() OR <group creator>
-- The middle clause is trivially satisfiable — assert your own id, pick any group_id, and you
-- are in. join_circuit(p_code) exists exactly to require a code (it raises 'no circuit with
-- that code'), but nothing forced anyone through it.
--
-- Membership is the master key in this schema: chat_room_member() treats a circuit room as
-- "anyone in circuit_group_members", and circuit_can_see_person() trusts it the same way. So one
-- INSERT bought the whole circuit.
--
-- Measured on live data, as a member of neither circuit:
--     private circuit chat messages   0 BEFORE -> 17 AFTER
--     another circuit's workout logs  0        -> 222
--     that circuit's people           0        -> 2
--
-- SECOND, SAME SHAPE
-- cpg_write allowed `circuit_can_edit_person(person_id)` on its own, and everyone can edit their
-- OWN person — so anyone could staple their board into a circuit they are not in. No read was
-- gained (circuit_can_see_person wants group membership) but a stranger could appear on
-- someone else's board.
--
-- THE FIX
-- The self-insert clause is gone. Joining goes through join_circuit, which is SECURITY DEFINER
-- and therefore unaffected by these policies. A group's creator and admins keep direct writes.
-- DELETE still allows `user_id = auth.uid()`, so leaving never depends on an RPC being
-- reachable. Attaching a person to a group now also requires being IN that group.
--
-- BLAST RADIUS: the client writes neither table (verified by grep — it only reads
-- circuit_person_groups in supabaseAdapter.ts). Every write already went through a definer RPC.
--
-- VERIFIED AFTER:
--     self-join with no code                      BLOCKED (RLS violation)
--     private circuit chat after that attempt     0 messages
--     staple my board into a circuit I'm not in   BLOCKED (RLS violation)
--     join_circuit WITH the code                  OK — joined, chat reads 17
--     leave_circuit                               OK
--     create_circuit (creator self-added)         OK
-- Also noted: join codes are not readable by non-members, which the test tripped over first.
-- Standing audits after the batch: anon-executable outside allowlist = none; SECURITY DEFINER
-- without pinned search_path = none.
-- ============================================================================

drop policy if exists cgm_write on public.circuit_group_members;

create policy cgm_insert on public.circuit_group_members
  for insert to authenticated
  with check (
    is_admin()
    or exists (select 1 from public.circuit_groups g
               where g.id = circuit_group_members.group_id and g.created_by = auth.uid())
  );

create policy cgm_update on public.circuit_group_members
  for update to authenticated
  using (
    is_admin()
    or exists (select 1 from public.circuit_groups g
               where g.id = circuit_group_members.group_id and g.created_by = auth.uid())
  )
  with check (
    is_admin()
    or exists (select 1 from public.circuit_groups g
               where g.id = circuit_group_members.group_id and g.created_by = auth.uid())
  );

create policy cgm_delete on public.circuit_group_members
  for delete to authenticated
  using (
    is_admin()
    or user_id = auth.uid()
    or exists (select 1 from public.circuit_groups g
               where g.id = circuit_group_members.group_id and g.created_by = auth.uid())
  );

drop policy if exists cpg_write on public.circuit_person_groups;

create policy cpg_write on public.circuit_person_groups
  for all to authenticated
  using (
    is_admin()
    or (circuit_can_edit_person(person_id) and circuit_is_member(group_id))
    or exists (select 1 from public.circuit_groups g
               where g.id = circuit_person_groups.group_id and g.created_by = auth.uid())
  )
  with check (
    is_admin()
    or (circuit_can_edit_person(person_id) and circuit_is_member(group_id))
    or exists (select 1 from public.circuit_groups g
               where g.id = circuit_person_groups.group_id and g.created_by = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Swept at the same time, no action needed:
--   chat_messages, chat_rooms, chat_room_members, friendships, invites,
--   profile_blocks, profile_notes    RLS on with NO write policy => direct writes denied,
--                                    RPC-only. Correct.
--   activity_reads, chat_reads       own row only.
--   account_features                 admin only.
--   circuit_groups                   insert requires created_by = auth.uid(); update/delete
--                                    creator-or-admin.
--   circuit_logs, circuit_people     gated on circuit_can_edit_person(), plus a
--                                    NOT is_suspended(auth.uid()) guard.
--   circuit_movies, circuit_watchlist gated on circuit_is_member().
--   profiles                         own-row-or-admin, no delete.
