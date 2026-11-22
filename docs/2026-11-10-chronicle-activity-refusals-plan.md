# An activity's name and unit, refused in words: the production fix plan

⛔ **DRAFT. Nothing in it has run against production.** Found by the Chronicle server audit of
10 Nov 2026, which asked every Chronicle writer, as a member, for its refusals to a value that breaks
a rule (db guards run 42825583418). Evan approves this plan, or not, as one step, and each step
below is run by Claude after that approval and not before.

## What changes

`chronicle_activity_save` let the table refuse these, so the room, which shows a refusal word for word, showed the
constraint's own sentence. The add and edit forms check only that a name is not empty, and neither the name box nor the unit box has a length limit, so both long cases are reachable by typing.

| What is sent                    | What the member reads today                                                                               | After                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| An empty or blank name          | `new row for relation "chronicle_activities" violates check constraint "chronicle_activities_name_check"` | "an activity needs a name"                   |
| A name of 61 characters or more | the same constraint sentence                                                                              | "that is longer than a name — 60 characters" |
| A unit of 17 characters or more | the same sentence, about `chronicle_activity_metric_short`                                                | "that is longer than a unit — 16 characters" |

One function changes. No table, column, row or grant changes, and nothing needs deploying: the room
already shows whatever the server says. The SQL is `docs/2026-11-10-chronicle-activity-refusals.DRAFT.sql`,
which refuses to run unless the live function is the exact text it was written against.

## Steps

**1. Check A, read-only.** If it differs, stop. The draft would refuse anyway.

```sql
select md5(pg_get_functiondef('public.chronicle_activity_save(uuid, text, text, text, text, integer, boolean)'::regprocedure));
-- expect 8ee2ec8d4bf532378073214b9d438c74
```

**2.** `apply_migration`, name `chronicle_activity_refusals`. The body is the draft after its leading comment block.

**3. Check B, read-only.**

```sql
select md5(pg_get_functiondef('public.chronicle_activity_save(uuid, text, text, text, text, integer, boolean)'::regprocedure));
-- expect 91d49b2b1b3f488701381cfb9ba1c521
select has_function_privilege('anon', 'public.chronicle_activity_save(uuid, text, text, text, text, integer, boolean)', 'execute') as anon,
       has_function_privilege('authenticated', 'public.chronicle_activity_save(uuid, text, text, text, text, integer, boolean)', 'execute') as member;
-- expect anon false, member true
```

**4. The record, as a PR.**

- The migration file and its `applied.md5` line. `npm run test` fails without them.
- The draft's header marked ✅ APPLIED.
- The stand-in follows production, with a test: `pvSaveActivity` refuses the same three things in the same words.

## Rollback

Run the whole of `docs/2026-11-10-chronicle-activity-refusals-rollback/chronicle_activity_save.sql`. It is the function's
text as check A expects it, byte for byte, so `md5sum` of the file gives check A's number. Running it
is a `create or replace` that keeps the function's grants. Nothing else needs undoing, because the fix
writes no row. Afterwards, check A's query returns the original md5.

## Proven in CI

db guards run 42827114937 (scratch branch `chronicle/ci-probe-refusal-plans`, commit `b64effbf`,
08:43 to 08:45 EST on 10 Nov). It ran on CI's database: the 4 Nov dump plus the release's seven
migrations, where `chronicle_activity_save` has check A's md5.

- `supabase/tests/chronicle-activity-refusals.sql`, run against today's function, failed exactly its
  6 refusal checks, each with the constraint sentence in the table above.
- With the draft applied, it passed. It checks each refusal word for word, that the limits
  themselves still save, and that an edit leaves alone what it was not sent.
- Run a second time, the draft refused on its md5 guard, naming check B's md5.
- The rollback file hashed to check A's md5. Running it put the function back to that md5, with
  anon still refused and members still allowed.
