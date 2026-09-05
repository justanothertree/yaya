-- 2026-09-05 — the pool's wheel, broadcast to the circuit it belongs to
--
-- WHY: the pool could already pick for you, but the pick happened on ONE laptop. Four people
-- deciding what to watch got one person reading out a result the others had to take on trust,
-- which is a worse version of that person just choosing. A randomiser only settles an argument
-- if the room watches it land.
--
-- So the roll is broadcast on `pool:<circuit uuid>`: the winner plus the exact sequence of names
-- the wheel will flick through, so every screen runs the same reel and stops on the same name.
-- Client side is src/circuit/poolRoll.ts.
--
-- ── WHAT THIS GRANTS, AND WHY INSERT IS DIFFERENT HERE ──────────────────────────────────────
-- The six channels in 2026-08-10 were deliberately SELECT-only: joining lets a client LISTEN,
-- and without INSERT a fixed topic like 'scores-changes' can never become a relay for strangers
-- to talk to each other through. That reasoning does not carry over, because a fixed topic is
-- exactly what this is not.
--
--   · the topic names a circuit, and the gate is membership OF THAT CIRCUIT. There is no topic
--     here that a stranger and a member both reach — an unrecognised uuid matches nobody's
--     membership and is refused, and a real one is refused to everyone outside it.
--   · so the audience for anything sent is precisely the people who can already see the pool,
--     read each other's votes, and delete each other's options. Speaking to them is not a new
--     capability, it is the one they already have, arriving faster.
--
-- Same shape as `voice: members can send`, which this is copied from down to the `extension`
-- filter, and for the same reason: a broadcast needs INSERT or the send is silently dropped.
--
-- ⚠️ The `extension in ('broadcast','presence')` filter belongs on THESE policies and must not
-- be copied onto a postgres_changes topic. See the long note in 2026-08-10 — `extension`
-- describes the authorization probe, not the subscription, and is null at join time for a
-- postgres_changes channel, so filtering on it there produces false denials only. Here the
-- channel really is a broadcast, so the filter is real and keeps the grant narrow.
--
-- ⚠️ Nothing is persisted. A roll is a moment, not a record — what the room decided becomes
-- durable when somebody presses "✓ Did it", which moves it to the review board through the
-- ordinary tables. No new table, no retention question, and a roll cannot be replayed at
-- somebody later.

create or replace function public.pool_topic_member(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  raw text;
begin
  raw := substring(p_topic from '^pool:([0-9a-fA-F-]{36})$');
  if raw is null then
    return false;
  end if;
  return exists (
    select 1 from public.circuit_group_members m
    where m.group_id = raw::uuid and m.user_id = auth.uid()
  );
end;
$$;

-- anon has no circuits and never will: the pool is members-only, and the client does not even
-- open the channel when signed out
revoke all on function public.pool_topic_member(text) from public, anon;
grant execute on function public.pool_topic_member(text) to authenticated;

create policy "pool: the circuit can watch the wheel"
on realtime.messages
for select
to authenticated
using (
  (extension = any (array['broadcast', 'presence']))
  and public.pool_topic_member((select realtime.topic()))
);

create policy "pool: the circuit can spin it"
on realtime.messages
for insert
to authenticated
with check (
  (extension = any (array['broadcast', 'presence']))
  and public.pool_topic_member((select realtime.topic()))
);

-- ── HOW TO CHECK IT WORKED ──────────────────────────────────────────────────────────────────
-- Signed in, open Ratings → Pool with two options in it and press "🎲 Pick for us". A second
-- browser signed in as somebody in the SAME circuit should see the wheel turn and stop on the
-- same name. If the console says
--     [realtime] pool:<uuid>: CHANNEL_ERROR … (not live)
-- the policies above are not in place, or that account is not in that circuit. The pool still
-- works in that state — whoever pressed the button sees their own wheel and the result is real,
-- it just isn't shared, which is deliberate: see the note on `self: false` in poolRoll.ts.
--
-- Predicate check without a browser:
--   select public.pool_topic_member('pool:' || id) from public.circuit_groups;  -- as a member
--   select public.pool_topic_member('pool:not-a-uuid');                          -- false
--   select public.pool_topic_member('chat:' || id) from public.circuit_groups;   -- false
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
-- drop policy if exists "pool: the circuit can watch the wheel" on realtime.messages;
-- drop policy if exists "pool: the circuit can spin it" on realtime.messages;
-- drop function if exists public.pool_topic_member(text);
-- ...and the pool goes back to deciding for one person at a time; no app change needed.
