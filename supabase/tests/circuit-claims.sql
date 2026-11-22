-- A Circuit person changes hands only when an admin approves a claim (OPEN-DECISIONS §19e), asked
-- of the real functions as three seeded members: the admin, and two others.
--
-- ⛔ NEEDS docs/applied/2026-11-22-circuit-claims-need-approval.DRAFT.sql APPLIED FIRST, and refuses to run
-- otherwise. It runs only where a throwaway database has been built from the baseline and seed
-- (the `db guards` CI job), and it rolls back. NEVER against production: it writes rows.
--
-- WHAT IT ASKS:
--   B  each of the four doors, as a member: This is me, Add me with a typed name, joining with a
--      code, and an owner's own UPDATE. None of them puts an account on a board, and the asker
--      cannot write a log for the person they asked for. B ends in a report of its own, so run
--      against the functions as they were it names each door that still opens, rather than only
--      erroring on the table that does not exist yet.
--   C  the requests those doors wrote: one each, and asking twice is still one
--   D  the privileges: nothing for anon, the internal pieces for nobody, the table deny-all
--   E  a member sees their own requests only, cannot withdraw anybody else's, and cannot use the
--      admin's two functions
--   G  the admin: the list says who, how and how much; approving sets the owner and declines the
--      rest; an answered request stays answered; a refused or withdrawn one is passed over by
--      Add me; a person who already has an owner, or a suspended asker, is refused
--   H  every board that existed before the test has the owner it started with
-- On failure it raises, naming every check that failed. A green run prints one row.

begin;

create temp table fails(check_name text, detail text);
create temp table ids(k text primary key, v text);
create temp table who(k text primary key, uid uuid, claims text);
grant select, insert on fails to authenticated, anon;
grant select on ids, who to authenticated, anon;

insert into who (k, uid)
select 'admin', (select a.user_id from public.admin_users a
                  join public.profiles p on p.user_id = a.user_id
                 where coalesce(p.suspended, false) = false
                 order by p.username limit 1);
insert into who (k, uid)
select k, uid from (
  select case row_number() over (order by p.username) when 1 then 'friend' else 'stranger' end, p.user_id
    from public.profiles p
   where coalesce(p.suspended, false) = false
     and p.user_id not in (select user_id from public.admin_users)
   order by p.username
   limit 2) as x(k, uid);
update who set claims = json_build_object('sub', uid::text, 'role', 'authenticated')::text;

\set be_admin 'reset role; select set_config(''request.jwt.claims'', (select claims from who where k = ''admin''), true) is not null as as_admin; set local role authenticated;'
\set be_friend 'reset role; select set_config(''request.jwt.claims'', (select claims from who where k = ''friend''), true) is not null as as_friend; set local role authenticated;'
\set be_stranger 'reset role; select set_config(''request.jwt.claims'', (select claims from who where k = ''stranger''), true) is not null as as_stranger; set local role authenticated;'

-- ── 0. THE DRAFT MUST BE APPLIED, OR EVERY CHECK BELOW IS ABOUT THE OLD TEXT ─────────────────
do $$
begin
  if to_regclass('public.circuit_person_claims') is null then
    raise exception 'apply docs/applied/2026-11-22-circuit-claims-need-approval.DRAFT.sql before this file';
  end if;
end $$;

insert into fails select 'FIXTURE: need an admin and two other members', 'seed the database first'
where (select count(*) from who where uid is not null) <> 3;

-- ── fixtures, as the database owner ────────────────────────────────────────────────────────────
-- G1 is the seed circuit, with both members added. G2 has a join code and nobody but the admin,
-- and holds an unclaimed person with the stranger's first name. G3 is a circuit the stranger is
-- not in. Every person made here is unclaimed, like a caretaken board.
create temp table before_owners as select id, owner_user_id from public.circuit_people;

insert into ids values
  ('g1', (select id::text from public.circuit_groups order by created_at, id limit 1)),
  ('g2', gen_random_uuid()::text),
  ('g3', gen_random_uuid()::text),
  ('linda', 'claim-test-linda'),
  ('gran', 'claim-test-gran'),
  ('typed', 'claim-test-typed'),
  ('join', 'claim-test-join'),
  ('far', 'claim-test-far'),
  ('g2code', 'claimtestg2code');
insert into ids
select 'own', coalesce((select cp.id from public.circuit_people cp
                          where cp.owner_user_id = (select uid from who where k = 'friend')
                          order by cp.id limit 1), 'claim-test-friend-own');
insert into public.circuit_people (id, name, owner_user_id)
select 'claim-test-friend-own', 'Friend own board', (select uid from who where k = 'friend')
where (select v from ids where k = 'own') = 'claim-test-friend-own';

insert into public.circuit_groups (id, name, created_by, join_code) values
  ((select v from ids where k = 'g2')::uuid, 'Claim test two', (select uid from who where k = 'admin'),
   (select v from ids where k = 'g2code')),
  ((select v from ids where k = 'g3')::uuid, 'Claim test three', (select uid from who where k = 'admin'), null);
insert into public.circuit_group_members (group_id, user_id) values
  ((select v from ids where k = 'g1')::uuid, (select uid from who where k = 'admin')),
  ((select v from ids where k = 'g1')::uuid, (select uid from who where k = 'friend')),
  ((select v from ids where k = 'g1')::uuid, (select uid from who where k = 'stranger')),
  ((select v from ids where k = 'g2')::uuid, (select uid from who where k = 'admin')),
  ((select v from ids where k = 'g3')::uuid, (select uid from who where k = 'admin'))
on conflict do nothing;

insert into public.circuit_people (id, name, owner_user_id) values
  ('claim-test-linda', 'Linda', null),
  ('claim-test-gran', 'Gran', null),
  ('claim-test-typed', 'Typed Name', null),
  ('claim-test-join', (select coalesce(nullif(btrim(p.first_name), ''), p.username::text)
                         from public.profiles p where p.user_id = (select uid from who where k = 'stranger')), null),
  ('claim-test-far', 'Far Away', null);
insert into public.circuit_person_groups (person_id, group_id) values
  ('claim-test-linda', (select v from ids where k = 'g1')::uuid),
  ('claim-test-gran', (select v from ids where k = 'g1')::uuid),
  ('claim-test-typed', (select v from ids where k = 'g1')::uuid),
  ('claim-test-join', (select v from ids where k = 'g2')::uuid),
  ('claim-test-far', (select v from ids where k = 'g3')::uuid),
  ((select v from ids where k = 'own'), (select v from ids where k = 'g1')::uuid)
on conflict do nothing;
insert into public.circuit_logs (id, person_id, date, entries) values
  ('claim-test-log-1', 'claim-test-linda', date '2026-11-01', '[]'),
  ('claim-test-log-2', 'claim-test-linda', date '2026-11-02', '[]');

-- ── B. the four doors, as members ──────────────────────────────────────────────────────────────
:be_friend
do $$
declare got text;
begin
  begin
    perform public.claim_person((select v from ids where k = 'linda'));
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got <> 'ok' then insert into fails values ('B1 This is me was refused', got); end if;
  /* the asker writing a day for the person they asked for: refused, because they are not its owner */
  begin
    insert into public.circuit_logs (id, person_id, date, entries)
    values ('claim-test-log-3', (select v from ids where k = 'linda'), date '2026-11-03', '[]');
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got = 'ok' then insert into fails values ('B1 the asker wrote a log for the person they asked for', ''); end if;
end $$;
reset role;
insert into fails select 'B1 This is me put the asker on the board', 'owner is set'
where (select owner_user_id from public.circuit_people where id = 'claim-test-linda') is not null;

:be_stranger
do $$
declare got text;
begin
  begin
    perform * from public.join_circuit((select v from ids where k = 'g2code'));
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got <> 'ok' then insert into fails values ('B2 joining with a code was refused', got); end if;
end $$;
reset role;
insert into fails select 'B2 joining with a matching first name put the joiner on the board', 'owner is set'
where (select owner_user_id from public.circuit_people where id = 'claim-test-join') is not null;
insert into fails select 'B2 joining made a blank board beside the one it matched', count(*)::text
  from public.circuit_people where owner_user_id = (select uid from who where k = 'stranger')
having count(*) > 0;

:be_stranger
do $$
declare got text;
begin
  begin
    got := public.add_self_to_circuit((select v from ids where k = 'g1')::uuid, '  typed NAME ', '#22c55e');
  exception when others then got := 'error: ' || sqlerrm;
  end;
  if got is distinct from (select v from ids where k = 'typed') then
    insert into fails values ('B3 Add me with a matching name did not answer with that person', coalesce(got, 'null'));
  end if;
end $$;
reset role;
insert into fails select 'B3 Add me with a typed name put the account on the board', 'owner is set'
where (select owner_user_id from public.circuit_people where id = 'claim-test-typed') is not null;
insert into fails select 'B3 Add me made a blank board beside the one it matched', count(*)::text
  from public.circuit_people where owner_user_id = (select uid from who where k = 'stranger')
having count(*) > 0;

:be_friend
do $$
declare got text;
begin
  begin
    update public.circuit_people set owner_user_id = (select uid from who where k = 'stranger')
     where id = (select v from ids where k = 'own');
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'a board changes hands only when an admin approves a claim' then
    insert into fails values ('B4 an owner handed their board to another account', got);
  end if;
  /* the board's ordinary save still works, and so does sending the same owner back unchanged */
  begin
    update public.circuit_people
       set name = name, owner_user_id = (select uid from who where k = 'friend')
     where id = (select v from ids where k = 'own');
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got <> 'ok' then insert into fails values ('B4 an owner''s ordinary save was refused', got); end if;
end $$;
reset role;
insert into fails select 'B4 the board changed hands', coalesce(owner_user_id::text, 'nobody')
  from public.circuit_people
 where id = (select v from ids where k = 'own')
   and owner_user_id is distinct from (select uid from who where k = 'friend');

-- the rule about WHO may ask is the one it always was
:be_stranger
do $$
declare got text;
begin
  begin
    perform public.claim_person((select v from ids where k = 'far'));
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'cannot claim this person' then
    insert into fails values ('B5 asked for a person in no circuit of theirs', got);
  end if;
  begin
    perform public.claim_person((select v from ids where k = 'own'));
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'cannot claim this person' then
    insert into fails values ('B5 asked for a person who already has an owner', got);
  end if;
end $$;
reset role;

do $$
begin
  if exists (select 1 from fails) then
    raise exception 'circuit claims, the doors: %',
      (select string_agg(check_name || coalesce(' — ' || nullif(detail, ''), ''), '; ') from fails);
  end if;
end $$;

-- ── C. the requests the doors wrote ───────────────────────────────────────────────────────────
insert into fails select 'C1 This is me wrote no request', ''
where not exists (select 1 from public.circuit_person_claims
                   where person_id = 'claim-test-linda' and user_id = (select uid from who where k = 'friend')
                     and via = 'asked' and status = 'pending' and decided_at is null);
insert into fails select 'C1 joining wrote no request', ''
where not exists (select 1 from public.circuit_person_claims
                   where person_id = 'claim-test-join' and user_id = (select uid from who where k = 'stranger')
                     and via = 'joined' and status = 'pending');
insert into fails select 'C1 Add me wrote no request', ''
where not exists (select 1 from public.circuit_person_claims
                   where person_id = 'claim-test-typed' and user_id = (select uid from who where k = 'stranger')
                     and via = 'added' and status = 'pending');

:be_friend
do $$ begin perform public.claim_person((select v from ids where k = 'linda')); end $$;
:be_stranger
do $$
declare got text;
begin
  got := public.add_self_to_circuit((select v from ids where k = 'g1')::uuid, 'Typed Name', null);
  if got is distinct from (select v from ids where k = 'typed') then
    insert into fails values ('C2 a second Add me answered with another person', coalesce(got, 'null'));
  end if;
end $$;
reset role;
insert into fails select 'C2 asking twice is not one request', p || ' has ' || n
  from (select person_id as p, count(*) as n from public.circuit_person_claims
         where person_id in ('claim-test-linda', 'claim-test-typed') group by person_id) x
 where n <> 1;
insert into fails select 'C2 a second Add me made a board', count(*)::text
  from public.circuit_people where owner_user_id = (select uid from who where k = 'stranger')
having count(*) > 0;

-- ── D. privileges ─────────────────────────────────────────────────────────────────────────────
insert into fails
select 'D1 anon can execute ' || f, ''
  from unnest(array[
    'public.claim_person(text)', 'public.add_self_to_circuit(uuid, text, text)',
    'public._circuit_add_self(uuid)', 'public._circuit_ask_for_person(text, text)',
    'public.my_person_claims()', 'public.withdraw_person_claim(uuid)',
    'public.admin_list_person_claims()', 'public.admin_decide_person_claim(uuid, boolean)',
    'public.circuit_person_owner_guard()']) f
 where has_function_privilege('anon', f, 'execute');
insert into fails
select 'D2 a member can execute the internal ' || f, ''
  from unnest(array['public._circuit_add_self(uuid)', 'public._circuit_ask_for_person(text, text)',
                    'public.circuit_person_owner_guard()']) f
 where has_function_privilege('authenticated', f, 'execute');
insert into fails
select 'D2 a member cannot execute ' || f, ''
  from unnest(array[
    'public.claim_person(text)', 'public.add_self_to_circuit(uuid, text, text)',
    'public.my_person_claims()', 'public.withdraw_person_claim(uuid)',
    'public.admin_list_person_claims()', 'public.admin_decide_person_claim(uuid, boolean)']) f
 where not has_function_privilege('authenticated', f, 'execute');
insert into fails
select 'D3 ' || r || ' holds ' || pr || ' on circuit_person_claims', ''
  from unnest(array['anon', 'authenticated']) r,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) pr
 where has_table_privilege(r, 'public.circuit_person_claims', pr);
insert into fails select 'D3 RLS is off on circuit_person_claims', ''
where not (select relrowsecurity from pg_class where oid = 'public.circuit_person_claims'::regclass);
insert into fails select 'D3 circuit_person_claims has a policy', count(*)::text
  from pg_policies where schemaname = 'public' and tablename = 'circuit_person_claims'
having count(*) > 0;

:be_friend
do $$
declare got text;
begin
  begin
    perform count(*) from public.circuit_person_claims;
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got = 'ok' then insert into fails values ('D4 a member read circuit_person_claims directly', ''); end if;
end $$;

-- ── E. a member's own view ────────────────────────────────────────────────────────────────────
:be_friend
insert into fails select 'E1 the friend does not see exactly their one request', count(*)::text
  from public.my_person_claims()
having count(*) <> 1 or bool_or(person_name is distinct from 'Linda' or status <> 'pending');
:be_stranger
insert into fails select 'E1 the stranger sees somebody else''s request', person_name
  from public.my_person_claims() where person_id = 'claim-test-linda';
insert into fails select 'E1 the stranger does not see their two requests', count(*)::text
  from public.my_person_claims()
having count(*) <> 2;
do $$
declare got text;
begin
  begin
    perform public.withdraw_person_claim(gen_random_uuid());
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'no such claim' then
    insert into fails values ('E2 withdrawing a request that does not exist', got);
  end if;
end $$;
reset role;
create temp table friend_claim as
  select id from public.circuit_person_claims
   where person_id = 'claim-test-linda' and user_id = (select uid from who where k = 'friend');
grant select on friend_claim to authenticated;
:be_stranger
do $$
declare got text;
begin
  begin
    perform public.withdraw_person_claim((select id from friend_claim));
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'no such claim' then
    insert into fails values ('E2 withdrawing somebody else''s request did not read as no such claim', got);
  end if;
end $$;
:be_friend
do $$
declare got text;
begin
  begin
    perform * from public.admin_list_person_claims();
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'admin only' then insert into fails values ('E3 a member listed the requests', got); end if;
  begin
    perform public.admin_decide_person_claim((select id from friend_claim), true);
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'admin only' then insert into fails values ('E3 a member approved their own request', got); end if;
end $$;
reset role;
insert into fails select 'E2 the friend''s request moved', status
  from public.circuit_person_claims where id = (select id from friend_claim) and status <> 'pending';
insert into fails select 'E3 the friend owns Linda', ''
where (select owner_user_id from public.circuit_people where id = 'claim-test-linda') is not null;

-- ── G. the admin ──────────────────────────────────────────────────────────────────────────────
-- the stranger asks for Linda too, so approving one has another to decline
create temp table listed (id uuid, person_id text, person_name text, user_id uuid, username text,
                          first_name text, via text, requested_at timestamptz, logs integer,
                          circuits text[], added_by_them boolean);
grant insert on listed to authenticated;
:be_stranger
do $$ begin perform public.claim_person((select v from ids where k = 'linda')); end $$;
:be_admin
insert into listed select * from public.admin_list_person_claims();
reset role;
insert into fails select 'G1 the list does not hold the four waiting requests', count(*)::text
  from listed having count(*) <> 4;
insert into fails select 'G1 the friend''s Linda row says the wrong thing',
       concat_ws(' / ', person_name, username, via, logs::text, array_to_string(circuits, ','), added_by_them::text)
  from listed
 where id = (select id from friend_claim)
   and (person_name <> 'Linda'
        or username is distinct from (select p.username::text from public.profiles p
                                       where p.user_id = (select uid from who where k = 'friend'))
        or via <> 'asked' or logs <> 2
        or not ((select name from public.circuit_groups where id = (select v from ids where k = 'g1')::uuid) = any (circuits))
        or added_by_them);
insert into fails select 'G1 the friend''s Linda row is missing', ''
where not exists (select 1 from listed where id = (select id from friend_claim));

:be_admin
do $$
declare got text;
begin
  begin
    got := public.admin_decide_person_claim((select id from friend_claim), true);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'approved' then insert into fails values ('G2 approving did not answer approved', got); end if;
  begin
    got := public.admin_decide_person_claim((select id from friend_claim), false);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'that claim has already been answered' then
    insert into fails values ('G3 an answered request was answered again', got);
  end if;
  begin
    got := public.admin_decide_person_claim(gen_random_uuid(), true);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'no such claim' then insert into fails values ('G3 a request that does not exist', got); end if;
  begin
    got := public.admin_decide_person_claim((select id from friend_claim), null);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'approve or decline' then insert into fails values ('G3 neither approve nor decline', got); end if;
end $$;
reset role;
insert into fails select 'G2 approving did not put the friend on the board', coalesce(owner_user_id::text, 'nobody')
  from public.circuit_people
 where id = 'claim-test-linda' and owner_user_id is distinct from (select uid from who where k = 'friend');
insert into fails select 'G2 the approved request does not say who approved it', ''
where not exists (select 1 from public.circuit_person_claims
                   where id = (select id from friend_claim) and status = 'approved'
                     and decided_by = (select uid from who where k = 'admin') and decided_at is not null);
insert into fails select 'G2 the other request for Linda was not declined', coalesce(status, 'missing')
  from (select (select status from public.circuit_person_claims
                 where person_id = 'claim-test-linda' and user_id = (select uid from who where k = 'stranger')) as status) x
 where status is distinct from 'declined';
-- and now the friend can write Linda's days, which they could not while they were only asking
:be_friend
do $$
declare got text;
begin
  begin
    insert into public.circuit_logs (id, person_id, date, entries)
    values ('claim-test-log-4', 'claim-test-linda', date '2026-11-04', '[]');
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got <> 'ok' then insert into fails values ('G2 the approved owner could not write a day', got); end if;
end $$;

-- declined: Add me passes it over and makes a board of their own, and asking again is refused
:be_admin
do $$
declare got text;
begin
  begin
    got := public.admin_decide_person_claim(
      (select c.id from public.admin_list_person_claims() c where c.person_id = 'claim-test-typed'), false);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'declined' then insert into fails values ('G4 declining did not answer declined', got); end if;
end $$;
:be_stranger
do $$
declare got text;
begin
  got := public.add_self_to_circuit((select v from ids where k = 'g1')::uuid, 'Typed Name', '#22c55e');
  if got is null or got = (select v from ids where k = 'typed') then
    insert into fails values ('G4 Add me after a refusal did not make a board of their own', coalesce(got, 'null'));
  end if;
  begin
    perform public.claim_person((select v from ids where k = 'typed'));
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'an admin has said no to this claim' then
    insert into fails values ('G4 asking again after a refusal', got);
  end if;
end $$;
reset role;
insert into fails select 'G4 the refused person changed hands', ''
where (select owner_user_id from public.circuit_people where id = 'claim-test-typed') is not null;
insert into fails select 'G4 the stranger does not own exactly one new board', count(*)::text
  from public.circuit_people where owner_user_id = (select uid from who where k = 'stranger')
having count(*) <> 1;

-- withdrawn, then asked again: a second request, not a revived first one
:be_stranger
do $$
begin
  perform public.withdraw_person_claim(
    (select c.id from public.my_person_claims() c where c.person_id = 'claim-test-join' and c.status = 'pending'));
  perform public.claim_person((select v from ids where k = 'join'));
end $$;
reset role;
insert into fails select 'G5 withdraw and ask again', string_agg(status, ',' order by status)
  from public.circuit_person_claims
 where person_id = 'claim-test-join' and user_id = (select uid from who where k = 'stranger')
having string_agg(status, ',' order by status) is distinct from 'pending,withdrawn';

-- a suspended asker is refused, and so is a person who has an owner by now
update public.profiles set suspended = true where user_id = (select uid from who where k = 'stranger');
:be_admin
do $$
declare got text;
begin
  begin
    got := public.admin_decide_person_claim(
      (select c.id from public.admin_list_person_claims() c where c.person_id = 'claim-test-join'), true);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'that account is suspended' then
    insert into fails values ('G6 approved a suspended account', got);
  end if;
end $$;
reset role;
update public.profiles set suspended = false where user_id = (select uid from who where k = 'stranger');
insert into fails select 'G6 the suspended account got the board', ''
where (select owner_user_id from public.circuit_people where id = 'claim-test-join') is not null;

:be_friend
do $$ begin perform public.claim_person((select v from ids where k = 'gran')); end $$;
:be_admin
-- the admin's own direct write still works, and is how Gran came to have an owner meanwhile
update public.circuit_people set owner_user_id = (select uid from who where k = 'admin')
 where id = 'claim-test-gran';
do $$
declare got text;
begin
  begin
    got := public.admin_decide_person_claim(
      (select c.id from public.admin_list_person_claims() c where c.person_id = 'claim-test-gran'), true);
  exception when others then got := sqlerrm;
  end;
  if got is distinct from 'this person already belongs to an account' then
    insert into fails values ('G7 approved a person who already had an owner', got);
  end if;
end $$;
reset role;
insert into fails select 'G7 the admin''s direct write did not land', ''
where (select owner_user_id from public.circuit_people where id = 'claim-test-gran')
      is distinct from (select uid from who where k = 'admin');

-- ── H. nobody's board changed hands that existed before the test ──────────────────────────────
insert into fails select 'H a board that existed before the test changed hands', b.id
  from before_owners b
  left join public.circuit_people cp on cp.id = b.id
 where cp.id is null or cp.owner_user_id is distinct from b.owner_user_id;
insert into fails select 'H there were no boards before the test to compare against', ''
where not exists (select 1 from before_owners);

-- ── the report ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from fails) then
    raise exception 'circuit claims: %',
      (select string_agg(check_name || coalesce(' — ' || nullif(detail, ''), ''), '; ') from fails);
  end if;
end $$;
select 'circuit claims: all checks passed' as result;

rollback;
