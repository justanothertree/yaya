-- A circuit's creator cannot put somebody else's person into their circuit, and so cannot read
-- them that way; everything else about adding and removing people is unchanged. Asked of the real
-- policies as the seeded admin and two members.
--
-- ⛔ NEEDS docs/2026-11-22-circuit-creator-staple.DRAFT.sql APPLIED FIRST, and refuses to run
-- otherwise. It runs only where a throwaway database has been built from the baseline and seed
-- (the `db guards` CI job), and it rolls back. NEVER against production: it writes rows.
--
-- WHAT IT ASKS:
--   A  the stranger makes a circuit and tries to add the friend's private board to it: refused,
--      and the friend's days stay unreadable to them. Ends in a report of its own, so run against
--      the policy as it was it says that, rather than failing on something else.
--   B  what must still work: a member adds their OWN board to a circuit they are in; the creator
--      takes somebody else's board out of their circuit; the admin adds anybody's
--   C  a row cannot be moved to a person you do not own, nor into a circuit you are not in
--   D  the table's policies are exactly the four, and none of them is for anon
-- On failure it raises, naming every check that failed. A green run prints one row.

begin;

create temp table fails(check_name text, detail text);
create temp table who(k text primary key, uid uuid, claims text);
create temp table ids(k text primary key, v text);
grant select, insert on fails to authenticated, anon;
grant select on who to authenticated, anon;
grant select, insert on ids to authenticated, anon;

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

-- ── 0. THE DRAFT MUST BE APPLIED, OR EVERY CHECK BELOW IS ABOUT THE OLD POLICY ───────────────
do $$
begin
  if not exists (select 1 from pg_policy where polrelid = 'public.circuit_person_groups'::regclass
                    and polname = 'cpg_insert') then
    raise exception 'apply docs/2026-11-22-circuit-creator-staple.DRAFT.sql before this file';
  end if;
end $$;

insert into fails select 'FIXTURE: need an admin and two other members', 'seed the database first'
where (select count(*) from who where uid is not null) <> 3;

-- ── fixtures, as the database owner ────────────────────────────────────────────────────────────
-- The friend's own board is private and in no circuit the stranger is in, with two days on it.
insert into public.circuit_people (id, name, owner_user_id, visibility) values
  ('staple-friend', 'Friend private', (select uid from who where k = 'friend'), 'private'),
  ('staple-other', 'Admin board', (select uid from who where k = 'admin'), 'private');
insert into public.circuit_logs (id, person_id, date, entries) values
  ('staple-log-1', 'staple-friend', date '2026-11-01', '[]'),
  ('staple-log-2', 'staple-friend', date '2026-11-02', '[]');

-- ── A. the staple ─────────────────────────────────────────────────────────────────────────────
:be_stranger
do $$
declare v uuid; got text;
begin
  select c.id into v from public.create_circuit('staple test') c;
  insert into ids values ('mine', v::text);
  begin
    insert into public.circuit_person_groups (person_id, group_id) values ('staple-friend', v);
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got = 'ok' then
    insert into fails values ('A the creator added somebody else''s private board to their circuit', '');
  end if;
  if (select count(*) from public.circuit_logs where person_id = 'staple-friend') > 0 then
    insert into fails values ('A the creator reads the private board''s days',
      (select count(*)::text from public.circuit_logs where person_id = 'staple-friend'));
  end if;
end $$;
reset role;

do $$
begin
  if exists (select 1 from fails) then
    raise exception 'circuit creator staple, the hole: %',
      (select string_agg(check_name || coalesce(' — ' || nullif(detail, ''), ''), '; ') from fails);
  end if;
end $$;

-- ── B. what must still work ───────────────────────────────────────────────────────────────────
-- the friend joins the stranger's circuit (as the owner would let them, by code) and adds their
-- own board; the stranger, as creator, takes it out again; the admin adds a board of their own
insert into public.circuit_group_members (group_id, user_id)
values ((select v from ids where k = 'mine')::uuid, (select uid from who where k = 'friend'));
:be_friend
do $$
declare got text;
begin
  begin
    insert into public.circuit_person_groups (person_id, group_id)
    values ('staple-friend', (select v from ids where k = 'mine')::uuid);
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got <> 'ok' then insert into fails values ('B a member could not add their own board', got); end if;
end $$;
:be_stranger
do $$
declare n int;
begin
  delete from public.circuit_person_groups
   where person_id = 'staple-friend' and group_id = (select v from ids where k = 'mine')::uuid;
  get diagnostics n = row_count;
  if n <> 1 then insert into fails values ('B the creator could not take a board out of their circuit', n::text); end if;
end $$;
:be_admin
do $$
declare got text;
begin
  begin
    insert into public.circuit_person_groups (person_id, group_id)
    values ('staple-friend', (select v from ids where k = 'mine')::uuid);
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got <> 'ok' then insert into fails values ('B the admin could not add a board', got); end if;
end $$;

-- ── C. moving a row ───────────────────────────────────────────────────────────────────────────
-- the friend's row is back (the admin put it there); the friend may not move it onto the admin's
-- board, and the stranger, who owns neither, may not touch it
:be_friend
do $$
declare got text;
begin
  begin
    update public.circuit_person_groups set person_id = 'staple-other'
     where person_id = 'staple-friend' and group_id = (select v from ids where k = 'mine')::uuid;
    got := 'ok';
  exception when others then got := sqlerrm;
  end;
  if got = 'ok' then insert into fails values ('C a member moved a row onto a board they do not own', ''); end if;
end $$;
:be_stranger
do $$
declare n int;
begin
  update public.circuit_person_groups set added_by = auth.uid()
   where person_id = 'staple-friend' and group_id = (select v from ids where k = 'mine')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then insert into fails values ('C the creator edited a row for a board they do not own', n::text); end if;
end $$;
reset role;

-- ── D. the policies ───────────────────────────────────────────────────────────────────────────
insert into fails select 'D the policies are not the four', coalesce(string_agg(polname, ',' order by polname), 'none')
  from pg_policy where polrelid = 'public.circuit_person_groups'::regclass
having coalesce(string_agg(polname, ',' order by polname), '') <> 'cpg_delete,cpg_insert,cpg_select,cpg_update';
insert into fails select 'D a policy reaches anon', polname
  from pg_policy where polrelid = 'public.circuit_person_groups'::regclass
   and 'anon'::regrole = any (polroles);

-- ── the report ────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from fails) then
    raise exception 'circuit creator staple: %',
      (select string_agg(check_name || coalesce(' — ' || nullif(detail, ''), ''), '; ') from fails);
  end if;
end $$;
select 'circuit creator staple: all checks passed' as result;

rollback;
