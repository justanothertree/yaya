-- Nothing bounded how fast a stranger could write.   2026-08-26
--   migration: submit_score_rate_limit_on_submitted_at
--
-- Closes the database half of OPEN-DECISIONS §7 ("Rate limiting on the anon RPCs ... nothing
-- bounds call volume"). The relay half ships in the same commit, in server/ws-server.js.
--
-- ── what was open ────────────────────────────────────────────────────────────
-- submit_score is executable by `anon`, and has to be: the game is played by strangers who
-- never sign in. Anyone holding the publishable key could write scores under any unclaimed
-- handle, as fast as they liked, forever. Every call also inserts into score_history AND can
-- create a player_registry row, so a flood pollutes three tables, not one.
--
-- (Claimed handles were already safe — a handle with an owner is only writable by that owner.
-- This is about the unclaimed ones, which is most of them.)
--
-- ── ⚠️ THE COLUMN THE LIMIT COUNTS ON ────────────────────────────────────────
-- The obvious limit — "count score_history rows in the last hour" — does not work here, and
-- would have looked like it did.
--
-- submit_score takes p_created_at from the CALLER and writes it to created_at, clamped only at
-- the top (least(p_created_at, now()), with anything before 2024-01-01 snapped to now()). So a
-- caller may stamp a row anywhere in a two-and-a-half-year window. A limit reading created_at
-- is therefore a limit the flooder sets the clock for: backdate every row to 2025 and the count
-- of "the last hour" stays at zero no matter how many you write.
--
-- score_history had no other timestamp, so this adds one the caller cannot reach:
--   submitted_at timestamptz not null default now()
-- It doubles as the honest answer to "when did this actually arrive", which created_at has
-- never been able to give.
--
-- ── the shape, sized from real traffic ───────────────────────────────────────
-- Measured before choosing the numbers, the way the contact-form limit was:
--   scores ever ................ 126, since 2025-12-20
--   distinct names .............. 26
--   last 30 days ................. 8
--   busiest hour by one name .... 13   ← the number that matters
--   busiest hour overall ........ 13   (the same session; one person playing)
--
--   per name: 40 an hour   — three times the busiest hour anyone has ever had
--   global:  200 an hour   — fifteen times it, a backstop and nothing else
--
-- ⚠️ The global ceiling is deliberately far out of reach of real use, because a global limit is
-- a SHARED FUSE: whoever trips it takes the leaderboard down for everyone else, and the flooder
-- hits their own per-name ceiling five times over before they get near it. That is the lesson
-- from docs/2026-08-24-the-contact-form-shared-fuse.sql, where a global-only limit meant one
-- sender could silence the form for every real visitor.
--
-- ⚠️ Names are matched case-insensitively, so "flood", "FLOOD" and "FlOoD" share one budget.
-- Rotating the NAME still buys a fresh one, and that is accepted on purpose: a handle is typed,
-- not proven, so per-name is a speed bump rather than an identity check. The relay's per-address
-- connection limit is what makes rotation expensive; neither is load-bearing alone.
--
-- ⚠️ Refusal returns NULL rather than raising. Every other refusal in this function already
-- does (blank name, score out of range, someone else's claimed handle), the client treats null
-- as "not recorded", and the in-match chat limiter in ws-server.js makes the same choice for the
-- same reason: telling a flooder they have been limited only tells them how fast to go.
--
-- ── considered and deliberately NOT done ─────────────────────────────────────
-- get_invite_by_token. §7 lists it, but a SQL rate limit here would be theatre. Tokens are
-- gen_random_uuid(), so enumeration is not the threat — 122 bits does that job — and the only
-- remaining risk is raw request volume, which belongs at the edge, not in a function. Adding one
-- would mean writing a row on every read of a read-only path, and any ceiling worth having would
-- be global: a shared fuse whose failure mode is that nobody can accept an invite. There is
-- currently ONE unclaimed invite in existence. Not worth it.
--
-- complete_member_signup. Also listed, but it raises 'not authenticated' before touching
-- anything, so it is not reachable by an actual anonymous caller despite the grant. Worth
-- revisiting whether the anon grant is vestigial; that is a separate question from rate limits.
--
-- ⚠️ Also noticed, NOT changed: p_created_at being caller-supplied at all lets anyone backdate a
-- leaderboard entry by up to two years. That is a scoring-integrity question rather than a rate
-- limit, and changing it would rewrite how offline rounds sync. Left for a decision.
--
-- ── ⚠️ THE BACKFILL, AND WHY IT IS NOT OPTIONAL ──────────────────────────────
--   migration: score_history_backfill_submitted_at_from_created_at
--
-- `add column ... not null default now()` stamps EVERY EXISTING ROW with now(). Applied to
-- production that put all 126 historical scores inside "the last hour" — and YAYA, with 91 of
-- them, was over the 40/hour ceiling the instant the function went live. The rate limit's first
-- act would have been to lock out the only real player, for an hour, with no message.
--
-- Caught by counting the buckets straight after applying, which is the only reason it was a
-- footnote rather than a bug report. A defaulted backfill is a silent data write; treat any
-- `not null default now()` on a table a limit reads as an event, not a schema detail.
--
-- The fix backfills submitted_at from created_at, which is also the honest value for rows that
-- predate the column. Scoped so it can only touch what the ALTER stamped — old by created_at,
-- brand new by submitted_at — so a genuine submission mid-migration is left alone.
-- Verified after: 0 rows counted in the hour, 0 nulls, 0 rows where the two disagree, 126 total.
--
-- ── verified ─────────────────────────────────────────────────────────────────
-- In a rolled-back transaction against production:
--   * 40 scores flooded under one name, EVERY ONE backdated to 2025-02-02 — the 41st refused,
--     which is the whole point: created_at said "no rows this hour" and it did not matter
--   * the same name in a different case (FLOODTEST-NAME) also refused
--   * a different name accepted while that one was blocked — the shared-fuse case
--   * the flood managed exactly 40 rows, not 41
--   * afterwards: score_history back to 126 rows, player_registry to 116, no submitted_at
--     column, no test rows left behind

alter table public.score_history
  add column if not exists submitted_at timestamptz not null default now();

-- Both counts below filter on an hour of submitted_at; the per-name one also folds case.
create index if not exists score_history_submitted_at_idx
  on public.score_history (submitted_at desc);
create index if not exists score_history_name_submitted_at_idx
  on public.score_history (lower(player_name), submitted_at desc);

create or replace function public.submit_score(
  p_name text,
  p_score integer,
  p_game_mode text default 'survival'::text,
  p_apples integer default null::integer,
  p_time integer default null::integer,
  p_created_at timestamp with time zone default now())
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_player_id bigint;
  v_owner uuid;
  v_lb_id bigint;
  v_existing integer;
  v_max_score constant integer := 1000000;
  v_at timestamptz := least(coalesce(p_created_at, now()), now());
  v_from_name int;
  v_total int;
  v_per_name constant int := 40;
  v_global   constant int := 200;
begin
  if v_name = '' or p_score is null or p_score <= 0 then
    return null;
  end if;

  if p_score > v_max_score then
    return null;
  end if;

  if v_at < timestamptz '2024-01-01' then
    v_at := now();
  end if;

  -- ⚠️ submitted_at, never created_at — created_at is whatever the caller passed in.
  -- Checked BEFORE the player_registry insert below, so a refused call cannot leave a row
  -- behind: registry pollution was half the cost of a flood.
  select count(*) into v_from_name
    from public.score_history
   where submitted_at > now() - interval '1 hour'
     and lower(player_name) = lower(v_name);
  if v_from_name >= v_per_name then
    return null;
  end if;

  select count(*) into v_total
    from public.score_history
   where submitted_at > now() - interval '1 hour';
  if v_total >= v_global then
    return null;
  end if;

  select id, user_id into v_player_id, v_owner
    from player_registry where player_name = v_name limit 1;

  -- a claimed handle is only writable by the member who claimed it
  if v_owner is not null and auth.uid() is distinct from v_owner then
    return null;
  end if;

  if v_player_id is null then
    begin
      insert into player_registry (player_name) values (v_name) returning id into v_player_id;
    exception when unique_violation then
      select id into v_player_id from player_registry where player_name = v_name limit 1;
    end;
  end if;

  insert into score_history (player_id, player_name, score, game_mode, apples_eaten, time_elapsed, created_at)
    values (v_player_id, v_name, p_score, p_game_mode, p_apples, p_time, v_at);

  select id, score into v_lb_id, v_existing
    from leaderboard where player_id = v_player_id and game_mode = p_game_mode limit 1;
  if v_lb_id is null then
    insert into leaderboard (player_id, player_name, score, game_mode, apples_eaten, time_elapsed, created_at)
      values (v_player_id, v_name, p_score, p_game_mode, p_apples, p_time, v_at)
      returning id into v_lb_id;
  elsif p_score > coalesce(v_existing, 0) then
    update leaderboard set score = p_score, player_name = v_name, apples_eaten = p_apples,
      time_elapsed = p_time, created_at = v_at where id = v_lb_id;
  end if;

  return v_lb_id;
end;
$function$;
