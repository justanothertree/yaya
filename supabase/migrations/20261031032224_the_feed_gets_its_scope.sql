-- ✅ APPLIED 31 Oct 2026 as `the_feed_gets_its_scope`.
--
-- Phase 6 of docs/2026-10-30-one-visibility-ladder-plan.md: the feed defaults to you and your
-- friends, with all members as a deliberate second tab.
--
-- ⚠️ IT IS A DROP AND CREATE RATHER THAN A REPLACE, because adding a fourth parameter to a
-- function does not replace the three-parameter one -- it OVERLOADS it, and two `feed_recent`s
-- would leave PostgREST choosing between them. Checked first that nothing in the database calls
-- it: no function body mentions it and no policy expression does, so the only caller is the
-- client. Afterwards there is exactly one `feed_recent` in the schema.
--
-- ⚠️ SCOPE IS A FILTER, NOT A BOUNDARY, and that decides what an unknown value does. Every
-- event in the feed has already been through `can_see` by way of `get_member_activity`, so
-- `all_members` is not a wider permission -- it is a wider list of people to ask, and it cannot
-- show anybody anything `you_and_friends` was hiding on purpose. That is why an unrecognised
-- scope RAISES rather than quietly falling back to the narrow one: a typo is a programming
-- mistake, silently narrowing would hide it, and there is no over-sharing to fail closed
-- against. A null or empty scope is a different thing -- nothing was said -- and falls back.
--
-- ⚠️ THE REWRITE WAS CHECKED AGAINST A BEHAVIOURAL BASELINE, not by reading it. The body is
-- long and was retyped to add six lines, which is exactly the transcription risk CLAUDE.md
-- names. So the feed was md5'd for all 14 members over a fixed window before the change, and
-- compared after:
--
--   before, the old three-argument function      1,586 events   md5 ec7583ae...
--   after, p_scope = 'all_members'               1,586 events   md5 ec7583ae...   IDENTICAL
--   after, p_scope = 'you_and_friends'           1,569 events   md5 e4daf927...
--   after, no scope passed at all                1,569 events   md5 e4daf927...   = the default
--
-- So the wide scope reproduces the old behaviour exactly -- nothing was garbled -- and the new
-- default narrows deliberately, which is the change that was asked for.
--
-- ⚠️ THE NARROWING IS SMALL TODAY AND THAT IS NOT A BUG. Only one member's feed changed at all
-- (17 events to 0, somebody with no accepted friendships). For the other thirteen the two scopes
-- are identical, because `get_member_activity` already filters by `can_see` -- a non-friend
-- whose things are private contributes nothing to either scope, so leaving them out of the list
-- of people to ask changes nothing. The tab earns its keep as the site grows and as people set
-- things to the members tier; it is not doing much work yet, and the figures say so rather than
-- implying otherwise.
--
-- Sittings are unchanged under both scopes: `chronicle_friends_log` asks only about friends by
-- construction, and a sitting-by-sitting timeline is friends-only by design, so `all_members`
-- deliberately does not widen that block.
--
-- Verified: anon and PUBLIC cannot execute; members can. An unknown scope is refused by name.
-- Surrounding whitespace is trimmed. Null and empty fall back to you_and_friends.

drop function if exists public.feed_recent(timestamptz, timestamptz, integer);

create or replace function public.feed_recent(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_per_member integer default 40,
  p_scope text default 'you_and_friends')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me   uuid := auth.uid();
  v_from timestamptz;
  v_to   timestamptz;
  v_rows jsonb := '[]'::jsonb;
  v_all  boolean;
  r      record;
begin
  if v_me is null then raise exception 'not authenticated'; end if;

  /* ⚠️ SCOPE IS A FILTER, NOT A BOUNDARY, and the difference decides what an unknown value does.
     Every event in here has already been through `can_see` by way of `get_member_activity`, so
     neither scope can show anybody anything the other would have hidden -- `all_members` is not
     a wider permission, it is a wider list of people to ask. That is why an unrecognised scope
     RAISES instead of quietly falling back to the narrow one: a typo is a programming mistake,
     silently narrowing would hide it, and there is no over-sharing to fail closed against. */
  p_scope := coalesce(nullif(btrim(p_scope), ''), 'you_and_friends');
  if p_scope not in ('you_and_friends', 'all_members') then
    raise exception 'unknown feed scope: %', p_scope;
  end if;
  v_all := p_scope = 'all_members';

  v_to   := least(coalesce(p_to, clock_timestamp()), clock_timestamp());
  v_from := greatest(coalesce(p_from, v_to - interval '14 days'), v_to - interval '31 days');
  if v_from >= v_to then return '[]'::jsonb; end if;
  p_per_member := least(greatest(coalesce(p_per_member, 40), 1), 100);

  for r in
    select p.user_id,
           p.username::text as who,
           coalesce(p.first_name, p.username::text) as name
      from public.profiles p
     where coalesce(p.suspended, false) = false
       and public.feed_may_show(p.user_id)
       /* `you_and_friends` is you plus accepted friends. are_friends answers NULL for a question
          about two other people, which cannot happen here because one side is always v_me. */
       and (v_all
            or p.user_id = v_me
            or coalesce(public.are_friends(v_me, p.user_id), false))
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

  /* Sittings are friends-only wherever they appear -- `chronicle_friends_log` asks only about
     friends by construction -- so this block is the same under both scopes. `all_members` does
     not widen it, because a sitting-by-sitting timeline is not a members-tier thing. */
  v_rows := v_rows || coalesce((
    select jsonb_agg(jsonb_build_object(
             'kind',   'sitting',      'id',     s->>'id',
             'who',    s->>'who',      'name',   s->>'name',
             'at',     s->>'started_at', 'until', s->>'ended_at',
             'detail', s->>'activity', 'score',  null,
             'colour', s->'colour',    'amount', s->'amount',
             'metric', s->'metric',    'mine',   false))
      from jsonb_array_elements(public.chronicle_friends_log(v_from, v_to)) s
      join public.profiles p on p.username::text = s->>'who'
     where public.feed_may_show(p.user_id)
  ), '[]'::jsonb);

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

  return coalesce((
    select jsonb_agg(q.e order by (q.e->>'at')::timestamptz desc)
      from (select e
              from jsonb_array_elements(v_rows) e
             order by (e->>'at')::timestamptz desc
             limit 300) q(e)
  ), '[]'::jsonb);
end
$function$;

revoke all on function public.feed_recent(timestamptz, timestamptz, integer, text) from public, anon;
grant execute on function public.feed_recent(timestamptz, timestamptz, integer, text) to authenticated;
