# Lab release — one reviewable integration, and what it depends on

_Written 8 Nov 2026 against `main` at `ea67e52`. A snapshot: re-check `git log origin/main` and the PR
list before acting on it. Nothing here has been merged, deployed or applied — that is Evan's to do._

## Final release, 9 Nov 2026 — authorised by Evan, and what was done

**68 toys** on `claude/lab-release-1` (#87): A (#31), B (#71 with #69), C (#72), D (#68, #77), and
Colour sight (#88, 67th) and Soaring (#89, 68th), merged in by normal merges. Every id unique; the
first 51 are `main`'s, unchanged and in order.

**The Lab SQL is applied** — `supabase/migrations/20261109030613_lab_catalog_and_feedback.sql`,
production's md5 `b3fad3b428010462340b30cfa527f9e1`, the reviewed draft byte for byte. Only the Lab
SQL: no other thread's draft or migration. All 68 ids registered; no votes or notes were created.
Details and checks: `docs/2026-11-07-lab-catalog-and-feedback.md`.

The sections below are the record from 8 Nov, when this was still a plan.

## What is on production now

**evancook.dev serves `main`**, and only `main` (`deploy.yml` runs on push to `main`; there are no
preview deployments). On `main` the Lab has **51 toys**, picked from a row of name buttons, with
**no catalog, no votes, no notes and no owner tools**.

Everything below is **draft-only**. To try it, run it locally from its branch:

```bash
git fetch origin && git checkout claude/lab-release-1 && npm install && npm run dev
```

then open `http://localhost:5173/#lab`. Against the production Supabase project (which has no Lab
SQL) the catalog lists every toy, every toy plays, and votes and notes are simply absent.
`docs/2026-11-07-lab-catalog-and-feedback.md` has the local-stack recipe for trying them for real.

## The release: one branch, one PR into `main`

**`claude/lab-release-1`** — A + B + C + Skipping stones together, based on `main` (`ea67e52`). It is
built only by merging the source branches; no commit was rebased or rewritten, and every source PR
stays open for reviewing one change at a time.

| Part | What                                                   | Source PRs                                             | Branch, head at integration                               |
| ---- | ------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------- |
| A    | Catalog, votes, notes, owner tools — the foundation    | #31                                                    | `claude/lab-catalog-1` `73506ac`                          |
| B    | Catalog and social improvements, the missing-SQL guard | #34 #45 #48 #50 #55 #57 #63 #66 #69, integrated as #71 | `claude/lab-release-catalog` `52225d7` (#69 at `05788ad`) |
| C    | Fourteen toys, ids 52–65, and the kinds split          | #40 … #65, integrated as #72                           | `claude/lab-release-toys` `5491816`                       |
| D    | Sun path on the clock, and Skipping stones (id 66)     | #68, #77                                               | `claude/lab-skip-1` `7f0636a` (#68 at `7013188`)          |

**Toys: 66.** Every id unique; the first 51 are `main`'s, in `main`'s order; 52–65 are the toy chain's;
66 is `skip`. Checked by reading the registry, not through the app.

**Why one PR rather than A, then B, then C.** Merging is deploying. A alone, with no SQL behind it,
offers a signed-in member 👍 👎 and a note form whose every press fails — measured on 8 Nov with
each `lab_*` call answering as PostgREST does for a missing function. #69 (in B) closes that: a Lab
whose functions are missing shows no feedback at all, as production does today. So A never ships
without B; this branch is the unit.

**#71 and #72 are superseded by this one** as the way to merge, and stay open as records.

## The SQL — separate, unapplied, and not touched by merging

- **File:** `supabase/drafts/lab-catalog-and-feedback.sql` (now `supabase/migrations/20261109030613_lab_catalog_and_feedback.sql`), md5 `5177fa6758ea2043365219b49c53afa8`,
  last changed at `73506ac` (#31's head). Nothing after #31 changes a line under `supabase/`.
- **Merging does not apply it.** It is a draft, not a migration, and no workflow pushes migrations or
  reads `supabase/drafts/` (checked: `grep` across `.github/workflows`).
- **Applying it** is the steps in `docs/2026-11-07-lab-catalog-and-feedback.md` (`apply_migration`,
  name `lab_catalog_and_feedback`, the file's own text). It seeds the 51 original ids; ids 52–66
  register the first time the admin opens the Lab after it is applied (verified: 51 → 66 rows).
- **Order:** the frontend is safe either side of it. Applying it first means feedback opens the
  moment the release deploys; applying it after means feedback stays hidden until then.

## What was verified, and where

**On the exact combined tree** (`claude/lab-release-1`): typecheck, zero-warning lint, the full test
suite and the build. GitHub's Lint, Test, Build and db guards run on the PR into `main`.

⚠️ **GitHub CI does not test the draft SQL** — `db guards` builds the schema without it. The SQL was
exercised only here, on a throwaway local stack:

- **Supabase Auth + PostgREST** (`supabase start`, the CI-pinned CLI, reset to the migrations, the
  draft applied from this tree): `supabase/tests/visibility-guards.sql` and
  `supabase/tests/lab-feedback.sql` hold; `scripts/lab-feedback-api.mjs` **59 of 59** through real
  sessions — votes, notes and their audiences, reports, removal and restore, owner-only switches,
  suspended accounts refused.
- **Plain Postgres 16** (`build.sh`): the same two files hold; `lab-feedback-race.sh` — 24
  simultaneous votes from one account leave one row, 30 voters 30 rows, the note limit holds at 5.
- **The page, against that stack** (Chromium, desktop and an emulated iPhone 13, mouse input):
  - Guest: two disabled buttons with no totals and "Sign in to vote"; no note box.
  - Member: totals at once, zeros included — 0/0 → 1/0 (pressed) → 0/1 → 0/0, each matching the
    table; nothing visible beside the two buttons; names such as "Like, 1 vote".
  - A minor's vote counts (3 on Topple, with an unknown-age member's).
  - Notes: a stranger reads only what reaches strangers; the minor's friends-only note reaches the
    friend; the owner's queue shows the reported note; removing it hides it from the friend and
    restoring brings it back; hiding Fold takes it out of a guest's 66 options and back.
  - Writes that fail never look saved: a refused vote leaves the counts and pressed state as they
    were, with "Couldn't reach the server — nothing was changed."; a failed note stays in its box,
    unlisted, with the same sentence.
- **Without the SQL** (every `lab_*` call answering PGRST202): no feedback anywhere, 66 options and
  66 catalog cards, toys old and new launched through the toolbar, one GPU device live after six
  mounts, the last toy remembered. **Offline** (calls aborted): the controls stay, and both writes
  fail honestly as above — offline is not mistaken for "no SQL".
- **Permissions fail closed.** The page's admin flag is `is_admin() === true`, so an unanswered
  check is "not the owner"; and every write is a SECURITY DEFINER function that checks the caller
  itself, so a wrong flag on the page can only show a button the server refuses.

**Not verified anywhere:** in-page WebGPU rendering (this container loses its GPU in-page — stage
pixels were checked offscreen only), real GPUs, real touch on a real phone (touch was emulated
through the DevTools protocol), Firefox and Safari, and how anything looks or sounds to a person.

## Questions this needs from Evan

1. **Apply the SQL before or after merging `claude/lab-release-1`?** Either is safe now; before means
   feedback opens with the deploy.
2. **Close #26–#28?** Their commits are already in `main`.
3. **Make the focus fix site-wide?** A focused control on a phone used to come to rest under the
   bottom nav. `lab.css` fixes it for pages showing the Lab with `scroll-padding`; the same gap is
   everywhere else, and the rule belongs in `index.css`.

## Not Lab, and not touched here

Open PRs from other threads are left exactly as they are: Chronicle, Instrument, dependency bumps,
CI.
