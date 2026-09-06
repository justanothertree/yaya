-- 2026-09-06 — achievements for every module, derived rather than awarded
--
-- WHY: trophies existed but only for Snake, hanging off a leaderboard row. The ask was one per
-- module — circuit, snake, paint, visual, profile, instrument, reviewer — shown on your page.
--
--
-- ⚠️ DERIVED FROM DATA YOU ALREADY HAVE, NOT WRITTEN WHEN YOU EARN THEM.
--
-- The obvious build is an `achievements` table plus a write wherever a condition is met. It is
-- also the wrong one here, for three reasons:
--
--   · RETROACTIVE. There are 676 circuit logs, 469 ratings and a year of use already on this
--     site. An awarded system starts empty and only fills going forward, so on the day it ships
--     the person who has logged every day for a year has nothing — which reads as broken, not as
--     new.
--   · NO WRITE POINTS. An awarded system needs a hook in every module, and the hook that gets
--     forgotten is invisible: nobody notices an achievement that never fires.
--   · IT CANNOT DRIFT. The definition and the check are the same expression, so an achievement
--     cannot disagree with the data it describes.
--
-- Same instinct as list_activity_notices, which derives the whole bell from the tables rather
-- than keeping a notifications table.
--
--
-- ⚠️ WHAT COUNTS IS MAKING SOMETHING, NOT USING SOMETHING.
--
-- Paint, the instrument and the visualiser keep nothing on the server — the paint gallery is
-- localStorage, and neither of the other two records anything at all. Checked before designing
-- this: there is no drawings table, no play history, nothing.
--
-- So they could only have achievements if the site started counting visits, which is usage
-- telemetry on your friends and a worse thing to build. What they DO leave is a profile block:
-- an `art` block is a drawing you kept, a `song` block is something you wrote, a `visualizer`
-- block is a look you thought was worth keeping. That is a better signal anyway — it rewards
-- making something rather than opening a tab.
--
--
-- ⚠️ Locked ones are returned too, with their progress. An achievement you cannot see is not a
-- goal, it is a surprise — and a wall of grey with "3/10" on it is the half that makes the
-- earned ones mean anything.

create or replace function public.list_achievements(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_viewer uuid := auth.uid();
  v_target uuid;
  v_tier public.visibility_tier;
  -- the counts every rule below is written against, gathered once
  v_days int;
  v_streak int;
  v_ratings int;
  v_written int;
  v_snake int;
  v_best int;
  v_gold int;
  v_blocks int;
  v_art int;
  v_song int;
  v_viz int;
begin
  if v_viewer is null then raise exception 'not authenticated'; end if;
  select p.user_id, p.activity_visibility into v_target, v_tier
  from public.profiles p
  where lower(p.username) = lower(p_username) and coalesce(p.suspended, false) = false;
  -- the same gate get_member_trophies uses: a page you cannot see has no achievements to show
  if v_target is null or not public.can_see(v_target, v_tier) then return '[]'::jsonb; end if;

  select count(distinct l.date) into v_days
  from public.circuit_logs l
  join public.circuit_people cp on cp.id = l.person_id
  where cp.owner_user_id = v_target;

  /**
   * The longest run of consecutive days, by the oldest trick there is: subtract a row number
   * from the date, and every unbroken run collapses to the same value.
   */
  select coalesce(max(n), 0) into v_streak
  from (
    select count(*) as n
    from (
      select l.date, l.date - (row_number() over (order by l.date))::int as grp
      from (
        select distinct l.date
        from public.circuit_logs l
        join public.circuit_people cp on cp.id = l.person_id
        where cp.owner_user_id = v_target
      ) l
    ) g
    group by g.grp
  ) runs;

  select count(*), count(*) filter (where r.review is not null)
    into v_ratings, v_written
  from public.circuit_ratings r where r.user_id = v_target;

  select count(*), coalesce(max(lb.score), 0) into v_snake, v_best
  from public.leaderboard lb
  join public.player_registry reg on reg.id = lb.player_id
  where reg.user_id = v_target;

  select count(*) into v_gold
  from public.trophies tr
  join public.leaderboard lb on lb.id = tr.leaderboard_id
  join public.player_registry reg on reg.id = lb.player_id
  where reg.user_id = v_target and tr.trophy_name = 'gold';

  select count(*),
         count(*) filter (where b.block_type = 'art'),
         count(*) filter (where b.block_type = 'song'),
         count(*) filter (where b.block_type = 'visualizer')
    into v_blocks, v_art, v_song, v_viz
  from public.profile_blocks b where b.user_id = v_target;

  -- module, code, label, what it takes, how far along
  return jsonb_build_array(
    -- ⚠️ CALIBRATED AGAINST THE REAL BOARD, not picked out of the air. Measured first: 224 days
    -- logged for one person, a 95-day streak for another, 145 ratings for a third, and a Snake
    -- median of 36 against a best of 310. Tiers set below those numbers would all be earned the
    -- moment this shipped, which is the same as having none.
    jsonb_build_object('module','circuit','code','first_day','label','On the board',
      'note','Log a day on the Circuit','goal',1,'have',v_days),
    jsonb_build_object('module','circuit','code','days_25','label','Regular',
      'note','Log twenty-five days','goal',25,'have',v_days),
    jsonb_build_object('module','circuit','code','days_100','label','Committed',
      'note','Log a hundred days','goal',100,'have',v_days),
    jsonb_build_object('module','circuit','code','days_250','label','Year of it',
      'note','Log two hundred and fifty days','goal',250,'have',v_days),
    jsonb_build_object('module','circuit','code','streak_week','label','Seven straight',
      'note','Log seven days in a row','goal',7,'have',v_streak),
    jsonb_build_object('module','circuit','code','streak_month','label','A month unbroken',
      'note','Log thirty days in a row','goal',30,'have',v_streak),
    jsonb_build_object('module','circuit','code','streak_90','label','Did not miss',
      'note','Log ninety days in a row','goal',90,'have',v_streak),

    jsonb_build_object('module','snake','code','first_score','label','Played',
      'note','Put a score on the board','goal',1,'have',v_snake),
    -- the median game is 36, so this is "a good one" rather than "any one"
    jsonb_build_object('module','snake','code','score_75','label','Getting long',
      'note','Score seventy-five','goal',75,'have',v_best),
    jsonb_build_object('module','snake','code','score_200','label','Enormous',
      'note','Score two hundred','goal',200,'have',v_best),
    jsonb_build_object('module','snake','code','gold','label','Gold',
      'note','Top a round','goal',1,'have',v_gold),

    jsonb_build_object('module','reviewer','code','first_rating','label','Critic',
      'note','Rate something','goal',1,'have',v_ratings),
    jsonb_build_object('module','reviewer','code','ratings_50','label','Well watched',
      'note','Rate fifty things','goal',50,'have',v_ratings),
    jsonb_build_object('module','reviewer','code','ratings_200','label','Seen everything',
      'note','Rate two hundred things','goal',200,'have',v_ratings),
    jsonb_build_object('module','reviewer','code','wrote_one','label','In your own words',
      'note','Write an actual review, not just a score','goal',1,'have',v_written),

    jsonb_build_object('module','profile','code','made_page','label','Moved in',
      'note','Put something on your page','goal',1,'have',v_blocks),
    jsonb_build_object('module','profile','code','five_blocks','label','Decorated',
      'note','Five things on your page','goal',5,'have',v_blocks),

    jsonb_build_object('module','paint','code','kept_art','label','Framed',
      'note','Put a drawing on your page','goal',1,'have',v_art),
    jsonb_build_object('module','instrument','code','kept_song','label','Songwriter',
      'note','Put a song you made on your page','goal',1,'have',v_song),
    jsonb_build_object('module','visual','code','kept_look','label','Set designer',
      'note','Put a visualiser look on your page','goal',1,'have',v_viz)
  );
end;
$$;

revoke all on function public.list_achievements(text) from public, anon;
grant execute on function public.list_achievements(text) to authenticated;

-- ── HOW TO CHECK IT WORKED ──────────────────────────────────────────────────────────────────
--   select jsonb_pretty(public.list_achievements('<your username>'));
-- Every row carries `goal` and `have`; earned is have >= goal, which the client decides so the
-- same call can render both the earned ones and the locked ones with their progress.
--
-- Expect it to light up immediately rather than starting empty — that is the point of deriving
-- it. On this data: 676 circuit logs and 469 ratings across the crew, so the circuit and
-- reviewer rows should already be well past their goals for anyone who has been using the site.
--
-- ── WHAT IS NOT HERE, AND WHY ───────────────────────────────────────────────────────────────
-- Nothing counts how OFTEN you open a room. Paint keeps its gallery in localStorage and the
-- instrument and visualiser record nothing, so a "played 100 notes" achievement would need the
-- site to start logging what your friends do minute to minute. Those three are measured by what
-- they leave behind on a page instead, which is a better thing to reward and needs no tracking.
