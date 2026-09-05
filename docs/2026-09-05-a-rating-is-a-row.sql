-- 2026-09-05 — a rating is a row, so two people writing at once both keep their work
--
-- ⚠️ INDEPENDENT OF 2026-09-05-pools-belong-to-friends.sql. Neither needs the other and they
-- touch nothing in common, so run them in whichever order you like. (They were deliberately not
-- merged: one migration that does everything has one blast radius that covers everything.)
--
--
-- WHY: `circuit_movies.ratings` is a jsonb object holding EVERYBODY's rating, and rating a film
-- rewrote the whole object — `saveMovie({ ...movie, ratings })` in MovieRate.tsx. So two people
-- reviewing the same film inside one round trip meant the second write silently erased the
-- first, and a rating is not a tap: it is a score, vibe icons, sentiment, rewatch, recommend,
-- tips, tags and a written note. Somebody's paragraph, gone, with the UI showing success.
--
-- That is the whole reason for this script. Reviewing together at the same time is the normal
-- case here, so the storage has to make concurrent ratings independent rather than hope they
-- miss each other.
--
--
-- ⚠️ THE FILM KEEPS ITS ONE SHARED ROW. This is not a split into private per-person reviews —
-- a film is still one page with everyone's ratings on it, which is the point of the board. Only
-- the STORAGE of the individual ratings moves out of a single rewritten blob into a row each.
-- Those are different questions and it was worth not confusing them.
--
--
-- ⚠️ RATINGS ARE KEYED BY ACCOUNT NOW, not by circuit_people.id.
--
-- A rating belongs to a person, and `user_id default auth.uid()` with a matching WITH CHECK is
-- what makes "you can only rate as yourself" true rather than merely customary. It is also the
-- groundwork for the board moving off circuits: an account is the thing a friendship connects.
--
-- Measured on prod before writing this: 469 rating entries, 469 distinct (film, account) pairs,
-- 0 belonging to a person with no account, 0 that would collide. The rekey is lossless, and the
-- numbers are here so a different answer at run time means stop and look.
--
--
-- ⚠️ WHAT THIS DOES NOT DO: it does not switch who can SEE the board to friends. Checked first,
-- and it is the reason: of the ten pairs among the five people who have actually written
-- reviews, only TWO are friends here. The crew connected through circuits and never needed to
-- send friend requests, so a friends-only board would hide eight of those ten pairs from each
-- other on day one and gut the stats page. Visibility therefore gains a friends path ON TOP of
-- the circuit one — a friend outside your circuits who rates something now shows up — and loses
-- nothing. Dropping the circuit path is one line, once the friend graph is actually filled in.

begin;

-- ── the table ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.circuit_ratings (
  movie_id text not null references public.circuit_movies(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  /* 0-100, or null for "rated the vibes but not the score" — the UI has always allowed that */
  score integer check (score is null or (score >= 0 and score <= 100)),
  /* decorative vibe ids; kept as jsonb rather than normalised because nothing queries inside it */
  icons jsonb,
  /* sentiment / rewatch / rec / tips / tags / note — one person's, so nobody else can clobber it */
  review jsonb,
  updated_at timestamptz not null default now(),
  primary key (movie_id, user_id)
);

create index if not exists circuit_ratings_user_idx on public.circuit_ratings (user_id);

-- ── who can see a film, and whose ratings ───────────────────────────────────────────────────
/*
 * ⚠️ SECURITY DEFINER so the policies can call it without recursing through themselves.
 *
 * Three ways a film is yours to see, in the order they will stop mattering: you share a circuit
 * with it (how everything works today), you or a friend has rated it (how it will work), or you
 * are an admin. The middle branch is the new one and it is purely additive — see the note at the
 * top about why the circuit branch cannot be removed yet.
 */
create or replace function public.movie_visible(p_movie text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.circuit_movies m
    where m.id = p_movie
      and (
        public.circuit_is_member(m.group_id)
        or exists (
          select 1 from public.circuit_ratings r
          where r.movie_id = m.id
            and (r.user_id = auth.uid() or public.are_friends(auth.uid(), r.user_id)))
        or public.is_admin()
      )
  );
$$;

revoke all on function public.movie_visible(text) from public, anon;
grant execute on function public.movie_visible(text) to authenticated;

-- ── policies ────────────────────────────────────────────────────────────────────────────────
alter table public.circuit_ratings enable row level security;
grant select, insert, update, delete on public.circuit_ratings to authenticated;

/*
 * ⚠️ `as restrictive` is load-bearing. Postgres ORs permissive policies together, so a permissive
 * "for all: not suspended" would not narrow anything — it would be a second, independent way to
 * pass, and every non-suspended member would read and write every rating on the site. Restrictive
 * policies are ANDed, which is what "and also you must not be suspended" actually means. Every
 * other members' table here marks theirs restrictive; this one has to as well.
 */
drop policy if exists circuit_ratings_not_suspended on public.circuit_ratings;
create policy circuit_ratings_not_suspended on public.circuit_ratings
  as restrictive for all to authenticated
  using (not public.is_suspended(auth.uid()))
  with check (not public.is_suspended(auth.uid()));

drop policy if exists circuit_ratings_select on public.circuit_ratings;
create policy circuit_ratings_select on public.circuit_ratings
  for select to authenticated
  using (public.movie_visible(movie_id));

-- ⚠️ `user_id = auth.uid()` on all three write verbs is the whole point: a rating is yours, and
-- nobody else can write it, overwrite it or delete it. The old jsonb blob let any circuit member
-- write any member's rating simply by saving the film.
drop policy if exists circuit_ratings_insert on public.circuit_ratings;
create policy circuit_ratings_insert on public.circuit_ratings
  for insert to authenticated
  with check (user_id = auth.uid() and public.movie_visible(movie_id));

drop policy if exists circuit_ratings_update on public.circuit_ratings;
create policy circuit_ratings_update on public.circuit_ratings
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists circuit_ratings_delete on public.circuit_ratings;
create policy circuit_ratings_delete on public.circuit_ratings
  for delete to authenticated
  using (user_id = auth.uid());

-- the film row itself gains the friends path, and keeps everything it had
drop policy if exists circuit_movies_select on public.circuit_movies;
create policy circuit_movies_select on public.circuit_movies
  for select
  using (public.movie_visible(id));

-- ── the live board ──────────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.circuit_ratings;

-- ── migrate: one row per (film, account), from the blob ─────────────────────────────────────
insert into public.circuit_ratings (movie_id, user_id, score, icons, review, updated_at)
select m.id,
       p.owner_user_id,
       nullif(k.val ->> 'score', '')::int,
       k.val -> 'icons',
       k.val -> 'review',
       coalesce(m.updated_at, now())
from public.circuit_movies m
cross join lateral jsonb_each(coalesce(m.ratings, '{}'::jsonb)) as k(person_id, val)
join public.circuit_people p on p.id = k.person_id
where p.owner_user_id is not null
on conflict (movie_id, user_id) do nothing;

commit;

-- ── HOW TO CHECK IT WORKED ──────────────────────────────────────────────────────────────────
--   select count(*) from public.circuit_ratings;                          -- 469
--   select count(distinct user_id) from public.circuit_ratings;           -- 5
--   select count(*) from public.circuit_ratings where score is not null;  -- most of them
-- Then in the app: the review board should look EXACTLY as it did — same films, same faces,
-- same averages, same taste twins. Nothing about this is meant to be visible. The test that
-- matters is two people rating the same film at the same moment and both keeping their work.
--
-- ── WHAT IS STILL EVAN'S TO DO, LATER ───────────────────────────────────────────────────────
-- 1. `circuit_movies.ratings` is now dead — nothing reads it, nothing writes it — but it is left
--    in place ON PURPOSE so this script and the deploy can land in either order without a cached
--    older tab's save failing. Once the new build has been live a day or so:
--        alter table public.circuit_movies drop column ratings;
--
-- 2. Moving the board off circuits for real needs the friend graph filled in first — today it is
--    6 accepted friendships across 10 accounts, and 6 more still pending. Either everyone sends
--    the requests, or a one-time backfill makes everyone who shares a circuit friends:
--        insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
--        select distinct least(a.user_id, b.user_id), greatest(a.user_id, b.user_id),
--               least(a.user_id, b.user_id), 'accepted', now()
--        from public.circuit_group_members a
--        join public.circuit_group_members b on b.group_id = a.group_id and a.user_id < b.user_id
--        on conflict do nothing;
--    ⚠️ That creates friendships on other people's behalf, which is a decision about their
--    accounts and not one to make quietly. It is written out here, not run.
--    Once the graph is right, the circuit branch of movie_visible() is one line to delete.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
--   create policy circuit_movies_select on public.circuit_movies for select
--     using (circuit_is_member(group_id) or is_admin());   -- after dropping the new one
--   alter publication supabase_realtime drop table public.circuit_ratings;
--   drop table public.circuit_ratings;
--   drop function public.movie_visible(text);
-- The blob was never emptied, so the board comes back exactly as it is now.
