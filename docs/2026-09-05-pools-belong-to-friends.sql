-- 2026-09-05 — a pool belongs to friends, not to a circuit
--
-- WHY: a pool was gated on circuit membership, so deciding what to watch with two friends meant
-- first creating a "circuit" — a fitness board with people, goals and exercise grids — and
-- getting them to join it. The audience mechanism was borrowed from the thing the pool was built
-- next to, not chosen for it. Choosing between four takeaways should be shared the way you
-- already know these people: they are your friends.
--
-- A pool is now its own object with its own audience: just you, all your friends, or the
-- specific people you picked. Options belong to a pool. Circuits are untouched and still run the
-- fitness board and the review board.
--
--
-- ⚠️ VOTES BECOME ROWS, and that is a bug fix, not tidying.
--
-- `circuit_watchlist.votes` was a jsonb array rewritten whole on every tap. Two people voting on
-- the same option inside one round trip meant the second write clobbered the first, silently —
-- and the pool's entire purpose is several people acting at once. One row per (option, person)
-- makes concurrent votes independent by construction, and `user_id default auth.uid()` with a
-- matching WITH CHECK means a vote is now something you can only cast for YOURSELF.
--
-- Nothing is migrated because there is nothing to migrate: measured on prod before writing this,
-- 0 of 102 rows had a single vote on them. The old column is deliberately LEFT IN PLACE — see
-- the note at the bottom — so that this script and the deploy can land in either order.
--
--
-- ⚠️ MIGRATED POOLS KEEP THE CIRCUIT'S UUID as their own id. Everything that already points at a
-- circuit — the realtime topic `pool:<uuid>`, any link somebody saved — keeps pointing at the
-- right thing, and `update circuit_watchlist set pool_id = group_id` is the whole data move.
--
--
-- ⚠️ AN AUDIENCE OF "FRIENDS" IS NEVER ENUMERATED to the people in it. pool_names() below
-- resolves the owner, the explicitly invited, and whoever has actually voted — and stops there.
-- Listing every friend of the owner as a potential voter would tell each of them who else the
-- owner is friends with, which is not theirs to learn from a takeaway poll, and would put thirty
-- empty circles on every row to do it.

begin;

-- ── the pool ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.pools (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'Pool',
  -- just_me: a private shortlist. friends: everyone you have added. selected: pool_people.
  audience text not null default 'friends' check (audience in ('just_me', 'friends', 'selected')),
  created_at timestamptz not null default now()
);

create table if not exists public.pool_people (
  pool_id uuid not null references public.pools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  /* ⚠️ needed for the bell, not for bookkeeping. A notice is "this became visible to you
     recently", and without a timestamp the only question the row can answer is the standing
     "are you in it", which would re-announce every pool you have ever been added to on every
     visit — see the pool branch of list_activity_notices below. */
  added_at timestamptz not null default now(),
  primary key (pool_id, user_id)
);

create table if not exists public.pool_votes (
  item_id text not null references public.circuit_watchlist(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

alter table public.circuit_watchlist
  add column if not exists pool_id uuid references public.pools(id) on delete cascade;

create index if not exists pool_people_user_idx on public.pool_people (user_id);
create index if not exists pool_votes_user_idx on public.pool_votes (user_id);
create index if not exists circuit_watchlist_pool_idx on public.circuit_watchlist (pool_id);

-- ── who can see what ────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so the policies below can call it without recursing through the very
-- policies it is deciding.
create or replace function public.pool_visible(p_pool uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.pools p
    where p.id = p_pool
      and (
        p.owner_user_id = auth.uid()
        or (p.audience = 'friends' and public.are_friends(auth.uid(), p.owner_user_id))
        or (p.audience = 'selected' and exists (
              select 1 from public.pool_people pp
              where pp.pool_id = p.id and pp.user_id = auth.uid()))
      )
  );
$$;

/*
 * Who you may put in a pool: someone you are actually connected to.
 *
 * ⚠️ Friends OR a circuit you share, rather than friends alone. It is the same set as
 * list_member_directory(), i.e. the people this account can already see and message — so a pool
 * cannot reach anybody new — and it is what lets the migration below turn each existing circuit
 * into a pool without dropping a crewmate who was never separately added as a friend.
 */
create or replace function public.pool_can_invite(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select auth.uid() is not null
     and p_user is not null
     and (
       public.are_friends(auth.uid(), p_user)
       or exists (
         select 1
         from public.circuit_group_members mine
         join public.circuit_group_members theirs on theirs.group_id = mine.group_id
         where mine.user_id = auth.uid() and theirs.user_id = p_user)
     );
$$;

/** An option is visible when its pool is — or, for anything not yet moved, its circuit. */
create or replace function public.pool_item_visible(p_item text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.circuit_watchlist w
    where w.id = p_item
      and (
        (w.pool_id is not null and public.pool_visible(w.pool_id))
        or (w.pool_id is null and public.circuit_is_member(w.group_id))
      )
  );
$$;

revoke all on function public.pool_visible(uuid) from public, anon;
revoke all on function public.pool_can_invite(uuid) from public, anon;
revoke all on function public.pool_item_visible(text) from public, anon;
grant execute on function public.pool_visible(uuid) to authenticated;
grant execute on function public.pool_can_invite(uuid) to authenticated;
grant execute on function public.pool_item_visible(text) to authenticated;

-- ── names, and only the ones needed ─────────────────────────────────────────────────────────
/*
 * Names for the people who appear on this pool's screen: its owner, anyone explicitly invited,
 * anyone who has actually voted, and you.
 *
 * ⚠️ Deliberately NOT "everyone in the audience". For a friends-audience pool that would be the
 * owner's whole friend list, handed to every other friend — see the note at the top.
 */
create or replace function public.pool_names(p_pool uuid)
returns table(user_id uuid, name text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select u.uid, public.display_name(u.uid)
  from (
    select p.owner_user_id as uid from public.pools p where p.id = p_pool
    union
    select pp.user_id from public.pool_people pp where pp.pool_id = p_pool
    union
    select v.user_id
      from public.pool_votes v
      join public.circuit_watchlist w on w.id = v.item_id
     where w.pool_id = p_pool
    union
    select auth.uid()
  ) u
  where u.uid is not null
    and public.pool_visible(p_pool);
$$;

revoke all on function public.pool_names(uuid) from public, anon;
grant execute on function public.pool_names(uuid) to authenticated;

-- ── policies ────────────────────────────────────────────────────────────────────────────────
alter table public.pools enable row level security;
alter table public.pool_people enable row level security;
alter table public.pool_votes enable row level security;

grant select, insert, update, delete on public.pools to authenticated;
grant select, insert, delete on public.pool_people to authenticated;
grant select, insert, delete on public.pool_votes to authenticated;

/*
 * Suspended accounts do nothing here, matching every other members' table.
 *
 * ⚠️ `as restrictive` IS LOAD-BEARING AND EASY TO LOSE. Postgres ORs permissive policies
 * together, so a permissive "for all: not suspended" would not narrow anything — it would be a
 * second, independent way to pass, and every non-suspended member would read and write every
 * pool on the site regardless of audience. Restrictive policies are ANDed, which is what "and
 * also you must not be suspended" actually means. Checked against the existing tables before
 * writing this: circuit_watchlist and circuit_movies both mark theirs restrictive.
 */
drop policy if exists pools_not_suspended on public.pools;
create policy pools_not_suspended on public.pools
  as restrictive for all to authenticated
  using (not public.is_suspended(auth.uid()))
  with check (not public.is_suspended(auth.uid()));

drop policy if exists pool_people_not_suspended on public.pool_people;
create policy pool_people_not_suspended on public.pool_people
  as restrictive for all to authenticated
  using (not public.is_suspended(auth.uid()))
  with check (not public.is_suspended(auth.uid()));

drop policy if exists pool_votes_not_suspended on public.pool_votes;
create policy pool_votes_not_suspended on public.pool_votes
  as restrictive for all to authenticated
  using (not public.is_suspended(auth.uid()))
  with check (not public.is_suspended(auth.uid()));

drop policy if exists pools_select on public.pools;
create policy pools_select on public.pools
  for select to authenticated
  using (public.pool_visible(id) or public.is_admin());

-- ⚠️ Only the owner creates, renames, re-aims or deletes a pool. Everyone in it can add
-- options and vote (below); changing WHO CAN SEE IT is not a thing a guest may do.
drop policy if exists pools_insert on public.pools;
create policy pools_insert on public.pools
  for insert to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists pools_update on public.pools;
create policy pools_update on public.pools
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists pools_delete on public.pools;
create policy pools_delete on public.pools
  for delete to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists pool_people_select on public.pool_people;
create policy pool_people_select on public.pool_people
  for select to authenticated
  using (public.pool_visible(pool_id) or public.is_admin());

drop policy if exists pool_people_insert on public.pool_people;
create policy pool_people_insert on public.pool_people
  for insert to authenticated
  with check (
    exists (select 1 from public.pools p where p.id = pool_id and p.owner_user_id = auth.uid())
    and public.pool_can_invite(user_id)
  );

-- the owner can remove anyone; anyone can remove themselves, which is how you leave
drop policy if exists pool_people_delete on public.pool_people;
create policy pool_people_delete on public.pool_people
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.pools p where p.id = pool_id and p.owner_user_id = auth.uid())
  );

drop policy if exists pool_votes_select on public.pool_votes;
create policy pool_votes_select on public.pool_votes
  for select to authenticated
  using (public.pool_item_visible(item_id) or public.is_admin());

-- ⚠️ `user_id = auth.uid()` is the whole point of the rewrite: a vote is yours, cast by you.
-- The old jsonb array let any member write any member's vote, and let either of two simultaneous
-- voters erase the other.
drop policy if exists pool_votes_insert on public.pool_votes;
create policy pool_votes_insert on public.pool_votes
  for insert to authenticated
  with check (user_id = auth.uid() and public.pool_item_visible(item_id));

drop policy if exists pool_votes_delete on public.pool_votes;
create policy pool_votes_delete on public.pool_votes
  for delete to authenticated
  using (user_id = auth.uid());

-- options: gated on the pool when they have one, on the old circuit when they do not
drop policy if exists circuit_watchlist_select on public.circuit_watchlist;
create policy circuit_watchlist_select on public.circuit_watchlist
  for select
  using (
    (pool_id is not null and public.pool_visible(pool_id))
    or (pool_id is null and public.circuit_is_member(group_id))
    or public.is_admin()
  );

drop policy if exists circuit_watchlist_insert on public.circuit_watchlist;
create policy circuit_watchlist_insert on public.circuit_watchlist
  for insert
  with check (
    (pool_id is not null and public.pool_visible(pool_id))
    or (pool_id is null and public.circuit_is_member(group_id))
    or public.is_admin()
  );

drop policy if exists circuit_watchlist_update on public.circuit_watchlist;
create policy circuit_watchlist_update on public.circuit_watchlist
  for update
  using (
    (pool_id is not null and public.pool_visible(pool_id))
    or (pool_id is null and public.circuit_is_member(group_id))
    or public.is_admin()
  )
  with check (
    (pool_id is not null and public.pool_visible(pool_id))
    or (pool_id is null and public.circuit_is_member(group_id))
    or public.is_admin()
  );

drop policy if exists circuit_watchlist_delete on public.circuit_watchlist;
create policy circuit_watchlist_delete on public.circuit_watchlist
  for delete
  using (
    (pool_id is not null and public.pool_visible(pool_id))
    or (pool_id is null and public.circuit_is_member(group_id))
    or public.is_admin()
  );

-- ── the wheel's channel now names a pool ────────────────────────────────────────────────────
-- Same topic shape as 2026-09-05-the-pool-rolls-together.sql, same policies; only the membership
-- test changes, from "in that circuit" to "can see that pool". Migrated pools kept the circuit's
-- uuid, so nothing that already worked stops working.
create or replace function public.pool_topic_member(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  raw text;
begin
  raw := substring(p_topic from '^pool:([0-9a-fA-F-]{36})$');
  if raw is null then
    return false;
  end if;
  return public.pool_visible(raw::uuid);
end;
$$;

revoke all on function public.pool_topic_member(text) from public, anon;
grant execute on function public.pool_topic_member(text) to authenticated;

/*
 * ⚠️ THESE TWO POLICIES WERE IN A SEPARATE SCRIPT AND ARE FOLDED IN HERE, because neither script
 * had been run yet and "run these two, in this order" is a trap with a silent failure at the end
 * of it: run only this one and the wheel would turn on one screen forever, with nothing to say
 * why. 2026-09-05-the-pool-rolls-together.sql is now a design note, not a script.
 *
 * ⚠️ INSERT is granted here, unlike the six read-only channels in 2026-08-10, and the difference
 * is that this topic is not fixed. It names one pool and the gate is being able to SEE that
 * pool, so there is no topic a stranger and a member both reach — an unrecognised uuid matches
 * nobody. The audience for anything sent is exactly the people who can already read the pool,
 * vote in it and delete from it; speaking to them is not a new capability, it is the one they
 * have, arriving faster. Without INSERT a broadcast is silently dropped.
 *
 * ⚠️ The `extension` filter belongs on THESE policies and must never be copied onto a
 * postgres_changes topic — see the long note in 2026-08-10. `extension` describes the
 * authorization probe, not the subscription, and is null at join time for postgres_changes, so
 * filtering on it there produces false denials only. Here the channel really is a broadcast.
 */
drop policy if exists "pool: members can watch the wheel" on realtime.messages;
create policy "pool: members can watch the wheel"
on realtime.messages
for select
to authenticated
using (
  (extension = any (array['broadcast', 'presence']))
  and public.pool_topic_member((select realtime.topic()))
);

drop policy if exists "pool: members can spin it" on realtime.messages;
create policy "pool: members can spin it"
on realtime.messages
for insert
to authenticated
with check (
  (extension = any (array['broadcast', 'presence']))
  and public.pool_topic_member((select realtime.topic()))
);

-- ── the bell ────────────────────────────────────────────────────────────────────────────────
/*
 * A pool you can suddenly see should say so.
 *
 * ⚠️ Being added to something is useless if nobody is told. The audience work is what makes a
 * pool reach your friends; without this it reaches them only if they happen to open Ratings and
 * notice a new name in a dropdown, which is not reaching them.
 *
 * ⚠️ ONE NOTICE PER POOL PER PERSON, from either of the two ways a pool becomes yours to see:
 * being ticked into a `selected` one, or somebody you are friends with making a `friends` one.
 * Both are the same event — "this became visible to you" — and both happen once, so neither can
 * turn into a stream. Changing a pool's name or its options deliberately says nothing.
 *
 * ⚠️ `subject` carries the POOL ID and `detail` the name, which is backwards from the other
 * branches and is the reason this needed no signature change: the bell renders `detail` as the
 * secondary line, so the name shows and the uuid stays in the href. Adding a sixth column would
 * have meant dropping and recreating a function the bell already depends on.
 */
create or replace function public.list_activity_notices()
returns table(kind text, actor text, subject text, detail text, at timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as (select auth.uid() as uid),
  seen as (
    select coalesce(
      (select ar.seen_at from public.activity_reads ar, me where ar.user_id = me.uid),
      now() - interval '30 days'   -- first run: a sensible window, not the whole archive
    ) as since
  ),
  -- logs belonging to a person I own
  mine as (
    select l.id, l.date
    from public.circuit_logs l
    join public.circuit_people p on p.id = l.person_id
    join me on p.owner_user_id = me.uid
  )
  select 'kudos', r.author_name, m.date::text, r.emoji, r.created_at
  from public.circuit_log_reactions r
  join mine m on m.id = r.log_id, me, seen
  where r.user_id <> me.uid and r.created_at > seen.since
  union all
  select 'comment', c.author_name, m.date::text, c.body, c.created_at
  from public.circuit_log_comments c
  join mine m on m.id = c.log_id, me, seen
  where c.user_id <> me.uid and c.created_at > seen.since
  union all
  select 'join', coalesce(pr.first_name, pr.username::text), g.name, null, gm.joined_at
  from public.circuit_group_members gm
  join public.circuit_groups g on g.id = gm.group_id
  join public.profiles pr on pr.user_id = gm.user_id, me, seen
  where gm.user_id <> me.uid
    and gm.joined_at > seen.since
    and exists (
      select 1 from public.circuit_group_members mine_gm
      where mine_gm.group_id = gm.group_id and mine_gm.user_id = me.uid
    )
  union all
  -- someone wrote on my page. `subject` carries MY username so the bell can link straight there.
  select 'guestbook',
         coalesce(ap.first_name, ap.username::text),
         myp.username::text,
         n.body,
         n.created_at
  from public.profile_notes n
  join public.profiles ap on ap.user_id = n.author_user_id
  join me on n.profile_user_id = me.uid
  join public.profiles myp on myp.user_id = me.uid, seen
  where n.author_user_id <> me.uid and n.created_at > seen.since
  union all
  -- ticked into a pool by name
  select 'pool', public.display_name(p.owner_user_id), p.id::text, p.name, pp.added_at
  from public.pool_people pp
  join public.pools p on p.id = pp.pool_id, me, seen
  where pp.user_id = me.uid
    and p.owner_user_id <> me.uid
    and pp.added_at > seen.since
  union all
  -- a friend made a pool aimed at their friends, which includes you
  select 'pool', public.display_name(p.owner_user_id), p.id::text, p.name, p.created_at
  from public.pools p, me, seen
  where p.audience = 'friends'
    and p.owner_user_id <> me.uid
    and p.created_at > seen.since
    and public.are_friends(me.uid, p.owner_user_id)
  order by 5 desc
  limit 30;
$function$;

-- ── the live board ──────────────────────────────────────────────────────────────────────────
-- so a friend adding an option or casting a vote reaches everyone's screen the same way an
-- edit to any other board does
alter publication supabase_realtime add table public.pools;
alter publication supabase_realtime add table public.pool_people;
alter publication supabase_realtime add table public.pool_votes;

-- ── migrate: one pool per existing circuit, same uuid, same people ──────────────────────────
insert into public.pools (id, owner_user_id, name, audience)
select g.id,
       coalesce(
         g.created_by,
         (select gm.user_id from public.circuit_group_members gm
           where gm.group_id = g.id order by gm.joined_at limit 1)),
       g.name,
       'selected'
from public.circuit_groups g
where coalesce(
        g.created_by,
        (select gm.user_id from public.circuit_group_members gm
          where gm.group_id = g.id order by gm.joined_at limit 1)) is not null
on conflict (id) do nothing;

insert into public.pool_people (pool_id, user_id)
select gm.group_id, gm.user_id
from public.circuit_group_members gm
join public.pools p on p.id = gm.group_id
on conflict do nothing;

update public.circuit_watchlist set pool_id = group_id where group_id is not null and pool_id is null;

commit;

-- ── HOW TO CHECK IT WORKED ──────────────────────────────────────────────────────────────────
--   select count(*) from public.pools;                                     -- one per circuit: 2
--   select count(*) from public.circuit_watchlist where pool_id is null;   -- 0
--   select count(*) from public.pool_people;                               -- 8
-- Dry-run before writing this said exactly those numbers, so anything else means something
-- moved underneath it — stop and look rather than carrying on.
--   select * from public.pool_names(id) from public.pools;                 -- names resolve
-- In the app: Ratings → Pool shows a pool picker with your migrated circuits in it, and "New
-- pool" makes one aimed at your friends without going anywhere near a circuit.
--
-- ── WHAT IS STILL EVAN'S TO DO, LATER ───────────────────────────────────────────────────────
-- `circuit_watchlist.votes` is now dead — nothing reads it and nothing writes it — but it is
-- left in place ON PURPOSE so this script and the deploy can land in either order without a
-- cached older tab's upsert failing on a missing column. Once the new build has been live for a
-- day or so:
--     alter table public.circuit_watchlist drop column votes;
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
-- The old policies, verbatim, then drop the new objects:
--   create policy circuit_watchlist_select on public.circuit_watchlist for select
--     using (circuit_is_member(group_id) or is_admin());          -- and insert/update/delete
--   alter table public.circuit_watchlist drop column pool_id;
--   drop table public.pool_votes, public.pool_people, public.pools;
--   drop function public.pool_visible(uuid), public.pool_can_invite(uuid),
--                 public.pool_item_visible(text), public.pool_names(uuid),
--                 public.pool_topic_member(text);
--   drop policy "pool: members can watch the wheel" on realtime.messages;
--   drop policy "pool: members can spin it" on realtime.messages;
--   alter publication supabase_realtime drop table public.pools, public.pool_people, public.pool_votes;
