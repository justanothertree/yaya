# The Chronicle server batch: one plan to approve

⛔ **DRAFT. Nothing in it has run against production.** Evan asked on 10 Nov 2026 for the four
production plans to be held and combined so they are approved once. This is that plan. Each step
below is run by Claude after that approval and not before. The four plans it combines stay as the
detail behind each change:

| §   | Plan                                                  | Function                  |
| --- | ----------------------------------------------------- | ------------------------- |
| 21a | `docs/2026-11-10-chronicle-21ab-fix-plan.md`          | `chronicle_moments`       |
| 21b | `docs/2026-11-10-chronicle-21ab-fix-plan.md`          | `chronicle_entry_amount`  |
| A   | `docs/2026-11-10-chronicle-activity-refusals-plan.md` | `chronicle_activity_save` |
| G   | `docs/2026-11-10-chronicle-goal-refusals-plan.md`     | `chronicle_goal_save`     |
| R   | `docs/2026-11-10-chronicle-routine-refusals-plan.md`  | `chronicle_routine_save`  |

## What changes

Five functions, each replaced from its own draft. No table, column, row or grant changes, and nothing
needs deploying.

- **21a.** A day's workout line keeps its decimals: 3.5 mi stops reading "4 mi".
- **21b.** A negative amount on a sitting with no counted sets leaves it with no amount, as before
  the release, instead of a refusal reading "sets count <NULL>".
- **A, G, R.** An over-long activity name or unit, goal title, unit or note, or routine name is
  refused in a sentence, instead of the constraint's own words. A routine step of ten or more
  digits is held at 600 minutes instead of overflowing an integer. The boxes already stop at these
  limits (released in #163), so these cover whatever still arrives, such as an old open tab.

Each draft refuses to run unless its live function is the exact text it was written against (an md5
guard), and unless each piece it replaces appears in it exactly once.

## Apply order

**1. Check A, read-only.** If any line differs from what is expected, stop before step 2.

```sql
select p.proname, md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('chronicle_moments', 'chronicle_entry_amount', 'chronicle_activity_save',
                     'chronicle_goal_save', 'chronicle_routine_save')
 order by 1;
-- expect  chronicle_activity_save  8ee2ec8d4bf532378073214b9d438c74
--         chronicle_entry_amount   417d779dd1f47ecb979103dc99e464b8
--         chronicle_goal_save      4fadbf346a514f9f36de5fd3d52d823e
--         chronicle_moments        ffdfc4c1ab852577d1a7e8c24ead8f73
--         chronicle_routine_save   295c8b99f86630a6c75c672a7f2d1dc8

select current_setting('server_version_num')::int >= 130000 as has_trim_scale;  -- expect true

select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as member
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('chronicle_moments', 'chronicle_entry_amount', 'chronicle_activity_save',
                     'chronicle_goal_save', 'chronicle_routine_save')
 order by 1;
-- expect anon false and member true, for all five
```

**1b. The `1.2.3` count, read-only.** It is the query in step 1b of the 21ab plan, and it does not
block anything: it is reported to Evan before step 2, because a non-zero count means members whose
workout lines error today. 21a keeps the same pattern and cast.

**2 to 6. One `apply_migration` each, in this order.** The body of each is its draft after its
leading comment block.

| Step | Migration name                    | Draft                                                       |
| ---- | --------------------------------- | ----------------------------------------------------------- |
| 2    | `chronicle_moments_decimals`      | `docs/2026-11-10-chronicle-moments-decimals.DRAFT.sql`      |
| 3    | `chronicle_entry_amount_negative` | `docs/2026-11-10-chronicle-entry-amount-negative.DRAFT.sql` |
| 4    | `chronicle_activity_refusals`     | `docs/2026-11-10-chronicle-activity-refusals.DRAFT.sql`     |
| 5    | `chronicle_goal_refusals`         | `docs/2026-11-10-chronicle-goal-refusals.DRAFT.sql`         |
| 6    | `chronicle_routine_refusals`      | `docs/2026-11-10-chronicle-routine-refusals.DRAFT.sql`      |

The five touch five different functions, so none depends on another. If one refuses (its guard
found different text), stop there: the steps before it are each complete and correct on their own,
and are kept or rolled back as Evan chooses.

**7. Check B, read-only.** The md5 query from check A, expecting:

```
chronicle_activity_save  91d49b2b1b3f488701381cfb9ba1c521
chronicle_entry_amount   e506edb5a99f78a0e03bd0bd83323956
chronicle_goal_save      86dc70b24fe393d0b3aab6881fff7887
chronicle_moments        d3d4fcc166328fb4d70a92c2b49f7a3b
chronicle_routine_save   f8a12a738559ef136f9e38e96df0652a
```

and the grant query from check A, unchanged: anon false, member true, for all five.

**8. The record, as one PR.**

- The five migration files and their `applied.md5` lines. `npm run test` fails without them.
- The drafts' headers marked ✅ APPLIED.
- OPEN-DECISIONS 21a and 21b marked done.
- The preview stand-ins follow production, each with a test: `pvMoments`, `pvAmount`,
  `pvSaveActivity`, `pvSaveGoal`, `pvSaveRoutine`.

## Rollback

Per function, in any combination, each independent of the others. Undo the most recent first if
undoing several. Run the whole of the function's file; it is that function's text as check A expects
it, byte for byte, so `md5sum` of the file gives check A's number:

| Function                  | File                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `chronicle_routine_save`  | `docs/2026-11-10-chronicle-routine-refusals-rollback/chronicle_routine_save.sql`   |
| `chronicle_goal_save`     | `docs/2026-11-10-chronicle-goal-refusals-rollback/chronicle_goal_save.sql`         |
| `chronicle_activity_save` | `docs/2026-11-10-chronicle-activity-refusals-rollback/chronicle_activity_save.sql` |
| `chronicle_entry_amount`  | `docs/2026-11-10-chronicle-21ab-rollback/chronicle_entry_amount.sql`               |
| `chronicle_moments`       | `docs/2026-11-10-chronicle-21ab-rollback/chronicle_moments.sql`                    |

Each is a `create or replace` that keeps the function's grants. None of the five changes writes a
row, so nothing else needs undoing. Afterwards, check A's md5 query returns the original numbers.

## Proven in CI

db guards run 42838268967 (scratch branch `chronicle/ci-probe-server-batch`, commit `39a13ca7`,
09:50 to 09:53 EST on 10 Nov), on CI's database: the 4 Nov dump plus the release's seven migrations.

- Check A matched all five md5s above, with anon refused and members allowed on each, and the
  version check true.
- Steps 2 to 6 applied in this order, and check B's five md5s matched.
- The four plans' tests (`chronicle-21ab.sql`, `chronicle-activity-refusals.sql`,
  `chronicle-goal-refusals.sql`, `chronicle-routine-refusals.sql`) all passed on the result.
- The five rollback files, run most recent first, hashed to check A's numbers. Running them put all
  five functions back to those numbers, with the grants unchanged.
- The standing guards that run after them in the same job passed.

Each change was also proven on its own first, its test failing against today's function before
passing with the draft (db guards runs 42817607061 and 42827114937).
