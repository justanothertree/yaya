-- ✅ APPLIED 3 Nov 2026 as `a_certain_list_survives_the_round_trip`.
--
-- ⚠️ A TIER WITHOUT ITS LIST IS NOT A ROUND TRIP, IT IS A SILENT NARROWING. The export
-- already carried `visibility`, so a `certain` activity came back as `certain` -- with an empty
-- list, which by Evan's own rule means Only me. ⬆ Put one back would have restored the LEVEL and
-- lost the PEOPLE, leaving its owner looking at a control reading "Certain friends" above an
-- audience of nobody.
--
-- The same shape as the `shared` bug this function was fixed for two ticks ago, and as the three
-- save-path deletions in §8: an optional field, a path that does not mention it, and a silence
-- read as a decision. Fail-closed, so nothing leaks -- and a setting lost is still a setting lost.
--
-- ⚠️ USERNAMES, NOT IDS, and the choice does two jobs. The file travels between
-- machines and gets passed around, so a list of account uuids would put other people's
-- identifiers in it for nothing. And on the way back in, an account id is a CLAIM while a
-- username is a lookup that still has to pass `are_friends` -- so the list is re-earned rather
-- than restored, exactly as `visibility_certain_set` would have it, and a name that has drifted
-- out of the friendship is simply dropped. Capped at 50 per item, and only written when the tier
-- that was actually STORED is `certain`, because an INSERT cannot lean on the UPDATE trigger.
--
-- Measured, and PERTURBED, which is the half that makes it worth anything:
--   export: the activity's list      ["Josh", "Salty"]
--   export: the goal's list          ["Salty"]
--   export: an ordinary friends one  []
--   wipe everything, restore         tier `certain`, list "Josh, Salty" and "Salty" back
--   a friend off the list            still cannot see it; one on it can
--   THE PERTURBATION: the same file with every `certain` key removed
--                                    tier `certain`, list EMPTY
-- That last line is the control. Without it the test proves only that the tier survives, which
-- it did before this migration.

/* ⚠️ A TIER WITHOUT ITS LIST IS NOT A ROUND TRIP, IT IS A SILENT NARROWING. The export already
   carries `visibility`, so a `certain` activity comes back as `certain` -- with an empty list,
   which by Evan's own rule means Only me. So ⬆ Put one back would restore the LEVEL and lose the
   PEOPLE, and the owner would be looking at a control reading "Certain friends" above a list
   that is empty and an audience that is nobody.

   That is the same shape as the `shared` bug this function was fixed for two ticks ago and as
   the three save-path deletions in §8: an optional field, a path that does not mention it, and a
   silence read as a decision. Fail-closed, so nothing leaks -- and a setting lost is still a
   setting lost.

   ⚠️ USERNAMES, NOT IDS. The file travels between machines and gets passed around; a list of
   account uuids would put other people's identifiers in it for nothing, since a username is
   what `visibility_certain_set` already takes and what the picker shows. It is also the right
   thing on restore: an account id in a file is a claim, a username is a lookup that still has
   to pass `are_friends`. */
do $mig$
declare
  r record;
  v_src text;
  v_out text;
  v_hits int;
  v_done int := 0;
begin
  for r in
    select * from (values
      /* ── the export ───────────────────────────────────────────────────────────────── */
      ('chronicle_export',
       E'               ''visibility'', a.visibility)\n',
       E'               ''visibility'', a.visibility,\n'
       || E'               ''certain'', coalesce((\n'
       || E'                  select jsonb_agg(pr.username::text order by lower(pr.username::text))\n'
       || E'                    from public.visibility_certain vc\n'
       || E'                    join public.profiles pr on pr.user_id = vc.friend\n'
       || E'                   where vc.item_kind = ''chronicle_activity''\n'
       || E'                     and vc.item_id = a.id::text and vc.owner = me\n'
       || E'               ), ''[]''::jsonb))\n', 1),
      ('chronicle_export',
       E'               ''shared'', g.shared, ''visibility'', g.visibility,\n',
       E'               ''shared'', g.shared, ''visibility'', g.visibility,\n'
       || E'               ''certain'', coalesce((\n'
       || E'                  select jsonb_agg(pr.username::text order by lower(pr.username::text))\n'
       || E'                    from public.visibility_certain vc\n'
       || E'                    join public.profiles pr on pr.user_id = vc.friend\n'
       || E'                   where vc.item_kind = ''chronicle_goal''\n'
       || E'                     and vc.item_id = g.id::text and vc.owner = me\n'
       || E'               ), ''[]''::jsonb),\n', 1),
      /* ── the restore ──────────────────────────────────────────────────────────────── */
      ('chronicle_import',
       E'      if found then n_act := n_act + 1; v_acts := v_acts + 1; else refused := refused + 1; end if;\n',
       E'      if found then\n'
       || E'        n_act := n_act + 1; v_acts := v_acts + 1;\n'
       || E'        /* ⚠️ THE LIST IS RE-EARNED, NOT RESTORED. Every name in the file has to still\n'
       || E'           be an accepted friend, which is the rule `visibility_certain_set` keeps and\n'
       || E'           the reason the file holds usernames rather than ids: a name that has drifted\n'
       || E'           out of the friendship is simply dropped, exactly as the picker drops one\n'
       || E'           that came from a stale circle. Capped at 50, the same per-item ceiling\n'
       || E'           `save_my_profile_blocks` applies -- an unbounded array in a file somebody\n'
       || E'           hands you is somebody else''s denial-of-service.\n'
       || E'\n'
       || E'           And only when the tier that was actually STORED is `certain`: an older file,\n'
       || E'           or one whose tier was clamped on the way in, must not leave a list behind on\n'
       || E'           a row that is not at that level. The UPDATE trigger cannot help here --\n'
       || E'           this is an INSERT. */\n'
       || E'        insert into public.visibility_certain (owner, item_kind, item_id, friend)\n'
       || E'        select me, ''chronicle_activity'', (x->>''id'')::uuid::text, pr.user_id\n'
       || E'          from jsonb_array_elements_text(\n'
       || E'                 case when jsonb_typeof(x->''certain'') = ''array''\n'
       || E'                      then x->''certain'' else ''[]''::jsonb end\n'
       || E'               ) with ordinality u(nm, ord)\n'
       || E'          join public.profiles pr on lower(pr.username::text) = lower(btrim(u.nm))\n'
       || E'         where u.ord <= 50\n'
       || E'           and pr.user_id <> me\n'
       || E'           and coalesce(public.are_friends(me, pr.user_id), false)\n'
       || E'           and public.chronicle_tier_from_file(\n'
       || E'                 x->>''visibility'', (x->>''shared'')::boolean, me) = ''certain''\n'
       || E'        on conflict (item_kind, item_id, friend) do nothing;\n'
       || E'      else refused := refused + 1; end if;\n', 1),
      ('chronicle_import',
       E'        if found then n_goal := n_goal + 1; v_goals := v_goals + 1; else refused := refused + 1; end if;\n',
       E'        if found then\n'
       || E'          n_goal := n_goal + 1; v_goals := v_goals + 1;\n'
       || E'          /* the same re-earning as the activities above */\n'
       || E'          insert into public.visibility_certain (owner, item_kind, item_id, friend)\n'
       || E'          select me, ''chronicle_goal'', (x->>''id'')::uuid::text, pr.user_id\n'
       || E'            from jsonb_array_elements_text(\n'
       || E'                   case when jsonb_typeof(x->''certain'') = ''array''\n'
       || E'                        then x->''certain'' else ''[]''::jsonb end\n'
       || E'                 ) with ordinality u(nm, ord)\n'
       || E'            join public.profiles pr on lower(pr.username::text) = lower(btrim(u.nm))\n'
       || E'           where u.ord <= 50\n'
       || E'             and pr.user_id <> me\n'
       || E'             and coalesce(public.are_friends(me, pr.user_id), false)\n'
       || E'             and public.chronicle_tier_from_file(\n'
       || E'                   x->>''visibility'', (x->>''shared'')::boolean, me) = ''certain''\n'
       || E'          on conflict (item_kind, item_id, friend) do nothing;\n'
       || E'        else refused := refused + 1; end if;\n', 1)
    ) as v(fn, old, new, want)
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.fn;
    if v_src is null then raise exception 'function % not found', r.fn; end if;

    v_hits := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_hits <> r.want then
      raise exception 'expected % of [%] in %, found %', r.want, r.old, r.fn, v_hits;
    end if;

    v_out := replace(v_src, r.old, r.new);
    execute v_out;
    v_done := v_done + 1;
  end loop;
  if v_done <> 4 then raise exception 'expected 4 substitutions, made %', v_done; end if;

  /* `version` stays at 1. The export's own header says to bump it when a field CHANGES MEANING
     and never when one is added, and `certain` is an addition: a reader that does not know about
     it reads the file exactly as before.

     Asserted against the SOURCE rather than by calling the function: `chronicle_export` raises
     'not authenticated' for a migration, which has no session. */
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'chronicle_export'
       and p.prosrc like '%''version'', 1,%'
  ) then
    raise exception 'the export version moved, which this migration did not intend';
  end if;
end
$mig$;
