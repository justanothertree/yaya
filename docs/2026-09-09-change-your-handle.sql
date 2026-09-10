-- 2026-09-09 — let somebody change their own handle
--
-- Run after 2026-09-09-tin-is-ramtin.sql, which is what made this possible: that migration
-- changed profiles_username_fkey to ON UPDATE CASCADE. Before it, renaming a handle was not
-- merely un-built, it was impossible — updating player_registry broke the reference from
-- profiles, and updating profiles first had nothing to point at.
--
--
-- WHY AN RPC AND NOT A POLICY
--
-- player_registry has RLS on and exactly ONE policy: select, using (true). There is no insert,
-- update or delete policy, so no client can write to that table at all — by design, because the
-- table is the identity map for every Snake score ever recorded. Adding an update policy would
-- be the wrong shape of fix: a rename is not "write this column", it is a small transaction that
-- has to touch three tables together and refuse several cases. That belongs in one SECURITY
-- DEFINER function on the server rather than in a policy plus client code that must remember to
-- do all of it.
--
--
-- ⚠️ THE DENORMALISED COPIES ARE THE PART THAT IS EASY TO MISS.
--
-- Only profiles.username is a foreign key to player_registry(player_name), and that one now
-- cascades on its own. But leaderboard and score_history each carry their OWN player_name text
-- column alongside player_id — so a rename that touched only the registry would leave the Snake
-- board and every score row still showing the old name, for good. Both are updated here, keyed
-- by player_id, which is the column their foreign keys actually use.
--
-- Checked before writing this: leaderboard and score_history reference player_registry(id), not
-- the name, so nothing here can break those references. One row already drifted this way
-- (player_id 5 reads "Jefe Legendary" on the board and "Player3" in the registry) — an unclaimed
-- row, pre-existing, and deliberately not touched by this migration.
--
--
-- ⚠️ NOTHING HERE TOUCHES LOGIN. Sign-in is auth.users. This is a display name.

create or replace function public.rename_my_handle(p_new text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_new text;
  v_old text;
  v_id  bigint;
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in.';
  end if;

  v_new := btrim(coalesce(p_new, ''));

  -- 2 to 16 matches the handles that already exist (measured: shortest 2, longest 16), so this
  -- cannot reject a name somebody is already using.
  if length(v_new) < 2 or length(v_new) > 16 then
    raise exception 'A handle is 2 to 16 characters.';
  end if;

  -- Letters, numbers, spaces, hyphen and underscore, and it has to START with a letter or
  -- number. Leading punctuation is what lets a name imitate a label ("- admin") or sort itself
  -- to the top of the board, and neither is worth allowing for the sake of it.
  if v_new !~ '^[A-Za-z0-9][A-Za-z0-9 _-]*$' then
    raise exception 'Use letters, numbers, spaces, - and _, starting with a letter or number.';
  end if;

  select id, player_name::text into v_id, v_old
    from public.player_registry
   where user_id = auth.uid();

  if v_id is null then
    raise exception 'You do not have a handle to change yet.';
  end if;

  -- ⚠️ player_name is citext, so this comparison — and the unique index — are already
  -- case-insensitive. Changing only the CASE of your own name is therefore allowed and skips
  -- the taken check, which would otherwise match your own row and refuse it.
  if lower(v_old) <> lower(v_new)
     and exists (select 1 from public.player_registry where player_name = v_new::citext) then
    raise exception 'That handle is taken.';
  end if;

  update public.player_registry set player_name = v_new::citext where id = v_id;

  -- the copies that no foreign key will fix for us (see the note above)
  update public.leaderboard   set player_name = v_new where player_id = v_id;
  update public.score_history set player_name = v_new where player_id = v_id;

  return v_new;
exception
  -- the unique index is the real arbiter; two people renaming to the same thing at the same
  -- instant get here rather than a raw constraint error with a column name in it
  when unique_violation then
    raise exception 'That handle is taken.';
end
$function$;

-- ⚠️ authenticated only, and never anon: the function trusts auth.uid() to decide whose row it
-- edits, so an anonymous caller has no business reaching it even though it would refuse them.
revoke all on function public.rename_my_handle(text) from public, anon;
grant execute on function public.rename_my_handle(text) to authenticated;


-- ── HOW TO CHECK IT WORKED ──────────────────────────────────────────────────────────────────
-- The function exists and only authenticated may call it:
--
--   select p.proname, p.prosecdef as security_definer,
--          array(select unnest(p.proacl)::text) as grants
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'rename_my_handle';
--
-- Expect: security_definer true, and an "authenticated=X/postgres" entry with no anon.
--
-- Then change your own handle in Account → Your info and confirm all three agree:
--
--   select r.player_name as registry, pf.username as profile,
--          (select count(*) from public.leaderboard   l where l.player_id = r.id
--             and l.player_name is distinct from r.player_name::text) as stale_board_rows,
--          (select count(*) from public.score_history h where h.player_id = r.id
--             and h.player_name is distinct from r.player_name::text) as stale_history_rows
--     from public.player_registry r
--     join public.profiles pf on pf.user_id = r.user_id
--    where r.user_id = auth.uid();
--
-- Expect: registry and profile identical, and both stale counts 0.
