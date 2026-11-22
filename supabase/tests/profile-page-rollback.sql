-- Does docs/2026-11-22-profile-page-version.ROLLBACK.sql put the save back exactly as it was?
--
-- HOW TO RUN: db-guards.yml loads the draft, runs its tests, then loads the rollback and this file.
-- A rollback nobody has run is a hope, and this one is the plan for the day the draft goes wrong in
-- production — so it is run here, on every push, against the draft it undoes. It raises on the
-- first thing that is not as it was.

do $$
declare n int; src text; acl text;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'save_my_profile_blocks';
  if n <> 1 then raise exception 'rollback: % save_my_profile_blocks functions, not 1', n; end if;

  select md5(p.prosrc) into src from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'save_my_profile_blocks'
     and pg_get_function_identity_arguments(p.oid) = 'p_blocks jsonb';
  /* the live body before the draft, md5(prosrc) read from production on 22 Nov 2026 */
  if src is distinct from '0603655260224be367a971ecc3b88a9f' then
    raise exception 'rollback: the one-argument save is not the original body (md5 %)', coalesce(src, 'missing');
  end if;

  if has_function_privilege('anon', 'public.save_my_profile_blocks(jsonb)', 'execute') then
    raise exception 'rollback: anon can execute the save';
  end if;
  if not has_function_privilege('authenticated', 'public.save_my_profile_blocks(jsonb)', 'execute') then
    raise exception 'rollback: members cannot execute the save';
  end if;
  if to_regprocedure('public.my_profile_page_version()') is not null
     or to_regprocedure('public.profile_page_version(uuid)') is not null then
    raise exception 'rollback: a version function is still there';
  end if;
  raise notice 'the rollback puts the save back as it was';
end $$;
