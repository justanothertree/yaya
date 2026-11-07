# The Lab's catalog, votes and notes — 7 Nov 2026

⛔ **The database half is a DRAFT and is NOT applied.** `supabase/drafts/lab-catalog-and-feedback.sql`
has run on throwaway local databases only — Supabase's own local stack and a plain Postgres.
Nothing here touched production, and the frontend works exactly as before until it is applied
(verified: with every call failing, all 51 experiments list and play).

⚠️ **One decision is Evan's before it is applied:** `docs/OPEN-DECISIONS.md` §13b — counting every
member's vote, as decided, meets "a total must not reveal hidden activity" at small numbers. The
draft shows a total only once three OTHER members have voted; what that floor cannot stop is
written there, with the options.

## What it is

- **Catalog** (no backend needed): search, five kinds, ★ favourites kept in this browser, and two
  views with their rule printed beside them — **New** (the day each was added, from git history)
  and **Highly rated** (👍 minus 👎, then more votes). Browsing unmounts the running experiment,
  so a card never mounts a GPU device.
- **Votes**: one 👍 or 👎 per account per experiment, changed or taken back in place.
- **Notes**: short plaintext ideas / "more of this" / bugs, paged, edited and deleted by their
  author, privately reportable, removable by the admin.
- **Owner controls**: feature, mark as "rough edges", hide and restore — enforced in the database.

Who sees what (Evan's decisions of 7 Nov, `docs/OPEN-DECISIONS.md` §13):

- **Votes:** every member who may vote counts, minors and unknown ages included; nobody but the
  voter sees a vote; a total is shown to members only, once three other members have voted.
- **Notes:** read through the profile ladder — a minor's note reaches their friends — and by their
  author. The admin has no standing access: a note the ladder keeps from them reaches them only
  when somebody reports it, and only in the report queue.
- **Guests:** browse and play; the catalog's flags only, no totals, no notes.
- **There is no member-to-member block on this site**, so nothing here claims to honour one.

## Migration and permission review (measured on the local build, 7 Nov)

House pattern (CLAUDE.md §3): RLS on, zero policies, no API grants; everything through
`SECURITY DEFINER` functions with a pinned `search_path` that check `auth.uid()` themselves.

| table                 | RLS | policies | grants to anon / authenticated |
| --------------------- | --- | -------- | ------------------------------ |
| `lab_demos`           | on  | 0        | none                           |
| `lab_votes`           | on  | 0        | none                           |
| `lab_comments`        | on  | 0        | none                           |
| `lab_comment_reports` | on  | 0        | none                           |

| function                                                                                                                                                   | anon | authenticated | first thing it does                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------- | ------------------------------------------------- |
| `lab_catalog()`                                                                                                                                            | ✓    | ✓             | flags for everybody; totals only for a member     |
| `lab_vote`, `lab_comments_page`, `lab_comment_add`, `lab_comment_edit`, `lab_comment_report`                                                               | —    | ✓             | refuses no session, then a suspended member       |
| `lab_comment_delete`                                                                                                                                       | —    | ✓             | refuses no session; deletes only the caller's own |
| `admin_lab_set_demo`, `admin_lab_register`, `admin_lab_reports`, `admin_lab_moderate`                                                                      | —    | ✓             | `if not is_admin() then raise 'not allowed'`      |
| `lab_vote_counts`, `lab_vote_floor`, `lab_totals`, `lab_can_read_comment`, `lab_admin_may_moderate`, `lab_demo_open`, `lab_comment_json`, `lab_clean_body` | —    | —             | helpers, run only inside the functions above      |

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
safe, and the catalog counts per experiment through `lab_totals`, which asks `lab_vote_counts` per
vote. At eight members
that is nothing; it is the query to look at first if the Lab ever has thousands of votes.

## Release order — proposed for review, none of it done

0. **Evan decides `OPEN-DECISIONS.md` §13b** — accept the three-other-members floor, raise it, or
   choose another option there. Anything but (1) is a change to the draft first, and the tests below
   are run again.
1. **Re-run the local validation on the final draft** (below: "How to run it"), all three suites
   green, on a throwaway local stack — never against production.
2. **Apply the database**, so the page never calls a function that is not there. With
   `apply_migration`, name `lab_catalog_and_feedback`, sending the draft file's contents read from
   disk (CLAUDE.md §2: read the file and pass what you read). The Lab keeps working while the
   frontend is still the old one: nothing calls the new functions yet.
3. **Check it from production's side** — queries, not a table to trust:
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
   Then run `supabase/tests/visibility-guards.sql` as usual. Do NOT run `lab-feedback.sql`,
   `lab-feedback-race.sh` or `scripts/lab-feedback-api.mjs` against production: they create
   accounts and fixtures, and the API script refuses any non-local URL for that reason.
4. **Record it** in the same commit: move the file to
   `supabase/migrations/<version>_lab_catalog_and_feedback.sql` (the version `apply_migration`
   assigned), reword its header to ✅ APPLIED, and add its line to `supabase/migrations/applied.md5`
   from the query in that file's header. `node scripts/migration-md5.mjs` must then say 0 fail and
   0 with no record. `src/lab/*.test.ts` read the draft path, so they move with it.
5. **Merge and deploy the frontend** (PR #31, out of draft).
6. **Open the Lab signed in as the admin** once: it registers any experiment added after the draft
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
    public.lab_admin_may_moderate(public.lab_comments), public.lab_totals(text), public.lab_vote_floor(),
    public.lab_vote_counts(uuid), public.lab_demo_open(text), public.lab_clean_body(text);
  drop table if exists public.lab_comment_reports, public.lab_comments, public.lab_votes, public.lab_demos;
  ```
  and take `'lab_catalog'` back out of block H in `visibility-guards.sql`.

## How it was tested, and which checks exercise the proposed SQL

**These exercise the draft SQL** — all on throwaway local databases, none in CI:

| check                                        | where                                                                                       | what it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/lab-feedback.sql`            | Supabase's own Postgres 17 image (the local stack) and plain Postgres 16                    | 126 cases in one rolled-back transaction, identities switched with `request.jwt.claims`: table verbs refused (TRUNCATE included), the exact set of callable functions, every member's vote counting, the floor (including a voter subtracting themselves), notes' validation and limits, who reads which note — the admin as an ordinary member — edit/delete, reports, the queue holding only reported notes, moderation refused on an unreported invisible note, remove/restore, paging, hide and restore keeping history |
| `supabase/tests/lab-feedback-race.sh`        | plain Postgres 16                                                                           | concurrent sessions: 24 simultaneous votes from one account → one row; 30 voters → 30 counted; 12 simultaneous notes → exactly 5 (10 with the advisory lock removed)                                                                                                                                                                                                                                                                                                                                                        |
| `scripts/lab-feedback-api.mjs`               | the local stack: **Supabase Auth issues each session, PostgREST verifies it**               | 58 cases through the real API path: a guest, separate members, a minor, an unknown age, the admin, a suspended member; tables unreachable over REST; a forged token refused with `PGRST301`; a burst of 12 votes from one session → one row                                                                                                                                                                                                                                                                                 |
| the real page (scratch probe, not committed) | dev server pointed at the local stack, sessions from Auth stored as supabase-js stores them | guest, adult, the minor's friend, the admin and the minor (emulated iPhone 13) driven through the page; every request to the real gateway, nothing intercepted                                                                                                                                                                                                                                                                                                                                                              |

Each SQL rule was broken once to watch the suites fail: the admin's reading branch put back,
moderation without a report, the floor counting the viewer, no floor, minors left out, the admin
counting every note, an unreported note in the queue — the SQL suite named each, and the API suite
named the first.

**These do NOT exercise the draft SQL:**

- **GitHub CI.** The `db guards` job builds the schema WITHOUT the draft and runs
  `visibility-guards.sql`, so it proves the one edit to that file (block H naming `lab_catalog`) is
  harmless today — nothing about the new functions. Lint, Test and Build never touch a database.
- **`npm run test`** reads the draft as TEXT (its seed list, its function signatures, its limits
  and its floor must agree with the page) and tests the frontend against a mocked server.
- **Typecheck, lint, build.**

### How to run it

On a machine with Docker, `supabase start` in the repo, then apply the draft and run the suites.
In a cloud session there is a daemon to start, and two catches (CLAUDE.md §2 has the detail):

```bash
dockerd &                                  # installed, not running
npm exec --prefix <scratch> supabase@2.122.0 -- --version   # the version CI pins, outside the repo
# a scratch COPY of supabase/ with storage, realtime, studio, analytics and edge_runtime disabled —
# their images come from hosts this proxy refuses; the repo's config is untouched
supabase start --workdir <scratch copy>
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/drafts/lab-catalog-and-feedback.sql
psql … -f supabase/tests/visibility-guards.sql
psql … -f supabase/tests/lab-feedback.sql
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<from supabase status> \
  LAB_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/lab-feedback-api.mjs
PGHOST=… PGPORT=… supabase/tests/plain-postgres/build.sh --draft supabase/drafts/lab-catalog-and-feedback.sql
PGHOST=… PGPORT=… supabase/tests/lab-feedback-race.sh
```

**Frontend tests against a mocked server** (`src/lab/*.test.ts`, vitest, in `npm run test`):
the catalog matches the DEMOS registry and the draft's seed list; every call names a function and
parameters the draft defines; every refusal the draft raises has a sentence; the note box agrees
with the table's bounds; the page's floor is the draft's; the stated orders, the floor's place in
them; favourites read defensively.

**The production bundle** (`vite preview`), backend unreachable: every experiment lists and the
current one mounts. SwiftShader dropped its GPU instance on some launches ("A valid external
Instance reference no longer exists") — 2 of 8 on this branch and 1 of 8 on a build of `main` at
`3d073b6`, same probe, same machine. Counted rather than assumed: each load requests exactly one
adapter and one device on both builds, and on the live path (catalog loaded, a toy featured, a
vote cast) the device count stays at one, so this change does not remount anything. Read as the
software adapter's instability, which batch 12 also met; a real GPU has not been tried.
