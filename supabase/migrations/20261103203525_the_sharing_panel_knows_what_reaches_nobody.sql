-- ✅ APPLIED 3 Nov 2026 as `the_sharing_panel_knows_what_reaches_nobody`.
--
-- ⚠️ "FRIENDS CAN SEE YOUR SITTINGS ON N ACTIVITIES" IS A DERIVED FIGURE, AND `certain`
-- CAN MAKE IT OVERSTATE. The Sharing panel counts what it is sharing and says so in a sentence
-- whose whole job is telling somebody who can see their days. The count was the `shared` boolean,
-- exactly right for private-or-friends. An activity at `certain` with nobody on its list is SET to
-- a sharing level and reaches no one -- so a count built on the tier alone would say 3 where the
-- truth is 2.
--
-- `item_reaches_anyone` is the predicate `feed_recent` already uses for the same question about
-- the same rows, so the panel's number and the feed's contents cannot disagree. Sent per activity,
-- because a per-row "Certain friends -- nobody picked yet" is the only thing that tells an owner
-- their list is empty before they find out from a friend's screen.
--
-- Measured:
--   certain, empty list    reaches false   -> the row says "nobody picked yet", not counted
--   certain, one friend    reaches true
--   friends                reaches true
--   and `shared` and `visibility` are both still in the payload, because the bundle reads them

/* ⚠️ "ON, AND SHARED WITH N ACTIVITIES" IS A DERIVED FIGURE, AND `certain` CAN MAKE IT LIE BY
   OVERSTATING. The Sharing panel counts the activities it is sharing and says so in words:
   "Friends can see your sittings on 3 activities". Until today the count was the `shared` boolean,
   which is exactly right for private-or-friends. An activity at `certain` with nobody on its list
   is SET to a sharing level and reaches no one — so a count built on the tier alone would say 3
   where the truth is 2, which is the confident wrong answer §2 warns about, in the sentence whose
   whole job is telling somebody who can see their days.

   `item_reaches_anyone` is the predicate `feed_recent` already uses for the same question about
   the same rows, so the panel's number and the feed's contents cannot disagree. Per activity,
   because a per-row "chosen friends — nobody picked yet" is the only thing that tells an owner
   their list is empty before they go looking for it on a friend's screen.

   `shared` and `visibility` both stay in the payload: the first is what the current bundle reads,
   and a reader that drops a field somebody is using is a breakage dressed as a cleanup. */
do $mig$
declare
  v_src text;
  v_out text;
  v_old constant text := E'''colour'', a.colour, ''shared'', a.shared,\n';
  v_new constant text := E'''colour'', a.colour, ''shared'', a.shared,\n'
    || E'                                          ''reaches'', public.item_reaches_anyone(\n'
    || E'                                            auth.uid(), a.visibility,\n'
    || E'                                            ''chronicle_activity'', a.id::text),\n';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'chronicle_sharing_mine';
  if v_src is null then raise exception 'chronicle_sharing_mine not found'; end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'the activity object is not where this migration expects it';
  end if;
  v_out := replace(v_src, v_old, v_new);
  execute v_out;
end
$mig$;
