-- READ-ONLY CHECKS for docs/2026-11-14-lab-matches.DRAFT.sql, to run against production.
--
-- Everything below runs inside a read-only transaction and ends with ROLLBACK, so even a mistake in
-- it cannot write. Run the whole file in the Supabase SQL editor, or with psql. Each block says
-- what it expects; if any answer differs, stop and do not apply the draft (block A), or roll it
-- back (block B).
--
-- THE FINGERPRINTS are md5 of each function's body as stored (`prosrc`). They were read on a
-- throwaway database — Supabase CLI 2.122.0, the stack db-guards.yml builds from the dump and
-- seed, plus supabase/migrations/20261109030613_lab_catalog_and_feedback.sql (the dump predates
-- the Lab catalog) — straight after applying the draft, and supabase/tests/lab-matches.sql passed
-- against that database. is_suspended and lab_demo_open are the two existing functions the
-- draft calls; their fingerprints are the dump's, so block A tells you whether production's are
-- the ones the draft was tested against.
--
--   is_suspended          83fa98307c05db59b0de942f2b19ed23   existing, relied on
--   lab_demo_open         e040dd067dc50d0abcfa00b4f77dbbd9   existing, relied on
--   lab_match_begin       0054a40b9168e220bbf00498f6f88381
--   lab_match_challenge   5093108bb2ea69824dbc79fbe783503d
--   lab_match_claim       bb9decd4b33a96600dba9c7bb55118de
--   lab_match_commit      258b884035c174b8e37afcdc6f77c9cd
--   lab_match_decline     62803e11d498b9b95b39665aa52e05b9
--   lab_match_get         af1cdf458d4a88ec09c3d20f9a3d6f58
--   lab_match_json        f7ca7a2fdab855f49e81d43593660694
--   lab_match_list        a14a904b3e9c1ed45573e742c8e94869
--   lab_match_load        1e06498f901c8aad487eb318b7b7ce73
--   lab_match_mine        cd509f59f2b2a00f177b52dceba55007
--   lab_match_playable    ac752f0a53e7d77b222f3e51c6d939f2
--   lab_match_record      08573def9e2b957cc358e6d7466aea86
--   lab_match_resign      5955ee32fbc0ec6bb6e36e5533dc111f
--   lab_match_suspended   ce1f64c8e4c36346205bdee2b3860a05
--   lab_match_timeout     c5f2c3f1ad917bb1ba78103721684c12
--   lab_my_turns          d187315904bc34ff095c54cd138111b1
--   lab_pair_friends      d361adadff621384cc8e21f67dec6f4c

begin transaction read only;

-- ── A. Before applying ──────────────────────────────────────────────────────────────────────
-- A1. Expect NO ROWS: nothing the draft creates exists yet.
select 'table' as kind, c.relname as name
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('lab_matches', 'lab_match_moves', 'lab_results')
union all
select 'function', p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proname like 'lab\_match%' or p.proname in ('lab_my_turns', 'lab_pair_friends'));

-- A2. Expect two rows, each with definitions = 1 and state 'as tested'.
select p.proname, count(*) over (partition by p.proname) as definitions, md5(p.prosrc) as body_md5,
       case p.proname || ':' || md5(p.prosrc)
         when 'is_suspended:83fa98307c05db59b0de942f2b19ed23' then 'as tested'
         when 'lab_demo_open:e040dd067dc50d0abcfa00b4f77dbbd9' then 'as tested'
         else 'CHANGED since the draft was tested: stop and ask'
       end as state
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('is_suspended', 'lab_demo_open')
 order by p.proname;

-- A3. Expect one row: true, true. The draft reads friendships' user_a/user_b/status and references
-- lab_demos(id); these are the column fingerprints of the dump it was tested on.
select md5(string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name))
         = '0defd0fb485661200997c451e4cdc37d' as friendships_as_tested,
       (select md5(string_agg(column_name || ':' || data_type, ',' order by column_name))
          from information_schema.columns where table_schema = 'public' and table_name = 'lab_demos')
         = '134cdc33839e63ed25e92d325621dcb4' as lab_demos_as_tested
  from information_schema.columns where table_schema = 'public' and table_name = 'friendships';

-- A4. Expect two rows, reversi and chess, both hidden = false. A match references the toy, so the
-- catalog must have them: if either is missing, register it from the admin page (admin_lab_register)
-- before applying, or the first challenge raises "no such experiment".
select id, hidden from public.lab_demos where id in ('reversi', 'chess') order by id;

-- ── B. After applying ───────────────────────────────────────────────────────────────────────
-- B1. Expect 17 rows, every one 'as drafted' with definitions = 1.
select p.proname, count(*) over (partition by p.proname) as definitions,
       case md5(p.prosrc)
         when case p.proname
                when 'lab_match_begin' then '0054a40b9168e220bbf00498f6f88381'
                when 'lab_match_challenge' then '5093108bb2ea69824dbc79fbe783503d'
                when 'lab_match_claim' then 'bb9decd4b33a96600dba9c7bb55118de'
                when 'lab_match_commit' then '258b884035c174b8e37afcdc6f77c9cd'
                when 'lab_match_decline' then '62803e11d498b9b95b39665aa52e05b9'
                when 'lab_match_get' then 'af1cdf458d4a88ec09c3d20f9a3d6f58'
                when 'lab_match_json' then 'f7ca7a2fdab855f49e81d43593660694'
                when 'lab_match_list' then 'a14a904b3e9c1ed45573e742c8e94869'
                when 'lab_match_load' then '1e06498f901c8aad487eb318b7b7ce73'
                when 'lab_match_mine' then 'cd509f59f2b2a00f177b52dceba55007'
                when 'lab_match_playable' then 'ac752f0a53e7d77b222f3e51c6d939f2'
                when 'lab_match_record' then '08573def9e2b957cc358e6d7466aea86'
                when 'lab_match_resign' then '5955ee32fbc0ec6bb6e36e5533dc111f'
                when 'lab_match_suspended' then 'ce1f64c8e4c36346205bdee2b3860a05'
                when 'lab_match_timeout' then 'c5f2c3f1ad917bb1ba78103721684c12'
                when 'lab_my_turns' then 'd187315904bc34ff095c54cd138111b1'
                when 'lab_pair_friends' then 'd361adadff621384cc8e21f67dec6f4c'
              end
         then 'as drafted' else 'DIFFERENT from the draft: roll back'
       end as state
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proname like 'lab\_match%' or p.proname in ('lab_my_turns', 'lab_pair_friends'))
 order by p.proname;

-- B2. Expect three rows, each rls = true and policies = 0, and table_privileges = 0: deny-all.
select c.relname, c.relrowsecurity as rls,
       (select count(*) from pg_policy pol where pol.polrelid = c.oid) as policies,
       (select count(*) from (values ('anon'), ('authenticated')) r(role)
          cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate'),
                             ('references'), ('trigger')) v(priv)
         where has_table_privilege(r.role, c.oid, v.priv)) as table_privileges
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('lab_matches', 'lab_match_moves', 'lab_results')
 order by c.relname;

-- B3. Expect exactly these seven rows, all with anon = false: what a member may call.
--   lab_match_challenge, lab_match_claim, lab_match_decline, lab_match_get, lab_match_list,
--   lab_match_resign, lab_my_turns
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proname like 'lab\_match%' or p.proname in ('lab_my_turns', 'lab_pair_friends'))
   and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))
 order by p.proname;

-- B4. Expect one row: true. The edge function's three can be called with the service key. (Before
-- applying, it reads false: to_regprocedure finds nothing, so this file runs whole either side.)
select coalesce(
         has_function_privilege('service_role', to_regprocedure('public.lab_match_load(uuid)'), 'execute')
         and has_function_privilege('service_role',
               to_regprocedure('public.lab_match_begin(uuid, uuid, jsonb, smallint, jsonb)'), 'execute')
         and has_function_privilege('service_role',
               to_regprocedure('public.lab_match_commit(uuid, integer, uuid, jsonb, jsonb, smallint, jsonb, jsonb)'),
               'execute'),
         false) as edge_function_can_write;

-- B5. Expect three rows, each with rows = 0: nothing has been played yet. (Before applying, rows is
-- null: a table is counted only where it exists, through query_to_xml, so the file runs whole.)
select t as table_name,
       case when to_regclass('public.' || t) is not null then
         (xpath('/row/c/text()',
                query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text::int
       end as rows
  from (values ('lab_matches'), ('lab_match_moves'), ('lab_results')) v(t);

rollback;
