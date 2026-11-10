-- ⛔ DRAFT, NOT APPLIED. OPEN-DECISIONS 21b; the plan is docs/2026-11-10-chronicle-21ab-fix-plan.md,
-- and nothing here runs until Evan approves it.
--
-- chronicle_entry_amount refuses a negative amount on a sitting with no counted sets, and says
-- "this sitting's sets count <NULL> — change those to go lower". The release's floor check
-- compares coalesce(p_amount, 0) with the counted sets, so -4 is below a floor of 0, and the
-- message prints a sum that is NULL because there are no sets. Before the release a negative was
-- stored as no amount (docs/2026-11-09-chronicle-release-rollback/chronicle_entry_amount.sql), and
-- the update below still does exactly that.
--
-- The fix measures a negative against the floor as 0. With no counted sets it passes, and the
-- sitting is left with no amount, as before the release. With counted sets it is refused like a
-- blank is, and the message names their sum, which is then always above 0, so it can no longer
-- print NULL. No stored row changes.
--
-- It refuses to run unless the live function is the exact text it was written against (md5
-- 417d779d…, production's since the release, which step 1 of the plan reads again) and the old
-- condition appears in it exactly once.

do $mig$
declare
  v_old constant text := 'if coalesce(p_amount, 0) < coalesce(';
  v_new constant text :=
    E'/* a negative amount is stored as no amount below, so it meets the floor as 0 */\n'
    || '  if greatest(coalesce(p_amount, 0), 0) < coalesce(';
  v_src text;
  v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'chronicle_entry_amount';
  if v_src is null then raise exception 'chronicle_entry_amount not found'; end if;
  if md5(v_src) <> '417d779dd1f47ecb979103dc99e464b8' then
    raise exception 'chronicle_entry_amount is not the text this was written against (md5 %)', md5(v_src);
  end if;

  v_hits := (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old);
  if v_hits <> 1 then
    raise exception 'expected 1 of [%] in chronicle_entry_amount, found %', v_old, v_hits;
  end if;

  execute replace(v_src, v_old, v_new);
end $mig$;
