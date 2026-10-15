-- ✅ APPLIED — migration: chronicle_no_future_sittings
--
-- You cannot have spent time on a day you have not lived.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────────────────────
--
-- The room already SAYS this. A future day answers "Not here yet. Plan a span below, or go back to
-- today to start a timer." — written on 15 Oct when the day stepper was walked forwards, with the
-- reasoning that the old sentence "invites somebody to record work they have not done".
--
-- The sentence was fixed. The button was not.
--
-- `chronicle_plan_did` hands a plan's own `starts_at`/`ends_at` to `chronicle_entry_add`, which
-- checked that a span was the right way round and no longer than a day, and nothing else. So the ✓
-- beside a plan on the Tomorrow view wrote a finished sitting into tomorrow. Measured in the room,
-- with the clock reading 15 Oct 06:30:
--
--   pressed ✓ on "7:00–7:45 AM · Gym"   →  log: "Gym 45m SHORT 7:00 AM – 7:45 AM"
--                                           totals: "Free Time 45m"
--                                           planned fold: "1h 15m · 45m done"
--
-- Forty-five minutes of gym, twenty-five hours in the future, counted in a day's totals.
--
-- ⚠️ AND ⏱ FILL A GAP IS THE SAME DOOR. It takes two free-form datetime boxes, so a span starting
-- next week is a thing anybody can type. Both doors go through `chronicle_entry_add`, which is why
-- the check belongs there rather than in either caller.
--
-- ── THE START, NOT THE END ──────────────────────────────────────────────────────────────────
--
-- `chronicle_running_fix` has had this rule since it was written — `if p_from > clock_timestamp()
-- then raise exception 'that is in the future'` — so this is the same check in the same words
-- rather than a new idea, and `chronicle_entry_edit` gets it too: a rule only one write path keeps
-- is one you get around by adding a legal sitting and then editing it forward.
--
-- The END is deliberately not checked. A span whose end is slightly ahead of now is what logging a
-- block you are in the middle of looks like, and is also what a clock two minutes fast produces.
-- Neither is time nobody has spent. A span that BEGINS after now is unambiguous.
--
-- ⚠️ AND THE NEW CHECK IS LAST OF THE THREE, which is the whole of the compatibility story: every
-- input that was refused before this is still refused, with the same words. Only inputs that were
-- ACCEPTED can newly be refused. A span that is both in the future and longer than a day is still
-- answered about its length.
--
-- ── WHAT WAS CHECKED ────────────────────────────────────────────────────────────────────────
--
-- In a rolled-back transaction with a simulated session. A refusal writes nothing, and the two
-- that are accepted were rolled back:
--
--   tomorrow's plan, the reported bug          that is in the future
--   starts one minute from now                 that is in the future
--   future AND over a day                      that is more than a day   ← older message still wins
--   an ordinary gap two hours ago              accepted, as it must be
--   started before now, ends just after        accepted — a block in progress
--
-- ⚠️ THE LAST TWO ARE THE POINT. A guard with no positive control is a guard that might have
-- turned the feature off, and the first pass through the room nearly made exactly that mistake:
-- every plan on Today was ALSO disabled, which looked like proof the fix worked and was really the
-- clock reading 06:34 with both of the day's plans at 10:00 and 14:00. A plan created for 05:00
-- the same morning is still tickable, and pressing it logged "Gym 30m" and moved the fold to
-- "3h · 2h 11m done".
--
-- ── AND THE ROOM NO LONGER OFFERS IT ────────────────────────────────────────────────────────
--
-- The server refusing is correct and not sufficient: a button whose only possible answer is an
-- error is a button that should not be lit. `Plans.tsx` disables ✓ on a plan that has not started
-- and says why — "Not yet — this has not started" — which is the same lesson as the archived step
-- in a routine, one surface over. Checked at 375: three plan rows, ticks 44×38, nothing over the
-- list.

create or replace function public.chronicle_entry_add(p_activity uuid, p_from timestamptz, p_to timestamptz, p_note text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_to is null or p_from is null or p_to <= p_from then raise exception 'that span ends before it starts'; end if;
  if p_to - p_from > interval '24 hours' then raise exception 'that is more than a day'; end if;
  -- see the header: the start, not the end, and last of the three so nothing already refused moves
  if p_from > clock_timestamp() then raise exception 'that is in the future'; end if;
  if not exists (select 1 from public.chronicle_activities where id = p_activity and owner = auth.uid()) then
    raise exception 'no such activity';
  end if;
  insert into public.chronicle_entries (owner, activity, started_at, ended_at, note)
  values (auth.uid(), p_activity, p_from, p_to, nullif(btrim(coalesce(p_note,'')),''))
  returning id into v_id;
  return v_id;
end $function$;

-- chronicle_entry_edit gains the same line after its own 24-hour check; the rest of that function
-- is unchanged and its comments are preserved in full. See the migration for the complete body.

revoke all on function public.chronicle_entry_add(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.chronicle_entry_edit(uuid, timestamptz, timestamptz, text, uuid) from public, anon;
grant execute on function public.chronicle_entry_add(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.chronicle_entry_edit(uuid, timestamptz, timestamptz, text, uuid) to authenticated;

-- ── the standing check, after ───────────────────────────────────────────────────────────────
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in ('chronicle_entry_add','chronicle_entry_edit');
-- → both false
