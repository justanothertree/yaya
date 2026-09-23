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
  `.claude/launch.json` defines the dev server; `#dev-profile`, `#dev-admin`, `#dev-usage`,
  `#dev-investments` and `#dev-park` are workbenches for surfaces that need a session. `DEV_PREVIEW`
  is read at module scope, so those need a full reload, not a hash change.
- **`#dev-park` is the only workbench for a GAME, and it earns the difference.** The park is
  members-only, so its whole boss fight shipped on reasoning alone until it existed; the first
  fight run in it found a boss that walked off the map and never came back. It joins `park-dev`,
  never `park`, so a test creature never appears on somebody's screen — and it grants nothing,
  because ParkRoom's `authed` is a courtesy rather than a lock (the relay socket is
  unauthenticated regardless). Walking the park needs the `requestAnimationFrame` stand-in above.
- **A test built from the same sum as the code confirms the mistake.** The park's `across()` and
  `down()` take SCREEN-heights while nearly everything is written in PET-heights, so the correct
  call is `across(v * PARK_TALL)` — and the factor went missing three times: a dodge that crossed
  most of the field, and a boss's mark and wave landing past the edge of the world so two of its
  three big attacks could never hit anybody. The wave was "verified" landing in the right place,
  because the check divided by `across(PARK_TALL)` and cancelled the error out exactly. **Measure
  through a path that shares no arithmetic with the thing being measured** — the field's own
  width, a pixel rectangle, a readback of painted pixels. And when a conversion goes wrong twice,
  the fix is not a third careful call site: it is `outBy(petHeights)`, which has nowhere to put a
  wrong factor.
- **A timed-out browser call keeps running, and its keypresses land in your next trial.** The
  pane gives up on the promise; the page does not. A three-trial fight harness that ran over
  the limit was still holding the guard key during the _next_ call's control run, which duly
  reported a defence that was up for 0.4s and broke twice while nothing was pressing it — a
  number that looks like a bug in the feature and is a bug in the harness. Keep a call under
  the limit, split long runs across calls, and have every loop capture a generation counter and
  return when it changes.
- **The dev server is not the thing you ship, and `yaya-prod` exists for that.** Thirty-odd
  changes were verified against `npm run dev` and none against the built bundle, which is a
  different program: `import.meta.env.DEV` strips whole branches, chunks split, and the
  workbenches go. `preview_start` with `yaya-prod` serves the real build on :4173. Two things
  are different there and both matter — **`#dev-park` does not exist**, so the park's
  production path is one I cannot reach at all without an account; and **:4173 is its own
  origin**, so localStorage is empty and every room starts as a first-time visitor sees it.
  That second one is worth the trip by itself: it is the only way to see the empty states,
  and it is how the Games page turned out to be telling somebody with no creatures about two
  games when there were three.
- **Co-op IS testable, with two tabs and a doorless relay.** "Only a second machine can check
  this" was written on seventeen commits and was not true. The real relay refuses to show one
  person to another until Supabase has verified their token server-side, and a local relay has
  no Supabase config — so two dev tabs never meet. That door is correct and must not be
  weakened; `scripts/park-stub-relay.mjs` stands in for the pipe behind it instead. Start it
  with `PARK_STUB_RELAY=yes` (it refuses otherwise), point `VITE_WS_URL` at it, open two tabs
  on `#dev-park` and walk both in. The first minute of the first run found a friend's cast
  landing for nothing on the host's boss — a flag shared with their swing, dead for weeks.
- **A faithful double is the hard part, and an unfaithful one looks exactly like a product
  bug.** Three of the four "bugs" that first run turned up were mine: the roster keyed peers by
  `id` where `readSomeone` reads `from`, it did not carry the room's boss the way the relay's
  `outNow` does, and it sent `presence` on a disconnect where the client only removes somebody
  on `over`. Read the server before believing the client is wrong.
- **`.park-field` is always rendered, so it does not mean you are in the park.** The field is
  the frame; only its contents are gated on `walking`. Two long measuring runs this session
  produced nothing because they were driving a park nobody had walked into. Check for
  `.park-one.is-me`, or for the Leave button.
- **A dynamic `import()` in the pane is a SECOND COPY of the module, and the app is bound to
  the other one.** Reaching into a module store from the console to drive a room —
  `setWorld(...)`, and the like — can update that store, fire a listener you registered on it,
  and move nothing on screen, because the component imported its own instance. It is worse than
  a technique that never works: it worked earlier in the same session and failed later, decided
  by load order, so a passing run proves nothing about the next one. Anything that survives a
  reload can cross the gap — write to localStorage, reload, and drive the app's own controls
  like a person would. Module state cannot.
- **Measurement lies more often than code does.** `.card` transitions `box-shadow`, so
  `getComputedStyle` reports interpolated values — inject `*{transition:none!important}` before
  measuring. `performance.now()` cannot see canvas work. The Browser pane collapses to 0×0 between
  calls, so resize immediately before measuring.
- **Four things never happen in the Browser pane, and each one fakes a pass.**
  `requestAnimationFrame` never fires, so any animation loop simply does not run — a canvas that
  is blank after a hot reload looks exactly like a renderer you have just broken, and is not.
  **It can be stood in for**, which is how the fighting room's live round, keyboard and win state
  were checked: replace `window.requestAnimationFrame` with a `setTimeout` at ~16ms, then leave
  the room and come back so the loop starts against the replacement. Everything the loop DRIVES
  is then observable; everything it computes should still live where it can be called directly.
  `ResizeObserver` never fires, so anything that re-measures on resize cannot be exercised at all.
  `prefers-reduced-motion` cannot be emulated. And `window.confirm` is auto-dismissed, which
  returns `false` — so a confirmed action appears to do nothing and the feature appears broken
  (this cost an hour on the paint room's Clear button, which was fine).
- **`window.prompt` is worse than `confirm`: it THROWS.** `prompt() is not supported` comes
  straight back out of the call, so it does not return null quietly — it aborts whatever handler
  asked, halfway through. Every naming flow in the app goes through it: ⬇ Keep, Make a minion,
  and renaming a layer. Untouched, those look like crashes rather than a pane limitation. Stand
  it in the same way as rAF, with a queue, before driving any of them:
  `window.__answers = ['Clawbert']; window.prompt = (q, d) => { const a = window.__answers.shift(); return a === undefined ? d : a }`
- **So put the logic where it can be asked a question, and leave the wiring in the component.**
  The pets module's physics is pure functions in `src/pets/play.ts` for exactly this reason: with
  no rAF, a loop that owns its own maths is a loop nobody can check. Called directly, `stepBody`
  answers "what happens if you hold right for half a second" with no browser involved — which is
  how the platformer's jump arcs, its one-way ledges, its coyote window and the reachability of
  every treat were verified. It is also why `effortFor` was lifted out of the JSX: reduced motion
  is unobservable in the pane, and a single frame at t=0 looks identical either way.

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
