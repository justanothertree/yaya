-- ✅ APPLIED 3 Nov 2026 as `the_block_reader_consults_the_list`.
--
-- ⚠️ ONE LINE, AND IT IS THE LINE THAT MAKES `certain` A REAL LEVEL. The table, the
-- ownership check, the list writer and the per-item door all granted nothing until now, because
-- `get_profile_blocks` asked the two-argument `can_see`, which fails closed on `certain` by
-- design. This is the first reader to ask `can_see_item`.
--
-- Measured end to end, in a rolled-back transaction, on a page with two `certain` blocks --
-- one naming a friend, one with an empty list:
--
--   the owner                        2 blocks   both, whatever the tier
--   the friend named on one list     1 block    exactly the one naming them
--   a non-friend member              0 blocks
--   that friend, after unfriending   0 blocks   access ends with the friendship
--
-- The member-to-member matrix is unchanged (196 / 539 / 6,945 / 130, md5
-- b89fc62c856482e4e5b248651da62fa0): no block on the live site is set to `certain` yet, because
-- nothing in the client can set one. That is the next piece.

do $mig$
declare v_src text; v_out text;
begin
  /* ⚠️ ONE LINE, AND IT IS THE LINE THAT MAKES `certain` A REAL LEVEL. Everything else built so
     far -- the table, the ownership check, the list writer, the per-item door -- granted nothing,
     because `get_profile_blocks` asked the two-argument `can_see`, which fails closed on
     `certain` by design. This is the first reader to ask the item-aware one.

     `v_target = v_viewer or ...` stays in front of it: the owner sees their own page whatever
     the tier, and short-circuiting there saves a lookup on every block of your own profile. */
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'get_profile_blocks';
  if v_src is null then raise exception 'get_profile_blocks not found'; end if;

  v_out := replace(v_src,
    'and (v_target = v_viewer or public.can_see(v_target, b.visibility))',
    'and (v_target = v_viewer
           or public.can_see_item(v_target, b.visibility, ''profile_block'', b.id::text))');
  if v_out = v_src then raise exception 'the can_see call was not found'; end if;
  execute v_out;
end
$mig$;
