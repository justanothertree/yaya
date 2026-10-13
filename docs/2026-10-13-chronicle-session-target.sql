-- ✅ APPLIED 13 Oct 2026 — migration `chronicle_activity_session_target`
--
-- "When I draw, draw for at least half an hour" — the HTML app's `sessionGoal`, and the last of
-- its named features this one did not have. With this the parity list is closed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY IT IS A COLUMN AND NOT A GOAL POINTING AT THE ACTIVITY
-- ─────────────────────────────────────────────────────────────────────────────
-- A goal counts a WINDOW: thirty minutes of drawing today is met by six five-minute sessions.
-- This counts each SESSION, and six five-minute sessions is the exact thing somebody setting one
-- is trying to stop doing. Same number, opposite question — so chronicle_goals cannot express it
-- and a column on the activity can.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE SHAPE
-- ─────────────────────────────────────────────────────────────────────────────
--   chronicle_activities.session_mins integer
--     check (session_mins is null or (session_mins > 0 and session_mins <= 1440))
--
-- A day is the ceiling, matching the span check on an entry: a sitting cannot be longer than one.
-- Clamped rather than raised in the save function, like the estimate on a goal — losing a whole
-- save over an optional field is a worse outcome than losing the field.
--
-- ⚠️ DROP AND RECREATE, NOT `create or replace`. Adding a parameter makes an OVERLOAD, the old
-- signature stays callable, and with named arguments from the client which one answers is
-- postgres's choice. This project has been bitten twice; proven afterwards that exactly one
-- signature of chronicle_activity_save exists.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE TWO RULES THAT LIVE IN THE CLIENT (metSession, src/chronicle/record.ts)
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ A RUNNING SESSION IS NEVER SHORT. Five minutes into a thirty-minute target you have not
-- failed, you are five minutes in. `false` there would put a reproach on screen for the whole
-- first half of every sitting, which is the opposite of what the target is for. It returns null
-- until the line is passed, then true, and can only return false once the session has stopped.
-- Verified in the room: a session seven minutes into a two-hour target carried no marker, and
-- gained one the instant it was stopped.
--
-- ⚠️ AND IT IS THE WHOLE SPAN, NOT THE OVERLAP WITH THE DAY ON SCREEN. A session's LENGTH belongs
-- to the session, as its `amount` does — so a sitting from 23:00 to 00:30 is an hour and a half
-- seen from either day. Judging it by the overlap would call it long enough on the evening you did
-- it and too short the next morning: one sitting, two verdicts, decided by which day you opened.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PROVEN, all inside begin/rollback in a simulated session
-- ─────────────────────────────────────────────────────────────────────────────
--   signatures             exactly one, chronicle_activity_save(uuid,text,text,text,text,integer)
--   live rows              all 4 came back with session null — inert
--   session 99999          -> 1440
--   session 0              -> null
--   edit                   kept the session AND the metric together
--
-- The standing checks, which cannot go stale:
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and has_function_privilege('anon', p.oid, 'execute');
-- expected: zero rows for anything chronicle_%

select p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'chronicle_activity_save';
-- expected: exactly one row
