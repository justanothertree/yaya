# The rollback text for docs/2026-11-10-chronicle-goal-refusals.DRAFT.sql

`chronicle_goal_save.sql` is that function's current text, byte for byte. It is what CI builds as
production's, and step 1 of `docs/2026-11-10-chronicle-goal-refusals-plan.md` reads production's own
md5 before anything runs. Its md5 is `4fadbf346a514f9f36de5fd3d52d823e`.

⚠️ **NOTHING IS ADDED TO IT, not even a comment**, so `md5sum` of the file still answers that.
Running it is a `create or replace` that keeps the function's grants.
