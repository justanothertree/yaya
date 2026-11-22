-- READ-ONLY CHECKS for docs/applied/2026-11-16-lab-gomoku-by-turns.DRAFT.sql, to run against production. Each statement only reads;
-- run block A before applying and block B after. If any answer differs, stop.
--
-- lab_match_playable's body (`prosrc`) by md5, measured on 16 Nov 2026 by applying each draft and
-- its rollback to a database built from every migration:
--
--   reversi, chess                         ac752f0a53e7d77b222f3e51c6d939f2   <- 20261115002456
--   reversi, chess, pool                   e33c8ae8a13bba967cd38113452ad444   <- Pool by turns
--   reversi, chess, pool, gomoku           0ed51b64f0b7dbd20021d01ae1467050   <- Five in a row

-- ── A. Before: one definition, holding the list this draft expects ('reversi, chess, pool') ──
-- ── B. After: the same query, now holding 'reversi, chess, pool, gomoku'; and nobody but the definer can call it ──
select p.proname,
       count(*) over () as definitions,
       md5(p.prosrc) as body_md5,
       case md5(p.prosrc)
         when 'ac752f0a53e7d77b222f3e51c6d939f2' then 'reversi, chess'
         when 'e33c8ae8a13bba967cd38113452ad444' then 'reversi, chess, pool'
         when '0ed51b64f0b7dbd20021d01ae1467050' then 'reversi, chess, pool, gomoku'
         else 'UNEXPECTED: stop'
       end as playable,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'lab_match_playable';
-- Expect, both times: definitions = 1, anon_can_execute = false, authenticated_can_execute = false.
