-- ✅ APPLIED 3 Nov 2026 as `suspension_reaches_the_writers_by_rule_not_by_list`.
--
-- ⚠️ THREE SWEEPS BY HAND WENT STALE IN THREE DAYS. Ten functions guarded by name,
-- then seven more, and a census afterwards found **91** member-callable SECURITY DEFINER
-- writers still unguarded -- `post_profile_note` among them, which puts your words on somebody
-- else's page. A list cannot keep up with a schema, so this computes its set from the same
-- predicate the new standing check (block K in visibility-guards.sql) uses.
--
-- 44 guarded here. Who is out, by rule:
--   * delete-only functions (18). Suspension stops somebody acting on other people's screens;
--     taking your own things down is the opposite. That is the `picture_drop` decision made
--     general.
--   * admin-gated ones (17). `admin_set_suspended` must never be blocked by the state it
--     exists to change.
--   * `submit_contact_message` -- how a suspended member APPEALS. Shutting it would make the
--     punishment unappealable.
--   * `mark_activity_seen`, `mark_room_read` -- self-bookkeeping that reaches nobody.
--
-- And four with no auth guard to anchor to, named in the body so the gap is known rather than
-- silent: close_park_room, close_profile_room, link_snake_names_to_accounts, submit_score.
-- `submit_score` is handled in the very next migration; the two room-closers only close a room
-- of your own, which is a narrowing action.
--
-- Spot-checked afterwards: 65 functions now carry the guard, and in every one it sits
-- immediately after `begin` and the `not authenticated` line. The 11 whose guard appears later
-- than 400 characters in are the ones with long `declare` blocks or the earlier verbose
-- comments, not misplacement.

do $mig$
declare
  r record;
  v_src text;
  v_out text;
  v_pat constant text := $re$(is null then\s*raise exception '[^']*';\s*end if;)$re$;
  v_add constant text := $g$\1
  if coalesce(public.is_suspended(auth.uid()), false) then
    raise exception 'your account is suspended';
  end if;$g$;
  v_done int := 0;
begin
  /* ⚠️ THE FIRST TWO SWEEPS WERE LISTS AND BOTH WENT STALE WITHIN A DAY. Ten functions were
     named on 3 Nov, then seven more, and a census afterwards found 91 member-callable
     SECURITY DEFINER writers still unguarded. A list cannot keep up with a schema; the set is
     computed here from the same predicate the standing guard check now uses.

     WHO IS IN: a function that is SECURITY DEFINER, executable by `authenticated`, and performs
     an INSERT or an UPDATE. Those are the ones that put something on somebody's screen.

     WHO IS OUT, and why each one:

     * anything whose only writes are DELETEs (18 of them -- chronicle_entry_drop, library_drop,
       park_map_drop, remove_friend, leave_circuit, picture_drop...). Suspension exists to stop
       somebody acting on other people's screens; taking your own things down is the opposite,
       and blocking it would trap a suspended member with the very thing they were suspended for.
     * anything that checks `is_admin()` itself, and anything named `admin_*` (17). They have
       their own gate, and `admin_set_suspended` in particular must never be blocked by the
       state it exists to change.
     * `submit_contact_message`. It is how somebody APPEALS a suspension. Shutting that door
       would make the punishment unappealable, which is not what suspension is for.
     * `mark_activity_seen` and `mark_room_read`. Pure self-bookkeeping -- they clear your own
       unread badges and reach nobody else's screen.

     Four writers have no `... is null then raise exception ...; end if;` block to anchor to and
     are left for individual attention: close_park_room, close_profile_room,
     link_snake_names_to_accounts and submit_score. The count assertion below is what makes that
     a known gap rather than a silent one. */
  for r in
    select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
       and has_function_privilege('authenticated', p.oid, 'execute')
       and p.proname not like 'admin\_%'
       and p.proname not in ('submit_contact_message', 'mark_activity_seen', 'mark_room_read')
       and regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/',' ','gs'),
                          '--[^'||chr(10)||']*',' ','g')
             ~* '\m(insert\s+into|update)\s+(public\.)?[a-z_]+'
       and regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/',' ','gs'),
                          '--[^'||chr(10)||']*',' ','g') !~* 'is_suspended'
       and regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/',' ','gs'),
                          '--[^'||chr(10)||']*',' ','g') !~* 'is_admin\s*\(\)'
       and p.prosrc ~ '(is null then\s*raise exception ''[^'']*'';\s*end if;)'
       /* one function per name: none of these is overloaded, and the assertion would catch it */
     order by p.proname
  loop
    select pg_get_functiondef(p.oid) into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname = r.proname;

    if v_src is null then raise exception 'function % not found', r.proname; end if;
    if v_src ~* 'is_suspended' then
      raise exception '% already mentions is_suspended', r.proname;
    end if;

    v_out := regexp_replace(v_src, v_pat, v_add);
    if v_out = v_src then raise exception 'the auth guard was not found in %', r.proname; end if;
    if (select count(*) from regexp_matches(v_out, 'is_suspended', 'g')) <> 1 then
      raise exception 'expected exactly one guard in %', r.proname;
    end if;

    execute v_out;
    v_done := v_done + 1;
  end loop;

  if v_done <> 44 then
    raise exception 'expected 44 functions, guarded % -- the schema has moved, look before rerunning', v_done;
  end if;
end
$mig$;
