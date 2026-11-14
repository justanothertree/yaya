# The 21a and 21b rollback text

The current text of the two functions the 21a and 21b drafts change, byte for byte. It is what CI
builds as production's (the 4 Nov dump plus the release's seven migrations), and step 1 of
`docs/2026-11-10-chronicle-21ab-fix-plan.md` checks production's own md5s before anything runs:

| file                         | md5                                |
| ---------------------------- | ---------------------------------- |
| `chronicle_entry_amount.sql` | `417d779dd1f47ecb979103dc99e464b8` |
| `chronicle_moments.sql`      | `ffdfc4c1ab852577d1a7e8c24ead8f73` |

⚠️ **NOTHING IS ADDED TO THEM, not even a comment**, so `md5sum` of each file still answers the
question above. Running one is a `create or replace` that puts that function back as it is today and
keeps its grants. Neither fix writes a row, so nothing else needs undoing.
