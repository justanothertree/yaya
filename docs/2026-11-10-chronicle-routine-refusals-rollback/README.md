# The rollback text for docs/2026-11-10-chronicle-routine-refusals.DRAFT.sql

`chronicle_routine_save.sql` is that function's current text, byte for byte. It is what CI builds as
production's, and step 1 of `docs/2026-11-10-chronicle-routine-refusals-plan.md` reads production's own
md5 before anything runs. Its md5 is `295c8b99f86630a6c75c672a7f2d1dc8`.

⚠️ **NOTHING IS ADDED TO IT, not even a comment**, so `md5sum` of the file still answers that.
Running it is a `create or replace` that keeps the function's grants.
