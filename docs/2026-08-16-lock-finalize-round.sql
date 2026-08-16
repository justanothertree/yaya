-- Lock finalize_round_rpc to the relay
-- =====================================
-- WHY: the function writes `leaderboard`, `score_history`, `trophies` AND `player_registry`,
-- and it was executable by `anon`. The anon key ships in the browser, so anyone could invent a
-- room_id/round_id pair (the only idempotency check) and post arbitrary names and scores. That
-- means forged leaderboard entries and trophies, and — because player_registry RESERVES NAMES —
-- squatting nicknames that belong to real people.
--
-- The relay is the only legitimate caller, and as of the matching commit it calls this with the
-- SERVICE ROLE key. Service role bypasses these grants, so removing them costs the relay
-- nothing and closes the hole for everyone else.
--
-- PRECONDITION — CHECK BEFORE RUNNING:
--   SUPABASE_SERVICE_ROLE_KEY must be set on the Render relay, and that build deployed.
--   Without it the relay falls back to the anon key (and logs a warning), and this revoke
--   would make multiplayer round finalization fail silently for players.
--
-- A GRANT IS NOT A REVOKE: functions are EXECUTE-able by PUBLIC by default, so revoking from
-- anon/authenticated alone would leave PUBLIC in place and change nothing.

begin;

revoke all on function public.finalize_round_rpc(text, text, text, jsonb, jsonb)
  from public, anon, authenticated;

-- explicit rather than implied, so the intent survives a future default-privileges change
grant execute on function public.finalize_round_rpc(text, text, text, jsonb, jsonb)
  to service_role;

commit;

-- Verify: expect service_role only.
--   select r.rolname, has_function_privilege(r.rolname,
--            'public.finalize_round_rpc(text,text,text,jsonb,jsonb)', 'EXECUTE') as can_execute
--   from pg_roles r where r.rolname in ('anon','authenticated','service_role');

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Restores the previous (open) state if round finalization breaks:
--
-- begin;
-- grant execute on function public.finalize_round_rpc(text, text, text, jsonb, jsonb)
--   to anon, authenticated;
-- commit;
