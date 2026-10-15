-- ✅ APPLIED — migration: chronicle_goal_counts_needs_a_metric
--
-- A goal cannot count something its source does not record.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────────────────────
--
-- The goal form asks what to count FROM — one activity, a category, or nothing — and then, only
-- when the chosen activity names a metric, offers a second choice: count the time, or count the
-- reps. That second control is right to exist and right to be conditional.
--
-- It is a SEPARATE control from the source, and it kept its answer when the source moved beneath
-- it. Pick Gym, choose "count the reps", then change the source to an activity that counts
-- nothing: the chooser vanishes, the state does not, and the save sends it.
--
-- Driven in the room, which is the only reason this was found — the form looks right at every step:
--
--   Read ten books      FROM DISHES   0 / 10 done        ← made through the form, counting reps
--   Wash up every evening FROM DISHES 12 / 10 minutes    ← from the seed, counting minutes
--
-- Same activity. Same twelve minutes of it in the log two inches above. One of them stuck at zero
-- for ever, because it was measuring a quantity Dishes never records. The unit said "done" rather
-- than "minutes", which is `unitFor` faithfully reporting the nonsense it was handed.
--
-- ⚠️ THIS IS THE SHAPE §6bd WAS ABOUT — a goal reading 0 with the minutes in the totals above it —
-- and the first instance anybody could create on purpose rather than inherit from a seed.
--
-- ── WHY CORRECTED AND NOT REFUSED ───────────────────────────────────────────────────────────
--
-- The function already corrected the sibling case, and said why: "counting an amount without an
-- activity is refused by a constraint, so it is corrected here rather than raised: the goal is
-- still a goal, it just measures time instead." The same reasoning covers this one. A person who
-- has just typed a title, a number and a source has written down something they mean; losing the
-- save over the pairing would be a worse outcome than measuring time.
--
-- ⚠️ AND IN BOTH PLACES. The room now derives what a goal counts from its source rather than
-- remembering it, so the chooser's stale answer cannot reach a save — and the server corrects it
-- anyway, because a rule the client alone keeps is a rule that lasts until the next caller.
--
-- ── WHAT WAS CHECKED ────────────────────────────────────────────────────────────────────────
--
--   goals on the account counting an amount          0 of 1
--   …of those, against an activity with no metric    0          ← nothing to repair
--
-- So this is preventive. Nothing stored is wrong today.
--
-- Then through the form itself, which is where it was found:
--
--   source Gym, "count the reps"            unit box offers "reps"
--   source moved to Dishes                  chooser gone, unit box now offers "minutes" (was "done")
--   saved                                   "Read ten books · FROM DISHES · 12 / 10 minutes"
--
-- ⚠️ AND THE CONTROL, so this is a correction rather than the feature switched off: a goal made
-- against Gym and left on "count the reps" saves as "Sixty reps a day · FROM GYM · REPS ·
-- 60 / 60 reps", counting the sixty reps in the log.

-- the correction, which replaces the single-condition version:
--
--   if v_counts = 'amount' and v_act is null then v_counts := 'minutes'; end if;
--
-- with both halves of the same question — is there anything here that counts one?

  if v_counts = 'amount' and (
       v_act is null
       or not exists (select 1 from public.chronicle_activities a
                       where a.id = v_act and a.owner = auth.uid()
                         and nullif(btrim(coalesce(a.metric, '')), '') is not null))
  then
    v_counts := 'minutes';
  end if;

-- The rest of chronicle_goal_save is unchanged and every comment in it is preserved; see the
-- migration for the whole body.

revoke all on function public.chronicle_goal_save(uuid, text, text, date, integer, numeric, text, text, integer, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.chronicle_goal_save(uuid, text, text, date, integer, numeric, text, text, integer, uuid, text, text, integer, integer) to authenticated;

-- ── the standing check, after ───────────────────────────────────────────────────────────────
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'chronicle_goal_save';
-- → false
