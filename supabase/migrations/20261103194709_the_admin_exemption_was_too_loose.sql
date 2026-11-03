-- ✅ APPLIED 3 Nov 2026 as `the_admin_exemption_was_too_loose`.
--
-- ⚠️ "MENTIONS is_admin()" IS NOT "IS ADMIN-GATED". Yesterday's rule-based sweep
-- exempted any body containing the word, on the reasoning that such a function has its own
-- door. `rename_circuit` reads `if not (is_admin() or <the circuit's owner>)` -- it mentions
-- the function and is gated by neither, so the exemption skipped a writer a non-admin can
-- reach, and a suspended circuit owner could rename a circuit everybody in it sees.
--
-- ⚠️ THE BODY BELOW SAYS "an ordinary member of the group" AND THAT IS WRONG. The
-- exists clause requires `gm.role = 'owner'`; an ordinary member is refused with "only the
-- circuit owner can rename it", measured. The next migration carries the correction, and the
-- body is left as applied rather than rewritten, because this file records what RAN. The
-- finding and the fix are unchanged -- the point was that a NON-ADMIN could reach it, not how
-- many people could.
--
-- Six functions mentioned `is_admin()`. Four genuinely OPEN with a refusal for non-admins and
-- stay exempt: create_invite, renew_invite, save_site_content, and upsert_prices, which reads
-- `if not (is_admin() or <a service role>) then raise`. The standing check (block K) now tests
-- for that OPENING rather than for the presence of the word. `insert_allocation` is admin-only
-- as well but checks authentication first, so the strict rule cannot see its gate -- guarded
-- here instead, which costs its real callers nothing and keeps the rule free of names.
--
-- Two more things in the same migration:
--
-- ⚠️ `link_snake_names_to_accounts` IS REVOKED FROM MEMBERS, and the harm it closes
-- is in the future. It links every unlinked `player_registry` row to the account whose username
-- matches exactly. The leaderboard is open, so anybody signed out can post under a handle
-- nobody has claimed -- including a username a real person has not signed up with yet. The day
-- they join, this would hand them the stranger's row and its scores: fabricated history landing
-- on a real profile and in the feed. 0 rows are linkable today, so this closes the door before
-- anybody walks through it. Revoked rather than narrowed, because a function nobody calls needs
-- no interface.
--
-- And the four pooled watchlist rows give back the group the old trigger stamped on them. Inert
-- while the pool branch is tested first; a row that ever lost its pool would have fallen into a
-- circuit nobody chose.
--
-- Measured after:
--   a group member renames a circuit     refused -- "only the circuit owner can rename it"
--   that owner, suspended                refused -- "your account is suspended"
--   the circuit name afterwards          unchanged
--   a member calls the snake linker      refused -- permission denied
--   pooled rows still carrying a group   0

do $mig$
declare
  r record;
  v_src text;
  v_out text;
  v_pat constant text := $re$(is null then\s*raise exception '[^']*';\s*end if;)$re$;
  v_add constant text := $g$\1
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;$g$;
  v_done int := 0;
begin
  /* ⚠️ "MENTIONS is_admin()" IS NOT "IS ADMIN-GATED", and the difference let a suspended member
     rename a shared circuit. Yesterday's sweep exempted any body containing `is_admin()`, on the
     reasoning that such a function has its own door. `rename_circuit` says

         if not (public.is_admin() or exists (select 1 from circuit_group_members ...))

     -- admin OR an ordinary member of the group. It mentions the function and is not gated by
     it, so the exemption skipped a writer any group member can call, and a suspended one could
     rename a circuit everybody in it sees.

     Six functions mentioned `is_admin()` and were skipped. Four genuinely OPEN with a refusal
     for non-admins and stay exempt -- create_invite, renew_invite, save_site_content and
     upsert_prices, the last of which reads `if not (is_admin() or <service role>) then raise`.
     The standing check tests for that opening rather than for the mere presence of the word.

     `insert_allocation` is admin-only too, but checks authentication first, so its admin
     refusal is the SECOND statement and the strict rule does not see it. Guarding it costs its
     real callers nothing -- an admin is not suspended -- and keeps the rule free of names. */
  for r in
    select unnest(array['rename_circuit', 'insert_allocation']) as fn
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;
    if v_src is null then raise exception 'function % not found', r.fn; end if;
    if v_src ~* 'is_suspended' then raise exception '% already guarded', r.fn; end if;

    v_out := regexp_replace(v_src, v_pat, v_add);
    if v_out = v_src then raise exception 'the auth guard was not found in %', r.fn; end if;
    if (select count(*) from regexp_matches(v_out, 'is_suspended', 'g')) <> 1 then
      raise exception 'expected exactly one guard in %', r.fn;
    end if;
    execute v_out;
    v_done := v_done + 1;
  end loop;
  if v_done <> 2 then raise exception 'expected 2 functions, guarded %', v_done; end if;
end
$mig$;

/* ⚠️ `link_snake_names_to_accounts` IS NOT A MEMBER'S FUNCTION, AND THE HARM IS IN THE FUTURE.
   It links every unlinked `player_registry` row to the account whose username matches it
   exactly. The leaderboard is open: anybody signed out can post a score under any handle,
   including one nobody has claimed yet. So a stranger can pre-post under a username a real
   person has not signed up with, and the moment that person joins, this function hands them the
   stranger's registry row and its scores -- fabricated history arriving on a real profile and
   in the feed, attributed to them.

   Nothing in the client calls it. It is maintenance and belongs to the service role and the
   admin tooling. Revoked rather than narrowed to the caller's own username, because a function
   nobody calls needs no interface -- and leaving a narrowed one is an entry somebody has to
   reason about at every review, which CLAUDE.md §3 says not to leave lying around.

   Measured today: 0 registry rows are linkable, so this closes a door before anybody walks
   through it rather than after. */
revoke execute on function public.link_snake_names_to_accounts() from public, anon, authenticated;

/* ⚠️ AND THE FOUR POOLED WATCHLIST ROWS GIVE BACK THE GROUP THEY WERE NEVER PUT IN. The
   default-group trigger stamped one on each of them on the way in. The policies test `pool_id`
   first so it has never mattered -- but a row that ever lost its pool would fall into a circuit
   nobody chose for it, and the stamp is prevented at the source now, so the four left behind
   are simply stale. */
update public.circuit_watchlist set group_id = null where pool_id is not null and group_id is not null;
