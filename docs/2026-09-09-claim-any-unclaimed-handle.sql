-- 2026-09-09 — claiming a Snake handle stops being "ask Evan"
--
--
-- WHAT WAS WRONG
--
-- claim_snake_name would only accept a handle that matched one of your own profile names —
-- username, nickname, snake_nickname or first_name, punctuation stripped. That sounds like a
-- safety check and is in practice a refusal, because the whole point of an arcade handle is that
-- it is NOT your name.
--
-- Measured on the live registry before writing this. Of the claimed rows, the ones that could
-- have passed that test are exactly the rows whose handle equals the account's username — the
-- registry row created at sign-up, which nobody ever needs to claim. Every handle anybody
-- actually plays under failed it:
--
--     handle            their names        would the old rule allow it?
--     HighScoreChamp    Cam                no
--     Krazay            Josh               no
--     YAYA              evan / Evan        no
--     YAYA phone        evan / Evan        no
--
-- and the refusal message said "ask Evan to link it for you", which is precisely what everyone
-- ended up doing. The gate only ever admitted the handles that needed no gate.
--
--
-- ⚠️ THE NEW RULE, AND WHAT IT GIVES UP
--
-- Any handle nobody has claimed can be claimed by whoever asks first. That is a deliberate
-- trade and it is worth stating plainly rather than burying: a handle carries its score history,
-- so first-come means an unclaimed name — including a friend's — can be taken by someone who
-- never played it. On a board this size, with the names already known to the people on it, that
-- is the accepted cost of everyone being able to claim without going through Evan.
--
-- What is still refused, and must stay refused:
--   · a handle somebody else has already claimed
--   · an ambiguous board name that maps to more than one registry row
--   · anonymous callers
--
-- ⚠️ Ten an hour. Not a serious attacker's obstacle — it is there so a single accident or a bored
-- afternoon cannot sweep the whole registry into one account before anybody notices. Evan owns
-- three handles himself, so the limit has to sit well above ordinary use.
--
-- ⚠️ Claiming already had a second effect nobody wanted: submit_score refuses a claimed handle
-- unless auth.uid() matches the owner, and the Snake board submitted through a session-less
-- client, so claiming your handle silently stopped your scores saving. That is fixed in the app
-- (src/game/leaderboard.ts), not here — but it is the reason claiming was worth avoiding, and
-- both halves need to be in place for this to be an improvement.

-- ⚠️ FIRST: the function below reads and writes claimed_at, so the column has to exist before
-- it does. Postgres will not catch this for you — a plpgsql body is not resolved against the
-- catalog at creation time, so the wrong order creates cleanly and fails on first call.
alter table public.player_registry add column if not exists claimed_at timestamptz;

create or replace function public.claim_snake_name(p_name text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id     bigint;
  v_owner  uuid;
  v_recent int;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Which handle?';
  end if;

  -- exact registry name first (the original path, unchanged)
  select id, user_id into v_id, v_owner
    from public.player_registry
   where lower(player_name::text) = lower(p_name);

  -- else the name as it RENDERS on the board. Ambiguity is possible in principle (two handles
  -- whose board rows share a name), and silently picking one could hand over the wrong person's
  -- scores — so refuse and let the operator link it instead.
  if v_id is null then
    if (select count(distinct l.player_id) from public.leaderboard l
         where lower(l.player_name) = lower(p_name) and l.player_id is not null) > 1 then
      raise exception 'That handle is ambiguous — ask Evan to link it for you.';
    end if;
    select r.id, r.user_id into v_id, v_owner
      from public.leaderboard l
      join public.player_registry r on r.id = l.player_id
     where lower(l.player_name) = lower(p_name)
     limit 1;
  end if;

  if v_id is null then
    raise exception 'No such handle on the leaderboard.';
  end if;

  -- already yours: succeed quietly rather than erroring, so a double tap is not a failure
  if v_owner = auth.uid() then
    return;
  end if;

  if v_owner is not null then
    raise exception 'That handle is already claimed.';
  end if;

  select count(*) into v_recent
    from public.player_registry
   where user_id = auth.uid()
     and claimed_at > now() - interval '1 hour';
  if v_recent >= 10 then
    raise exception 'That is a lot of handles at once — try again in an hour.';
  end if;

  update public.player_registry
     set user_id = auth.uid(), claimed_at = now()
   where id = v_id
     and user_id is null;  -- ⚠️ re-checked in the UPDATE: two people claiming the same free
                           -- handle at the same instant both passed the check above, and the
                           -- row is the only place that race can actually be settled.

  if not found then
    raise exception 'That handle was just claimed by somebody else.';
  end if;
end
$function$;

revoke all on function public.claim_snake_name(text) from public, anon;
grant execute on function public.claim_snake_name(text) to authenticated;


-- ── HOW TO CHECK IT WORKED ──────────────────────────────────────────────────────────────────
-- Nothing changed ownership just by running this:
--
--   select count(*) filter (where user_id is not null) as claimed,
--          count(*) filter (where user_id is null)     as free
--     from public.player_registry;
--
-- Expect 15 claimed / 107 free, the same as before.
--
-- Then have somebody claim their real arcade handle in Account → What people call you, and:
--
--   select player_name, user_id is not null as claimed, claimed_at
--     from public.player_registry where lower(player_name::text) = lower('THEIR HANDLE');
--
-- Expect claimed true with a claimed_at just now. And their next Snake run should appear:
--
--   select player_name, score, submitted_at from public.score_history
--    order by submitted_at desc limit 5;
