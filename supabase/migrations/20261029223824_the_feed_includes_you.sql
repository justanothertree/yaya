-- ✅ APPLIED 29 Oct 2026 as `the_feed_includes_you`.
--
-- Corrects `one_feed_for_the_whole_site`, applied twenty minutes earlier, which left the feed
-- empty for the one person most likely to open it.
--
-- ⚠️ "THE FEED IS OTHER PEOPLE" WAS A REASONABLE RULE AND A WRONG ONE, and only measuring showed
-- which. It was copied from `chronicle_friends_log`, where it is right — that list sits beside
-- your own chronicle and answers "what have my friends been doing". Asked of the whole site it
-- produces this, measured as Evan over 31 days: **0 events**. Not because the site is quiet —
-- there were 7 circuit logs, 8 ratings, 4 snake scores and 2 trophies in that window — but
-- because every one of them is his. One person makes most of what happens here, and the rule
-- hid exactly that person's work from exactly that person.
--
-- A zero is the one result that looks the same whether the query is wrong or the world is empty,
-- which is why it was checked against the tables rather than believed. CLAUDE.md §2: a room with
-- nothing in it passes every check there is.
--
-- ⚠️ AND IT MAKES THE FEED A MIRROR, which is worth more than the row count. Your own sittings
-- appear here under the SAME gates a friend's do — shared activity, timeline card, visible tier —
-- so the feed answers "is my sharing actually on?" by showing you the thing itself. That is the
-- honest version of a privacy preview: not a sentence describing what others would see, but the
-- row they would see.
--
-- ⚠️ THE GATE IS EXTRACTED RATHER THAN COPIED. Two places now need "does this person publish a
-- timeline I may read" — the friends log and the feed's own-sittings half — and writing it twice
-- is how the two stop agreeing. `chronicle_shares_timeline` is that question, once. It takes the
-- owner and reads the viewer from `auth.uid()` through `can_see`, which is why it needs no second
-- argument and why it answers correctly for yourself: `can_see` returns true when the owner IS
-- the caller, so the same predicate serves both halves without a special case.
--
-- The per-activity `shared` flag stays in each query rather than joining the helper: it is one
-- column test on a row the query already has in hand, and pulling it into a function would mean
-- a second lookup of the activity to answer something the join already knows.
--
-- ⚠️ `chronicle_friends_log` IS REWRITTEN AND MUST NOT MOVE. It draws the Chronicle friends list.
-- Checked by staging a real member through all three gates in a rolled-back transaction before
-- and after: 4 sittings both times, same ids, same order.

create or replace function public.chronicle_shares_timeline(p_owner uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.profile_blocks b
     where b.user_id = p_owner
       and b.block_type = 'chronicle'
       and coalesce((b.config->>'timeline')::boolean, false)
       and public.can_see(p_owner, b.visibility));
$function$;

revoke all on function public.chronicle_shares_timeline(uuid) from public, anon;
grant execute on function public.chronicle_shares_timeline(uuid) to authenticated;

create or replace function public.chronicle_friends_log(p_from timestamp with time zone, p_to timestamp with time zone)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid := auth.uid();
  v_from timestamptz;
  v_to   timestamptz;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  -- the window is a convenience, never a boundary -- clamped so a caller cannot ask for the
  -- whole history of everybody they know in one round trip
  v_to   := least(coalesce(p_to, clock_timestamp()), clock_timestamp());
  v_from := greatest(coalesce(p_from, v_to - interval '7 days'), v_to - interval '31 days');
  if v_from >= v_to then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(t order by t.started_at desc, t.who, t.activity)
    from (
      select e.id::text                                     as id,
             p.username::text                               as who,
             coalesce(p.first_name, p.username::text)        as name,
             a.name                                          as activity,
             a.cat, a.colour,
             e.started_at, e.ended_at, e.amount, a.metric
        from public.chronicle_entries e
        join public.chronicle_activities a
          on a.id = e.activity and a.owner = e.owner
        join public.profiles p
          on p.user_id = e.owner and coalesce(p.suspended, false) = false
       where e.owner <> v_me
         and e.ended_at is not null
         and e.started_at < v_to
         and e.ended_at   > v_from
         and a.shared
         and public.are_friends(v_me, e.owner)
         and public.chronicle_shares_timeline(e.owner)
       order by e.started_at desc
       limit 400
    ) t
  ), '[]'::jsonb);
end $function$;

create or replace function public.feed_recent(
  p_from timestamp with time zone default null,
  p_to   timestamp with time zone default null,
  p_per_member integer default 40
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me   uuid := auth.uid();
  v_from timestamptz;
  v_to   timestamptz;
  v_rows jsonb := '[]'::jsonb;
  r      record;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  v_to   := least(coalesce(p_to, clock_timestamp()), clock_timestamp());
  v_from := greatest(coalesce(p_from, v_to - interval '14 days'), v_to - interval '31 days');
  if v_from >= v_to then return '[]'::jsonb; end if;
  p_per_member := least(greatest(coalesce(p_per_member, 40), 1), 100);

  /* Every member, the caller included -- see the header. Each call gates itself on that member's
     own tier, so this loop never decides anything about who may read what. `mine` rides along so
     the client can say "You" rather than guessing from a username it would have to fetch. */
  for r in
    select p.user_id,
           p.username::text as who,
           coalesce(p.first_name, p.username::text) as name
      from public.profiles p
     where coalesce(p.suspended, false) = false
     order by p.username
  loop
    v_rows := v_rows || coalesce((
      select jsonb_agg(e || jsonb_build_object('who', r.who, 'name', r.name,
                                               'mine', r.user_id = v_me))
        from jsonb_array_elements(public.get_member_activity(r.who, p_per_member)) e
       where e ? 'at'
         and (e->>'at')::timestamptz >= v_from
         and (e->>'at')::timestamptz <  v_to
    ), '[]'::jsonb);
  end loop;

  /* Friends' sittings, already friends-only and already gated, renamed into the feed's own
     vocabulary here rather than in the client so one shape arrives rather than two. */
  v_rows := v_rows || coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind',   'sitting',      'id',     s->>'id',
             'who',    s->>'who',      'name',   s->>'name',
             'at',     s->>'started_at', 'until', s->>'ended_at',
             'detail', s->>'activity', 'score',  null,
             'colour', s->'colour',    'amount', s->'amount',
             'metric', s->'metric',    'mine',   false))
      from jsonb_array_elements(public.chronicle_friends_log(v_from, v_to)) s
  ), '[]'::jsonb);

  /* ⚠️ YOUR OWN SITTINGS, UNDER THE GATES A FRIEND WOULD MEET. Not everything you did -- only
     what you have actually shared, so that seeing it here means a friend sees it too. A sitting
     of yours missing from this list is the truthful answer to "why can nobody see my chronicle". */
  v_rows := v_rows || coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind',   'sitting',       'id',     e.id::text,
             'who',    p.username::text,
             'name',   coalesce(p.first_name, p.username::text),
             'at',     e.started_at,    'until',  e.ended_at,
             'detail', a.name,          'score',  null,
             'colour', to_jsonb(a.colour), 'amount', to_jsonb(e.amount),
             'metric', to_jsonb(a.metric), 'mine', true))
      from public.chronicle_entries e
      join public.chronicle_activities a on a.id = e.activity and a.owner = e.owner
      join public.profiles p on p.user_id = e.owner
     where e.owner = v_me
       and e.ended_at is not null
       and e.started_at < v_to
       and e.ended_at   > v_from
       and a.shared
       and public.chronicle_shares_timeline(v_me)
  ), '[]'::jsonb);

  /* Newest first, and bounded. The client merges and sorts again -- it has to, because it holds
     the previous window -- but a server that hands back an unbounded blob is a server that will
     one day hand back a very large one. */
  return coalesce((
    select jsonb_agg(q.e order by (q.e->>'at')::timestamptz desc)
      from (select e
              from jsonb_array_elements(v_rows) e
             order by (e->>'at')::timestamptz desc
             limit 300) q(e)
  ), '[]'::jsonb);
end
$function$;

revoke all on function public.feed_recent(timestamp with time zone, timestamp with time zone, integer) from public, anon;
grant execute on function public.feed_recent(timestamp with time zone, timestamp with time zone, integer) to authenticated;
