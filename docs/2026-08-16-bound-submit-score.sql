-- Sanity bounds on submit_score
-- =============================
-- WHY: this one has to stay callable by `anon` — it is how a signed-out player's solo score
-- reaches the leaderboard, and that is the point of a public arcade game. So it cannot be
-- locked down the way finalize_round_rpc can. What it CAN do is refuse the impossible:
--
--   1. UNBOUNDED SCORE. The only check was `p_score > 0`, so a forged 2,000,000,000 would sit
--      permanently at the top of the board. The cap below is far above any reachable score, so
--      it never touches real play — it just removes "infinity" as an option.
--   2. CALLER-CONTROLLED TIMESTAMP. `p_created_at` was written as given, so a score could be
--      dated into the future and pinned to the top of any recent-first view forever.
--
-- NOT fixed here, because it cannot be without accounts: a caller can still submit a plausible
-- score under someone else's name, and still create `player_registry` rows. Tying leaderboard
-- entries to authenticated users is the only real answer, and that is a product decision about
-- whether signed-out people can compete at all.

begin;

create or replace function public.submit_score(
  p_name text,
  p_score integer,
  p_game_mode text default 'survival'::text,
  p_apples integer default null::integer,
  p_time integer default null::integer,
  p_created_at timestamp with time zone default now()
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_player_id bigint;
  v_lb_id bigint;
  v_existing integer;
  -- orders of magnitude above anything the game can produce; this rejects forgery, not play
  v_max_score constant integer := 1000000;
  -- never in the future, and never before the game existed
  v_at timestamptz := least(coalesce(p_created_at, now()), now());
begin
  if v_name = '' or p_score is null or p_score <= 0 then
    return null;
  end if;

  -- Refuse rather than clamp: a clamped score would silently enter the board as a legitimate
  -- looking record, and there is no honest score this rejects.
  if p_score > v_max_score then
    return null;
  end if;

  -- guard the other direction too: a backdated entry rewrites history just as effectively
  if v_at < timestamptz '2024-01-01' then
    v_at := now();
  end if;

  -- find-or-create player (player_name is case-insensitive)
  select id into v_player_id from player_registry where player_name = v_name limit 1;
  if v_player_id is null then
    begin
      insert into player_registry (player_name) values (v_name) returning id into v_player_id;
    exception when unique_violation then
      select id into v_player_id from player_registry where player_name = v_name limit 1;
    end;
  end if;

  -- always record the run in history
  insert into score_history (player_id, player_name, score, game_mode, apples_eaten, time_elapsed, created_at)
    values (v_player_id, v_name, p_score, p_game_mode, p_apples, p_time, v_at);

  -- keep one best row per player + mode on the leaderboard
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

commit;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- The previous definition differed only in the two guards: it had no v_max_score check and
-- wrote `p_created_at` directly instead of `v_at`. To revert, re-run this file with those two
-- guards removed — the rest of the body is unchanged.
