-- ⛔ DRAFT — NOT APPLIED TO PRODUCTION. Approved on 8 Nov 2026 for implementation and LOCAL
-- testing only; applying it is a separate approval. Run only in the `db guards` CI job's
-- throwaway database, through a scratch branch.
--
-- STEP 3 OF 3 — a friend's view of a repeating goal says how THIS window went.
--
-- `get_member_chronicle` lists the goals an owner shares, each with a ✓ or a ○, and counts
-- "N reached, M still going". Both read the row's single `done_at`, so a shared "Floss every day"
-- ticked once has shown ✓ on that member's profile on every day since — the same defect as the
-- room's, one page over.
--
-- ⚠️ THIS LANDS AFTER THE ROOM (step 2), NOT WITH THE TABLE (step 1). Until the room writes
-- marks, nothing would ever make a mark current, and every repeating goal on every profile would
-- read ○ — a regression from "stuck on the first tick" to "never ticked". In that order each step
-- is inert alone: step 1 adds what nobody calls, step 2 makes the room right and leaves the
-- profile as it is today, step 3 makes the profile right.
--
-- ⚠️ THE SERVER KNOWS WHICH MARK IS CURRENT WITHOUT KNOWING ANYBODY'S ZONE, because the client
-- sent each window's two instants with it. "Done now" is a mark with a `done_at` whose window
-- contains this moment. A one-off reads its row exactly as before.
--
-- ⚠️ A TICK FROM BEFORE MARKS — the row's `done_at` on a repeating goal — DOES NOT SHOW HERE.
-- The room places it in its local window (marks.ts, `Legacy`); the server cannot, so at worst a
-- goal ticked under the old room reads ○ on the profile for the rest of that one window, once.
-- That is the honest direction: it never claims a tick for a window it cannot place.
--
-- ROLLBACK: re-run the function's previous text, saved from pg_get_functiondef before this is
-- applied. Nothing is written by this step, so there is nothing else to undo.

do $mig$
declare
  r record;
  v_src text;
  v_hits int;
  v_done int := 0;
  v_now constant text :=
    E'exists (select 1 from public.chronicle_goal_marks mk\n'
    || E'                      where mk.goal = %1$s.id and mk.scope = %1$s.scope\n'
    || E'                        and mk.done_at is not null\n'
    || E'                        and mk.starts_at <= now() and mk.ends_at > now())';
begin
  for r in
    select * from (values
      ('(gl.done_at is not null) as done,',
       '(case when gl.repeat_every is null then gl.done_at is not null'
       || E'\n                  else ' || format(v_now, 'gl') || E' end) as done,'),
      (E'count(*) filter (where g.done_at is not null and g.done_at >= v_from),\n'
       || E'         count(*) filter (where g.done_at is null)',
       E'count(*) filter (where case when g.repeat_every is null\n'
       || E'                                then g.done_at is not null and g.done_at >= v_from\n'
       || E'                                else ' || format(v_now, 'g') || E' end),\n'
       || E'         count(*) filter (where case when g.repeat_every is null\n'
       || E'                                then g.done_at is null\n'
       || E'                                else not ' || format(v_now, 'g') || E' end)')
    ) as v(old, new)
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'get_member_chronicle';
    if v_src is null then raise exception 'get_member_chronicle not found'; end if;

    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> 1 then
      raise exception 'expected 1 of [%] in get_member_chronicle, found %', r.old, v_hits;
    end if;

    execute replace(v_src, r.old, r.new);
    v_done := v_done + 1;
  end loop;
  if v_done <> 2 then raise exception 'expected 2 substitutions, made %', v_done; end if;
end $mig$;
