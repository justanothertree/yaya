# The Lab's catalog, votes and notes — 7 Nov 2026

⛔ **The database half is a DRAFT and is NOT applied.** `supabase/drafts/lab-catalog-and-feedback.sql`
has run on a throwaway local Postgres only. Nothing here touched production, and the frontend is
built to work exactly as before until it is applied (verified: with every call failing, all 51
experiments list and play).

## What it is

- **Catalog** (no backend needed): search, five kinds, ★ favourites kept in this browser, and two
  views with their rule printed beside them — **New** (the day each was added, from git history)
  and **Highly rated** (👍 minus 👎, then more votes). Browsing unmounts the running experiment,
  so a card never mounts a GPU device.
- **Votes**: one 👍 or 👎 per account per experiment, changed or taken back in place.
- **Notes**: short plaintext ideas / "more of this" / bugs, paged, edited and deleted by their
  author, privately reportable, removable by the admin.
- **Owner controls**: feature, mark as "rough edges", hide and restore — enforced in the database.

Who sees what, and the calls behind it: `docs/OPEN-DECISIONS.md` §13.

## Migration and permission review (measured on the local build, 7 Nov)

House pattern (CLAUDE.md §3): RLS on, zero policies, no API grants; everything through
`SECURITY DEFINER` functions with a pinned `search_path` that check `auth.uid()` themselves.

| table                 | RLS | policies | grants to anon / authenticated |
| --------------------- | --- | -------- | ------------------------------ |
| `lab_demos`           | on  | 0        | none                           |
| `lab_votes`           | on  | 0        | none                           |
| `lab_comments`        | on  | 0        | none                           |
| `lab_comment_reports` | on  | 0        | none                           |

| function                                                                                         | anon | authenticated | first thing it does                               |
| ------------------------------------------------------------------------------------------------ | ---- | ------------- | ------------------------------------------------- |
| `lab_catalog()`                                                                                  | ✓    | ✓             | flags for everybody; totals only for a member     |
| `lab_vote`, `lab_comments_page`, `lab_comment_add`, `lab_comment_edit`, `lab_comment_report`     | —    | ✓             | refuses no session, then a suspended member       |
| `lab_comment_delete`                                                                             | —    | ✓             | refuses no session; deletes only the caller's own |
| `admin_lab_set_demo`, `admin_lab_register`, `admin_lab_reports`, `admin_lab_moderate`            | —    | ✓             | `if not is_admin() then raise 'not allowed'`      |
| `lab_vote_counts`, `lab_can_read_comment`, `lab_demo_open`, `lab_comment_json`, `lab_clean_body` | —    | —             | helpers, run only inside the functions above      |

The tables hold these constraints themselves, so no path can skip them: a vote is ±1 and the
primary key `(user_id, demo_id)` is the one-vote rule; a note is 2–500 characters, trimmed, at
most eight line breaks and no control character but a newline; a report is one per (note,
reporter) with a fixed reason list. Indexes: votes by demo, notes by (demo, time, id) for the page
and by (author, time) for the rate limits, open reports, reports by reporter.

**Two existing guards were broken by the first draft and caught it** (`visibility-guards.sql`,
blocks H and K): writers must name `is_suspended` in their own body, owner functions must be
`admin_*` and open with the admin refusal, and a new anon-callable definer function must be named
in block H. All three are met; `lab_catalog` is added to block H's list with its reason, in this
PR. The guard file holds on the local build with and without the draft.

**Cost:** totals are counted when asked rather than stored, which is what makes concurrent votes
safe, and the catalog counts per experiment through `lab_vote_counts` per vote. At eight members
that is nothing; it is the query to look at first if the Lab ever has thousands of votes.

## Release order — manual, none of it done

1. **Apply the database first**, so the page never calls a function that is not there. In the SQL
   editor or with `apply_migration`, name `lab_catalog_and_feedback`, sending the draft file's
   contents read from disk (CLAUDE.md §2: read the file and pass what you read).
2. **Check it from production's side** — these are queries, not a table to trust:
   ```sql
   -- nothing new reachable by table verb, and only lab_catalog by anon
   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
     and (p.proname like 'lab\_%' or p.proname like 'admin\_lab\_%');          -- expect: lab_catalog
   select c.relname, has_table_privilege('anon', c.oid, 'select'), has_table_privilege('authenticated', c.oid, 'truncate')
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'lab\_%' and c.relkind = 'r';  -- expect: all false
   select count(*) from public.lab_demos;                                       -- expect: 51
   ```
   Then run `supabase/tests/visibility-guards.sql` as usual. Do NOT run `lab-feedback.sql` or
   the race script against production: they create fixture accounts (the first rolls back, the
   second commits and cleans up) and belong on a throwaway database.
3. **Record it** in the same commit: move the file to
   `supabase/migrations/<version>_lab_catalog_and_feedback.sql` (the version `apply_migration`
   assigned), reword its header to ✅ APPLIED, and add its line to `supabase/migrations/applied.md5`
   from the query in that file's header. `node scripts/migration-md5.mjs` must then say 0 fail and
   0 with no record. `src/lab/*.test.ts` read the draft path, so they move with it.
4. **Merge and deploy the frontend.**
5. **Open the Lab signed in as the admin** once: it registers any experiment added after the draft
   was written, and the Owner controls fold is where featuring and hiding happen.

## Rollback

- **Frontend:** revert the PR. Nothing in the existing Lab depends on the new code.
- **Frontend only, keeping the data:** also fine on its own — the tables simply go unused.
- **Database:** ⚠️ this deletes every vote and note, so it is Evan's call (CLAUDE.md §4), and the
  frontend must be reverted FIRST or every member sees "Couldn't reach the server" on a vote:
  ```sql
  drop function if exists
    public.lab_catalog(), public.lab_vote(text, int),
    public.lab_comments_page(text, timestamptz, uuid, int), public.lab_comment_add(text, text, text),
    public.lab_comment_edit(uuid, text, text), public.lab_comment_delete(uuid),
    public.lab_comment_report(uuid, text), public.admin_lab_set_demo(text, boolean, boolean, boolean),
    public.admin_lab_register(text[]), public.admin_lab_reports(), public.admin_lab_moderate(uuid, text),
    public.lab_comment_json(public.lab_comments), public.lab_can_read_comment(uuid, boolean),
    public.lab_vote_counts(uuid), public.lab_demo_open(text), public.lab_clean_body(text);
  drop table if exists public.lab_comment_reports, public.lab_comments, public.lab_votes, public.lab_demos;
  ```
  and take `'lab_catalog'` back out of block H in `visibility-guards.sql`.

## How it was tested, and what each test is

**Real database assertions** — a real Postgres 16 with the real baseline, seed and draft loaded by
`supabase/tests/plain-postgres/build.sh` (no Docker daemon here, so `supabase start` was not
available; `00-platform.sql` stands in for the roles and `auth.uid()`/`auth.jwt()` only):

```bash
PGHOST=… PGPORT=… supabase/tests/plain-postgres/build.sh \
  --draft supabase/drafts/lab-catalog-and-feedback.sql \
  --test supabase/tests/visibility-guards.sql --test supabase/tests/lab-feedback.sql
PGHOST=… PGPORT=… supabase/tests/lab-feedback-race.sh
```

- `visibility-guards.sql`: "all visibility guards hold", with and without the draft.
- `lab-feedback.sql`: 88 cases as a guest, an adult, the adult's friend, a minor, a member with no
  age band, a suspended member, and a member calling the admin functions — table verbs refused
  (TRUNCATE included), the exact set of callable functions, vote change/remove/one-row, who is in
  a total, notes' validation and limits, who reads which note, edit/delete/report/remove/restore,
  paging with a tie, hide and restore keeping history. Made to fail by breaking each rule it is
  for (minors counted, the ladder skipped, revokes dropped, the admin check removed, reporters
  named, a limit off by one, hidden still writable, suspended authors still read, anon granted a
  writer, paging without the id tiebreak) — each named its own failure.
- `lab-feedback-race.sh`: 24 simultaneous votes from one account → one row; 30 simultaneous voters
  → 30 counted; 12 simultaneous notes → exactly 5 land (10 land with the advisory lock removed).

**Frontend tests against a mocked server** (`src/lab/*.test.ts`, vitest, in `npm run test`):
the catalog matches the DEMOS registry and the draft's seed list; every call names a function and
parameters the draft defines; every refusal the draft raises has a sentence; the note box agrees
with the table's bounds; the stated orders; favourites read defensively.

**The real page against the real functions** — headless Chromium (SwiftShader), with a probe that
answers `/rest/v1/rpc/*` by running the actual draft function in the local database as the member
the page's token names. PostgREST and GoTrue are stood in for; the rules are the real ones. Desktop
at 1024 and the emulated iPhone 13 (touch on). Not real devices.

**The production bundle** (`vite preview`), backend unreachable: every experiment lists and the
current one mounts. SwiftShader dropped its GPU instance on some launches ("A valid external
Instance reference no longer exists") — 2 of 8 on this branch and 1 of 8 on a build of `main` at
`3d073b6`, same probe, same machine. Counted rather than assumed: each load requests exactly one
adapter and one device on both builds, and on the live path (catalog loaded, a toy featured, a
vote cast) the device count stays at one, so this change does not remount anything. Read as the
software adapter's instability, which batch 12 also met; a real GPU has not been tried.
