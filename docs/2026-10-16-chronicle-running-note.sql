-- ✅ APPLIED — migration: chronicle_running_note
--
-- Say what the session you are IN is about, without ending it.
--
-- ── WHY IT DID NOT EXIST ────────────────────────────────────────────────────────────────────
--
-- `chronicle_running_fix` can already move a running sitting's start and change which activity it
-- is — the two mistakes you notice while working. Its note reads:
--
--   "NULL LEAVES EACH ONE ALONE, and there is no way to set an end: the open entry is open
--    because it has no end, and typing one in is what Stop is for."
--
-- That is exactly right about the END, and it had been taken to cover the NOTE as well. So a
-- sitting could only be described once it was over: the box beside Stop writes the note at the
-- moment you finish.
--
-- ⚠️ ASKED FOR DIRECTLY, which is why a written decision is being overturned rather than worked
-- around. The thing worth writing down is what you are doing WHILE you are doing it, and a phone
-- is where you want to write it.
--
-- ── ITS OWN FUNCTION ────────────────────────────────────────────────────────────────────────
--
-- Not a third parameter on chronicle_running_fix: `create or replace` cannot ADD one — it mints
-- an overload and leaves two callable signatures. The same reasoning already put
-- chronicle_entry_amount and chronicle_entry_quality beside chronicle_entry_edit rather than
-- widening the write path everything else goes through.
--
-- ⚠️ AND '' CLEARS, WHERE NULL MEANS "LEAVE IT ALONE" EVERYWHERE ELSE IN THIS ROOM. That rule
-- exists because those callers write other columns in the same breath, so silence about one has
-- to be distinguishable from erasing it — see docs/2026-10-13-chronicle-silent-erasures.sql.
-- This function writes ONE column and nothing else, so calling it at all is the statement of
-- intent, and null and '' can mean the same thing without ambiguity.
--
-- ── WHAT WAS CHECKED ────────────────────────────────────────────────────────────────────────
--
-- In a rolled-back transaction with a simulated session, all four branches:
--
--   the note before                 (none)
--   set it, with surrounding spaces  "the chapter that will not end"   ← trimmed
--   an empty string                  null — cleared
--   null                             null — cleared
--   with nothing running             refused: nothing is running
--
-- ⚠️ THE FIRST ATTEMPT AT THIS PROOF ABORTED ITS OWN TRANSACTION. The refusal is a `raise`, so it
-- took the earlier rows with it and the run reported only the error. Catching it in a nested
-- block is what let all five lines be printed together.
--
-- The grants, confirmed rather than assumed: anon false, authenticated true, security definer.

create or replace function public.chronicle_running_note(p_note text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.chronicle_entries
     set note = nullif(btrim(coalesce(p_note, '')), '')
   where owner = auth.uid() and ended_at is null
  returning id into v_id;
  if v_id is null then raise exception 'nothing is running'; end if;
  return true;
end $function$;

revoke all on function public.chronicle_running_note(text) from public, anon;
grant execute on function public.chronicle_running_note(text) to authenticated;

-- ── the standing check, after ───────────────────────────────────────────────────────────────
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'chronicle_running_note';
-- → anon false
