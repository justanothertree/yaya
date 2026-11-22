-- ✅ APPLIED to production 22 Nov 2026 at 8:01 AM EST as migration
-- `chronicle_entry_amount_negative`, version 20261122130138, with Evan's approval of
-- OPEN-DECISIONS 21b. Production recorded md5(statements[1]) = 7ebd4aa1d3fdd2dc1f55b618cf137f10,
-- this file's body byte for byte. Check A before it: chronicle_entry_amount 417d779d…, the text
-- this was written against. Check B after: chronicle_entry_amount e506edb5…, anon refused,
-- members allowed.
-- Why, and the rollback: docs/applied/2026-11-10-chronicle-entry-amount-negative.DRAFT.sql,
-- docs/2026-11-10-chronicle-21ab-fix-plan.md and docs/2026-11-10-chronicle-21ab-rollback/.

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