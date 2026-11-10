# 21a and 21b: the production fix plan

⛔ **DRAFT. Nothing in it has run against production.** OPEN-DECISIONS §21. Evan asked for this
plan on 10 Nov 2026 and approves it, or not, as one step. Each step below is run by Claude after
that approval and not before.

## What changes

| §   | Function                 | Before                                                                                           | After                                                                                                                                        |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 21a | `chronicle_moments`      | The day's workout line rounds every number to a whole one: 3.5 mi reads "4 mi", 0.25 min "0 min" | It keeps up to two decimals: "3.5 mi", "0.25 min", and 12 stays "12"                                                                         |
| 21b | `chronicle_entry_amount` | A negative amount is refused with "this sitting's sets count <NULL> — change those to go lower"  | With no counted sets, a negative leaves the sitting with no amount, as before the release; with counted sets it is refused, naming their sum |

One expression in one function, and one condition in the other. No table, column, row or grant
changes, and nothing needs deploying: the room already shows the line the server writes, and
nothing in it sends a negative.

The SQL is the two drafts, each refusing to run unless the live function is the exact text it was
written against:

- `docs/2026-11-10-chronicle-moments-decimals.DRAFT.sql`
- `docs/2026-11-10-chronicle-entry-amount-negative.DRAFT.sql`

## Steps

**1. Check A, read-only.** If anything differs, stop. The drafts would refuse anyway.

```sql
select p.proname, md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('chronicle_moments', 'chronicle_entry_amount')
 order by 1;
-- expect  chronicle_entry_amount  417d779dd1f47ecb979103dc99e464b8
--         chronicle_moments       ffdfc4c1ab852577d1a7e8c24ead8f73
select current_setting('server_version_num')::int >= 130000 as has_trim_scale;  -- expect true
```

**2. 21a.** `apply_migration`, name `chronicle_moments_decimals`. The body is the moments draft
after its leading comment block.

**3. 21b.** `apply_migration`, name `chronicle_entry_amount_negative`. The body is the amount
draft after its leading comment block.

**4. Check B, read-only.**

```sql
-- the same md5 query as check A; expect
--         chronicle_entry_amount  e506edb5a99f78a0e03bd0bd83323956
--         chronicle_moments       d3d4fcc166328fb4d70a92c2b49f7a3b
select f, has_function_privilege('anon', f, 'execute') as anon,
          has_function_privilege('authenticated', f, 'execute') as member
  from (values ('public.chronicle_moments(timestamptz, timestamptz)'),
               ('public.chronicle_entry_amount(uuid, numeric)')) v(f);
-- expect anon false and member true, for both
select trim_scale(round(v, 2))::text from (values (3.5::numeric), (0.25), (12)) x(v);
-- expect 3.5, 0.25, 12
```

**5. The record, as a PR.**

- The two migration files and their `applied.md5` lines. `npm run test` fails without them.
- The drafts' headers marked ✅ APPLIED.
- OPEN-DECISIONS 21a and 21b marked done.
- The stand-in follows production, with its tests: `pvMoments` prints two decimals, and `pvAmount`
  leaves a negative as no amount when nothing is counted.

## Rollback

Per function, and either one alone. Run the whole of the function's file:

- `docs/2026-11-10-chronicle-21ab-rollback/chronicle_moments.sql`
- `docs/2026-11-10-chronicle-21ab-rollback/chronicle_entry_amount.sql`

Each file is that function's text as check A expects it, byte for byte, so `md5sum` of the file
gives check A's number. Running one is a `create or replace` that keeps the function's grants.
Neither fix writes a row, so nothing else needs undoing. Afterwards, check A's query returns the
original md5s.

## Proven in CI

Run 42817607061 (`db guards` on the scratch branch `chronicle/ci-probe-21ab`, commit `031d1863`,
07:39 to 07:42 EST on 10 Nov). It ran on CI's database: the 4 Nov dump plus the release's seven
migrations, Postgres 17. In it, both functions have check A's md5s, which are production's.

| value      | prints today   | prints after 21a |
| ---------- | -------------- | ---------------- |
| 3.5        | `4`            | `3.5`            |
| 12.5       | `13`           | `12.5`           |
| 0.25       | `0`            | `0.25`           |
| 12         | `12`           | `12`             |
| 12.345     | `12`           | `12.35`          |
| 1000000000 | `#########.##` | `1000000000`     |
| 0.001      | `0`            | `0`, as today    |

- `supabase/tests/chronicle-21ab.sql`, run against today's functions, failed exactly the five checks
  it should. The line read "Walk 4 mi · Plank 0 min · Squat 12 reps · Row 12 km", and the negative
  was refused with the `<NULL>` message.
- With the drafts applied, the test passed.
- Run a second time, the drafts refused on their md5 guard, naming check B's md5s.
- The rollback files hashed to check A's md5s. Running them put both functions back to those md5s,
  with anon still refused and members still allowed.
- The standing guards that run after them in the same job passed.

## Seen, not changed

`chronicle_moments` reads a value when it matches `^[0-9.]+$` and then casts it to a number, so a
value such as `1.2.3` or `.` would pass the pattern, fail the cast, and error the whole call.
`circuit_cell_set` uses the stricter `^[0-9]+(\.[0-9]+)?$`. Whether any stored log holds such a
value is a production read, so it is left out of this plan.
