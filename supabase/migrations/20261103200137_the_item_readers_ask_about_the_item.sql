-- ✅ APPLIED 3 Nov 2026 as `the_item_readers_ask_about_the_item`.
--
-- ⚠️ `certain` WAS WIRED END TO END AND REACHED NOBODY, AND NOTHING WOULD HAVE SAID SO.
-- The tier was in the enum, the picker could store it, `visibility_certain` had rows in it and
-- its own RPCs -- and the readers all asked `can_see(owner, tier)`, which fails closed on
-- `certain` by design. So every friend on every list got "no", on every surface, and a feature
-- that is complete and reaches no one looks exactly like a feature nobody has used yet.
--
-- The reason the two-argument form cannot answer is worth stating once: the other four tiers are
-- a rule about a RELATIONSHIP, so owner-plus-tier settles every viewer. `certain` is a rule about
-- a LIST held per item -- two friends looking at the same block get different answers -- so the
-- question needs the item. `can_see_item(owner, tier, kind, id)` is the four-argument form, Part
-- 3's option (a): the two-argument `can_see` is untouched and its twelve callers and six policies
-- carry on unchanged.
--
-- Eleven call sites across nine functions, by substitution into `pg_get_functiondef` rather than
-- by retyping: `get_member_activity` is 5 kB of union and `get_member_chronicle` 5 kB of
-- arithmetic, and a hand-copied body is a chance to change something nobody asked to change.
-- Each replacement asserts its own hit count, and the migration ends by asking the SCHEMA whether
-- any caller of the two-argument form is left -- which is the check a list of call sites can never
-- be, because a list goes stale and this raises.
--
-- Measured afterwards in a rolled-back transaction, with the fault and the control both run:
--   a friend ON a block's list              sees it
--   a friend OFF it                         does not, and the block is not in their SELECT
--   a member who is not a friend            does not
--   a signed-out visitor                    does not
--   the owner                               does
--   an ex-friend still on the list          does not
--   an empty list                           reaches nobody
--   on a list, but for a DIFFERENT item     does not
--
-- ⚠️ AND THE FIRST ATTEMPT MEASURED A NEIGHBOURING MECHANIC AND REPORTED A BROKEN GATE.
-- `circuit_can_see_person` is `can_see_item(...) OR you are in a circuit this person is in`, and
-- every member of this site is in the circuit the one test person belongs to -- so the probe said
-- `true` for a non-friend at `certain` and looked precisely like the tier doing nothing. The
-- site's own copy says it out loud: "People in your circuits always see your board there. This
-- setting is about everyone else." Re-measured with the group link removed, the tier branch
-- answers correctly. The standing test uses a profile BLOCK, which has no second branch.
--
-- The member-to-member matrix is UNCHANGED at b89fc62c856482e4e5b248651da62fa0, and that is
-- provable rather than lucky: zero rows anywhere in the database sit at `certain`, and with an
-- empty list `can_see_item` delegates to `can_see` exactly.

do $mig$
declare
  r record;
  v_src text;
  v_out text;
  v_hits int;
  v_done int := 0;
begin
  /* CERTAIN NOW GRANTS, AND EVERY ITEM READER HAS TO SAY WHICH ITEM IT IS ASKING ABOUT.
     `can_see(owner, tier)` cannot answer a question about `certain`, because the answer is not a
     property of the owner and the tier -- it is a property of the ROW: this friend is on this
     item's list and that one is not. It fails closed instead, which was right while nothing
     could be on a list and is now simply "certain reaches nobody".

     `can_see_item(owner, tier, kind, id)` is the four-argument form (Part 3 chose option (a), so
     the two-argument `can_see` is untouched and its twelve other callers and six policies carry
     on). This migration moves every reader of a tier that belongs to an ITEM onto it. The
     mapping is `owns_item`'s own vocabulary:

       profile_blocks.visibility        -> 'profile_block',    b.id
       circuit_people.visibility        -> 'circuit_person',   cp.id      (already text)
       player_registry.visibility       -> 'player_registry',  r.id
       profiles.activity_visibility     -> 'profile_activity', the owner's own id

     Done by substitution into `pg_get_functiondef` rather than by retyping: `get_member_activity`
     is 5 kB of union and `get_member_chronicle` 5 kB of arithmetic, and a hand-copied body is a
     chance to change something nobody asked to change. Each replacement asserts its own hit
     count, so a body that has moved since this was written stops the migration instead of being
     half-edited. */
  for r in
    select * from (values
      ('chronicle_shares_timeline',
       'public.can_see(p_owner, b.visibility)',
       'public.can_see_item(p_owner, b.visibility, ''profile_block'', b.id::text)', 1),
      ('guestbook_open_to',
       'public.can_see(p_owner, b.visibility)',
       'public.can_see_item(p_owner, b.visibility, ''profile_block'', b.id::text)', 1),
      ('circuit_can_see_person',
       'public.can_see(cp.owner_user_id, cp.visibility)',
       'public.can_see_item(cp.owner_user_id, cp.visibility, ''circuit_person'', cp.id)', 1),
      ('get_member_chronicle',
       'public.can_see(v_target, b.visibility)',
       'public.can_see_item(v_target, b.visibility, ''profile_block'', b.id::text)', 1),
      ('get_member_profile',
       'public.can_see(v_target, v_tier)',
       'public.can_see_item(v_target, v_tier, ''profile_activity'', v_target::text)', 1),
      ('get_member_trophies',
       'public.can_see(v_target, v_tier)',
       'public.can_see_item(v_target, v_tier, ''profile_activity'', v_target::text)', 1),
      ('list_achievements',
       'public.can_see(v_target, v_tier)',
       'public.can_see_item(v_target, v_tier, ''profile_activity'', v_target::text)', 1),
      ('snake_friend_names',
       'public.can_see(r.user_id, r.visibility)',
       'public.can_see_item(r.user_id, r.visibility, ''player_registry'', r.id::text)', 1),
      ('get_member_activity',
       'public.can_see(v_target, v_tier)',
       'public.can_see_item(v_target, v_tier, ''profile_activity'', v_target::text)', 1),
      ('get_member_activity',
       'public.can_see(cp.owner_user_id, cp.visibility)',
       'public.can_see_item(cp.owner_user_id, cp.visibility, ''circuit_person'', cp.id)', 1),
      ('get_member_activity',
       'public.can_see(r.user_id, r.visibility)',
       'public.can_see_item(r.user_id, r.visibility, ''player_registry'', r.id::text)', 2)
    ) as v(fn, old, new, want)
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;
    if v_src is null then raise exception 'function % not found', r.fn; end if;

    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> r.want then
      raise exception 'expected % of % in %, found %', r.want, r.old, r.fn, v_hits;
    end if;

    v_out := replace(v_src, r.old, r.new);
    execute v_out;
    v_done := v_done + 1;
  end loop;

  if v_done <> 11 then raise exception 'expected 11 substitutions, made %', v_done; end if;

  /* THE CENSUS, ASKED OF THE WHOLE SCHEMA RATHER THAN OF THIS LIST. Twelve calls to the
     two-argument `can_see` existed across ten functions, and every one of them was reading a
     tier that belongs to an item -- so when the eleven substitutions above are done, the only
     caller left in the database should be `can_see_item` itself. Written as an assertion and
     not as a comment, because a list of call sites is exactly the thing CLAUDE.md says goes
     stale: the next person to add a reader finds out here rather than in a review.

     Matched unqualified too (`\mcan_see\s*\(` rather than `public\.can_see`), since a word
     boundary before `can_see` excludes `circuit_can_see_person` and `can_see_item` alike. */
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname <> 'can_see_item'
       and regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'gs'),
                          '--[^' || chr(10) || ']*', ' ', 'g')
             ~ '\mcan_see\s*\('
  ) then
    raise exception 'a reader still asks can_see() without naming its item';
  end if;
end
$mig$;
