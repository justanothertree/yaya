-- Read-only checks for docs/2026-11-22-circuit-claims-need-approval.DRAFT.sql. Nothing here writes.
-- The plan is docs/2026-11-22-circuit-claims-plan.md.

-- ── CHECK A, before applying: production is the text the draft was written against ───────────
-- Expect: claim_person 9dcb6353aa8b46a142837b01619b5d40, add_self_to_circuit
-- bf6833376662902ffadb2ef66aa9f0fa, _circuit_add_self 380d9993d2019c5113f4543aad254eaf,
-- table_absent true, trigger_absent true. If any differs, stop: the draft refuses anyway, and it
-- has to be rewritten against what production holds.
-- `owners` is a fingerprint of who owns every board; write it down, Check B compares it.
select md5(pg_get_functiondef('public.claim_person(text)'::regprocedure)) as claim_person,
       md5(pg_get_functiondef('public.add_self_to_circuit(uuid, text, text)'::regprocedure)) as add_self_to_circuit,
       md5(pg_get_functiondef('public._circuit_add_self(uuid)'::regprocedure)) as _circuit_add_self,
       to_regclass('public.circuit_person_claims') is null as table_absent,
       not exists (select 1 from pg_trigger where tgname = 'circuit_people_owner_guard') as trigger_absent,
       (select count(*) from public.circuit_people where owner_user_id is not null) as owned_boards,
       (select md5(string_agg(id || ':' || coalesce(owner_user_id::text, '-'), ',' order by id))
          from public.circuit_people) as owners;

-- ── CHECK B, after applying ─────────────────────────────────────────────────────────────────
-- Expect each md5 as below (what CI's database gave, db guards run 45079301551); `owners` and
-- `owned_boards` exactly as Check A read them, because applying moves no board; the table
-- deny-all and empty; anon holding nothing; a member holding exactly the four functions marked.
select p.proname, md5(pg_get_functiondef(p.oid)) as md5,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as member
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('claim_person', 'add_self_to_circuit', '_circuit_add_self',
                     '_circuit_ask_for_person', 'circuit_person_owner_guard', 'my_person_claims',
                     'withdraw_person_claim', 'admin_list_person_claims', 'admin_decide_person_claim')
 order by p.proname;
--   _circuit_add_self          a933d5697f66f65738e1631c044d3d65   anon f  member f
--   _circuit_ask_for_person    124d10f8bd3bc07f32da85ad54a8d2c6   anon f  member f
--   add_self_to_circuit        644506b6055b1427c211d3cc68ec8169   anon f  member t
--   admin_decide_person_claim  e96a7d3dece8640654a9dce4cffdcc0d   anon f  member t
--   admin_list_person_claims   ea42d6dd68f476ba74b7049cd226e74a   anon f  member t
--   circuit_person_owner_guard 4e6c4e1c942b5f0db6daaf6b840b0503   anon f  member f
--   claim_person               74f7136e7f00bc8f0e23bbb782191c20   anon f  member t
--   my_person_claims           459eaa4dde5eba24150c550d0d776371   anon f  member t
--   withdraw_person_claim      0cf6402f03abe75d84fc9c6e52516b99   anon f  member t

select (select count(*) from public.circuit_people where owner_user_id is not null) as owned_boards,
       (select md5(string_agg(id || ':' || coalesce(owner_user_id::text, '-'), ',' order by id))
          from public.circuit_people) as owners,
       (select count(*) from public.circuit_person_claims) as requests,
       (select relrowsecurity from pg_class where oid = 'public.circuit_person_claims'::regclass) as rls_on,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'circuit_person_claims') as policies,
       (select string_agg(r || ':' || pr, ',')
          from unnest(array['anon', 'authenticated']) r,
               unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr
         where has_table_privilege(r, 'public.circuit_person_claims', pr)) as stray_grants;
-- Expect: owned_boards and owners as in Check A, requests 0, rls_on true, policies 0,
-- stray_grants null.
