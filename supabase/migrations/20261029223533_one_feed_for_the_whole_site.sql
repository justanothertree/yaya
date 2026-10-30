-- ✅ APPLIED 29 Oct 2026 as `one_feed_for_the_whole_site`.
--
-- One feed carrying everything the site can show, instead of four rooms each keeping its own.
--
-- ⚠️ IT CALLS THE EXISTING FUNCTIONS RATHER THAN REPEATING THEIR RULES, and that is the whole
-- design. `get_member_activity` already decides who may see a circuit log, a rating, a snake
-- score and a trophy — four different answers, one of them deferring to `movie_visible` and
-- another to circuit group membership — and `chronicle_friends_log` already decides who may see
-- a sitting, behind four gates of its own. Writing those predicates out again here would make a
-- second copy that agrees with the first until the day somebody changes one of them. CLAUDE.md
-- has that lesson twice over about the park's stub relay: when a guard exists on the server,
-- copy it in the server's own words — and the strongest form of copying it is not copying it.
--
-- So this function contains NO visibility logic at all. It picks who to ask and merges the
-- answers. If a member is at `activity_visibility = 'private'` they contribute nothing, because
-- the function being asked says so; six of fourteen are, today, and that is their choice rather
-- than a setting this file gets a vote on.
--
-- ⚠️ THE FEED IS OTHER PEOPLE, which is a decision rather than an oversight. `chronicle_friends_log`
-- excludes `e.owner = v_me` deliberately — it answers "what your friends have been doing" — and a
-- feed that included your own sittings but not your own, er, own sittings would be incoherent in
-- exactly one direction. Rather than loosen that function, the member loop skips the caller too,
-- so the rule is the same for all five kinds. Your own day is what Chronicle is for.
--
-- ⚠️ THE WINDOW IS CLAMPED, SAME AS THE CHRONICLE'S. A caller cannot ask for the whole history of
-- everybody they know in one round trip; 31 days is the ceiling and 14 the default. The per-member
-- cap is separate and also bounded, because `get_member_activity` orders by time before it
-- truncates — so asking for 40 gets the newest 40, not an arbitrary 40.
--
-- ⚠️ AND IT IS `authenticated` ONLY. A revoke aimed at PUBLIC leaves `anon` holding execute in
-- this project — anon is granted directly by the schema's default ACL, which hands `arwdDxtm` to
-- anon and authenticated on everything new. So: revoke from public AND anon, then grant.

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

  /* The four instant kinds, asked of each member in turn. Every call gates itself on that
     member's own tier, so this loop never decides anything about who may read what. */
  for r in
    select p.username::text as who,
           coalesce(p.first_name, p.username::text) as name
      from public.profiles p
     where coalesce(p.suspended, false) = false
       and p.user_id <> v_me
     order by p.username
  loop
    v_rows := v_rows || coalesce((
      select jsonb_agg(e || jsonb_build_object('who', r.who, 'name', r.name))
        from jsonb_array_elements(public.get_member_activity(r.who, p_per_member)) e
       where e ? 'at'
         and (e->>'at')::timestamptz >= v_from
         and (e->>'at')::timestamptz <  v_to
    ), '[]'::jsonb);
  end loop;

  /* Sittings, which already carry who they belong to and are already friends-only. Renamed into
     the feed's own vocabulary here rather than in the client, so one shape arrives rather than
     two: `activity` is the event's `detail`, and the pair of timestamps becomes at/until. */
  v_rows := v_rows || coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind',   'sitting',
             'id',     s->>'id',
             'who',    s->>'who',
             'name',   s->>'name',
             'at',     s->>'started_at',
             'until',  s->>'ended_at',
             'detail', s->>'activity',
             'score',  null,
             'colour', s->'colour',
             'amount', s->'amount',
             'metric', s->'metric'))
      from jsonb_array_elements(public.chronicle_friends_log(v_from, v_to)) s
  ), '[]'::jsonb);

  /* Newest first, and bounded. The client merges and sorts again — it has to, because it holds
     the previous window — but a server that hands back an unbounded blob is a server that will
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
