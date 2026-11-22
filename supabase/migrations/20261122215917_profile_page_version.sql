-- ✅ APPLIED to production 22 Nov 2026 (4:59 PM EST, 21:59 UTC) as migration `profile_page_version`,
-- version 20261122215917, with Evan's yes of 22 Nov ("#450 server check: YES, apply the migration and
-- release"). Production recorded md5(statements[1]) = 9c3695205007c7925bce5243b3361669 over 12,683 bytes, this
-- file's body byte for byte. Before it: save_my_profile_blocks(jsonb) with md5(prosrc)
-- 0603655260224be367a971ecc3b88a9f, as the draft was written against. After it: one
-- save_my_profile_blocks(p_blocks jsonb, p_expected_page text), executable by authenticated and
-- service_role and not anon; my_profile_page_version() the same; profile_page_version(uuid) by
-- service_role only. A save of the owner's own page as it stood, in a session rolled back, left the
-- page identical and answered the same before and after, with and without a version; a stale
-- version was refused with PT409.
-- Why, and the rollback: docs/applied/2026-11-22-profile-page-version.DRAFT.sql and
-- docs/2026-11-22-profile-page-version.ROLLBACK.sql.

create function public.profile_page_version(p_owner uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  /* position, type, size, visibility, config and the Certain list of every block, in order --
     everything a save overwrites, and nothing it does not (ids and created_at change on every
     save by design) */
  select md5(coalesce((
    select jsonb_agg(jsonb_build_array(
             b.position, b.block_type, b.size, b.visibility, b.config,
             coalesce((select jsonb_agg(vc.friend order by vc.friend)
                         from public.visibility_certain vc
                        where vc.item_kind = 'profile_block' and vc.item_id = b.id::text),
                      '[]'::jsonb))
           order by b.position, b.id)
      from public.profile_blocks b
     where b.user_id = p_owner
  ), '[]'::jsonb)::text)
$$;
revoke all on function public.profile_page_version(uuid) from public, anon, authenticated;

create function public.my_profile_page_version()
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return public.profile_page_version(auth.uid());
end;
$$;
revoke all on function public.my_profile_page_version() from public, anon;
grant execute on function public.my_profile_page_version() to authenticated, service_role;

drop function public.save_my_profile_blocks(jsonb);

create function public.save_my_profile_blocks(p_blocks jsonb, p_expected_page text default null)
returns jsonb
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

  /* ⚠️ ONE SAVE OF A PAGE AT A TIME, AND ONLY OVER THE PAGE THE CALLER READ (22 Nov 2026).
     Two overlapping saves used to both delete the page as their own snapshot saw it and both
     insert, so the page came back doubled; and a save sent a moment after somebody else's
     change deleted that change with no message. Two locks, each for a case the other misses:
       - the member's own profile row, NO KEY UPDATE, so it waits only for another save of this
         page and never for anything that merely references the member. It is the only lock an
         EMPTY page has: with no rows, the second lock below locks nothing.
       - the page's rows, so an in-place writer that got there first (the chronicle switch's
         UPDATE) is waited for and then shows in the version below, which refuses. Without it the
         version is read past that uncommitted update, matches, and the delete then takes the row.
     ⚠️ The other order is not covered and is the switch's own: a switch that arrives while this
     save holds the rows waits, then finds its row deleted and re-inserted under a new id, updates
     nothing, and still answers as if it had. That was true before this change too.

     `p_expected_page` is what `my_profile_page_version()` said when the caller read the page.
     NULL is a caller that does not know about versions -- every bundle before this one --
     and it saves as it always did, only no longer doubled. */
  perform 1 from public.profiles where user_id = v_me for no key update;
  perform 1 from public.profile_blocks where user_id = v_me for update;
  if p_expected_page is not null
     and p_expected_page is distinct from public.profile_page_version(v_me) then
    /* PT409: PostgREST answers HTTP 409, and the editor says the page changed elsewhere */
    raise exception 'page changed' using errcode = 'PT409', hint = 'read the page again';
  end if;

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

  /* WHAT WAS STORED, NOT WHAT WAS ASKED FOR. Every tier above this account's ceiling
     was quietly narrowed by the clamp above, and until now the editor had no way to
     know -- so a block saved as "Anyone with an account" by a member capped at Friends
     went on reading "Anyone with an account" on screen. Keyed by position, which is the
     only identity a block has across this function. */
  return coalesce((
    select jsonb_agg(jsonb_build_object('position', b.position,
                                        'visibility', b.visibility)
                     order by b.position)
      from public.profile_blocks b where b.user_id = v_me
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.save_my_profile_blocks(jsonb, text) from public, anon;
grant execute on function public.save_my_profile_blocks(jsonb, text) to authenticated, service_role;
