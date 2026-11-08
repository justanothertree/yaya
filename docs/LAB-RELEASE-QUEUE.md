# Lab release queue — what is live, what is draft, and the order it can land in

_Written 8 Nov 2026 from the open PR list and `main` at `ea67e52`. A snapshot: re-check with
`git log origin/main` and the PR list before acting on it. Nothing here has been merged, deployed or
applied — that is Evan's to do._

## What is on production now

**evancook.dev serves `main`**, and only `main` (`deploy.yml` runs on push to `main`; there are no
preview deployments). On `main` the Lab has **51 toys**, picked from the row of name buttons. It has
**no catalog, no votes, no notes and no owner tools**, and none of the 14 toys below.

Everything else in this file is **draft-only**. To try any of it, run it locally from its branch:

```bash
git fetch origin && git checkout <branch> && npm install && npm run dev
```

then open `http://localhost:5173/#lab`. Every toy plays and the catalog lists them all. Votes and
notes need the draft SQL in the Supabase project `.env.local` points at — production's does not have
it — so against production they are absent on `lab-release-catalog` and later (#69), and on branches
before #69 they are offered and fail. `docs/2026-11-07-lab-catalog-and-feedback.md` has the
local-stack recipe for trying them for real.

## Three merge units, in this order

Each unit is stacked on the one before. The order is forced, not chosen: B and C both edit, and C
appends to, the same three registries — `DEMOS` in `src/sections/GpuLab.tsx`, `META` in
`src/lab/catalog.ts` and the end of `src/gpu/lab.css` — so two units that both append conflict
unless one is already under the other.

| #   | Unit                                   | PR to merge                       | Branch to try                | Needs                              |
| --- | -------------------------------------- | --------------------------------- | ---------------------------- | ---------------------------------- |
| A   | Catalog and feedback **foundation**    | #31 (as reviewed, `73506ac`)      | `claude/lab-catalog-1`       | `main`                             |
| B   | Catalog and social improvements        | #71 (integration)                 | `claude/lab-release-catalog` | A                                  |
| C   | 14 new toys, the kinds split, Sun path | #72 (integration)                 | `claude/lab-release-toys`    | B                                  |
| SQL | The database half of A                 | none — `apply_migration`, by Evan | —                            | nothing: apply it BEFORE A deploys |

**A is the release boundary for the database.** All of the SQL is in #31's
`supabase/drafts/lab-catalog-and-feedback.sql`; nothing in B or C changes a line under `supabase/`
(checked with `git diff --stat` across both chains). ⚠️ GitHub CI does **not** execute the draft
SQL — the `db guards` job builds the schema without it. The SQL has been exercised only against a
local Supabase stack (Auth + PostgREST), recorded in that doc.

⚠️ **Apply the SQL before A reaches `main`** — the order the SQL doc's own steps already give, and
it matters more than it looks, because merging to `main` IS deploying. Measured on 8 Nov with every
`lab_*` call answering as PostgREST does for a missing function: A alone offers a signed-in member
👍 👎 and a note form, and a vote answers "Couldn't reach the server". Nothing is lost or written;
it is just broken to look at. **#69 (the end of B) fixes that**: from B on, a Lab with no SQL behind
it shows no feedback at all, exactly as production does today. So the safe orders are SQL → A → B →
C, or A + B together → SQL → C.

**B and C can wait as long as you like after A.**

The individual stacked PRs (#34 … #69, #40 … #68) stay open for reviewing one change at a time; the
two integration PRs, #71 and #72, are the same commits, to merge in one step each instead of thirty.

### B — catalog and social (on A)

All UI over A's functions; no SQL, no new toys.

| PR  | What it adds                                                                   |
| --- | ------------------------------------------------------------------------------ |
| #34 | One toolbar above the toy (dropdown + 🔎 Browse instead of 51 name buttons)    |
| #45 | 🕘 Recent — a view for coming back to what you were playing (browser-local)    |
| #48 | 🎲 Surprise me — a toy you have not opened lately                              |
| #50 | Counts beside each kind; `/` searches the catalog                              |
| #55 | Back from a toy, the catalog is where you left it                              |
| #57 | New to you — which toys arrived since you first came (browser-local)           |
| #63 | The notes fold says how many there are to read (only what you may read)        |
| #66 | Voting is two buttons; press yours again to take it back (your 8 Nov feedback) |
| #69 | Before the SQL is applied, no votes or notes are offered (instead of failing)  |

### C — toys (on B)

Fourteen toys, ids 52–65, every id unchanged from its own PR, plus two catalog changes that only
matter once there are toys newer than the SQL's seed list.

**Catalog changes carried here, and why they are not in B:**

- `3bde242` (in #40) — a toy newer than the catalog says "new here: votes and notes open once it has
  been added to the catalog", not that it is gone. The SQL seeds 51 ids; ids 52–65 are registered
  the first time the admin opens the Lab after the SQL is applied (step 6 in the SQL doc).
- #60 — games and puzzles become two kinds, moving 11 toys (old and new) into 🧩 Puzzles. It sits
  after Slide because it re-labels toys added before it.

**The toys, by kind** (the PR is where to review each one):

| Kind                         | Toys                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| 🧩 Puzzles — find the answer | Jigsaw #40, Beams #47, Bridge #49, Nonogram #56, Logic gates #58, Slide #59, Paint mixer #61  |
| 🎮 Games — skill and timing  | Orbit #53                                                                                     |
| Tools and things to make     | Palette #44, Wallpaper #54 (🎨 make)                                                          |
| Patterns, sound, nature      | Epicycles #52, Graph match #64 (patterns), Intervals #62 (sound), Sun path #65 + #68 (nature) |

**Splitting C by kind is possible and not prepared.** The toys are in the order they were made, which
mixes kinds; a puzzles-only release would mean re-applying fourteen toy commits in a new order and
resolving the same three registry appends each time, which renumbers the toys' display positions
(their ids would not change). Worth it only if you want to ship some kinds and hold others — say so
and it is an hour's work.

## Not Lab, and not touched here

Open PRs from other threads, left exactly as they are: Chronicle #33, #36–#39, #41–#43, #46, #51, #67;
Instrument #35; dependency bumps #11–#15; CI #10. #67 changes a workflow.

**Stale:** #26, #27 and #28 (Lab toy batches 9–11) are still open, but every commit in them is
already in `main` — they can be closed without merging. Not closed here, because closing somebody's
PR is yours to decide.

## Questions this needs from Evan

1. **Merge order:** SQL, then A, B, C — or A + B together before the SQL? Or would you rather take
   A and C and hold B?
   (C is built on B, so holding B means rebuilding C on A: a mechanical job, but say so first.)
2. **Split C by kind?** Only if you want to hold some kinds back.
3. **Close #26–#28?** They are already in `main`.
