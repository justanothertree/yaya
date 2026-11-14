-- ⛔ PROBE ONLY: strips five rules from feed_recent after the step 3 draft, so the step 3 test
-- can be watched naming each failure. Never to be merged.
do $p$
declare r record; v_src text; v_n int;
begin
  for r in select * from (values
    ($x$               and c.removed_at is null
$x$, $x$$x$),
    ($x$               and not d.hidden
$x$, $x$$x$),
    ($x$               and public.guestbook_open_to(n.profile_user_id)
$x$, $x$$x$),
    ($x$               and not coalesce(public.is_suspended(v_me), false)
$x$, $x$$x$),
    ($x$else public.can_see_item(b.user_id, b.visibility,$x$, $x$else true or public.can_see_item(b.user_id, b.visibility,$x$)
  ) v(old, new) loop
    select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'feed_recent';
    v_n := (length(v_src) - length(replace(v_src, r.old, ''))) / length(r.old);
    if v_n <> 1 then raise exception 'perturbation anchor found % times: %', v_n, r.old; end if;
    execute replace(v_src, r.old, r.new);
  end loop;
end $p$;
