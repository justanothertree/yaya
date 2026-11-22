-- ✅ APPLIED to production 22 Nov 2026 (UTC) as migration `lab_match_chat`, version 20261122124951:
-- md5(statements[1]) = 5c4323e2b3aee06193af60cfaf02cd0d, this file's body. The record is
-- supabase/migrations/20261122124951_lab_match_chat.sql.
--
-- (as drafted) Chat for a match by turns: one conversation per match, kept with it,
-- that only the match's two players can read or write.
--
-- WHAT: a table, lab_match_chat, in the house pattern for member data (CLAUDE.md §3): RLS on, zero
-- policies, no grants, reached only through two SECURITY DEFINER functions that ask the same
-- question every match function asks, lab_match_mine: are you one of this match's two players, and
-- are you two still friends? Anybody else, a guest included, gets the answer a stranger gets.
--
--   lab_match_say(p_match, p_body)    one line, from your seat: 1–300 characters, one line, no
--                                     control characters; twenty a minute, five hundred a match,
--                                     and across all your matches thirty a minute, 500 in 24 hours
--   lab_match_lines(p_match, p_after) the lines after id p_after, oldest first, the last 100 at most
--
-- A LIVE GAME IN A CALL has no chat of its own and none of this: it uses the call's chat
-- (src/voice/CallChat.tsx in the call dock; the table's "Call chat" opens it), which everybody in
-- the call reads and which a DM or circuit call keeps in that conversation. This is only for the
-- matches by turns, where the two players are rarely on the page at once, so a line has to wait.
--
-- ⚠️ THE TABLE'S GRANTS ARE REVOKED, NOT LEFT OFF: the schema's default ACL hands anon and
-- authenticated every privilege on every new table (CLAUDE.md §3), and RLS does not cover TRUNCATE.
-- And `revoke … from public` does not reach anon in this project, so every revoke names it.
--
-- ⚠️ A DECLINED MATCH TAKES NO MORE LINES, and every other status does: a challenge is a fair place
-- to say "your move whenever", and a finished game is where "good game" goes. Unfriending closes it
-- both ways, as it closes the match itself. But the lines a challenge took while it was open still
-- count against the member's caps below once it is declined: challenge, talk, decline is the very
-- loop those caps are for.
--
-- ⚠️ THE CAPS ARE PER MEMBER AS WELL AS PER MATCH, BECAUSE A MATCH COSTS NOTHING TO MAKE.
-- lab_match_challenge is NOT rate-limited: it caps OPEN matches (ten a member, ten for the friend
-- challenged, one per pair and toy) and nothing else, and either player may decline an invitation —
-- the challenger included — which frees its slot at once. A finished match takes lines too, so even
-- without that a member's rate grows with every game they have ever played. Measured on a scratch
-- copy of main with the per-match caps alone, in one transaction (one minute): thirty rounds of
-- challenge, say, decline kept 600 lines from one member, and ten invitations left open took 200
-- more. The widest line is 1,441 bytes on disk (300 four-byte characters: heap and all three
-- indexes, measured over 10,000), so at the 800 a minute that run kept, one member fills the 500 MB
-- free tier in under eight hours, and nothing per match stops them going faster (CLAUDE.md §5).
--   So across every match a member plays, in any status and from whichever seat: THIRTY A MINUTE
-- and FIVE HUNDRED A DAY, beside the per-match twenty a minute and five hundred a match, which
-- stay. The same run with them in: 30 lines kept, the other 970 refused. Neither bites a person:
-- thirty a minute is more than anybody types — twenty in one match already is — with room to answer
-- in several games at once, and five hundred a day is a whole match's worth of chat every day,
-- where a lively evening across a few games is tens of lines. At the cap, every day, at the widest,
-- one member is 720 kB a day, about 260 MB a year: slow enough to be seen long before it matters,
-- and is_suspended stops them at their next line. The bound is per member, so it multiplies with
-- members, who are all somebody's friend.
--   ⚠️ THE DAY IS A ROLLING 24 HOURS, WRITTEN `interval '24 hours'`. `now() - interval '1 day'` is
-- a calendar day in the session's TimeZone, which this function does not set: measured in
-- America/New_York, it reached 25 hours back from noon UTC on 1 Nov 2026 and 23 from noon UTC on
-- 8 Mar. A minute, `interval '1 minute'`, is 60 seconds in every zone.
--   Both member counts are taken under a per-member advisory lock, as lab_match_challenge locks per
-- pair: the match row's lock only serialises one match, and two calls on two matches would each
-- count without the other's line and both write.
--
-- THE INDEX lab_match_chat_said (match_id, by_seat, at) IS FOR THOSE COUNTS. The table keeps a
-- seat, not a member, so a member's lines are found through the matches they play (lab_matches'
-- player_a and player_b indexes, which exist), and then by time within each. Measured 22 Nov 2026
-- on a scratch fixture of 5,971 matches and 298,550 lines, one member in 300 of them: without it
-- the per-match count read every line of every match the member had played (14 ms), and as a plain
-- join the planner seq-scanned the whole table instead (28 ms) — both growing with everybody's
-- history. With it, one index-only probe per match: 1.1 ms. At 3,000 matches for the member
-- (433,550 lines): 15 ms with it, against 114 ms without (2.2 s here with jit on, the plan's cost
-- being past its threshold), and the whole call 8–13 ms, generic plan included. An index on (at)
-- alone was no better (12 ms: it reads the whole site's day). The count is written per match, a
-- LATERAL aggregate, because that cannot be flattened into a join, so it stays one probe per match
-- whatever the statistics say. (match_id, id) stays: lab_match_lines pages by id.
--   A by_user column would make the count independent of how many matches a member has had, but it
-- would say who wrote a line twice with only this function to keep the two agreeing. What is left
-- growing is one probe per match ever played, about 4 µs each, and since challenges are not
-- rate-limited a friend could inflate that — each thousand matches they open and decline costs the
-- other a few milliseconds a line, and lab_match_challenge's own table first: worth a limit there.
--
-- ROLLBACK: docs/2026-11-18-lab-match-chat.ROLLBACK.sql. CHECKS: …checks.sql beside it.
-- TESTED: on the local stack (Supabase CLI 2.122.0, Postgres 17) by
-- supabase/tests/lab-match-chat.sql and two browsers, 18 Nov, before the per-member caps; with
-- them, by the same file's 43 cases on 22 Nov — lines in declined matches, the minute's edges and
-- the day asked in two zones whose clocks changed within it among them — on plain Postgres 16
-- builds of main, of main with only the three Lab migrations the chat needs and of main with every
-- Lab migration through dominoes, and on a plain Postgres 17 build of main
-- (supabase/tests/plain-postgres). Case 8 was given the per-match minute's edges after that, the
-- same day, and the file as it now stands was run on the build through dominoes only: all 43 hold.

create table public.lab_match_chat (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.lab_matches (id) on delete cascade,
  by_seat smallint not null check (by_seat in (0, 1)),
  body text not null check (char_length(body) between 1 and 300 and body = btrim(body)
                            and body !~ '[[:cntrl:]]'),
  at timestamptz not null default now()
);
create index lab_match_chat_match on public.lab_match_chat (match_id, id);
create index lab_match_chat_said on public.lab_match_chat (match_id, by_seat, at);

alter table public.lab_match_chat enable row level security;
revoke all on table public.lab_match_chat from public, anon, authenticated;
revoke all on sequence public.lab_match_chat_id_seq from public, anon, authenticated;

-- One line, from the caller's own seat.
create or replace function public.lab_match_say(p_match uuid, p_body text)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  m public.lab_matches := public.lab_match_mine(p_match);
  seat smallint;
  body text := btrim(coalesce(p_body, ''));
  line public.lab_match_chat;
  said_minute bigint;
  said_day bigint;
begin
  if public.is_suspended(me) then
    raise exception 'this account cannot chat' using errcode = '42501';
  end if;
  if m.status = 'declined' then
    raise exception 'this challenge was declined' using errcode = '22023';
  end if;
  if body = '' or char_length(body) > 300 or body ~ '[[:cntrl:]]' then
    raise exception 'a line is one line of 1 to 300 characters' using errcode = '22023';
  end if;
  seat := case when me = m.player_a then 0 else 1 end;
  -- one writer at a time per member, then per match, so none of the counts below can be raced
  -- past: the member's lock covers their lines in every match, the match's row both seats
  perform pg_advisory_xact_lock(hashtextextended('lab_match_chat:' || me::text, 0));
  perform 1 from public.lab_matches where id = m.id for update;
  if (select count(*) from public.lab_match_chat c
       where c.match_id = m.id and c.by_seat = seat and c.at > now() - interval '1 minute') >= 20 then
    raise exception 'slow down: twenty lines a minute is the most' using errcode = '54000';
  end if;
  if (select count(*) from public.lab_match_chat c where c.match_id = m.id) >= 500 then
    raise exception 'this match''s chat is full' using errcode = '54000';
  end if;
  -- and across every match the caller plays, whatever its status, from whichever seat they have in
  -- each: a count per match, so one probe of lab_match_chat_said each and never a scan of
  -- everybody's lines (the draft's header has the measurements). The day is '24 hours' and never
  -- '1 day', which is a calendar day in the session's TimeZone: 23 or 25 hours across a change of
  -- the clocks. A minute is 60 seconds in every zone.
  select coalesce(sum(n.minute), 0), coalesce(sum(n.day), 0) into said_minute, said_day
    from public.lab_matches x
   cross join lateral (
         select count(*) filter (where c.at > now() - interval '1 minute') as minute,
                count(*) as day
           from public.lab_match_chat c
          where c.match_id = x.id and c.by_seat = case when x.player_a = me then 0 else 1 end
            and c.at > now() - interval '24 hours') n
   where me in (x.player_a, x.player_b);
  if said_minute >= 30 then
    raise exception 'slow down: thirty lines a minute across your matches is the most'
      using errcode = '54000';
  end if;
  if said_day >= 500 then
    raise exception 'five hundred lines a day across your matches is the most'
      using errcode = '54000';
  end if;
  insert into public.lab_match_chat (match_id, by_seat, body)
  values (m.id, seat, body)
  returning * into line;
  return jsonb_build_object('id', line.id, 'seat', line.by_seat, 'body', line.body,
                            'at', line.at, 'mine', true);
end;
$$;

-- The lines after p_after, oldest first: the last hundred of them at most.
create or replace function public.lab_match_lines(p_match uuid, p_after bigint default 0)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  m public.lab_matches := public.lab_match_mine(p_match);
  seat smallint := case when me = m.player_a then 0 else 1 end;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', l.id, 'seat', l.by_seat, 'body', l.body,
                                        'at', l.at, 'mine', l.by_seat = seat) order by l.id)
      from (select * from public.lab_match_chat c
             where c.match_id = m.id and c.id > coalesce(p_after, 0)
             order by c.id desc limit 100) l
  ), '[]'::jsonb);
end;
$$;

-- a grant is not a revoke: a new function is executable by PUBLIC, and anon holds execute here
revoke all on function public.lab_match_say(uuid, text) from public, anon;
revoke all on function public.lab_match_lines(uuid, bigint) from public, anon;
grant execute on function public.lab_match_say(uuid, text) to authenticated;
grant execute on function public.lab_match_lines(uuid, bigint) to authenticated;
