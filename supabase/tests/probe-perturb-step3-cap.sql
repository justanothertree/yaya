-- ⛔ PROBE ONLY: makes the made branch show any version of a kind the owner still has on a
-- page, so section E2 can be watched naming it. Never to be merged.
do $p$
declare v_src text; v_n int;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'feed_recent';
  v_n := (length(v_src) - length(replace(v_src, $x$                    and md5(b.config::text) = s.config_md5
$x$, ''))) / length($x$                    and md5(b.config::text) = s.config_md5
$x$);
  if v_n <> 1 then raise exception 'perturbation anchor found % times', v_n; end if;
  execute replace(v_src, $x$                    and md5(b.config::text) = s.config_md5
$x$, '');
end $p$;
