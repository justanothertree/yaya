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
- **`npm run test` is vitest over the PURE modules, and it exists because the code was already
  shaped for it.** strike.ts, cast.ts, walk.ts, play.ts, zone.ts, mapDoc.ts and solid.ts all say
  in their own comments that they are pure so they can be asked a question without a browser —
  and for a long time nothing asked. It runs in about a third of a second, on pre-push and in CI.
  What belongs in it is anything with a UNIT or an INVARIANT in it: the pet-height conversions,
  a jump arc, a dodge's reach, a cast's radius, the gap between a fissure's steps, a round trip
  through a saved format. What does not is anything needing a DOM — that is what the Browser
  pane is for.
- **Write the expectation from the world's SHAPE, never from the code's sum.** This is the same
  rule as the note below about `across(PARK_TALL)`, and it is the difference between a test and
  a second copy of the bug: `outBy(n) * PARK.across * ASPECT === n * PARK_TALL` says "a creature
  is this tall on screen", while comparing against `across(n * PARK_TALL)` says nothing at all.
  A new test earns its place by being made to FAIL once — reintroduce the bug it is for and
  watch it go red, then put the code back.
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
- **And it is not only about factors: a test that asks the same QUESTION as the code gets the
  same answer, including when that answer is wrong.** The fissure's test asked `gap > r + r` —
  do the circles overlap — which is the sum `patchesOf` was making, so it agreed with it and
  reported floor between the steps. The real question has a third term: `inPatch` expands every
  patch by the TARGET's own footprint, so "there is a gap" and "somebody fits through it" are
  different claims. Swept with `inPatch` itself, there was nowhere to stand from scale 1.0 up —
  a plain player's own fissure was a wall, not only a boss's. The same shape twice in one
  sitting: the gallery's cap was "120 items", which is the store's own limit, and the question
  underneath it was how many BYTES that is and what happens to the one that does not fit.
  **Measure a gap against the thing that has to occupy it, not against zero.**
- **A FIXTURE CAN NEUTRALISE THE THING UNDER TEST AND STILL LOOK THOROUGH, which is worse than a
  thin test because it reads as a wide one.** `chronicle_tally` was rewritten to bound its candidate
  entries by the span of each goal's own windows, and the check was a differential sweep against the
  live function over eight rounds of random data — random sittings, boundary-exact ones, a 400-day
  one, an open entry, every goal shape. It agreed exactly. Perturbed with the new bound asking
  where an entry STARTED rather than whether it had ENDED, it still agreed exactly, on all eight
  rounds: the sweep hung a life-scope window on every goal, which drags `min(from)` back to 1970 and
  makes any lower bound a no-op. The data was generous and the one dimension being tested was
  pinned flat. **Perturb before believing a sweep, and when it stays green ask what in the fixture
  is holding the thing still** — here, one window per goal was setting the very bound under test.
  With the life window given a goal of its own, the mistake was 3,068–4,106 minutes across ~22 keys.
  **And the commonest version of this is a fixture sitting on DEFAULTS.** It happened twice more
  within two days, both in round trips — save a copy, lose everything, put it back, compare. Those
  are only worth the fields the fixture fills: deleting every rating from the import left all 34
  tests green, because nothing in the fixture had a rating, and an unsorted list passed because the
  fixture inserted it in order already. A round trip, a serialiser, a copy constructor or a
  migration must be fed a row where **every field is something other than its default**, and then
  each field dropped in turn to watch it go red — nine of them here, all caught only after the
  fixture was rebuilt.
- **A UNIT IN A COMMENT IS NOT A UNIT, and a bound typed in beside a table that owns the answer
  will agree with the bug.** Two of the three things the park's first wave got wrong were a
  number disagreeing with the sentence above it. The flock's standoff was `PARK_TALL * scale *
1.6` — a sensible-looking body and a half, and 75% outside the reach of every swing in the
  game, so the whole wave could neither be hit nor hit back. A minion's life band read `[8, 26]`
  under a note promising "two or three swings", which against the softest move is up to five
  each and fifty to clear a wave. Worse, its TEST read `expect(m.life / 5).toBeLessThan(6)`
  under a name saying two or three: the 5 was typed in beside a move table that owns it and the
  6 came from the band rather than from the claim, so the test stayed green about the thing it
  was named after. Write the pool in SWINGS and the standoff in FOOTPRINTS — ask the table, and
  assert the number in the sentence. **And sweep the band's own ends, not two fixtures**: both
  fixtures here sat near the bottom and the creature that exposed it rolled near the top.
- **A feature can be blocked by a NEIGHBOURING mechanic, and it looks exactly like itself being
  broken.** With the wave finally reaching the player, swings still felled nothing — because
  `canBeHurt` was `stun <= 0`, so the safety window and the no-control window were one number.
  That is enough against one attacker, whose wind-up leaves a gap; a crowd in contact has none,
  so the frame the stagger ends the next one lands. Measured: a held attack key produced ZERO
  live swings in 2.4s while surrounded, against seventeen with the field empty. Every honest
  reading of the symptom pointed at the hit test, which was fine both times. **When a thing does
  not happen, check that the room is letting you ask** — the same shape as `.park-field` always
  being rendered, one layer up.
- **A dynamic `import()` in the pane is served from the BROWSER's module cache, and HMR does
  not clear it.** Pure functions are the one thing that copy is safe to ask — but only if it is
  the version on disk. A probe comparing a creature with and without a `spell` layer reported
  them identical AFTER the fix that separates them, because the module it imported was the one
  loaded before the edit; the honest-looking conclusion was "the fix does not work", and the fix
  was fine. Add `?fresh=${Date.now()}` to every dynamic import in a probe. It costs nothing and
  the failure mode is a wrong diagnosis, not an error.
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
- **`previewMember` MAKES NO SESSION, so a room whose data only comes from Supabase renders
  empty in the pane — and an audit of it passes.** The harness flips client-side gates and feeds
  components mock data; it has no token, so every RPC quietly answers nothing. Chat, People,
  Profile and Ratings have stand-ins in `src/dev/previewMember.ts` and are fine. Chronicle keeps
  **no local copy** by design, so for six features it rendered its empty state and only its empty
  state: a streak chip was called verified because the module exported the function that makes it,
  and a 375px sweep reported `0 undersized, 0 off-edge, 0 clipped` against a paragraph and two
  buttons. The first load of a seeded room found a live bug — every repeating derived goal on the
  site read `0 / 30` with the minutes in the totals two inches above it. **A room with nothing in
  it passes every check there is**, so count what the sweep examined before believing it, and give
  a members-only surface a stand-in the way `src/dev/chroniclePreview.ts` does.
- **A DEV-only harness is a claim about the BUNDLE, and the bundle is greppable.** `previewMember`
  folds to `false` in production, which kills the branches and not necessarily the module: a
  statement-level call at module scope — `let S = seed()` — is a side effect rollup cannot prove
  pure, so it keeps the whole file. 2.78 kB of invented fixture shipped to real users on a module
  whose header said it tree-shook out. Neither the `import.meta.env.DEV` guard nor switching a
  namespace import to named ones changed it, both measured as an identical bundle hash; building
  the store behind a function fixed it. `grep` the built `dist/assets/*.js` for a string only the
  harness contains, and keep its data in plain literals on exports nobody reaches.
- **A dynamic `import()` in the pane is a SECOND COPY of the module, and the app is bound to
  the other one.** Reaching into a module store from the console to drive a room —
  `setWorld(...)`, and the like — can update that store, fire a listener you registered on it,
  and move nothing on screen, because the component imported its own instance. It is worse than
  a technique that never works: it worked earlier in the same session and failed later, decided
  by load order, so a passing run proves nothing about the next one. Anything that survives a
  reload can cross the gap — write to localStorage, reload, and drive the app's own controls
  like a person would. Module state cannot.
- **`?fresh=` COPIES THE MODULE YOU NAME AND SHARES EVERYTHING IT IMPORTS, and both halves of that
  will mislead you.** The two notes above are each true and each incomplete. Measured in the pane:
  a fresh `import('/src/dev/chroniclePreview.ts?fresh=…')` came back with an EMPTY store, so the
  module you name really is a second copy — but a write made through a fresh
  `import('/src/chronicle/cloud.ts?fresh=…')` landed in the APP's store, because that module's own
  `import '../dev/chroniclePreview'` carries no query and resolves to the instance already loaded.
  So a probe can reach the running app's state, as long as the state lives in a DEPENDENCY of the
  module it freshly imports — and putting `?fresh=` on the module that owns the state is how you
  get a blank answer and conclude the feature is broken.
- **AND HMR HAS ALREADY PUT A QUERY ON THE APP'S COPY, so the plain path is the wrong instance
  too.** The sharpest version of the trap, because it needs no `?fresh=` to spring and it arrives
  halfway through a session that was working. After any hot update the app is bound to
  `/src/dev/chroniclePreview.ts?t=1791958465904`; a probe's `import('/src/dev/chroniclePreview.ts')`
  resolves to the unqueried URL, which is a THIRD store with its own state — and
  `import('/src/dev/chroniclePreview')` without the extension is a fourth. Measured: the planner's
  own form reported saving, the store read back four plans unchanged, the save function returned
  `{ id: 'pv-p-new-9' }` for a store whose counter was at 1, and the app's real instance had all
  three plans in it the whole time. An hour of "the planner silently does nothing" about a planner
  that was never broken. **The counter is the tell** — two instances mint `…-new-1` independently,
  so a freshly-minted id that disagrees with the ids already in the store means you are holding the
  wrong copy. To reach the app's own instance, import the URL the browser actually loaded:
  ```js
  const url = [...new Set(performance.getEntriesByType('resource').map((e) => e.name))]
    .filter((n) => /myModule\.ts\?t=/.test(n))
    .sort()
    .pop()
  const app = await import(url)
  ```
  And prefer a reading the PAGE gives you over any module read: the plan list on screen had been
  right from the first submission.
- **The pane reports `document.visibilityState` as `hidden` while it is not displayed**, so anything
  gated on being seen simply does not run — `useVisits` treats hidden as "not viewing" by
  design, so its beat never fires there and the feature reads as dead. Stand it in like `rAF`:
  `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })`
  With that and a wait past the beat, it was observable for the first time — it created its own
  `auto` activity and wrote the visit.
- **`if (rule.cssRules)` is not how you tell a group rule from a style rule, and believing it
  cost two wrong diagnoses in one sitting.** Chrome's `CSSStyleRule` implements
  `CSSGroupingRule` now, for CSS nesting — so every plain rule HAS a `cssRules`, an empty list,
  which is truthy. A walker that branches on it recurses into nothing, never examines the rule,
  and reports that NO rule sets the property while the computed value plainly says one does.
  Both times the honest-looking conclusion was "it must be an inline style" and both times it
  was a stylesheet rule four lines from the one I was reading. Check `.length`, or use
  `whoSets()` in `scripts/mobile-audit.js`, which does.
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
  `ResizeObserver` never fires, so anything that re-measures through one cannot be exercised.
  A `window` resize listener CAN be — but `resize_window` does not fire the event, it only
  changes the emulated viewport, so a component that resizes correctly reads as broken until you
  `dispatchEvent(new Event('resize'))` yourself. That misreading cost a wrong diagnosis of the
  ambient backdrop: its listener had always worked and the first measurement said it did not.
  `prefers-reduced-motion` cannot be emulated. And `window.confirm` is auto-dismissed, which
  returns `false` — so a confirmed action appears to do nothing and the feature appears broken
  (this cost an hour on the paint room's Clear button, which was fine).
- **A `computer` click in the pane is about 1ms long, which is shorter than a frame.** Measured:
  pointerdown and pointerup one millisecond apart. Anything that samples a LEVEL once a frame —
  a held key, a held button, a cast slot — never sees it, so the feature reads as broken and is
  not. Use `left_click_drag` when you need the button held, and take a control reading before
  believing a click did nothing. It is also worth fixing in the product when the control is one
  people tap: a person's click is 60-120ms and nearly always survives, and "nearly always" is a
  control that occasionally ignores you. Two of today's readings were this, and a third was a
  four-second cooldown still running from the previous trial — wait for the ready state, do not
  count seconds.
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
- **A local cap that is looser than the server's is a silent half-save.** `member_library`
  carries `check (octet_length(body::text) <= 131072)`, and `put` in `library/cloud.ts`
  deliberately discards a refusal — it is not a crash, and the item is still exactly where it
  was. So the only thing that can stop somebody being told "Kept" about something the account
  will never hold is the LOCAL ceiling, and three of the four synced kinds did not have one that
  worked: the gallery's was 200KB (copied from the maps store, which does not sync and answers a
  different question), and minions and songs had none at all. They share `ACCOUNT_ITEM_BYTES`
  now. **And measure it in the server's unit**: `octet_length` counts UTF-8 bytes while
  `JSON.stringify(x).length` counts UTF-16 code units, so a name with an emoji in it measures
  smaller here than it does there — a ceiling set to exactly the right number still leaks if it
  is measured in the wrong one.
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

**`scripts/mobile-audit.js` answers this rather than a checklist does.** Paste it into the
Browser pane at 375 (the `mobile` preset also emulates touch, so `(pointer: coarse)` rules
apply) and call `auditRooms()`. It reports sideways scroll, anything past the right edge,
clipped text, targets under **24×24** — WCAG 2.5.8, an outside bar rather than a preference —
and controls carrying no word that are explained only by a `title`.

The exclusions are the whole value of it, and the first version had none: a naive sweep flagged
fourteen things on home and twenty-seven in the instrument, and nearly all were correct by
design. `sr-only` text is MEANT to be clipped to a pixel, a piano keyboard is MEANT to scroll
sideways with adjacent keys, a palette is MEANT to be a tight grid, and a link in a sentence
cannot be 24px tall without changing the line it sits in. **A checker that cries wolf about a
room's whole toolbar is one nobody runs twice** — so each exclusion is a rule, never a skip
list of names. What survived it was three things, and all three were real.

**`mobileAudit` NOW ASKS THE CONTAINER TOO, because asking it by hand was a step I kept skipping.**
`sideways` and `offEdge` are measured against the viewport, and an ancestor that manages its own
scrolling swallows everything inside it: the goal row sat **32px wider than the list holding it**
through every clean report. That used to be a manual `el.scrollWidth - el.clientWidth` on the list,
the card and the container — and on 14 Oct the same blind spot produced **three** faults in one day
(a day log's buttons orphaned on their own line, a goal row's ✕ the same, and a 66-character title
taking a card 223px past its own edge), each found by eye and none by the sweep. So `spills` is a
rule now: content past its own box with `overflow-x: visible`, excluding anything that declares the
axis itself or contains something that does — the piano keyboard and the day strip stay silent.
Measured across nine rooms, a healthy site reports one finding at six pixels; with the bug put back
it names the whole chain down to the culprit while `sideways`, `offEdge`, `clipped` and `insideOut`
all still read zero. **One fault arrives as a chain and the LAST entry is the one to fix.** **And a clean number is not a clean room.** Fixing that overflow with
`flex-wrap` plus `min-width: 0` took every figure to zero — `listOver`, `cardOver`, `mainOver`,
`sideways`, nothing undersized or clipped — while a screenshot showed every title crushed to a
3px column reading ":". The numbers were zero BECAUSE the titles had been destroyed. `min-width:
0` without a floor is not "let it shrink", it is "let it vanish": whatever in the row is rigid
wins and the one flexible thing pays the entire bill. Give the text a floor in **pixels** (the
root size is fluid, so `rem` is not a length here), and take a screenshot before believing a
layout fix.

**`flex: 1` DOES NOT SHRINK AN INPUT, and the reason is worth knowing rather than re-deriving.** A
flex child defaults to `min-width: auto`, and for an `<input>` that resolves to its `size`
attribute's worth of characters — twenty by default, about **202px**. So `flex: 1` gives it room to
grow and no permission to shrink, and a compose box in a narrow card simply runs off the end: the
guestbook block was **144px past its own card** at a third width and 63px at a half, for as long as
that block has had a small size. `minWidth: 0` is the whole fix, and it changes nothing where there
is already room.

The same `min-width: auto` default is why a **grid** row will not let its contents ellipse — a
66-character goal title measured 437px inside a ~300px card — and the same floor rule applies to
the repair: give the text a pixel floor one level down, or `min-width: 0` is "let it vanish".

Two more instances are in the tree and **neither is demonstrated**: the chat compose input
(`circuit/ui/Chat.tsx`) and the custom-tag box (`circuit/ui/MovieRate.tsx`). Both are `flex: 1` with
no floor; both looked fine at 375 because their containers are full-width there, and I could not
reach a narrow enough state to make either fail. Worth a look if those surfaces ever go into a
column.

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

**A cache that evicts is a DELETE, once the store syncs.** Five stores here ended `write` with
`slice(0, MAX)`, which reads as tidy housekeeping and was written when each of them was the only
copy. `library/cloud.ts` then made four of them a cache: `watchLibrary` diffs `localRows()`
against the previous snapshot and sends `library_drop` for anything that has gone, because while
it is watching, "gone from here" can only mean somebody deleted it — the one thing a cold sync
cannot establish, and the reason sync itself never deletes. An eviction is indistinguishable from
a deletion, so keeping a 121st picture deleted your first off your account. **Nothing local may
quietly drop an item that something else mirrors**: refuse the new one and say so. The fifth
store, maps, does not sync and so holds the ONLY copy — where an eviction is worse still.

**A SAVE THAT WRITES EVERY COLUMN IS A DELETE FOR THE ONES THE CALLER FORGOT.** The sibling of the
rule above, found three times in two days in chronicle. The shape is always the same: an optional
field, a caller that does not mention it, and a function that reads that silence as erasure.
`editEntry` passed `null` for the note on every edit and `chronicle_entry_edit` said
`note = nullif(btrim(coalesce(p_note,'')),'')` — so opening a session's editor and pressing Save,
changing nothing, destroyed what you had written. `saveActivity` passes null for `colour` because
there is no colour picker; `saveGoal` omits a goal's `note` entirely. Each half looks unremarkable
on its own and together they are a delete.

**Two things make it hard to see.** The field is usually one nothing on screen DRAWS — a session's
note was written at Stop and rendered nowhere, so there was no surface on which the loss could
show. And it is often harmless for a long time: erasing a column that is always already null is a
no-op, so the bug sits dormant until something else gives the column a value. Here that something
was `chronicle_import`, which I had shipped two ticks earlier — a restored file became the one way
an activity could have a colour, and the next rename deleted it.

So: **null means "I am not talking about this", never "throw it away"**, and clearing is asked for
with `''`. Prefer that to fixing the caller, because it also repairs the bundle somebody already
has open rather than waiting for them to reload. And when adding a column, ask immediately which
save paths will now overwrite it and what on screen would ever reveal that they had.

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
