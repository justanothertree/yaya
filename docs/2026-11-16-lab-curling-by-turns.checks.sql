-- READ-ONLY CHECKS for docs/applied/2026-11-16-lab-curling-by-turns.DRAFT.sql, to run against production. Each statement only reads;
-- run block A before applying and block B after. If any answer differs, stop.
--
-- lab_match_playable's body (`prosrc`) by md5, measured on 16 Nov 2026 by applying each draft and
-- its rollback to a database built from every migration:
--
--   reversi, chess                         ac752f0a53e7d77b222f3e51c6d939f2   <- 20261115002456
--   reversi, chess, pool                   e33c8ae8a13bba967cd38113452ad444   <- Pool by turns
--   reversi, chess, pool, gomoku           0ed51b64f0b7dbd20021d01ae1467050   <- Five in a row
--   … and draughts                         7859d76c7370d9ef0743e377578aa2be   <- Draughts
--   … and dots                             2c255a28a7dfc8ad3b31a26ff9c5e18b   <- Dots and boxes
--   … and fourrow                          9daa1f0e0e5603b8ba2f1a92be94b2cc   <- Four in a row
--   … and mancala                          720a81330b34079bafa38d44553b9f56   <- Mancala
--   … and morris                           355217b73869d815bea4e77f4e3a581b   <- Nine men's morris
--   … and hex                              10e1a3d44fccac252f20f492928cd537   <- Hex
--   … and ultimate                         b6ba192db0f90965ae218086db960693   <- Ultimate noughts
--   … and breakthrough                     3566c6186024dd27fe82a947ee29e6d8   <- Breakthrough
--   … and fences                           b3d133ae75417732534a64deb0988d11   <- Fences
--   … and halma                            2efad6dd0ac3ecb7a4166bcdb11f89d6   <- Chinese checkers
--   … and go                               ecc3f356e7a74a851a7e0516bf565028   <- Go
--   … and fox                              7c2ba9536c201ff1aed9997e6bc35cc4   <- Fox and geese
--   … and cube                             42898e1e35a1e8fed935402f2ddd3966   <- Noughts and crosses in a cube
--   … and artillery                        b28cca34d03b7ac6d7913c27c744c4d8   <- Artillery
--   … and bowling                          bf7682b1ecbabdacbb3f3982775a8491   <- Bowling
--   … and curling                          dd14c8f4dfbf3e41b1bc8332e83b08ff   <- Curling

-- ── A. Before: one definition, holding the list this draft expects ('reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex, ultimate, breakthrough, fences, halma, go, fox, cube, artillery, bowling') ──
-- ── B. After: the same query, now holding '… bowling, curling'; and nobody but the definer can call it ──
select p.proname,
       count(*) over () as definitions,
       md5(p.prosrc) as body_md5,
       case md5(p.prosrc)
         when 'ac752f0a53e7d77b222f3e51c6d939f2' then 'reversi, chess'
         when 'e33c8ae8a13bba967cd38113452ad444' then 'reversi, chess, pool'
         when '0ed51b64f0b7dbd20021d01ae1467050' then 'reversi, chess, pool, gomoku'
         when '7859d76c7370d9ef0743e377578aa2be' then 'reversi, chess, pool, gomoku, draughts'
         when '2c255a28a7dfc8ad3b31a26ff9c5e18b' then 'reversi, chess, pool, gomoku, draughts, dots'
         when '9daa1f0e0e5603b8ba2f1a92be94b2cc' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow'
         when '720a81330b34079bafa38d44553b9f56' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala'
         when '355217b73869d815bea4e77f4e3a581b' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris'
         when '10e1a3d44fccac252f20f492928cd537' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex'
         when 'b6ba192db0f90965ae218086db960693' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex, ultimate'
         when '3566c6186024dd27fe82a947ee29e6d8' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex, ultimate, breakthrough'
         when 'b3d133ae75417732534a64deb0988d11' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex, ultimate, breakthrough, fences'
         when '2efad6dd0ac3ecb7a4166bcdb11f89d6' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex, ultimate, breakthrough, fences, halma'
         when 'ecc3f356e7a74a851a7e0516bf565028' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex, ultimate, breakthrough, fences, halma, go'
         when '7c2ba9536c201ff1aed9997e6bc35cc4' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex, ultimate, breakthrough, fences, halma, go, fox'
         when '42898e1e35a1e8fed935402f2ddd3966' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex, ultimate, breakthrough, fences, halma, go, fox, cube'
         when 'b28cca34d03b7ac6d7913c27c744c4d8' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex, ultimate, breakthrough, fences, halma, go, fox, cube, artillery'
         when 'bf7682b1ecbabdacbb3f3982775a8491' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex, ultimate, breakthrough, fences, halma, go, fox, cube, artillery, bowling'
         when 'dd14c8f4dfbf3e41b1bc8332e83b08ff' then 'reversi, chess, pool, gomoku, draughts, dots, fourrow, mancala, morris, hex, ultimate, breakthrough, fences, halma, go, fox, cube, artillery, bowling, curling'
         else 'UNEXPECTED: stop'
       end as playable,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'lab_match_playable';
-- Expect, both times: definitions = 1, anon_can_execute = false, authenticated_can_execute = false.
