-- ✅ APPLIED 3 Nov 2026 as `a_just_me_film_stays_just_me`.
--
-- ⚠️ THE 3 NOV "JUST-ME POOL PUBLISHES NOWHERE" FIX DID NOT WORK, AND THE CLIENT WAS
-- NOT THE PROBLEM. `rateIt` correctly inserted the film with a null group. A BEFORE INSERT
-- trigger, `trg_circuit_movies_default_group`, then filled it with
-- `select group_id from circuit_group_members where user_id = auth.uid() limit 1` -- no ORDER
-- BY, so an ARBITRARY group of theirs. The pick was published to a board chosen by whichever
-- row the planner returned. Measured: inserting with a null group stored a real group.
--
-- ⚠️ AND "NO GROUP" WAS NOT A STORABLE STATE ANYWAY, which is why deleting the
-- trigger alone would have made things worse rather than better. A null-group film is not
-- `movie_visible` to ANYBODY -- not even its maker, because the only other branch is "you have
-- rated it" and a new film has no ratings -- so it could not be rated, which is the single
-- thing it exists for. And the insert policy refused it outright for anyone in no group.
--
-- So the film needs an owner, and `circuit_movies` recorded none. Same shape as
-- `circuit_watchlist.added_by` the day before: a rule that could not be expressed because the
-- column did not exist. `created_by` is stamped by a trigger and pinned on UPDATE, `movie_visible`
-- lets the creator through, and the insert / update / delete policies all learn that a null
-- group is a real state -- otherwise a group-less film could not be edited or deleted by the
-- person who made it.
--
-- Measured in a rolled-back transaction:
--   insert with group_id null          stays null
--   created_by                         the caller
--   the creator can see it             true
--   the creator can rate it            ok      <- the thing it is for
--   another member can see it          false, and it is not in their SELECT
--   a member in NO group creates one   ok      (the insert policy used to refuse this)
--   and deletes their own              ok
--
-- The same trigger is on `circuit_watchlist` and stays there for genuinely group-based options,
-- but no longer fires for POOLED ones: all four pooled rows carried a group it had stamped on
-- them. Inert while the pool branch is tested first -- and a row that ever lost its pool would
-- fall into a circuit nobody put it in.

/* ⚠️ THE CLIENT ASKED FOR NO GROUP AND A TRIGGER PICKED ONE ANYWAY. `rateIt` was changed on
   3 Nov to publish nowhere for a just-me pool, by inserting the film with a null group. It did
   not work: `trg_circuit_movies_default_group` fires BEFORE INSERT and fills a null group_id
   with

       select group_id from circuit_group_members where user_id = auth.uid() limit 1

   -- no ORDER BY, so an ARBITRARY group of theirs. The pick was published after all, to a board
   chosen by whichever row the planner happened to return. Measured: inserting with group_id null
   stored a real group of the caller's.

   ⚠️ AND "NO GROUP" WAS NOT A STORABLE STATE ANYWAY, which is the half that makes this more than
   deleting a trigger. A film with a null group is not `movie_visible` to anybody -- not even the
   person who made it, because the only other branch is "you have rated it" and a brand-new film
   has no ratings. So it could not be rated, which is the one thing it was created for. The
   insert policy refused it outright for anyone in no group at all.

   So a just-me film needs an owner, and `circuit_movies` did not record one. Same shape as
   `circuit_watchlist.added_by` the day before: the rule could not be expressed because the
   column did not exist. */
drop trigger if exists trg_circuit_movies_default_group on public.circuit_movies;

alter table public.circuit_movies
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create or replace function public.circuit_movie_stamp_creator()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  /* stamped on INSERT and pinned on UPDATE -- editing a title must not be a way to take
     ownership of somebody else's film, the same rule watchlist_stamp_adder keeps */
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
  end if;
  return new;
end $function$;

revoke all on function public.circuit_movie_stamp_creator() from public, anon, authenticated;

drop trigger if exists circuit_movies_stamp_creator on public.circuit_movies;
create trigger circuit_movies_stamp_creator
  before insert or update on public.circuit_movies
  for each row execute function public.circuit_movie_stamp_creator();

/* ⚠️ THE CREATOR SEES THEIR OWN FILM, which is what makes a group-less one usable at all. It is
   the same principle as the `r.user_id = auth.uid()` branch already here: what you made or wrote
   does not vanish from your own screen because of where it does or does not belong. */
create or replace function public.movie_visible(p_movie text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  /* ⚠️ A FILM NEEDS THE GROUP, NOT A FRIEND. This used to end
         or are_friends(auth.uid(), r.user_id)
     so a film reached you because somebody you know rated it -- even if you had never been in
     the group that watched it. A film belongs to the GROUP it was watched in, not to whoever
     happened to rate it.

     ⚠️ `r.user_id = auth.uid()` STAYS: somebody who leaves a group must keep seeing the ratings
     they wrote. `m.created_by = auth.uid()` is the same idea for a film with no group at all --
     a just-me pick from a just-me pool, which nobody else should see and its own maker must. */
  select exists (
    select 1 from public.circuit_movies m
    where m.id = p_movie
      and (
        public.circuit_is_member(m.group_id)
        or m.created_by = auth.uid()
        or exists (
          select 1 from public.circuit_ratings r
          where r.movie_id = m.id and r.user_id = auth.uid())
      )
  );
$function$;

/* A null group is now a real state, so the three policies that assumed a group have to say so.
   `created_by` is stamped by the trigger above, so a row with a null group always belongs to
   whoever made it -- there is no way to insert one on somebody else's behalf. */
drop policy if exists circuit_movies_insert on public.circuit_movies;
create policy circuit_movies_insert on public.circuit_movies
  for insert to authenticated
  with check (
    public.circuit_is_member(group_id)
    or (group_id is null and auth.uid() is not null)
    or public.is_admin()
  );

drop policy if exists circuit_movies_update on public.circuit_movies;
create policy circuit_movies_update on public.circuit_movies
  for update to authenticated
  using (public.circuit_is_member(group_id) or created_by = auth.uid() or public.is_admin());

drop policy if exists circuit_movies_delete on public.circuit_movies;
create policy circuit_movies_delete on public.circuit_movies
  for delete to authenticated
  using (public.circuit_is_member(group_id) or created_by = auth.uid() or public.is_admin());

/* ⚠️ AND THE SAME TRIGGER IS ON `circuit_watchlist`, where it is quieter but still wrong. All
   four rows there are pooled, and all four carry a group the trigger stamped on them. The
   watchlist policies test `pool_id` first, so the stray group is inert -- until a row loses its
   pool, at which point it falls into a circuit it was never put in. A pooled option belongs to
   its pool; it has no business acquiring a group on the way in.

   The trigger stays for genuinely group-based options, which is what it was written for. */
create or replace function public.circuit_default_group()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  /* only reachable from circuit_watchlist now -- the circuit_movies trigger is dropped above.
     The table name is checked first so `new.pool_id` is never evaluated on a table without it. */
  if tg_table_name = 'circuit_watchlist' and new.pool_id is not null then
    return new;
  end if;
  if new.group_id is null then
    new.group_id := (select group_id from public.circuit_group_members
                      where user_id = auth.uid() limit 1);
  end if;
  return new;
end;
$function$;
