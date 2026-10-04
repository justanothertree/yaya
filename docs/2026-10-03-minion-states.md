# Minion states — a proposal

**Status: decided 3 Oct 2026, steps 1 and 2 of 3 applied.** Written after the three drawn move stages
(`tell` / `hit` / `after`) landed. The question this answers is the one left open there: states of
the _creature_, as opposed to stages of a _move_. Evan's answers are in §8.

---

## 1 · The thing to notice first: the machine already exists

This is not a new system. It is a system the park has had for months with no name, no picture, and
no minion.

**The boss already has states**, implicit in one long function. `bossThink` returns early, in
order, for:

- `b.leap` — in the air, and the air is not a place it can change its mind from. No steering, no
  swinging, no casting.
- `!hunted(b.watch)` — it has not noticed you. The comment on that branch says it outright:
  _"WARY IS A WHOLE STATE, NOT A PAUSE."_
- `b.charge` — a committed run, with a wind-up during which it steers nowhere.
- otherwise — fighting: approach, give ground, line up, swing, cast.

**And the awareness model is already complete and already the right shape.** `notice.ts` carries
`Watch { seen, mark, cold }` with `hunted()` and `wary()` as named predicates, derived from
geometry, pure, and — its own note — _"the host's alone… it needs nothing from the wire."_

**The player has states too**: `dodge` (bought), `safe` (the grace window added this week),
`braced`, `stun`, and `down` via `stepDown`.

**The minion has none of them.** `stepSwarm` is pure flocking; the park steps it, tests contact,
and filters out anything whose `hp` hit zero. A minion has no awareness, no commitment, no
reaction to being hit, and no death — it vanishes mid-stride.

So the work is not "build a state machine". It is **name the one that exists, give the states
pictures, and give the minion the same machine.**

---

## 2 · The two questions, answered

### What makes a creature change state?

**Derived, never authored.** Every comparable system here is derived from the drawing or from
geometry — `temperOf`, `castShapeOf`, `minionOf`, `Watch`, `patchesOf` — and all of them for the
same stated reason: everybody already has the drawing, so a derived thing costs the wire nothing.
`cast.ts` opens with it; `swarm.ts` repeats it one size up.

A hand-authored transition table would break that twice. It would have to be _sent_ (it is not
derivable from the picture), and it would be a second opinion about a creature that `temperOf`
is supposed to be the only reading of.

### Do you draw it?

**You draw what each state looks like. The engine owns which states exist and when they change.**

This is exactly the bargain `tell` and `after` already make, and it is the only one that keeps the
promise in `rig.ts`: _"ANY drawing is already a pet… Naming layers makes it better; nothing makes
it fail."_ A creature with no state poses behaves precisely as it does today.

---

## 3 · The encoding — and the thing I changed my mind about

My first instinct was "a state is a layer, like `tell`". **That is wrong, and the format already
says why.**

`tell` and `after` work as layers because they are usually _an addition_ — a raised limb, a
flourish — and the body still shows underneath. A **state is a whole-body pose**. Encoding that as
a layer means redrawing the entire creature inside one layer, and then hiding the real body
whenever that state is on. That fights the layer system rather than using it.

The format has a second axis that is whole-picture by construction: **frames**. A stroke carries
both `l` (layer) and `f` (frame), and `f < 0` means _"the stroke never chose a frame, so it shows
on all of them"_ — which is exactly "the parts that don't change between poses". `paint.ts`
already treats frames as the higher-priority truth: _"A DRAWN ANIMATION BEATS THE RIG, because
somebody who drew twelve frames of their pet walking has said exactly what it should do."_

### Recommendation: a state is a **named frame**

- Frames are unnamed today and identified by index. Adding names is a **named document key**
  (`fn?: string[]`), which has an explicit precedent and needs no version bump — `hits` did this,
  and its note spells out the rule: _"This is a NAMED key on the document, so an older build
  simply does not look at it and reads the same picture it always did."_
- **Unnamed frames stay the animation.** Today `frameCount > 1` means "play the frames on a loop
  and ignore the rig", and that must keep working untouched.
- **Named frames are pulled out of the loop** and shown when their state is on.

So one creature can be: a rig-driven body (no frames), _or_ a hand-animated walk (unnamed
frames), _or_ a walk plus a `hurt` pose and a `down` pose, _or_ just a `down` pose and nothing
else. Each is a ladder rung, and the bottom rung is "change nothing".

A second, real advantage: **it keeps states out of the layer-name vocabulary**, which is already
18 words and is the list the wizard renders as buttons. Three more part words would crowd a list
that is close to its usable limit; three more frame names would not.

---

## 4 · Which states

A small fixed set, and I would justify each by it **already having engine state behind it**. The
point is to put a picture on something the simulation already knows, not to invent behaviour.

| State       | What drives it                           | Exists today for | Minion has it?       |
| ----------- | ---------------------------------------- | ---------------- | -------------------- |
| _(default)_ | nothing — the rig, or the unnamed frames | everything       | yes                  |
| `wary`      | `wary(watch)` in notice.ts               | boss             | **no**               |
| `hurt`      | `safe > 0` — the grace window            | player           | **no**               |
| `down`      | `stepDown` / `beaten`                    | player, boss     | **no — it vanishes** |

Four rows, three of which are a picture on an existing flag. That is the whole first version.

### What I would deliberately leave out

- **`enraged` / phase two.** Needs a new mechanic (what triggers it, what changes), not a picture.
  A boss at low health behaving differently is a real idea and a separate decision.
- **`fleeing`.** Same — nothing in the sim currently makes anything run away.
- **Idle variants.** The rig already breathes, bobs and leans; a second idle pose buys little.
- **Per-creature custom states.** The engine has to know what a state _means_ in order to drive
  it. A state nobody can transition into is a drawing with no home.

---

## 5 · What the minion actually gains — the gameplay half

The pictures are the smaller half. The reason to do this at all is that **a minion currently has
no attack**: touching you is instant damage with no wind-up, which is precisely why the grace
window had to be added last week — `safe` is a patch over the fact that contact is unreadable.

Give a minion the three move stages that now exist and contact becomes a _move_:

1. it closes to `pressedTo`,
2. **winds up** — visible, brief, and the moment you can step out or swing first,
3. bites,
4. recovers, during which it is harmless.

That is the single biggest change available here, and it is mostly wiring: `tell` / `hit` /
`after` exist, `posedAt` exists, and `stepStrike` already runs a wind-up/live/recover clock. Then:

- **a death.** They vanish mid-stride today. `down` as a named frame plus the boss's existing
  linger would fix it.
- **a flinch.** `hp` drops with no reaction; a `hurt` frame plus a brief stagger makes a swing
  feel like it connected with something.

---

## 6 · Costs and risks, honestly

- **Wire: free.** Derived from the drawing and from geometry both ends already have — the bargain
  `Watch` and `castShape` already make. And waves are single-screen anyway (`swarm.ts` says the
  correction channel that would change that is an undecided, separate thing), so this introduces
  no new multiplayer problem.
- **Drawing burden: opt-in, and it has to stay that way.** Every state falls back to the default
  pose. The test that matters is the one `tell` and `after` already have: a creature made before
  any of this must be byte-for-byte unchanged in behaviour.
- **The real risk is scope.** "States" is the kind of word that grows an editor. I would not build
  a node-and-arrow state machine UI, for the reason `rig.ts` already gives about hierarchy:
  _"A deeper tree would want joints, a bind pose and an order to resolve them in, which is the rig
  editor this module exists to avoid."_ The same argument applies exactly.
- **Frames are currently all-or-nothing**, and that is the one genuinely fiddly bit of
  implementation. `paint.ts` returns early for `frameCount > 1`; teaching it "these frames are the
  animation, those are poses" is where the care goes, and where a regression would hide.

---

## 7 · What I would build, in order

1. **A minion's bite becomes a move** — wind-up, bite, recover, using the stages that exist. No
   new drawing needed; it reads better immediately and makes the swarm something you can play
   against rather than stand in.
2. **`fn` frame names + `down`** — the smallest possible version of the encoding, proving it on
   the state whose absence is most obvious.
3. **`hurt` and `wary`**, once the encoding has survived contact.

Each one is shippable alone and each is reversible.

---

## 8 · Decided

1. **Frames, not layers.** ✅ Agreed — states will be named frames (`fn`), per §3.
2. **The set is right as a DRAWING vocabulary, wrong as a swarm feature list.** Evan's words:
   _"not exactly for the vampire survivor gameplay, unless you mean for drawing then whatever you
   think makes sense."_ He is right, and the thing I had muddled is worth writing down: **`wary`
   is a boss-and-exploration state, not a swarm one.** A wave spawns already coming for you —
   that is what a wave IS — so noticing has nothing to do in it. It stays in the vocabulary
   because the boss already has `wary()` and the park already has sneaking, but it comes off the
   critical path. For the swarm the set that matters is **the bite becoming a move, then `down`,
   then `hurt`**. `enraged` stays out: still a mechanic rather than a picture.
3. **Order confirmed**, bite first.

### Where it got to

- ✅ **Step 1 — the bite is a move.** Applied in `0f90832`. Wind-up, bite, recover; paced from
  `pace` via `biteOf`; a committed minion holds still and a mark closes on the ground under it.
  Measured: standing still against wave one takes 2 hits per 4.5s, walking away takes 1.
- ✅ **Step 2 — named frames + `down`.** Applied in `480afe4` and `286a097`. The key is `poses`
  rather than the `fn` array proposed in §3 — sparse and keyed by index, exactly like `acts`,
  which is the better shape for something most frames will never have. `loopFrames` is what keeps
  every existing drawing identical: the UNNAMED frames are the animation. A felled minion lies in
  its pose and fades over 1.1s instead of vanishing mid-stride, and the frames row has a picker
  so a frame can actually be named without hand-editing storage.
  - The vocabulary offered in the maker is `POSE_WORDS`, which holds only `down` — a word offered
    before the room reads it is a drawing somebody made for nothing. It grows as each state is
    wired, and never before.
- ◻️ **Step 3 — `hurt`**, once the encoding has survived contact.
- ◻️ _(not on the path)_ `wary`, for the boss, whenever it is worth the drawing.
