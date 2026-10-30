-- ✅ APPLIED 30 Oct 2026 as `feed_waits_for_an_adult`.
--
-- An interim guard, standing until the shared visibility ladder is built: no minor's activity
-- reaches somebody else's feed without an explicit yes.
--
-- ⚠️ NULL IS TREATED AS A MINOR, AND THAT IS THE WHOLE MECHANISM. Nothing in this database knew
-- anybody's age when this was written, and a guarantee about minors cannot be built on a guess
-- about who they are. So `age_band` is adult | minor | null, and the feed asks for `age_band =
-- 'adult' or feed_opt_in` — which means an unmarked account contributes nothing to anyone else's
-- feed. It fails quiet rather than fails open, and the cost is that the feed stays thin until
-- somebody is marked.
--
-- ⚠️ IT IS SCOPED TO THE FEED AND NOTHING ELSE. Profiles, the Circuit, Chronicle and ratings are
-- untouched: this narrows one surface that is four hours old rather than reaching into features
-- people already rely on. Widening it is the ladder's job, deliberately, because that is a design
-- with a migration plan rather than a guard applied in a hurry.
--
-- ⚠️ YOUR OWN EVENTS ARE ALWAYS YOURS. `feed_may_show` answers true for `auth.uid()` before it
-- looks at anything else — the question here is what OTHER people may see, and a feed that hid
-- you from yourself would be a bug wearing a safety rule's clothes.
--
-- ⚠️ ONE ROW IS SET: `evan` to 'adult'. It is the site owner's own account, he is the admin who
-- asked for this guard, and — the part that decides it — marking him adult PRESERVES today's
-- behaviour where leaving him unknown would narrow it. His activity_visibility is already
-- 'public'. Every other account is left unknown, which is the safe direction, and the feed will
-- be quiet about them until they are marked. Nobody's visibility widens by one row.
--
-- ⚠️ CONSENT IS ADMIN-SET, NOT SELF-SET. For a minor the consent that counts is a guardian's, and
-- a checkbox the minor can tick themselves is not that. `admin_set_feed_consent` takes null to
-- mean "I am not talking about this field" — the §8 rule — so setting a band does not silently
-- reset an opt-in, and 'unknown' is how a band is cleared.

alter table public.profiles
  add column if not exists age_band text,
  add column if not exists feed_opt_in boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_age_band_check') then
    alter table public.profiles
      add constraint profiles_age_band_check check (age_band is null or age_band in ('adult','minor'));
  end if;
end $$;

comment on column public.profiles.age_band is
  'adult | minor | null = not yet established. NULL IS NOT "adult" -- the feed treats unknown as a minor, because a guarantee about minors cannot be built on a guess about who they are.';
comment on column public.profiles.feed_opt_in is
  'An explicit yes to appearing in other people''s feeds, for anyone not established as an adult. Admin-set for now: for a minor the consent that matters is a guardian''s.';

create or replace function public.feed_may_show(p_owner uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select p_owner = auth.uid()
      or exists (select 1 from public.profiles p
                  where p.user_id = p_owner
                    and (p.age_band = 'adult' or p.feed_opt_in));
$function$;

revoke all on function public.feed_may_show(uuid) from public, anon;
grant execute on function public.feed_may_show(uuid) to authenticated;

create or replace function public.admin_set_feed_consent(
  p_username text, p_age_band text default null, p_feed_opt_in boolean default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_uid uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_age_band is not null and p_age_band not in ('adult','minor','unknown') then
    raise exception 'age band must be adult, minor or unknown';
  end if;
  select user_id into v_uid from public.profiles where lower(username) = lower(p_username);
  if v_uid is null then raise exception 'no such member'; end if;
  update public.profiles
     set age_band = case when p_age_band is null then age_band
                         when p_age_band = 'unknown' then null
                         else p_age_band end,
         feed_opt_in = coalesce(p_feed_opt_in, feed_opt_in)
   where user_id = v_uid;
  return (select jsonb_build_object('username', username, 'age_band', age_band,
                                    'feed_opt_in', feed_opt_in, 'in_feed', age_band = 'adult' or feed_opt_in)
            from public.profiles where user_id = v_uid);
end $function$;

revoke all on function public.admin_set_feed_consent(text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_feed_consent(text, text, boolean) to authenticated;

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

  for r in
    select p.user_id,
           p.username::text as who,
           coalesce(p.first_name, p.username::text) as name
      from public.profiles p
     where coalesce(p.suspended, false) = false
       and public.feed_may_show(p.user_id)
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

revoke all on function public.feed_recent(timestamp with time zone, timestamp with time zone, integer) from public, anon;
grant execute on function public.feed_recent(timestamp with time zone, timestamp with time zone, integer) to authenticated;

update public.profiles set age_band = 'adult' where username = 'evan' and age_band is null;
