-- ✅ APPLIED 30 Oct 2026 as `drop_the_duplicate_demo_index`.
--
-- The previous migration created an index that already existed under another name.
--
-- ⚠️ `create unique index if not exists` CHECKS THE NAME, NOT THE DEFINITION. `profiles` already
-- carried `ux_profiles_one_demo` -- `unique ((true)) where is_demo`, which enforces exactly the
-- same thing -- so `profiles_one_demo_row` was a second index doing identical work on every
-- write to the table. "If not exists" reads like a safety net and is only one about the name.
--
-- Found because the test that proved the one-demo-row rule reported the constraint that actually
-- fired, and it was not the one just created. A check that prints WHICH rule stopped it is worth
-- more than one that prints "refused".
--
-- The pre-existing index is kept; the new duplicate goes.

drop index if exists public.profiles_one_demo_row;
