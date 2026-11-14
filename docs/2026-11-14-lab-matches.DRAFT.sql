-- ⛔ DRAFT — NOT APPLIED. Nothing in this file has run against production.
--
-- Step 2 of docs/2026-11-14-lab-async-matches-plan.md: Lab matches played by turns between two
-- friends, saved on the server, and lab_results (step 9 of docs/2026-11-13-lab-social-plan.md),
-- drafted together as Evan asked on 14 Nov. Every move is checked by the toy's own rules in the
-- `lab-move` edge function (step 3, not drafted here); this file is where the moves are kept and
-- the only door they go through.
--
-- WHAT IT ADDS, in the house pattern (CLAUDE.md §3): three tables with RLS ON, ZERO policies and no
-- grants to anon or authenticated — deny-all — reached only through SECURITY DEFINER functions.
--
--   lab_matches       one match between two members: the toy, versus or together, its settings,
--                     the game as the toy's Rules.encode gives it, whose turn and since when, and
--                     the result. `secret` is for dice and hidden hands later; nothing returns it.
--   lab_match_moves   every move, numbered: the history that makes a finished match replayable.
--   lab_results       one checked result per member (the step 9 table): what the server itself
--                     saw happen. A finished match writes one row for each player.
--
-- WHO MAY DO WHAT. Members call the RPCs below; the edge function calls the service-only ones with
-- the service key, after checking the move with the toy's rules.
--
--   lab_match_challenge  challenge a FRIEND to a toy this file lists as playable (Reversi and Chess,
--                        Evan's first two). At most 10 open matches each, one open match per friend
--                        per toy (asking again returns the open one).
--   lab_match_decline    either player, while it is still an invitation.
--   lab_match_list       your matches, newest first, without the game.
--   lab_match_get        one match, with the game, if you are in it and still friends.
--   lab_match_resign     either player, while it is going: the other one wins.
--   lab_match_claim      the player waiting, once the other has not moved for 7 days (Evan,
--                        14 Nov): nothing ends a match on its own.
--   lab_my_turns         how many matches wait on you, for the bell and the badge.
--   (service) lab_match_load, lab_match_begin, lab_match_commit — the only writes that put a
--                        game in a match. commit takes `at_seq`, the move count the mover saw, and
--                        updates only a row still at it, so two moves against one board cannot
--                        both land.
--
-- ⚠️ FRIENDS, ASKED EVERY TIME, AND NOT THROUGH are_friends. are_friends answers only when the
-- caller is one of the pair, and the edge function has no caller (auth.uid() is null under the
-- service key), so it would answer NULL and refuse every move. lab_pair_friends asks the
-- friendships table directly and is callable by nobody but these functions. A friendship ended
-- mid-match hides the match from both lists at once, refuses every move in it, and ends it (status
-- 'ended', no winner) the next time either player challenges anybody.
--
-- ⚠️ A SUSPENDED MEMBER writes nothing: no challenge, no move, no resign, no claim.
--
-- WHAT DOES NOT CHANGE. No existing table, column, row, function or grant. The Feed event for a
-- finished match and the bell's `lab` kind are later steps (5 and 6), each its own draft.
--
-- ⚠️ AFTER APPLYING: supabase/tests/lab-feedback.sql pins the exact list of callable lab_*
-- functions (its case 1) and will need the new names added the same day.
--
-- ROLLBACK: docs/2026-11-14-lab-matches.ROLLBACK.sql.
-- CHECKS:   docs/2026-11-14-lab-matches.checks.sql (read-only; before and after).
-- TEST:     supabase/tests/lab-matches.sql, on a throwaway database (it rolls back).

-- ── the tables ───────────────────────────────────────────────────────────────────────────────
create table public.lab_matches (
  id uuid primary key default gen_random_uuid(),
  demo_id text not null references public.lab_demos (id),
  mode text not null check (mode in ('versus', 'together')),
  player_a uuid not null references auth.users (id) on delete cascade, -- seat 0, who challenged
  player_b uuid not null references auth.users (id) on delete cascade, -- seat 1
  status text not null default 'invited'
    check (status in ('invited', 'active', 'finished', 'declined', 'ended')),
  settings jsonb not null default '{}'::jsonb check (octet_length(settings::text) <= 200),
  state jsonb check (octet_length(state::text) <= 16384),
  secret jsonb check (octet_length(secret::text) <= 16384),
  seq int not null default 0 check (seq >= 0),
  turn smallint check (turn in (0, 1)),
  turn_since timestamptz,
  result jsonb check (octet_length(result::text) <= 200),
  rematch_of uuid references public.lab_matches (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check (player_a <> player_b),
  -- no game while it is an invitation, a game once it is going (an ended match keeps its board),
  -- and a turn exactly while it is going
  check (status <> 'invited' or state is null),
  check (status not in ('active', 'finished') or state is not null),
  check ((status = 'active') = (turn is not null and turn_since is not null)),
  check ((status = 'finished') = (result is not null and finished_at is not null))
);
-- one open match per pair per toy, whoever challenged whom
create unique index lab_matches_one_open
  on public.lab_matches (demo_id, least(player_a, player_b), greatest(player_a, player_b))
  where status in ('invited', 'active');
create index lab_matches_player_a on public.lab_matches (player_a, status);
create index lab_matches_player_b on public.lab_matches (player_b, status);

create table public.lab_match_moves (
  match_id uuid not null references public.lab_matches (id) on delete cascade,
  seq int not null check (seq >= 1),
  by_seat smallint not null check (by_seat in (0, 1)),
  move jsonb not null check (octet_length(move::text) <= 200),
  at timestamptz not null default now(),
  primary key (match_id, seq)
);

create table public.lab_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  demo_id text not null references public.lab_demos (id),
  day date not null,
  params jsonb not null check (octet_length(params::text) <= 200),
  metric jsonb not null check (octet_length(metric::text) <= 200),
  -- which check made it: 'match@1' for a match the server played, 'lamps@1' for a replayed solve
  checked_by text not null check (checked_by ~ '^[a-z0-9-]{1,40}@[0-9]{1,4}$'),
  match_id uuid references public.lab_matches (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (match_id, user_id)
);
create index lab_results_user on public.lab_results (user_id, created_at desc);

alter table public.lab_matches enable row level security;
alter table public.lab_match_moves enable row level security;
alter table public.lab_results enable row level security;

-- ⚠️ EXPLICIT, BECAUSE THE SCHEMA'S DEFAULT ACL GRANTS EVERYTHING (CLAUDE.md §3): no policy refuses
-- rows but not TRUNCATE. service_role keeps its access, as on every other table here.
revoke all on table public.lab_matches, public.lab_match_moves, public.lab_results
  from public, anon, authenticated;
grant all on table public.lab_matches, public.lab_match_moves, public.lab_results to service_role;

-- ── the rules, in one place ─────────────────────────────────────────────────────────────────
-- The toys a match may be played on. Evan, 14 Nov: Reversi and Chess first; the next four
-- (gomoku, draughts, dots, fourrow) join by a `create or replace` of this, with the edge function
-- that knows their rules.
create or replace function public.lab_match_playable(p_demo text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_demo in ('reversi', 'chess') $$;

-- How long a turn may stand before the player waiting may claim the win (Evan, 14 Nov: 7 days),
-- and how long an invitation stays open.
create or replace function public.lab_match_timeout()
returns interval
language sql immutable
set search_path = public, pg_temp
as $$ select interval '7 days' $$;

-- Are these two accepted friends — asked of the table, for any caller, because the edge function
-- has none. Callable by these functions only.
create or replace function public.lab_pair_friends(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.friendships f
     where f.user_a = least(p_a, p_b) and f.user_b = greatest(p_a, p_b) and f.status = 'accepted')
$$;

-- One match as a player sees it: never `secret`, and the game only when asked for.
create or replace function public.lab_match_json(m public.lab_matches, p_me uuid, p_with_state boolean)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', m.id,
    'demo', m.demo_id,
    'mode', m.mode,
    'settings', m.settings,
    'seats', jsonb_build_array(
      jsonb_build_object('id', m.player_a, 'name',
        (select coalesce(p.first_name, p.username::text) from public.profiles p where p.user_id = m.player_a)),
      jsonb_build_object('id', m.player_b, 'name',
        (select coalesce(p.first_name, p.username::text) from public.profiles p where p.user_id = m.player_b))),
    'you', case p_me when m.player_a then 0 when m.player_b then 1 end,
    -- an invitation nobody answered for the timeout reads as expired; nothing writes that
    'status', case when m.status = 'invited' and m.created_at < now() - public.lab_match_timeout()
                   then 'expired' else m.status end,
    'seq', m.seq,
    'turn', m.turn,
    'turn_since', m.turn_since,
    'can_claim', m.status = 'active'
                 and m.turn is distinct from (case p_me when m.player_a then 0 when m.player_b then 1 end)
                 and m.turn_since < now() - public.lab_match_timeout(),
    'result', m.result,
    'rematch_of', m.rematch_of,
    'updated_at', m.updated_at
  ) || case when p_with_state then jsonb_build_object('state', m.state) else '{}'::jsonb end
$$;

-- The one check every member RPC makes first: signed in, one of the two players, still friends.
-- Returns the match, or raises the same error whether it does not exist or is not yours, so an id
-- cannot be probed for.
create or replace function public.lab_match_mine(p_match uuid)
returns public.lab_matches
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  m public.lab_matches;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  select * into m from public.lab_matches where id = p_match;
  if m.id is null or me not in (m.player_a, m.player_b)
     or not public.lab_pair_friends(m.player_a, m.player_b) then
    raise exception 'no such match' using errcode = 'P0002';
  end if;
  return m;
end;
$$;

-- A finished match's results, one row per player, written by whichever function finished it.
create or replace function public.lab_match_record(m public.lab_matches)
returns void
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  w text := m.result->>'winner';
begin
  insert into public.lab_results (user_id, demo_id, day, params, metric, checked_by, match_id)
  select pl.uid, m.demo_id, (m.finished_at at time zone 'utc')::date,
         jsonb_build_object('mode', m.mode) || m.settings,
         jsonb_build_object(
           'outcome', case when w = 'draw' then 'drawn'
                           when m.mode = 'together' then case when w = '0' then 'won' else 'lost' end
                           when w = pl.seat::text then 'won' else 'lost' end,
           'how', m.result->>'how'),
         'match@1', m.id
    from (values (m.player_a, 0), (m.player_b, 1)) pl(uid, seat)
  on conflict (match_id, user_id) do nothing;
end;
$$;

-- ── what members call ───────────────────────────────────────────────────────────────────────
create or replace function public.lab_match_challenge(
  p_friend uuid, p_demo text, p_mode text, p_settings jsonb default '{}'::jsonb,
  p_rematch_of uuid default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  m public.lab_matches;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if public.is_suspended(me) then
    raise exception 'this account cannot play' using errcode = '42501';
  end if;
  -- a non-friend, a suspended friend and a nonexistent id all get the same answer
  if p_friend is null or p_friend = me or not public.lab_pair_friends(me, p_friend)
     or public.is_suspended(p_friend) then
    raise exception 'you can only challenge a friend' using errcode = '42501';
  end if;
  if not public.lab_match_playable(p_demo) then
    raise exception 'that toy is not played by turns yet' using errcode = '22023';
  end if;
  perform public.lab_demo_open(p_demo);
  if (select hidden from public.lab_demos where id = p_demo) then
    raise exception 'this experiment is retired' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('versus', 'together') then
    raise exception 'a match is versus or together' using errcode = '22023';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or octet_length(p_settings::text) > 200 then
    raise exception 'settings are a small object' using errcode = '22023';
  end if;
  -- a friendship that ended mid-match ends that match, here where a member writes anyway; until
  -- then every read already hides it, so nothing waits on this
  update public.lab_matches
     set status = 'ended', turn = null, turn_since = null, updated_at = now()
   where status in ('invited', 'active') and me in (player_a, player_b)
     and not public.lab_pair_friends(player_a, player_b);
  -- serialised per pair, so two racing challenges cannot both open a match
  perform pg_advisory_xact_lock(hashtextextended(
    'lab_match:' || least(me, p_friend)::text || greatest(me, p_friend)::text, 0));
  select * into m from public.lab_matches
   where demo_id = p_demo and status in ('invited', 'active')
     and least(player_a, player_b) = least(me, p_friend)
     and greatest(player_a, player_b) = greatest(me, p_friend);
  if m.id is not null then
    return public.lab_match_json(m, me, false); -- the one already open
  end if;
  if (select count(*) from public.lab_matches
       where status in ('invited', 'active') and me in (player_a, player_b)) >= 10 then
    raise exception 'ten open matches is the most' using errcode = '54000';
  end if;
  if (select count(*) from public.lab_matches
       where status in ('invited', 'active') and p_friend in (player_a, player_b)) >= 10 then
    raise exception 'they already have ten open matches' using errcode = '54000';
  end if;
  if p_rematch_of is not null and not exists (
       select 1 from public.lab_matches r
        where r.id = p_rematch_of and r.status = 'finished'
          and least(r.player_a, r.player_b) = least(me, p_friend)
          and greatest(r.player_a, r.player_b) = greatest(me, p_friend)) then
    raise exception 'a rematch is of a finished match between you' using errcode = '22023';
  end if;
  insert into public.lab_matches (demo_id, mode, player_a, player_b, settings, rematch_of)
  values (p_demo, p_mode, me, p_friend, p_settings, p_rematch_of)
  returning * into m;
  return public.lab_match_json(m, me, false);
end;
$$;

create or replace function public.lab_match_decline(p_match uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  m public.lab_matches := public.lab_match_mine(p_match);
begin
  if public.is_suspended(auth.uid()) then
    raise exception 'this account cannot play' using errcode = '42501';
  end if;
  if m.status <> 'invited' then
    raise exception 'only an invitation can be declined' using errcode = '22023';
  end if;
  update public.lab_matches set status = 'declined', updated_at = now()
   where id = m.id returning * into m;
  return public.lab_match_json(m, auth.uid(), false);
end;
$$;

-- Read-only: a suspended member may still see their own matches, and change nothing.
create or replace function public.lab_match_list()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  return coalesce((
    select jsonb_agg(public.lab_match_json(m, me, false)
                     order by (m.status = 'active' and m.turn = case me when m.player_a then 0 else 1 end) desc,
                              m.updated_at desc)
      from public.lab_matches m
     where me in (m.player_a, m.player_b)
       and public.lab_pair_friends(m.player_a, m.player_b)
       and (m.status in ('invited', 'active') or m.updated_at > now() - interval '30 days')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.lab_match_get(p_match uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  return public.lab_match_json(public.lab_match_mine(p_match), auth.uid(), true);
end;
$$;

create or replace function public.lab_match_resign(p_match uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  m public.lab_matches := public.lab_match_mine(p_match);
begin
  if public.is_suspended(me) then
    raise exception 'this account cannot play' using errcode = '42501';
  end if;
  if m.status <> 'active' then
    raise exception 'only a match that is going can be resigned' using errcode = '22023';
  end if;
  update public.lab_matches
     set status = 'finished', turn = null, turn_since = null, finished_at = now(), updated_at = now(),
         result = jsonb_build_object(
           -- together, the side resigns as one: the computer's side wins
           'winner', case when mode = 'together' then 1 when me = player_a then 1 else 0 end,
           'how', 'resigned')
   where id = m.id returning * into m;
  perform public.lab_match_record(m);
  return public.lab_match_json(m, me, true);
end;
$$;

create or replace function public.lab_match_claim(p_match uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  m public.lab_matches := public.lab_match_mine(p_match);
  mine smallint := case me when m.player_a then 0 else 1 end;
begin
  if public.is_suspended(me) then
    raise exception 'this account cannot play' using errcode = '42501';
  end if;
  if m.status <> 'active' or m.mode <> 'versus' or m.turn = mine
     or m.turn_since >= now() - public.lab_match_timeout() then
    raise exception 'a win can be claimed only after the other player has not moved for 7 days'
      using errcode = '22023';
  end if;
  update public.lab_matches
     set status = 'finished', turn = null, turn_since = null, finished_at = now(), updated_at = now(),
         result = jsonb_build_object('winner', mine, 'how', 'timeout')
   where id = m.id returning * into m;
  perform public.lab_match_record(m);
  return public.lab_match_json(m, me, true);
end;
$$;

create or replace function public.lab_my_turns()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'your_move', (select count(*) from public.lab_matches m
                   where m.status = 'active' and m.turn = case me when m.player_a then 0 else 1 end
                     and me in (m.player_a, m.player_b)
                     and public.lab_pair_friends(m.player_a, m.player_b)),
    'invites', (select count(*) from public.lab_matches m
                 where m.status = 'invited' and m.player_b = me
                   and m.created_at >= now() - public.lab_match_timeout()
                   and public.lab_pair_friends(m.player_a, m.player_b)));
end;
$$;

-- ── what only the edge function calls, after the toy's rules have checked the move ──────────
-- The match as the checker needs it, secret included.
create or replace function public.lab_match_load(p_match uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(m) from public.lab_matches m where m.id = p_match
$$;

-- An invitation accepted: the invited player, the toy's fresh game, and the first turn.
create or replace function public.lab_match_begin(
  p_match uuid, p_by uuid, p_state jsonb, p_turn smallint, p_secret jsonb default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  m public.lab_matches;
begin
  select * into m from public.lab_matches where id = p_match for update;
  if m.id is null or m.status <> 'invited' or p_by is distinct from m.player_b
     or m.created_at < now() - public.lab_match_timeout()
     or not public.lab_pair_friends(m.player_a, m.player_b)
     or public.is_suspended(m.player_a) or public.is_suspended(m.player_b) then
    raise exception 'that invitation cannot be accepted' using errcode = '22023';
  end if;
  if p_state is null or p_turn is null or p_turn not in (0, 1) then
    raise exception 'a match begins with a game and a turn' using errcode = '22023';
  end if;
  update public.lab_matches
     set status = 'active', state = p_state, secret = p_secret, turn = p_turn,
         turn_since = now(), updated_at = now()
   where id = m.id returning * into m;
  return public.lab_match_json(m, p_by, true);
end;
$$;

-- A move the toy's rules accepted, written only to a match still at the seq the mover saw.
-- p_result null: the game goes on with p_turn to move; otherwise it is over, and p_turn is ignored.
create or replace function public.lab_match_commit(
  p_match uuid, p_at_seq int, p_by uuid, p_move jsonb, p_state jsonb, p_turn smallint,
  p_result jsonb default null, p_secret jsonb default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
declare
  m public.lab_matches;
  seat smallint;
  w jsonb := p_result->'winner';
begin
  select * into m from public.lab_matches where id = p_match for update;
  if m.id is null or m.status <> 'active' then
    raise exception 'that match is not going' using errcode = '22023';
  end if;
  -- the board has moved on since the mover looked: their move is not this board's move
  if p_at_seq is distinct from m.seq then
    raise exception 'the match has moved on' using errcode = '40001';
  end if;
  seat := case p_by when m.player_a then 0 when m.player_b then 1 end;
  if seat is null or seat <> m.turn then
    raise exception 'it is not your turn' using errcode = '42501';
  end if;
  if not public.lab_pair_friends(m.player_a, m.player_b) or public.is_suspended(p_by) then
    raise exception 'that match cannot be played' using errcode = '42501';
  end if;
  if p_move is null or p_state is null then
    raise exception 'a move and the game after it' using errcode = '22023';
  end if;
  if p_result is null and (p_turn is null or p_turn not in (0, 1)) then
    raise exception 'a game that goes on has somebody to move' using errcode = '22023';
  end if;
  if p_result is not null and (w is null or w not in ('0', '1', '"draw"'::jsonb)
                               or (p_result ? 'score' and (jsonb_typeof(p_result->'score') <> 'string'
                                                         or length(p_result->>'score') > 40))) then
    raise exception 'a result names a winning seat or a draw, and at most a short score'
      using errcode = '22023';
  end if;
  -- sixty moves a minute is far past a person, and well short of a script
  perform pg_advisory_xact_lock(hashtextextended('lab_move:' || p_by::text, 0));
  if (select count(*) from public.lab_match_moves mv join public.lab_matches x on x.id = mv.match_id
       where mv.at > now() - interval '1 minute'
         and ((mv.by_seat = 0 and x.player_a = p_by) or (mv.by_seat = 1 and x.player_b = p_by))) >= 60 then
    raise exception 'slow down: sixty moves a minute is the most' using errcode = '54000';
  end if;
  insert into public.lab_match_moves (match_id, seq, by_seat, move) values (m.id, m.seq + 1, seat, p_move);
  update public.lab_matches
     set seq = seq + 1, state = p_state, secret = coalesce(p_secret, secret), updated_at = now(),
         turn = case when p_result is null then p_turn end,
         turn_since = case when p_result is null then now() end,
         status = case when p_result is null then 'active' else 'finished' end,
         -- only what this function vouches for: who won, that it was played, and the toy's score
         result = case when p_result is not null then
                    jsonb_build_object('winner', w, 'how', 'played')
                    || case when p_result ? 'score' then jsonb_build_object('score', p_result->'score')
                            else '{}'::jsonb end
                  end,
         finished_at = case when p_result is null then null else now() end
   where id = m.id returning * into m;
  if m.status = 'finished' then
    perform public.lab_match_record(m);
  end if;
  return public.lab_match_json(m, p_by, true);
end;
$$;

-- ── who may call what ────────────────────────────────────────────────────────────────────────
-- ⚠️ revoke … from public DOES NOT COVER anon in this project (CLAUDE.md §3): each is named.
revoke all on function
  public.lab_match_playable(text), public.lab_match_timeout(),
  public.lab_pair_friends(uuid, uuid), public.lab_match_json(public.lab_matches, uuid, boolean),
  public.lab_match_mine(uuid), public.lab_match_record(public.lab_matches),
  public.lab_match_challenge(uuid, text, text, jsonb, uuid), public.lab_match_decline(uuid),
  public.lab_match_list(), public.lab_match_get(uuid), public.lab_match_resign(uuid),
  public.lab_match_claim(uuid), public.lab_my_turns(),
  public.lab_match_load(uuid), public.lab_match_begin(uuid, uuid, jsonb, smallint, jsonb),
  public.lab_match_commit(uuid, int, uuid, jsonb, jsonb, smallint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.lab_match_challenge(uuid, text, text, jsonb, uuid), public.lab_match_decline(uuid),
  public.lab_match_list(), public.lab_match_get(uuid), public.lab_match_resign(uuid),
  public.lab_match_claim(uuid), public.lab_my_turns()
  to authenticated;
grant execute on function
  public.lab_match_load(uuid), public.lab_match_begin(uuid, uuid, jsonb, smallint, jsonb),
  public.lab_match_commit(uuid, int, uuid, jsonb, jsonb, smallint, jsonb, jsonb)
  to service_role;
