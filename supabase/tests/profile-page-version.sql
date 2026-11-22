-- Does a profile save refuse to overwrite a page that changed since it was read, and does a save
-- that does not ask (every bundle before 22 Nov 2026) still work exactly as it did?
--
-- HOW TO RUN: db-guards.yml loads supabase/migrations/20261122215917_profile_page_version.sql
-- and then this file. Everything is in one transaction that rolls back. It raises,
-- listing every failed check, if anything is wrong, and says how many it asked otherwise.
--
-- Its race-condition half needs two real sessions and lives in profile-page-race.sh.
--
-- ⚠️ IT REFUSES TO RUN WITHOUT ITS CAST, because every check here is "this changed" or "this was
-- refused", and against a member who does not exist the first raises and the second never runs.
-- The cast is the seed's: seedowner and seedfriend, who are accepted friends (supabase/seed.sql).

begin;

create temp table fails(check_name text, detail text);
create temp table cast_(part text primary key, uid uuid, uname text);
insert into cast_ values
  ('owner', '00000000-0000-4000-a000-000000000001'),
  ('friend', '00000000-0000-4000-a000-000000000002');
/* the names, read here as postgres: a member cannot read profiles directly */
update cast_ c set uname = p.username::text from public.profiles p where p.user_id = c.uid;
/* what each step saw, for the steps after it */
create temp table seen(k text primary key, v text);
grant select on cast_ to authenticated, anon;
grant select, insert, update on seen to authenticated;
grant select, insert on fails to authenticated, anon;

do $$
begin
  if (select count(*) from public.profiles where user_id in (select uid from cast_)) <> 2 then
    raise exception 'fixture: the seed members seedowner and seedfriend are missing';
  end if;
  /* `friendships` read directly: `are_friends` is self-or-admin gated and answers nothing to a
     connection with no session, which is what this block runs as (certain-lists.sql learned it) */
  if not exists (
    select 1 from public.friendships f, cast_ o, cast_ fr
     where o.part = 'owner' and fr.part = 'friend' and f.status = 'accepted'
       and ((f.user_a = o.uid and f.user_b = fr.uid) or (f.user_a = fr.uid and f.user_b = o.uid))
  ) then
    raise exception 'fixture: seedowner and seedfriend are not friends, so no Certain list can hold a name';
  end if;
end $$;

-- ── A. the shape of the API: one save, and nobody can fingerprint somebody else's page ─────────
insert into fails
select 'save_my_profile_blocks has overloads', count(*)::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'save_my_profile_blocks'
having count(*) <> 1;

insert into fails
select 'the save does not take an expected page', pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'save_my_profile_blocks'
  and pg_get_function_identity_arguments(p.oid) <> 'p_blocks jsonb, p_expected_page text';

insert into fails
select 'a privilege is wrong', f || ' for ' || r || ': ' || coalesce(has::text, 'missing')
from (values
  ('public.save_my_profile_blocks(jsonb, text)', 'anon', false),
  ('public.save_my_profile_blocks(jsonb, text)', 'authenticated', true),
  ('public.my_profile_page_version()', 'anon', false),
  ('public.my_profile_page_version()', 'authenticated', true),
  ('public.profile_page_version(uuid)', 'anon', false),
  ('public.profile_page_version(uuid)', 'authenticated', false)
) want(f, r, ok)
cross join lateral (select has_function_privilege(r, f, 'execute') as has) h
where h.has is distinct from want.ok;

-- ── B. as the owner ─────────────────────────────────────────────────────────────────────────
-- ⚠️ A MEMBER HAS NO GRANT ON profile_blocks OR visibility_certain (deny-all, the house pattern), so
-- everything this block knows about the page it reads the way the member's own browser does:
-- through get_profile_blocks, which gives the owner every block and every Certain list.
select set_config('request.jwt.claims',
  json_build_object('sub', (select uid::text from cast_ where part = 'owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  v0 text; v1 text; v2 text; v3 text; vA text; vB text;
  two jsonb := '[{"block_type":"bio","size":"medium","config":{"text":"one"},"visibility":"members"},
                 {"block_type":"status","size":"small","config":{"text":"two"},"visibility":"friends"}]';
  other jsonb := '[{"block_type":"bio","size":"large","config":{"text":"elsewhere"},"visibility":"members"}]';
  ours jsonb := '[{"block_type":"bio","size":"medium","config":{"text":"ours"},"visibility":"members"}]';
  n int; st text; msg text;
  me text := (select uname from cast_ where part = 'owner');
begin
  v0 := public.my_profile_page_version();
  if v0 !~ '^[0-9a-f]{32}$' then
    insert into fails values ('the version is not an md5', coalesce(v0, 'null'));
  end if;

  /* an old bundle: p_blocks alone, by name, as PostgREST calls it */
  perform public.save_my_profile_blocks(p_blocks => two);
  v1 := public.my_profile_page_version();
  if v1 = v0 then
    insert into fails values ('a save that changed the page left its version', v1);
  end if;
  if jsonb_array_length(public.get_profile_blocks(me)) <> 2 then
    insert into fails values ('an old-style save did not store the page it was sent', '');
  end if;

  /* the same page again: every id and created_at changes, the version must not */
  perform public.save_my_profile_blocks(p_blocks => two, p_expected_page => null);
  if public.my_profile_page_version() is distinct from v1 then
    insert into fails values ('a save that changed nothing changed the version', 'ids or times are in it');
  end if;

  /* a save over the page it read */
  perform public.save_my_profile_blocks(p_blocks => ours, p_expected_page => v1);
  v2 := public.my_profile_page_version();
  if public.get_profile_blocks(me)->0->'config'->>'text' is distinct from 'ours' then
    insert into fails values ('a save with the right version did not land', '');
  end if;

  /* ⚠️ THE CASE THIS IS FOR: a save carrying the version from BEFORE the last change */
  begin
    perform public.save_my_profile_blocks(p_blocks => other, p_expected_page => v1);
    insert into fails values ('a save over a page that changed since it was read went through', '');
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
    if st <> 'PT409' or msg <> 'page changed' then
      insert into fails values ('a stale save was refused, but not as page changed', st || ' ' || msg);
    end if;
  end;
  if public.my_profile_page_version() is distinct from v2
     or public.get_profile_blocks(me)->0->'config'->>'text' is distinct from 'ours'
     or jsonb_array_length(public.get_profile_blocks(me)) <> 1 then
    insert into fails values ('a refused save changed the page', '');
  end if;

  /* ANOTHER WRITER: the chronicle switch writes this table without going through the save */
  perform public.chronicle_share_timeline(true);
  v3 := public.my_profile_page_version();
  if v3 = v2 then
    insert into fails values ('the chronicle switch changed the page and not its version', '');
  end if;
  begin
    perform public.save_my_profile_blocks(p_blocks => ours, p_expected_page => v2);
    insert into fails values ('a save read before the chronicle switch deleted its card', '');
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    if st <> 'PT409' then insert into fails values ('the switch case refused with', st); end if;
  end;
  if not exists (select 1 from jsonb_array_elements(public.get_profile_blocks(me)) e
                  where e->>'block_type' = 'chronicle') then
    insert into fails values ('the chronicle card is gone after a refused save', '');
  end if;

  /* A CERTAIN LIST is part of the page: the same block with and without a name differs */
  perform public.save_my_profile_blocks(p_blocks =>
    '[{"block_type":"bio","size":"medium","config":{},"visibility":"certain","certain":["seedfriend"]}]');
  vA := public.my_profile_page_version();
  n := jsonb_array_length(coalesce(public.get_profile_blocks(me)->0->'certain', '[]'::jsonb));
  if n <> 1 then
    insert into fails values ('fixture: the Certain list did not hold the friend', n::text);
  end if;
  perform public.save_my_profile_blocks(p_blocks =>
    '[{"block_type":"bio","size":"medium","config":{},"visibility":"certain","certain":[]}]');
  vB := public.my_profile_page_version();
  if vA = vB then
    insert into fails values ('a Certain list is not part of the version', '');
  end if;
  insert into seen values ('vA', vA), ('vB', vB);
end $$;

-- ── C. a change no function made: a list entry going by cascade, as when a friend's account goes
reset role;
do $$
declare v_owner uuid := (select uid from cast_ where part = 'owner');
begin
  /* put the name back as postgres, the way a migration or a cascade writes: no function at all */
  insert into public.visibility_certain (owner, item_kind, item_id, friend)
  select v_owner, 'profile_block', b.id::text, (select uid from cast_ where part = 'friend')
    from public.profile_blocks b where b.user_id = v_owner;
  if public.profile_page_version(v_owner) is distinct from (select v from seen where k = 'vA') then
    insert into fails values ('the same stored page did not give the same version', 'after a list was restored by hand');
  end if;
  delete from public.visibility_certain where owner = v_owner and item_kind = 'profile_block';
  if public.profile_page_version(v_owner) is distinct from (select v from seen where k = 'vB') then
    insert into fails values ('a list entry deleted outside any function did not change the version', '');
  end if;
end $$;

-- ── D. somebody else: their own version, and no door to the owner's ────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', (select uid::text from cast_ where part = 'friend'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if public.my_profile_page_version() = (select v from seen where k = 'vB') then
    insert into fails values ('a member was told the owner''s version', '');
  end if;
  begin
    perform public.profile_page_version((select uid from cast_ where part = 'owner'));
    insert into fails values ('a member can fingerprint somebody else''s page', '');
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── E. nobody: no session, no version ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{}', true);
set local role anon;
do $$
begin
  perform public.my_profile_page_version();
  insert into fails values ('anon was given a page version', '');
exception when others then null;
end $$;
reset role;

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
do $$
declare n int; msg text;
begin
  select count(*), string_agg('  - ' || check_name || ': ' || detail, E'\n') into n, msg from fails;
  if n > 0 then
    raise exception E'PROFILE PAGE VERSION FAILED -- % check(s):\n%', n, msg;
  end if;
end $$;

select 'profile page version holds' as result, count(*) as failures from fails;

rollback;
