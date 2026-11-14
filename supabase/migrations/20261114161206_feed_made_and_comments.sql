-- ✅ APPLIED to production 14 Nov 2026 (stamped 20261114161206 in UTC) as migration
-- `feed_made_and_comments`, step 3 of the Feed plan (#301), from #317, on top of steps 1 and 2.
-- Production recorded md5(statements[1]) = 89485346b07019d0e21a538bba33cc90, this file's body
-- byte for byte (supabase/migrations/applied.md5).
--
-- The Feed gains things made (a song, drawing, pet or look first reaching a page above Only me)
-- and comments from workouts, Lab toys and guestbooks with an 80-character preview, each read by
-- its own room's rule. New: profile_showcase (deny-all), its backfill, the profile_showcase_note
-- trigger on profile_blocks, and feed_preview; feed_recent gains one block in front of its final
-- return. The body is docs/2026-11-14-feed-made-and-comments.DRAFT.sql after its leading comment
-- block, which holds the reasoning; its ROLLBACK and read-only checks sit beside it. The one-a-day
-- cap on things made is the client's (oneMadePerDay), not this SQL's.
--
-- Before it, check A read `#304 only` with no new objects; the backfill wrote 12 rows (2 art,
-- 1 looks, 3 pet, 6 song), none announced. After it, `the draft and #304 are applied` with four
-- new objects, and check C showed none reachable by anon or authenticated, feed_recent still
-- signed-in only, RLS on with 0 policies. The trigger is not in supabase/baseline/02-triggers.sql
-- yet: the dump CI builds from lacks its table and function (see the draft's header).

-- ── the first moment each made thing reached a page ──────────────────────────────────────────
create table public.profile_showcase (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (user_id) on delete cascade,
  block_type text not null check (block_type in ('song', 'art', 'pet', 'looks')),
  config_md5 text not null check (config_md5 ~ '^[0-9a-f]{32}$'),
  /* null: on a page before the Feed kept track, so never announced */
  first_shown_at timestamptz,
  unique (owner, block_type, config_md5)
);
create index profile_showcase_recent on public.profile_showcase (first_shown_at)
  where first_shown_at is not null;

alter table public.profile_showcase enable row level security;
/* the schema's default ACL grants every new table to anon and authenticated: take it all back,
   TRUNCATE included, which no RLS policy can stop */
revoke all on table public.profile_showcase from public, anon, authenticated;

insert into public.profile_showcase (owner, block_type, config_md5, first_shown_at)
select b.user_id, b.block_type, md5(b.config::text), null
  from public.profile_blocks b
 where b.block_type in ('song', 'art', 'pet', 'looks')
   and b.visibility <> 'private'
on conflict (owner, block_type, config_md5) do nothing;

create function public.profile_showcase_note()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.block_type in ('song', 'art', 'pet', 'looks') and new.visibility <> 'private' then
    insert into public.profile_showcase (owner, block_type, config_md5, first_shown_at)
    values (new.user_id, new.block_type, md5(new.config::text), clock_timestamp())
    on conflict (owner, block_type, config_md5) do nothing;
  end if;
  return null;
end
$$;
revoke all on function public.profile_showcase_note() from public, anon, authenticated;

create trigger profile_showcase_note
  after insert or update of block_type, config, visibility on public.profile_blocks
  for each row execute function public.profile_showcase_note();

-- ── the preview ───────────────────────────────────────────────────────────────────────────────
create function public.feed_preview(p_body text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when char_length(t) > 80 then rtrim(left(t, 79)) || '…' else t end
    from (select btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g')) as t) x
$$;
revoke all on function public.feed_preview(text) from public, anon, authenticated;

-- ── the Feed reads them ───────────────────────────────────────────────────────────────────────
do $mig$
declare
  v_old  constant text := $old$
  return coalesce((
    select jsonb_agg(q.e order by (q.e->>'at')::timestamptz desc)
$old$;
  v_new  constant text := $new$
  /* ⚠️ THINGS MADE, AND COMMENTS -- docs/2026-11-14-feed-made-and-comments.DRAFT.sql. One set
     rather than a call per member, of the same people the loop above asks about by the same three
     rules. Each source keeps the rule its own room's reader applies, so the Feed never shows a
     comment or a block that room would not. Never in get_member_activity: that one also feeds
     public pages, which signed-out visitors load. */
  v_rows := v_rows || coalesce((
    select jsonb_agg(x.e)
      from (
        select ev.e || jsonb_build_object('who', p.username::text,
                                          'name', coalesce(p.first_name, p.username::text),
                                          'mine', p.user_id = v_me) as e,
               row_number() over (partition by ev.actor, ev.e->>'kind'
                                  order by (ev.e->>'at')::timestamptz desc) as n
          from (
            /* a comment on a workout: clc_select's rule, and the RESTRICTIVE policy beside it */
            select c.user_id as actor,
                   jsonb_build_object('kind', 'comment', 'id', 'workout:' || c.id::text,
                                      'at', c.created_at, 'detail', public.feed_preview(c.body),
                                      'score', null, 'on', 'workout', 'about', cp.name,
                                      'about_who', null,
                                      'about_mine', cp.owner_user_id = v_me) as e
              from public.circuit_log_comments c
              join public.circuit_logs l on l.id = c.log_id
              join public.circuit_people cp on cp.id = l.person_id
             where c.created_at >= v_from and c.created_at < v_to
               and not coalesce(public.is_suspended(v_me), false)
               and public.circuit_can_see_log(c.log_id)
            union all
            /* a note on a Lab toy: lab_comments_page's rules, never a removed one */
            select c.user_id,
                   jsonb_build_object('kind', 'comment', 'id', 'lab:' || c.id::text,
                                      'at', c.created_at, 'detail', public.feed_preview(c.body),
                                      'score', null, 'on', 'lab', 'about', c.demo_id,
                                      'about_who', null, 'about_mine', false)
              from public.lab_comments c
              join public.lab_demos d on d.id = c.demo_id
             where c.created_at >= v_from and c.created_at < v_to
               and c.removed_at is null
               and not d.hidden
               and public.lab_can_read_comment(c.user_id, false)
            union all
            /* a note in a guestbook: list_profile_notes' rules */
            select n.author_user_id,
                   jsonb_build_object('kind', 'comment', 'id', 'guestbook:' || n.id::text,
                                      'at', n.created_at, 'detail', public.feed_preview(n.body),
                                      'score', null, 'on', 'guestbook',
                                      'about', coalesce(o.first_name, o.username::text),
                                      'about_who', o.username::text,
                                      'about_mine', n.profile_user_id = v_me)
              from public.profile_notes n
              join public.profiles o on o.user_id = n.profile_user_id
             where n.created_at >= v_from and n.created_at < v_to
               and coalesce(o.suspended, false) = false
               and public.guestbook_open_to(n.profile_user_id)
            union all
            /* something made, put on a page: the block's own level. Your own shows only while it
               reaches somebody, as your own sittings do, so seeing it here means it is out there. */
            select s.owner,
                   jsonb_build_object('kind', 'made', 'id', s.id::text,
                                      'at', s.first_shown_at, 'detail', s.block_type,
                                      'score', null)
              from public.profile_showcase s
             where s.first_shown_at >= v_from and s.first_shown_at < v_to
               and exists (
                 select 1 from public.profile_blocks b
                  where b.user_id = s.owner and b.block_type = s.block_type
                    and md5(b.config::text) = s.config_md5
                    and case when b.user_id = v_me
                             then public.item_reaches_anyone(v_me, b.visibility,
                                                             'profile_block', b.id::text)
                             else public.can_see_item(b.user_id, b.visibility,
                                                      'profile_block', b.id::text)
                        end)
          ) ev
          join public.profiles p on p.user_id = ev.actor
         where coalesce(p.suspended, false) = false
           and public.feed_may_show(p.user_id)
           and (v_all
                or p.user_id = v_me
                or coalesce(public.are_friends(v_me, p.user_id), false))
      ) x
     where x.n <= p_per_member
  ), '[]'::jsonb);

  return coalesce((
    select jsonb_agg(q.e order by (q.e->>'at')::timestamptz desc)
$new$;
  v_src  text;
  v_hits int;
  v_defs int;
begin
  select count(*) into v_defs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent';
  if v_defs <> 1 then raise exception 'expected one definition of feed_recent, found %', v_defs; end if;

  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent';

  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  if v_hits <> 1 then raise exception 'expected 1 of the final return in feed_recent, found %', v_hits; end if;

  execute replace(v_src, v_old, v_new);

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent'
         and p.prosrc like '%THINGS MADE, AND COMMENTS%') <> 1 then
    raise exception 'feed_recent does not carry the new block';
  end if;
end
$mig$;
