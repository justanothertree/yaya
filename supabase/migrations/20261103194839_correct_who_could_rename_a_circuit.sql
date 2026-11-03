-- ✅ APPLIED 3 Nov 2026 as `correct_who_could_rename_a_circuit`.
--
-- A correction to the migration immediately before this one, which said `rename_circuit` was
-- reachable by "an ordinary member of the group". It is not: the exists clause requires
-- `gm.role = 'owner'`, so the set is the circuit's owner or an admin. Measured -- an ordinary
-- member of The Crew is refused with "only the circuit owner can rename it".
--
-- ⚠️ THE FINDING AND THE FIX ARE UNCHANGED. The point was never how many people
-- could call it; it was that a NON-ADMIN could, which is why a body merely mentioning
-- `is_admin()` is not a body gated by it. A suspended circuit owner renaming a circuit
-- everybody in it sees is still exactly what suspension is for. Only the blast radius was
-- overstated, and a reader who believed it would go hunting for a hole that is not there.
--
-- ⚠️ THE DO BLOCK BELOW IS A NO-OP, DELIBERATELY RECORDED. The sentence it looks for
-- lives in the previous MIGRATION's comment, not in the function body, so there is nothing in
-- the database to rewrite -- it checks and finds nothing. The correction that matters is this
-- header and the matching edit in supabase/tests/visibility-guards.sql. It is applied anyway
-- because this directory is the project's record of what was decided and why, and a correction
-- nobody can find is not a correction. The second time a comment of mine has overstated a
-- finding this week; both were caught by running the thing rather than re-reading it.

do $mig$
declare v_src text; v_out text;
  v_old constant text := '-- admin OR an ordinary member of the group. It mentions the function and is not gated by';
  v_new constant text := '-- admin OR the circuit''s OWNER (gm.role = ''owner''), checked rather than assumed after the';
begin
  /* A SECOND COMMENT OF MINE THAT OVERSTATED, AND FOUND THE SAME WAY -- by running the thing.
     The migration applied minutes ago said `rename_circuit` was reachable by "an ordinary member
     of the group". It is not: the exists clause requires `gm.role = 'owner'`, so the reachable
     set is the circuit's owner or an admin. Measured: an ordinary member of The Crew is refused
     with "only the circuit owner can rename it".

     THE FINDING IS UNCHANGED AND SO IS THE FIX. The point was never how many people could call
     it -- it was that a NON-ADMIN could, so a body mentioning `is_admin()` is not a body gated
     by it, and the exemption let a writer through. A suspended circuit owner renaming a circuit
     everybody in it sees is still exactly the thing suspension is for. Only the size of the
     blast radius was wrong, and a reader who believed it would look for a hole that is not
     there -- the same correction, for the same reason, as the invite one on 3 Nov. */
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'rename_circuit';
  if v_src is null then raise exception 'rename_circuit not found'; end if;
  if position(v_old in v_src) > 0 then
    v_out := replace(v_src, v_old, v_new);
    execute v_out;
  end if;
  /* the sentence lives in the MIGRATION's comment rather than in the function body, so there may
     be nothing to replace here; the authoritative correction is this migration's own header and
     the matching edit in supabase/tests/visibility-guards.sql */
end
$mig$;
