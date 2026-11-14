-- ROLLBACK for docs/2026-11-14-feed-made-and-comments.DRAFT.sql. ⛔ Not applied, like the draft.
--
-- In the reverse order of the draft, because feed_recent reads both new objects:
--   1. feed_recent loses the block the draft put in front of its final `return`, byte for byte
--      (the same substitution, reversed, raising unless it is found exactly once);
--   2. the trigger, its function, the table and the preview helper are dropped.
--
-- ⚠️ DROPPING profile_showcase FORGETS WHEN EACH THING FIRST WENT UP. Nothing else is lost: it
-- holds no member's words or work, only those moments, and nothing outside feed_recent reads it.
-- Applying the draft again would start them afresh, with everything then on a page marked as
-- "before the Feed kept track".
--
-- Afterwards, check A of docs/2026-11-14-feed-made-and-comments.checks.sql should read
-- 'as before the draft' (or '#304 only', if step 1 is applied) and show no new objects.

do $rollback$
declare
  v_old  constant text := $old$
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
$old$;
  v_new  constant text := $new$
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
  if v_hits <> 1 then raise exception 'expected 1 of the draft''s block in feed_recent, found %', v_hits; end if;

  execute replace(v_src, v_old, v_new);

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'feed_recent'
                and (p.prosrc like '%profile_showcase%' or p.prosrc like '%feed_preview%')) then
    raise exception 'feed_recent still reads what the draft added';
  end if;
end
$rollback$;

drop trigger profile_showcase_note on public.profile_blocks;
drop function public.profile_showcase_note();
drop table public.profile_showcase;
drop function public.feed_preview(text);
