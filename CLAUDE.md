# Working on Yaya

Evan's standard for this repository, with the project-specific facts that make each rule
actionable. Every change is production work on a public portfolio project serving real friends and
family — not a disposable prototype.

---

## 1 · Work end to end

Inspect → plan → implement → integrate → test → review → fix → verify. Across frontend, database,
realtime and configuration as the change requires. Do not stop at a proposal when the task can
reasonably be finished, and leave the repository buildable.

Then say what changed, **what was verified**, and what risk or decision is left.

## 2 · Verify the result, never the intention

> Do not claim something works because the code looks correct.

**Before the push, not after it.** Evan deploys to test — he tries things on evancook.dev rather
than locally — so the honest division is: verify everything checkable here, push, and then say
plainly what is left that only he can exercise. A bug found on the live site that a dev-server
click would have caught is a bug that was shipped, whatever happens next.

**Check what your own change made untrue.** Shipping a cause and its consequence in one sitting is
normal here, and the consequence is usually a sentence somewhere: the Account card still said the
library lives "in this browser only" an hour after the library started syncing, and a section's tab
still rendered after its only block became one that draws nothing. After a change lands, look for
what it just made stale — copy, empty states, the thing a neighbouring feature assumed.

- **`npm run typecheck` is the only real typecheck.** The root `tsconfig.json` has `files: []` plus
  references, so `tsc --noEmit` checks **zero files** and passes on anything. `npm run typecheck`
  runs `tsc -b`.
- `npm run lint`, then `npm run build`. The pre-push hook runs the build, so a broken tree cannot
  reach the remote — but finding out at push time is finding out late.
- Exercise the **actual user flow** in the Browser pane where the change is observable.
  `.claude/launch.json` defines the dev server; `#dev-profile`, `#dev-admin`, `#dev-usage` and
  `#dev-investments` are workbenches for surfaces that need a session. `DEV_PREVIEW` is read at
  module scope, so those need a full reload, not a hash change.
- **Measurement lies more often than code does.** `.card` transitions `box-shadow`, so
  `getComputedStyle` reports interpolated values — inject `*{transition:none!important}` before
  measuring. `performance.now()` cannot see canvas work. The Browser pane collapses to 0×0 between
  calls, so resize immediately before measuring.

## 3 · Security is part of every change

Assume real users and sensitive data, because there are and it is.

- **The house pattern for member data**: table with RLS **on**, **zero policies**, **no grants** —
  deny-all — reached only through `SECURITY DEFINER` RPCs that check `auth.uid()` and consult
  `can_see()`. `profile_blocks`, `profile_notes` and `member_library` all work this way. It means
  "what may be read" is one question answered in one place, rather than a policy and a grant that
  have to agree.
- **`revoke … from public` does NOT cover `anon` in this project.** `anon` holds execute directly,
  so a revoke aimed at `PUBLIC` leaves it untouched. Always `revoke all … from public, anon`, then
  prove it:
  ```sql
  select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute');
  ```
- **Don't grant what cannot be used.** A function that refuses `anon` on its own first line but is
  still callable by `anon` is an entry somebody must reason about at every review.
- **Two different tiers are not one decision.** A block's visibility tier and a page being
  published are separate switches; so are a page and its activity feed. "Anyone" honestly meant
  "any member" for as long as only members could load a profile, and everybody who ever chose it
  chose it under that meaning.
- **Never leak whether a member exists.** A name nobody has and a member who has not opted in must
  return the same answer through the same path — the property `get_public_profile` and
  `sendPasswordReset` are both built around.
- The service-role key must never gain a `VITE_` prefix; Vite inlines `VITE_*` into the public
  bundle. `.env.local` is gitignored.
- `docs/rpc-inventory.md` holds the standing checks as **queries, not a table** — the table version
  drifted in four weeks and was wrong in both directions. `docs/2026-09-15-member-to-member-sweep.sql`
  simulates a session to ask what one member can see of another.

## 4 · Supabase is a production backend

- Read the existing tables, functions, policies and RPCs before changing any of them.
- **`profile_blocks.block_type` has no check constraint.** Every block type is enforced by
  `save_my_profile_blocks` and nowhere else — adding one is a `create or replace` of that function,
  not an `alter table`.
- Use `apply_migration` for DDL and record the reasoning in `docs/YYYY-MM-DD-*.sql`, marked
  ✅ APPLIED with the migration name. Those files are the project's memory of _why_.
- **Before replacing a live function, take a behavioural baseline** — `md5()` of its output in a
  simulated session — and compare afterwards. Replacing `get_member_activity` was provably a no-op
  for members because of this.
- **Ask the owner before anything irreversible**: dropping tables or columns, deleting or
  rewriting rows, anything touching another member's data. A `create or replace` is recoverable; a
  `delete` is not.
- Do not make unrelated changes to working Supabase functionality.

## 5 · Cost and third-party services

Currently: **26 MB of Supabase's 500 MB free tier**. `member_library` caps a person at 400 items /
20 MB, which is right for eight people and roughly 9× too generous at two hundred — revisit around
fifty active libraries.

- Prefer an existing capability over a new service.
- Reason about the **worst case**, not the normal one.
- One home per thing. Splitting storage across providers doubles the places a thing can live, which
  is the bug class behind "the song plays but the editor says it's empty".
- Cloudflare R2 earns its place when real media arrives (rendered audio, video, images) — not for
  note-events and stroke lists, which are tiny and belong beside the rest of the data.

## 6 · UI across every viewport

The grid collapses to a single column below **700px**; the appearance tray has its own breakpoint
at **56rem**. Check phone (375), tablet (~820) and desktop (1440) — and prefer `resize_window`
over assuming.

Watch for: touch targets, text overflow, horizontal scroll, keyboard interaction, modals, dynamic
content, and a control that is only explained by a `title` attribute — a tooltip does not exist on
a phone.

**Root font-size is fluid**, so `rem` is not a reliable unit for anything measured in pixels.

**A new control counts as a UI change.** It is easy to remember the viewport pass for a layout and
skip it for "just a button" — but buttons are what crowd a tile, overflow a toolbar and end up
under a thumb. The block toolbar carries six of them on a cell that is 61px tall.

**Browsers this cannot reach.** The Browser pane is Chromium, so responsive behaviour and touch
emulation are testable and **Firefox and Safari are not**. This project has already been bitten by
a Firefox-specific audio trap — `667366c`, automation dated in the past — so anything touching Web
Audio, canvas timing, or recent CSS syntax should be handed over as _"needs a look in Firefox"_
rather than reported as verified. Say which it is; do not let the two blur.

## 7 · Performance

Identify obvious problems; do not optimise prematurely. Known shapes here: per-frame canvas work
belongs behind a dirty-rect or a bake, realtime messages should carry changes rather than state,
and an effect whose dependency is rebuilt every render tears down and rebuilds whatever it owns —
memoise anything derived that an effect depends on.

## 8 · Preserve what works

Identify what a change could affect before making it. Protect database contracts, authentication,
realtime, existing user data, public routes, mobile behaviour and deployment config. If a contract
must break, say so explicitly and handle the migration deliberately.

**Read the comments before overturning a decision.** This codebase explains _why_ in the places it
matters, and several of those notes were written after the obvious-looking change had already been
tried and had failed.

## 9 · Code quality

Efficient without sacrificing maintainability; clean, type-safe, consistent with what is already
here; free of duplication, dead code and temporary hacks. Impressive because the engineering is
good, not because it is complicated. Prefer the simple solution when it gives the same result, and
do not add an abstraction, dependency or service without a concrete reason.

## 10 · Scope discipline

Solve the requested problem completely, including improvements directly relevant to it. An
unrelated issue gets fixed only if it is small, clearly safe and adjacent; otherwise name it
separately rather than expanding scope.

## 11 · How this repository remembers

Three places, each with a job, and keeping them separate is what stops any of them rotting:

- **`CLAUDE.md`** — the standard. Rules that outlive any one change.
- **`docs/YYYY-MM-DD-*.sql` and `*.md`** — why a specific change was made, marked ✅ APPLIED with
  its migration name once it is live. These are the project's memory of reasoning.
- **Commit messages** — long, and deliberately so. They explain the failure a change fixes, not
  just the change. Conventional Commits, and commitlint rejects a capitalised subject.

`npm run lint && npm run build` runs on pre-push, so the remote cannot receive a broken tree.

The one thing that does **not** belong in any of them is a list that has to be maintained by hand
to stay true. `docs/rpc-inventory.md` used to be a table of 116 functions; it drifted in four weeks
and was wrong in both directions. It is now the queries that answer the questions, which cannot go
stale.

## 12 · A note on the owner's notes

Evan's testing notes are a **log, not a backlog** — most items are already fixed by the time they
are written down. Check against `git log -S` and the code before building anything from them. This
has caused wasted work more than once.

---

_Sections 1–10 are Evan's standard, written 2026-09-15. The project-specific detail under each is
what this repository has learned, and should grow as it learns more._
