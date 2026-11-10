# The Chronicle release's rollback text

Production's own text for the six functions the release patched, read from `pg_get_functiondef`
immediately before step 1 on 9 Nov 2026 (step 0 of `docs/2026-11-09-chronicle-release-plan.md`).
Each file is that output byte for byte, and its md5 is the one production reported:

| file                         | md5                                |
| ---------------------------- | ---------------------------------- |
| `chronicle_entry_amount.sql` | `257c45b4256bf9d278210b86704f561e` |
| `chronicle_export.sql`       | `f3e16bed381e455b3905c13d9f3deeae` |
| `chronicle_goals_mine.sql`   | `bff4311d27e4e8f24dbe30a2ad95c258` |
| `chronicle_import.sql`       | `bc19f91904908b0831338ddbc2a7a1f8` |
| `chronicle_tally.sql`        | `543f0572c074f53fc320db7f40903ee4` |
| `get_member_chronicle.sql`   | `6f86f652a8f27991880a2ff890b5799a` |

⚠️ **NOTHING IS ADDED TO THEM, not even a comment**, so `md5sum` of each file still answers the
question above. Running one is a `create or replace` that puts that function back as it was before
the release; it keeps its grants. Which ones to run, in what order, and what else each step's
rollback needs (some of which deletes what people wrote, and is asked first) is in the plan.
