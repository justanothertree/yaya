-- Does `certain` actually grant, to exactly the people on an item's list and nobody else?
--
-- HOW TO RUN: paste into the SQL editor or hand to execute_sql. Needs a connection that can
-- write (it builds fixtures and creates temp tables); everything is inside a transaction that
-- rolls back. It raises on the first failure rather than printing a report, so it is a gate.
--
-- ⚠️ THIS IS THE FILE THAT WOULD HAVE CAUGHT `certain` SHIPPING AS A NO-OP. The tier existed in
-- the enum, the picker could store it, the list table had rows in it -- and `can_see` fails
-- closed on `certain` by design, so every reader answered "no" to every friend on every list.
-- A feature that is wired end to end and reaches nobody looks exactly like a feature nobody has
-- used yet, which is why a level needs a test that asserts somebody CAN see, not only that the
-- wrong people cannot.
--
-- ⚠️ AND IT MEASURES THROUGH `profile_blocks`, NOT THROUGH A CIRCUIT PERSON, BECAUSE THE FIRST
-- ATTEMPT MEASURED A NEIGHBOURING MECHANIC. `circuit_can_see_person` is
-- `can_see_item(...) OR you are in a circuit this person is in`, and on this site every member
-- is in the circuit the one test person belongs to -- so a probe through it reported `true` for
-- a stranger at `certain` and looked exactly like a broken gate. The site's own copy says so out
-- loud: "People in your circuits always see your board there. This setting is about everyone
-- else." A block has no second branch, so it answers the question that was asked.
--
-- ⚠️ MADE TO FAIL ONCE, 3 Nov 2026. With `can_see_item` reverted to
--   `select public.can_see(p_owner, p_tier)` -- the state the feature was in this morning -- this
--   file reports two failures, "a friend ON the list cannot see the item (austin)" and
--   "get_profile_blocks hides the item from a friend on its list", while every refusal assertion
--   stays silent. That asymmetry is the point: the refusals pass against a gate that says no to
--   everybody, and only the two positive assertions can tell a working feature from a dead one.
--
-- ⚠️ THE CAST IS CHOSEN BY RULE, NOT BY NAME. Who has the most friends changes; what the test
-- needs is an owner with at least two accepted friends and one member who is not a friend. If
-- the site cannot supply that, the fixture raises rather than passing by testing nothing.

begin;

create temp table fails(what text, detail text);
create temp table cast_(part text, uid uuid, u text);

do $fixture$
declare
  v uuid; vu text;
begin
  -- the owner: whoever has the most accepted friendships, ties broken by username
  select p.user_id, p.username::text into v, vu
    from public.profiles p
   where coalesce(p.suspended, false) = false
   order by (select count(*) from public.friendships f
              where f.status = 'accepted'
                and (f.user_a = p.user_id or f.user_b = p.user_id)) desc,
            p.username
   limit 1;
  insert into cast_ values ('owner', v, vu);

  -- two of their accepted friends: one that goes on the list, one that does not.
  -- `friendships` is read directly rather than through `are_friends`, which is self-or-admin
  -- gated and answers nothing for a connection with no session.
  insert into cast_
  select 'on_list', p.user_id, p.username::text
    from public.profiles p
   where coalesce(p.suspended, false) = false
     and exists (select 1 from public.friendships f
                  where f.status = 'accepted'
                    and f.user_a = least(v, p.user_id) and f.user_b = greatest(v, p.user_id))
   order by p.username
   limit 1;

  insert into cast_
  select 'off_list', p.user_id, p.username::text
    from public.profiles p
   where coalesce(p.suspended, false) = false
     and exists (select 1 from public.friendships f
                  where f.status = 'accepted'
                    and f.user_a = least(v, p.user_id) and f.user_b = greatest(v, p.user_id))
   order by p.username
   offset 1
   limit 1;

  -- somebody with an account who is not a friend of the owner
  insert into cast_
  select 'stranger', p.user_id, p.username::text
    from public.profiles p
   where coalesce(p.suspended, false) = false
     and p.user_id <> v
     and not exists (select 1 from public.friendships f
                      where f.status = 'accepted'
                        and f.user_a = least(v, p.user_id) and f.user_b = greatest(v, p.user_id))
   order by p.username
   limit 1;

  if (select count(*) from cast_) <> 4 then
    raise exception
      'FIXTURE: need an owner with two accepted friends and one non-friend member; got %',
      (select string_agg(part, ', ' order by part) from cast_);
  end if;
end
$fixture$;

-- ── the item tests: a profile block at `certain` with one friend on its list ────────────────
do $items$
declare
  v_owner uuid := (select uid from cast_ where part = 'owner');
  v_on    uuid := (select uid from cast_ where part = 'on_list');
  v_off   uuid := (select uid from cast_ where part = 'off_list');
  v_str   uuid := (select uid from cast_ where part = 'stranger');
  v_block uuid;
  v_other uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
  values (v_owner, 'bio', 90, 'small', '{"text":"certain-lists fixture"}'::jsonb, 'certain')
  returning id into v_block;
  insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
  values (v_owner, 'stats', 91, 'small', '{}'::jsonb, 'certain')
  returning id into v_other;

  insert into public.visibility_certain (owner, item_kind, item_id, friend)
  values (v_owner, 'profile_block', v_block::text, v_on);
  -- the null control: the OTHER block's list names the off-list friend, so a reader that
  -- confuses one item with another says yes to the wrong person
  insert into public.visibility_certain (owner, item_kind, item_id, friend)
  values (v_owner, 'profile_block', v_other::text, v_off);

  -- 1. the friend on the list sees it. THIS IS THE ASSERTION THAT MAKES THE FILE WORTH RUNNING:
  --    every other case below passes against a gate that simply refuses everybody.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_on::text, 'role', 'authenticated')::text, true);
  if not coalesce(public.can_see_item(v_owner, 'certain', 'profile_block', v_block::text), false)
  then
    insert into fails values ('a friend ON the list cannot see the item',
      (select u from cast_ where part = 'on_list'));
  end if;
  if not exists (select 1 from jsonb_array_elements(
                   public.get_profile_blocks((select u from cast_ where part = 'owner'))) b
                  where b->>'block_type' = 'bio'
                    and b->'config'->>'text' = 'certain-lists fixture') then
    insert into fails values ('get_profile_blocks hides the item from a friend on its list', null);
  end if;

  -- 2. a friend who is not on this item's list does not, even though they are on another's
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_off::text, 'role', 'authenticated')::text, true);
  if coalesce(public.can_see_item(v_owner, 'certain', 'profile_block', v_block::text), false) then
    insert into fails values ('a friend OFF the list can see the item',
      (select u from cast_ where part = 'off_list'));
  end if;
  if exists (select 1 from jsonb_array_elements(
               public.get_profile_blocks((select u from cast_ where part = 'owner'))) b
              where b->'config'->>'text' = 'certain-lists fixture') then
    insert into fails values ('get_profile_blocks shows the item to a friend off its list', null);
  end if;

  -- 3. a member who is not a friend at all
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_str::text, 'role', 'authenticated')::text, true);
  if coalesce(public.can_see_item(v_owner, 'certain', 'profile_block', v_block::text), false) then
    insert into fails values ('a non-friend member can see a certain item',
      (select u from cast_ where part = 'stranger'));
  end if;

  -- 4. and a non-member: `certain` must never be reachable without a session
  -- `{}` rather than `''`: auth.uid() casts the setting to json, and an empty string raises
  perform set_config('request.jwt.claims', '{}', true);
  if coalesce(public.can_see_item(v_owner, 'certain', 'profile_block', v_block::text), false) then
    insert into fails values ('a signed-out visitor can see a certain item', null);
  end if;

  -- 5. the owner always can
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  if not coalesce(public.can_see_item(v_owner, 'certain', 'profile_block', v_block::text), false)
  then
    insert into fails values ('the owner cannot see their own certain item', null);
  end if;

  -- 6. AN EX-FRIEND ON THE LIST LOSES ACCESS. The row stays -- nothing deletes it on unfriending,
  --    deliberately, because a friendship can come back; the READER is what refuses.
  update public.friendships set status = 'pending'
   where user_a = least(v_owner, v_on) and user_b = greatest(v_owner, v_on);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_on::text, 'role', 'authenticated')::text, true);
  if coalesce(public.can_see_item(v_owner, 'certain', 'profile_block', v_block::text), false) then
    insert into fails values ('an ex-friend still on the list can see the item', null);
  end if;
  update public.friendships set status = 'accepted'
   where user_a = least(v_owner, v_on) and user_b = greatest(v_owner, v_on);

  -- 7. AN EMPTY LIST MEANS ONLY ME -- Evan's rule, 3 Nov
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  delete from public.visibility_certain
   where item_kind = 'profile_block' and item_id = v_block::text;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_on::text, 'role', 'authenticated')::text, true);
  if coalesce(public.can_see_item(v_owner, 'certain', 'profile_block', v_block::text), false) then
    insert into fails values ('an empty list still reaches a friend', null);
  end if;

  -- 8. THE ITEM GOES, ITS LIST GOES. An AFTER DELETE trigger per item table, because the list's
  --    only cascading FKs are `owner` and `friend`; the item lives in a table of its own.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  delete from public.profile_blocks where id = v_other;
  if exists (select 1 from public.visibility_certain
              where item_kind = 'profile_block' and item_id = v_other::text) then
    insert into fails values ('deleting an item left its list behind', null);
  end if;

  -- 9. AND THE TIER LEAVING `certain` DROPS THE LIST TOO, so Certain -> Friends -> Certain cannot
  --    silently restore an audience the owner stopped choosing.
  insert into public.visibility_certain (owner, item_kind, item_id, friend)
  values (v_owner, 'profile_block', v_block::text, v_on);
  update public.profile_blocks set visibility = 'friends' where id = v_block;
  if exists (select 1 from public.visibility_certain
              where item_kind = 'profile_block' and item_id = v_block::text) then
    insert into fails values ('a list survived its item leaving the certain tier', null);
  end if;
end
$items$;

-- ── the chronicle tests: the tier the boolean cannot express ────────────────────────────────
do $chron$
declare
  v_owner uuid := (select uid from cast_ where part = 'owner');
  v_owner_u text := (select u from cast_ where part = 'owner');
  v_on    uuid := (select uid from cast_ where part = 'on_list');
  v_off   uuid := (select uid from cast_ where part = 'off_list');
  v_act uuid;
  v_goal uuid;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  /* ⚠️ THIS SECTION BRINGS ITS OWN CHRONICLE BLOCK, AND THE FIRST RUN IS WHY. Both readers
     below are gated on one -- `chronicle_friends_log` through `chronicle_shares_timeline`, and
     `get_member_chronicle` by returning null outright -- so without a block visible to the
     viewer they answer "nothing" for a correct reason, and this file reported two failures about
     a feature that was working. The cause was the save section below, which calls
     `save_my_profile_blocks` and so DELETES the owner's entire page: the chronicle block went
     with it, and the order of two `do` blocks decided whether the test passed.

     Fixed twice over -- the save section runs last now, and this one no longer depends on what
     the owner happens to have on their page. A test whose result turns on fixture order is one
     that will go red one day about something else entirely. */
  insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
  values (v_owner, 'chronicle', 92, 'small',
          '{"live":true,"goals":true,"timeline":true}'::jsonb, 'friends');

  insert into public.chronicle_activities (owner, name, cat, metric, visibility)
  values (v_owner, 'certain-lists fixture', 'free', 'reps', 'certain') returning id into v_act;
  insert into public.chronicle_entries (owner, activity, started_at, ended_at)
  values (v_owner, v_act, clock_timestamp() - interval '3 hours',
          clock_timestamp() - interval '2 hours');
  insert into public.chronicle_goals
    (owner, title, scope, repeat_every, target, unit, counts, visibility)
  values (v_owner, 'certain-lists goal', 'week', 1, 5, 'times', 'minutes', 'certain')
  returning id into v_goal;
  insert into public.visibility_certain (owner, item_kind, item_id, friend)
  values (v_owner, 'chronicle_activity', v_act::text, v_on),
         (v_owner, 'chronicle_goal', v_goal::text, v_on);

  -- the CHECK that makes this necessary: `shared` is false at `certain`, by constraint
  if (select shared from public.chronicle_activities where id = v_act) then
    insert into fails values ('a certain activity has shared = true', null);
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_on::text, 'role', 'authenticated')::text, true);
  if not exists (select 1 from jsonb_array_elements(
                   public.chronicle_friends_log(clock_timestamp() - interval '1 day',
                                                clock_timestamp())) s
                  where s->>'activity' = 'certain-lists fixture') then
    insert into fails values ('chronicle_friends_log hides a certain sitting from the list', null);
  end if;
  if not exists (select 1 from jsonb_array_elements(
                   (public.get_member_chronicle(v_owner_u, 7))->'goals') g
                  where g->>'title' = 'certain-lists goal') then
    insert into fails values ('get_member_chronicle hides a certain goal from the list', null);
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_off::text, 'role', 'authenticated')::text, true);
  if exists (select 1 from jsonb_array_elements(
               public.chronicle_friends_log(clock_timestamp() - interval '1 day',
                                            clock_timestamp())) s
              where s->>'activity' = 'certain-lists fixture') then
    insert into fails values ('chronicle_friends_log shows a certain sitting off the list', null);
  end if;
  if exists (select 1 from jsonb_array_elements(
               (public.get_member_chronicle(v_owner_u, 7))->'goals') g
              where g->>'title' = 'certain-lists goal') then
    insert into fails values ('get_member_chronicle shows a certain goal off the list', null);
  end if;

  -- and the owner's own feed: `certain` with somebody on it IS being shared, an empty one is not
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  if not public.item_reaches_anyone(v_owner, 'certain', 'chronicle_activity', v_act::text) then
    insert into fails values ('a certain item with a friend on it reaches nobody', null);
  end if;
  delete from public.visibility_certain
   where item_kind = 'chronicle_activity' and item_id = v_act::text;
  if public.item_reaches_anyone(v_owner, 'certain', 'chronicle_activity', v_act::text) then
    insert into fails values ('a certain item with an empty list reaches somebody', null);
  end if;
end
$chron$;

-- ── the card's goal COUNTS follow each goal's level ─────────────────────────────────────────
--
-- ⚠️ THE COUNTS WERE THE ONE THING ON THE CARD THAT NO LEVEL GOVERNED, and the titles two inches
-- above them were gated twice. `get_member_chronicle` counted `reached` and `open` over every goal
-- the owner had, so a member whose only goal was Only me told each of their friends they had one
-- on the go. Fixed 3 Nov 2026; this is what stops it coming back.
--
-- ⚠️ A DELTA, NOT AN ABSOLUTE, because the owner is a real member with goals of their own and a
-- fixture that assumed otherwise would be measuring the database rather than the rule.
--
-- ⚠️ AND THE SECOND ASSERTION IS THE ONE THAT MAKES THE FIRST MEAN ANYTHING. "Adding a private
-- goal did not move the count" is also what a count stuck at zero says, and what a card nobody
-- can see says — the same shape as the `.park-field` and empty-room traps in CLAUDE.md §2. So a
-- goal the viewer MAY see has to move the same number by exactly one, through the same call.
--
-- Made to fail once, by restoring the unfiltered count inside the same rolled-back transaction:
-- 2 of the 4 assertions went red — `1 -> 2` where the private goal must not move it, and `1 -> 3`
-- where the shared one must move it to 2, the second failing because the first already inflated
-- the base. The live function was untouched; the substitution rolled back with everything else.
do $counts$
declare
  v_owner   uuid := (select uid from cast_ where part = 'owner');
  v_owner_u text := (select u   from cast_ where part = 'owner');
  v_on      uuid := (select uid from cast_ where part = 'on_list');
  v_base int; v_after_priv int; v_after_shared int; v_owner_base int; v_owner_after int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_on::text, 'role', 'authenticated')::text, true);
  v_base := ((public.get_member_chronicle(v_owner_u, 7))->>'open')::int;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  v_owner_base := ((public.get_member_chronicle(v_owner_u, 7))->>'open')::int;
  insert into public.chronicle_goals
    (owner, title, scope, repeat_every, target, unit, counts, visibility)
  values (v_owner, 'certain-lists only-me goal', 'week', 1, 5, 'times', 'minutes', 'private');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_on::text, 'role', 'authenticated')::text, true);
  v_after_priv := ((public.get_member_chronicle(v_owner_u, 7))->>'open')::int;
  if v_after_priv <> v_base then
    insert into fails values ('an Only-me goal is counted on somebody else''s card',
      v_base || ' -> ' || v_after_priv);
  end if;
  /* and it must not appear by name either -- the two halves of the same answer */
  if exists (select 1 from jsonb_array_elements(
               (public.get_member_chronicle(v_owner_u, 7))->'goals') g
              where g->>'title' = 'certain-lists only-me goal') then
    insert into fails values ('an Only-me goal is listed on somebody else''s card', null);
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  insert into public.chronicle_goals
    (owner, title, scope, repeat_every, target, unit, counts, visibility)
  values (v_owner, 'certain-lists friends goal', 'week', 1, 5, 'times', 'minutes', 'friends');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_on::text, 'role', 'authenticated')::text, true);
  v_after_shared := ((public.get_member_chronicle(v_owner_u, 7))->>'open')::int;
  if v_after_shared <> v_base + 1 then
    insert into fails values ('a goal the viewer may see is not counted on the card',
      v_base || ' -> ' || v_after_shared || ' (expected ' || (v_base + 1) || ')');
  end if;

  -- the owner's own card counts everything, which is the reading that must NOT change
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  v_owner_after := ((public.get_member_chronicle(v_owner_u, 7))->>'open')::int;
  if v_owner_after <> v_owner_base + 2 then
    insert into fails values ('the owner stopped counting their own goals',
      v_owner_base || ' -> ' || v_owner_after || ' (expected ' || (v_owner_base + 2) || ')');
  end if;
end
$counts$;

-- ── the save test: editing one block must not disturb another block's list ──────────────────
--
-- ⚠️ LAST, BECAUSE IT EMPTIES THE OWNER'S PAGE. `save_my_profile_blocks` deletes every
-- block this member has and re-inserts the payload, so anything above that depends on a block
-- of theirs has to have run already. Learned by running it: with this section in the middle,
-- the chronicle checks failed because the block they are gated on had just been deleted.
--
-- ⚠️ `save_my_profile_blocks` DELETES EVERY BLOCK AND RE-INSERTS, so each save mints fresh
-- UUIDs and a list keyed on the old id would be orphaned by the act of editing a bio. The lists
-- are therefore remembered by POSITION across the save -- position is the only identity a block
-- has in that function, because the client has never carried an id.
do $save$
declare
  v_owner uuid := (select uid from cast_ where part = 'owner');
  v_on_u  text := (select u   from cast_ where part = 'on_list');
  v_off_u text := (select u   from cast_ where part = 'off_list');
  v_stored jsonb;
  v_lists text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  v_stored := public.save_my_profile_blocks(jsonb_build_array(
    jsonb_build_object('block_type', 'bio', 'size', 'small',
                       'config', jsonb_build_object('text', 'first'),
                       'visibility', 'certain',
                       'certain', jsonb_build_array(v_on_u)),
    jsonb_build_object('block_type', 'stats', 'size', 'small', 'config', '{}'::jsonb,
                       'visibility', 'certain',
                       'certain', jsonb_build_array(v_off_u))));

  if jsonb_array_length(v_stored) <> 2 then
    insert into fails values ('save_my_profile_blocks did not report what it stored',
      v_stored::text);
  end if;

  -- now edit ONLY the first block's text, sending both lists as a real client would
  perform public.save_my_profile_blocks(jsonb_build_array(
    jsonb_build_object('block_type', 'bio', 'size', 'small',
                       'config', jsonb_build_object('text', 'edited'),
                       'visibility', 'certain',
                       'certain', jsonb_build_array(v_on_u)),
    jsonb_build_object('block_type', 'stats', 'size', 'small', 'config', '{}'::jsonb,
                       'visibility', 'certain',
                       'certain', jsonb_build_array(v_off_u))));

  select string_agg(b.position || '=' || p.username::text, ', ' order by b.position)
    into v_lists
    from public.profile_blocks b
    join public.visibility_certain vc
      on vc.item_kind = 'profile_block' and vc.item_id = b.id::text
    join public.profiles p on p.user_id = vc.friend
   where b.user_id = v_owner;
  if v_lists is distinct from ('1=' || v_on_u || ', 2=' || v_off_u) then
    insert into fails values ('editing a block disturbed the lists', coalesce(v_lists, '(none)'));
  end if;

  -- ⚠️ AND A PAYLOAD WITH NO `certain` KEY AT ALL MUST LEAVE THE LISTS ALONE. An older bundle
  -- has never heard of them, and reading its silence as "empty" would let one stale tab wipe
  -- every list on the page.
  perform public.save_my_profile_blocks(jsonb_build_array(
    jsonb_build_object('block_type', 'bio', 'size', 'small',
                       'config', jsonb_build_object('text', 'from an older bundle'),
                       'visibility', 'certain'),
    jsonb_build_object('block_type', 'stats', 'size', 'small', 'config', '{}'::jsonb,
                       'visibility', 'certain')));

  select string_agg(b.position || '=' || p.username::text, ', ' order by b.position)
    into v_lists
    from public.profile_blocks b
    join public.visibility_certain vc
      on vc.item_kind = 'profile_block' and vc.item_id = b.id::text
    join public.profiles p on p.user_id = vc.friend
   where b.user_id = v_owner;
  if v_lists is distinct from ('1=' || v_on_u || ', 2=' || v_off_u) then
    insert into fails values ('a payload with no certain key wiped the lists',
      coalesce(v_lists, '(none)'));
  end if;
end
$save$;

-- ── the verdict ─────────────────────────────────────────────────────────────────────────────
-- ── A CIRCLE IS A FILL-IN SHORTCUT, AND NOTHING MORE ────────────────────────────────────────
-- Evan's design of 31 Oct, confirmed 4 Nov: pressing a circle copies its people into the
-- Certain picker and the two stop being related. Editing or deleting the circle afterwards does
-- not change who can see anything already set.
--
-- ⚠️ IT IS THE DESIGN THAT NEEDS THE TEST, NOT A BUG. Nothing links them today — checked by
-- enumeration rather than by reading: no circle function writes `visibility_certain` (all four
-- of `visibility_circle_save`, `_set_member`, `_delete`, `_drop_ex_friends`), there is no
-- trigger on either circle table, and no foreign key runs between them in either direction. The
-- one mention of the word "certain" inside a circle function is a comment about the ladder.
-- So this block defends a decision rather than fixing a fault, and the thing it is defending
-- against is somebody later adding the OTHER design — which is tidier-sounding, which is the
-- problem: it means an audience changing while the person who chose it is not looking.
--
-- ⚠️ AND THE SILENT HALF IS WHY IT ASKS TWICE. Comparing the stored list catches a row being
-- deleted; `can_see_item` catches the audience actually changing. A live link would do both, but
-- a half-built one — say a circle rename that rewrote the list — could move the rows without
-- moving anybody's sight of it, or the reverse.
--
-- Made to fail, 4 Nov, by BUILDING the rejected design: an after-delete trigger on
-- `visibility_circle_members` that drops that person from the owner's certain lists, which a
-- circle delete then cascades into. Both assertions went red — the list went from two names to
-- one, and the friend lost sight of the item — and both are silent against the real schema.
--
-- The fixture holds TWO friends on purpose. With one, removing them from the circle empties the
-- list, and an empty list is also what a failed fixture looks like.
do $circles$
declare
  v_owner uuid := (select uid from cast_ where part = 'owner');
  v_on_u  text := (select u   from cast_ where part = 'on_list');
  v_off_u text := (select u   from cast_ where part = 'off_list');
  v_circle uuid; v_block uuid; v_kept int; v_before text; v_now text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  v_circle := public.visibility_circle_save(null, 'certain-lists circle');
  perform public.visibility_circle_set_member(v_circle, v_on_u, true);
  perform public.visibility_circle_set_member(v_circle, v_off_u, true);

  insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
  values (v_owner, 'bio', 93, 'small', '{"text":"circle shortcut fixture"}'::jsonb, 'certain')
  returning id into v_block;

  /* what the chooser's "fill from circle" amounts to: the names are copied in the client and
     saved as NAMES, so nothing on the item ever refers to the circle */
  v_kept := public.visibility_certain_set('profile_block', v_block::text,
                                          array[v_on_u, v_off_u]);

  v_before := (select string_agg(p.username::text, ',' order by p.username)
                 from public.visibility_certain vc
                 join public.profiles p on p.user_id = vc.friend
                where vc.item_kind = 'profile_block' and vc.item_id = v_block::text);

  /* the positive control: without a two-person list, "unchanged" below is two nulls agreeing */
  if v_kept <> 2 or v_before is null then
    insert into fails values ('FIXTURE: the item did not get a two-person list',
      coalesce(v_kept::text, 'null') || ' kept, list ' || coalesce(v_before, '(none)'));
    return;
  end if;

  perform public.visibility_circle_save(v_circle, 'certain-lists circle, renamed');
  perform public.visibility_circle_set_member(v_circle, v_off_u, false);
  perform public.visibility_circle_delete(v_circle);

  v_now := (select string_agg(p.username::text, ',' order by p.username)
              from public.visibility_certain vc
              join public.profiles p on p.user_id = vc.friend
             where vc.item_kind = 'profile_block' and vc.item_id = v_block::text);

  if v_now is distinct from v_before then
    insert into fails values ('editing or deleting a circle changed an item''s certain list',
      coalesce(v_before, '(none)') || ' -> ' || coalesce(v_now, '(none)'));
  end if;

  /* the friend who was taken OUT of the circle, and whose circle was then deleted, must still
     see the item -- the rows surviving is not the same claim as the audience surviving */
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select uid::text from cast_ where part = 'off_list'),
                      'role', 'authenticated')::text, true);
  if not coalesce(public.can_see_item(v_owner, 'certain', 'profile_block', v_block::text), false)
  then
    insert into fails values ('a friend lost sight of an item when the circle was deleted',
      'they were taken out of the circle and the circle then deleted');
  end if;
end
$circles$;

do $$
declare n int; msg text;
begin
  select count(*), string_agg(what || coalesce(' (' || detail || ')', ''), E'\n  ')
    into n, msg from fails;
  if n > 0 then
    raise exception E'certain-lists: % failure(s)\n  %', n, msg;
  end if;
  raise notice 'certain-lists: all green (cast: %)',
    (select string_agg(part || '=' || u, ', ' order by part) from cast_);
end $$;

rollback;
