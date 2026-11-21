# Drafts that have been applied

A draft in `docs/` is SQL waiting for a decision. Once it has been applied to production the
migration beside it is the record of what ran, and the draft becomes history: the reasoning, the
rollback it was written with, and whatever was true when it was written. Still worth keeping —
§11 calls these files the project's memory of _why_ — but no longer a thing anybody is about to
run, which is what `docs/` is for.

Every file here carries a `✅ APPLIED` header naming the migration that ran it. Nothing was
pruned; they moved, and `git log --follow` reaches straight back through the rename.

## ⚠️ A frozen migration may still name the old path, and that is on purpose

Seventeen applied migrations point at these drafts by their old `docs/<name>.DRAFT.sql` location
in their own headers. **Those were not updated**, because a migration is the record of an event
and not source that can be corrected — `scripts/migration-md5.mjs` enforces exactly that, and it
caught the first version of this move within a minute: seventeen edited files, three tests red.

So if you have followed a path like `docs/2026-11-16-lab-match-nudge.DRAFT.sql` out of a
migration and found nothing there, it is here. That dangling pointer is the price of the move,
and it is cheaper than the alternative: editing seventeen immutable records to tidy a directory.

## The one that is still a draft

`docs/2026-11-09-circuit-logs-conversion.DRAFT.sql` stays in `docs/`. It says NOT APPLIED and
there is no migration for it, so it is the only one of the nineteen that is still what its name
says it is.
