-- ✅ APPLIED 3 Nov 2026 as `profile_blocks_carry_their_certain_lists`.
--
-- Evan's plan for p_blocks, with his four rules.
--
-- ⚠️ THE LISTS ARE KEYED BY POSITION BECAUSE THE IDS DO NOT SURVIVE A SAVE. This
-- function deletes every block and re-inserts them, so each gets a fresh `gen_random_uuid()`;
-- and the client has no block id to send -- `ProfileBlock` carries block_type, size, config and
-- visibility and nothing else. "Keep block ids stable" would mean threading an id through
-- create, duplicate, reorder and undo in a 4,000-line file. Carrying the list in `p_blocks` and
-- rewriting it in the same transaction cannot orphan anything by construction.
--
-- ⚠️ A MISSING `certain` KEY MUST NOT MEAN "EMPTY", AND THE RULE IS PER PAYLOAD
-- RATHER THAN PER BLOCK. A client that knows about lists sends the key on every block, including
-- an empty array. So if the key appears NOWHERE in the payload the sender is an older bundle
-- that has never heard of them, and the old lists are carried across by position. Within a
-- payload that DOES use the key, a missing key on one block is genuinely empty -- that client is
-- telling us about every block it has. Without the first half, one stale tab wipes every list on
-- the page.
--
-- ⚠️ AND A BLOCK THAT LEAVES THE `certain` TIER LOSES ITS LIST. Keeping it would mean
-- moving a block to Friends and back again silently restored an audience the owner had stopped
-- choosing.
--
-- Accepted friends only, never yourself, deduped by the primary key, capped at 50 per block --
-- the same rule `visibility_certain_set` keeps, because `certain` sits BELOW `friends` and a
-- list naming a stranger would make the narrow level wider than the broad one. Nothing deletes
-- from `visibility_certain` here: the AFTER DELETE trigger clears each block's list as its row
-- goes, which is also why the old lists are read before the delete.
--
-- Measured in a rolled-back transaction:
--   two `certain` blocks + one `friends` block   lists on the two, none on the third;
--                                                a repeated name deduped, an unknown one dropped
--   editing ONLY the bio                         every list intact        <- Evan's test
--   a stale tab with no `certain` key anywhere   every list intact
--   the bio leaves the `certain` tier            its list dropped, the other kept
--   an explicit empty list                       cleared

alter table public.profile_blocks drop constraint if exists profile_blocks_tier_accepted;
alter table public.profile_blocks
  add constraint profile_blocks_tier_accepted
  check (visibility in ('public', 'friends', 'members', 'private', 'certain'));

create or replace function public.save_my_profile_blocks(p_blocks jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid := auth.uid();
  v_count int;
  v_total bigint;
  /* the lists as they stand, keyed by POSITION -- see the note on ids below */
  v_old_lists jsonb;
  v_client_knows_lists boolean;
begin
  if v_me is null then raise exception 'not authenticated'; end if;
  /* suspension reaches SECURITY DEFINER functions only here: they run as the owner, so a
     RESTRICTIVE policy on the table underneath never sees the suspended member at all. */
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;
  if jsonb_typeof(p_blocks) <> 'array' then raise exception 'p_blocks must be an array'; end if;

  -- ASSIGNED, not `select count(*) into v_count`: the SQL editor lints the body as top-level SQL,
  -- where `select . into name` is the archaic spelling of CREATE TABLE AS, and reports
  -- "creates a table without RLS: v_count" every time this file is opened.
  v_count := (select count(*) from jsonb_array_elements(p_blocks));
  if v_count > 20 then raise exception 'too many blocks (max 20)'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_blocks) e
    where (e->>'block_type') not in (
            'bio','banner','stats','activity','guestbook','status','trophies',
            'song','visualizer','art','looks',
            -- text at any size, face and alignment, or no text at all and just a shape
            'free',
            -- Holds packed drawings, the same shape 'art' holds, checked by the same cap below
            -- and by readPet on the way out.
            'pet',
            -- THE ADDITION. Carries no data of its own - its config is which window to cover, and
            -- the figures are derived at read time by get_member_chronicle, which uses THIS
            -- block's visibility as the only gate.
            -- See docs/2026-10-14-chronicle-profile-block.sql
            'chronicle'
          )
       or (e->>'size') not in ('small','medium','large')
       or coalesce(e->>'visibility','members')
            not in ('public','friends','members','private','certain')
       -- 64000, four times what it was. A pet and a drawing carry every stroke that made them, so
       -- this is the only block cap anybody ever reaches.
       or length(e->>'config') > 64000
       -- a list is a list; anything else is a client bug and not something to guess at
       or (e ? 'certain' and jsonb_typeof(e->'certain') <> 'array')
  ) then
    raise exception 'invalid block';
  end if;

  -- A CHRONICLE BLOCK CANNOT BE PUBLIC, and this is the only place that can enforce it.
  -- can_see(owner,'public') is true unconditionally, anon included - but get_member_chronicle
  -- refuses an unauthenticated caller outright. So 'public' here would READ as "the whole
  -- internet" and BEHAVE as "members": a tier whose name overstates what it does, which is the one
  -- thing a privacy control must never be.
  if exists (
    select 1 from jsonb_array_elements(p_blocks) e
    where e->>'block_type' = 'chronicle'
      and coalesce(e->>'visibility','members') = 'public'
  ) then
    raise exception 'a chronicle block cannot be public';
  end if;

  -- AND A CEILING ON THE WHOLE PAGE: a visitor downloads and draws every block on a profile, so
  -- what costs them is the total, not the largest one.
  v_total := (select coalesce(sum(length(e->>'config')), 0) from jsonb_array_elements(p_blocks) e);
  if v_total > 160000 then raise exception 'profile too large'; end if;

  /* ⚠️ THE LISTS ARE REMEMBERED BY POSITION, BECAUSE THE IDS DO NOT SURVIVE THIS FUNCTION.
     Every save deletes all of this member's blocks and re-inserts them, so each block gets a
     fresh `gen_random_uuid()`. The client has no block id at all -- `ProfileBlock` carries
     block_type, size, config and visibility and nothing else -- so there is no id to send and
     no id to preserve. Position is the only identity a block has across a save. */
  v_old_lists := coalesce((
    select jsonb_object_agg(b.position::text, coalesce(l.names, '[]'::jsonb))
      from public.profile_blocks b
      left join lateral (
        select jsonb_agg(p.username::text) as names
          from public.visibility_certain vc
          join public.profiles p on p.user_id = vc.friend
         where vc.item_kind = 'profile_block' and vc.item_id = b.id::text
      ) l on true
     where b.user_id = v_me
  ), '{}'::jsonb);

  /* ⚠️ A MISSING `certain` KEY MUST NOT MEAN "EMPTY", or one stale tab wipes every list on the
     page. A client that knows about lists sends the key on every block, including an empty
     array when the list is empty -- so if the key appears NOWHERE in the payload, the sender is
     an older bundle that has never heard of them, and the right answer is to leave what is
     there alone rather than to read its silence as a decision.

     Per block, within a payload that does use the key, a missing key IS empty: that client is
     telling us about every block it has. */
  v_client_knows_lists := exists (select 1 from jsonb_array_elements(p_blocks) e where e ? 'certain');

  /* the AFTER DELETE trigger on this table clears each block's list as its row goes, which is
     why nothing deletes from visibility_certain here -- and why the lists above are read first */
  delete from public.profile_blocks where user_id = v_me;

  /* CLAMPED, NOT REFUSED, and the difference is whether a new member can save their own page.
     `profile_blocks.visibility` defaults to 'members' and a new signup's age_band is 'unknown',
     whose ceiling is 'friends' - so raising on a tier above the ceiling would make the editor's
     own default value unsaveable, and the first thing a new member did on the site would fail.
     Clamping silently is also what every read door already does, so this makes the stored tier
     agree with the effective one rather than changing what anybody can see. */
  with ins as (
    insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
    select v_me,
           e->>'block_type',
           o::int,
           e->>'size',
           coalesce(e->'config','{}'::jsonb),
           public.clamp_visibility(v_me, coalesce(e->>'visibility','members')::public.visibility_tier)
      from jsonb_array_elements(p_blocks) with ordinality t(e, o)
    returning id, position, visibility
  ),
  wanted as (
    select i.id,
           case
             /* ⚠️ A BLOCK THAT IS NOT `certain` HAS NO LIST. Leaving one behind would mean
                moving a block to Friends and back again silently restored an audience the
                owner had stopped choosing. */
             when i.visibility <> 'certain'::public.visibility_tier then '[]'::jsonb
             when pe.e ? 'certain' then pe.e->'certain'
             when not v_client_knows_lists
               then coalesce(v_old_lists->(i.position::text), '[]'::jsonb)
             else '[]'::jsonb
           end as names
      from ins i
      join lateral (
        select e from jsonb_array_elements(p_blocks) with ordinality t(e, o) where o = i.position
      ) pe on true
  )
  insert into public.visibility_certain (owner, item_kind, item_id, friend)
  select distinct v_me, 'profile_block', w.id::text, pr.user_id
    from wanted w
    cross join lateral (
      /* capped per block: a list is people you chose, not a mailing list, and an unbounded
         array in a payload is somebody else's denial-of-service */
      select n.name from jsonb_array_elements_text(w.names) with ordinality n(name, ord)
       where ord <= 50
    ) n
    join public.profiles pr on lower(pr.username::text) = lower(btrim(n.name))
   where pr.user_id <> v_me
     /* the same rule `visibility_certain_set` keeps: accepted friends only, never yourself.
        `certain` sits BELOW `friends`, so a list naming a stranger would make the narrow level
        wider than the broad one. Names that are not friends are dropped rather than refused --
        the picker fills from a circle, and a circle can hold somebody who has since drifted. */
     and coalesce(public.are_friends(v_me, pr.user_id), false)
  on conflict (item_kind, item_id, friend) do nothing;
end;
$function$;
