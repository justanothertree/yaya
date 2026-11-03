-- ✅ APPLIED 3 Nov 2026 as `the_block_reader_tells_its_owner_the_list`.
--
-- THE EDITOR CANNOT SHOW A LIST IT HAS NEVER BEEN SENT. `save_my_profile_blocks` has taken a
-- `certain` array per block since 3 Nov and `get_profile_blocks` never returned one -- so the page
-- editor could WRITE a list with no way to read back the one already there. Opening the panel on a
-- block set to Certain would show an empty chooser above a list with three people on it, and the
-- next save would send that emptiness as a decision.
--
-- ⚠️ THE OWNER ONLY, WHICH IS WHY IT IS A `case` AND NOT A JOIN. Who else is on a list
-- is the owner's choice about other people: telling a viewer "you and two others can see this"
-- hands them two of their friend's private decisions, and naming them hands over the names. A
-- viewer gets `null` -- not `[]`, which would read as "the list is empty" and be a different false
-- statement. No new row is served: `get_profile_blocks` already gives an owner every block they
-- have, so this is one more field on rows they already had.
--
-- Measured:
--   the owner, on a certain block        ["Salty"]
--   the owner, on a friends block        []
--   a viewer who IS on the list         null -- and the block itself, which they can see
--   the owner, after the friendship ended  []  (ex-friends grant nothing, so they are not named)

/* THE EDITOR CANNOT SHOW A LIST IT HAS NEVER BEEN SENT. `save_my_profile_blocks` has taken a
   `certain` array per block since 3 Nov, and `get_profile_blocks` has never returned one -- so a
   page editor could WRITE a list and had no way to read back the one already there. Opening the
   panel on a block set to Certain would show an empty chooser above a list with three people on
   it, and the next save would send that emptiness as a decision.

   ⚠️ THE OWNER ONLY, AND THIS IS THE WHOLE REASON IT IS A `case` RATHER THAN A JOIN. Who else is
   on a list is the owner's choice about other people: telling a viewer "you and two others can
   see this" hands them two of their friend's private decisions, and telling them WHICH two hands
   over the names. A viewer gets `null` -- not `[]`, which would read as "the list is empty" and
   be a different false statement. `get_profile_blocks` already serves the owner every block
   regardless of tier, so there is no new row here, only a new field on rows they already had.

   Ex-friends are filtered the way `visibility_certain_get` filters them: a membership whose
   friendship has ended grants nothing, so it is not part of the answer, and the chooser must not
   offer to keep somebody the save would drop anyway. */
do $mig$
declare
  v_src text;
  v_out text;
  v_old constant text := E'      ''size'', b.size, ''config'', b.config, ''visibility'', b.visibility\n';
  v_new constant text := E'      ''size'', b.size, ''config'', b.config, ''visibility'', b.visibility,\n'
    || E'      /* the block''s Certain list, for its OWNER and nobody else -- a viewer gets null,\n'
    || E'         which is not the same statement as an empty list */\n'
    || E'      ''certain'', case when v_target = v_viewer then coalesce((\n'
    || E'          select jsonb_agg(pr.username::text order by lower(pr.username::text))\n'
    || E'            from public.visibility_certain vc\n'
    || E'            join public.profiles pr on pr.user_id = vc.friend\n'
    || E'           where vc.item_kind = ''profile_block'' and vc.item_id = b.id::text\n'
    || E'             and vc.owner = v_target\n'
    || E'             and coalesce(public.are_friends(v_target, vc.friend), false)\n'
    || E'        ), ''[]''::jsonb) end\n';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'get_profile_blocks';
  if v_src is null then raise exception 'get_profile_blocks not found'; end if;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'the block object is not where this migration expects it';
  end if;
  v_out := replace(v_src, v_old, v_new);
  execute v_out;
end
$mig$;
