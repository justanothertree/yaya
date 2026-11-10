/**
 * What a bar of an arrangement actually plays.
 *
 * ⚠️ TWO PIECES OF ARITHMETIC THAT HAD TO AGREE AND DID NOT. A plan is a list of stored part
 * indices — "bar 3 of this take sounds here" — while how many parts a take HOLDS is derived from
 * its length and the room's tempo. The scheduler bounded the one against the other
 * (`src >= takeBars` → `continue`, so an index past the end is silence) and the track view did
 * not: it drew every stored index as a filled cell, reported `aria-pressed`, and titled itself
 * `Bar 1 plays part 2 of 1`. A cell that looks on, names a part that does not exist, and sounds
 * nothing.
 *
 * ⚠️ WHAT REACHES IT IS A FILE, AND I FIRST WROTE DOWN THE WRONG ANSWER. `partsIn` divides by the
 * bar length, so on its own arithmetic a four-second take is TWO parts at 120bpm and ONE at 60 —
 * which looks exactly like "arrange it fast, slow it down, and the arrangement falls off the end".
 * It does not, and the room said so on the first try: the cells read "part 2 of 2" at 96bpm and
 * at 60. `setBpm` rescales every layer's `len` by the same ratio as the bar, so
 * `len·(bo/bn) / barLen·(bo/bn)` is the length it always was and the part count never moves.
 * Checked at 40, 60, 96 and 200: two parts throughout. `commitTake` closes the other guess —
 * a re-recorded take is always `loopLength()`, so ⏺ cannot shrink one either.
 *
 * The honest reachable path is a SONG FILE, which is the one that matters anyway because songs
 * travel: `readPlan` accepts any non-negative whole number and cannot do better, since how many
 * parts a take holds depends on a tempo a file does not carry. Measured, `plan: [0, 900, 7]`
 * comes back out of both the verbose and the packed reader unchanged.
 *
 * ⚠️ AND THE BOUND LIVING IN ONE PLACE IS THE POINT REGARDLESS OF TODAY'S REACHABILITY. Two
 * copies of a rule, one of them missing, is a bug waiting for its path — this is the same reason
 * `triadAt` is a function in chordPatterns.ts. A second copy of the arithmetic is free to disagree
 * with the first the moment either changes, and the way these two disagree is a picture of an
 * arrangement that is not the arrangement you hear.
 *
 * Pure on purpose — no state, no tempo of its own, nothing to mock — so the question "what sounds
 * in bar 3" can be put to it without a browser or a running sequencer.
 */

/**
 * How many bars of its own a take holds, at a given tempo.
 *
 * ⚠️ ROUNDED, NOT FLOORED, and that is the existing behaviour kept deliberately rather than
 * tidied. A take is whatever somebody played, so it is never an exact number of bars; flooring
 * would throw away a part that is 90% there, which is a part they can hear. At least one, because
 * a take shorter than a bar is still a take.
 */
export function partsIn(len: number, bpm: number, beatsPerBar: number): number {
  const barLen = (60 / fin(bpm, 96, 1, 400)) * fin(beatsPerBar, 4, 1, 32)
  return Math.min(MAX_PARTS, Math.max(1, Math.round(fin(len, 2, 0.05, 600) / barLen)))
}

/**
 * ⚠️ MORE PARTS THAN ANY PLAN CAN NAME, so the cap never touches real music. A plan is at most 32
 * entries — songFile caps it there — and the longest take the format carries is 60 seconds, which
 * at the fastest tempo the room offers is fifty bars. The ceiling is here for an infinity, not for
 * a long recording.
 */
const MAX_PARTS = 64

/**
 * A number inside its range, or the fallback — and the reason this is not three `Math.max` calls.
 *
 * ⚠️ `Math.max(1, NaN)` IS NaN, which is how a non-finite input walked straight through the
 * clamps and out the other side. The first run of this module's own test caught it: `partsIn`
 * answered NaN for a NaN length, so "a take always holds at least one part" — the one thing every
 * caller assumes — was false for an input the format is supposed to make impossible. Only
 * supposed to: `len` arrives from a file by way of `num()`, which does reject non-finite, but a
 * shared module that trusts its callers is wrong the first time a new caller forgets. An infinity
 * is clamped rather than refused for the same reason — a part count of Infinity is a loop bound.
 */
function fin(v: number, fallback: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback
}

/**
 * Which part of the take sounds in song bar `bar` — or null for silence.
 *
 * ⚠️ NULL COVERS BOTH KINDS OF SILENCE, and the caller does not need to tell them apart to be
 * truthful: a slot somebody switched off, and a slot holding a part this take no longer has. What
 * matters is that the answer is the same one the scheduler acts on.
 *
 * A plan shorter than the song plays nothing in the bars past its end, which is the opposite of
 * `play`'s rule — see the note on `pb` in songFile.ts. That asymmetry is deliberate and predates
 * this: an absent `play` entry means "plays", an absent `plan` entry means "silent", because a
 * mask is a set of exceptions and a plan is an order. (Since 9 Nov 2026 `setBars` carries a plan
 * into the bars a song grows by — `growPlan` below — so a short plan now mostly arrives by file.)
 */
export function partAt(
  plan: readonly (number | null)[] | undefined,
  bar: number,
  parts: number,
): number | null {
  if (!plan) return null
  const src = plan[bar]
  if (src == null || !Number.isFinite(src)) return null
  if (src < 0 || src >= parts) return null
  return Math.floor(src)
}

/**
 * Is this slot holding a part the take has since lost?
 *
 * ⚠️ DISTINCT FROM `partAt` RETURNING NULL, because the two want different words on screen. A
 * slot somebody switched off is silent and correct; a slot pointing past the end of its own take
 * is silent and is about to surprise somebody. The track view says so rather than drawing it as
 * an ordinary empty bar, which would quietly lose the arrangement the next time they looked.
 */
export function partLost(
  plan: readonly (number | null)[] | undefined,
  bar: number,
  parts: number,
): boolean {
  if (!plan) return false
  const src = plan[bar]
  return typeof src === 'number' && Number.isFinite(src) && src >= parts
}

/**
 * Where inside the take a moment of the SONG lands, once the bars have been put in an order —
 * or null when that slot is silent.
 *
 * ⚠️ THIS IS THE SCHEDULER'S OWN PLACEMENT, INVERTED, and it is here rather than in the room
 * because getting it wrong is silent. The scheduler puts an event owned by take-bar `src` at
 * `b * barLen + (e.t - src * barLen)`; so a song time `at` falling in song-bar `b` is take time
 * `src * barLen + (at - b * barLen)`. Drop the `src * barLen` term and every arranged bar reads
 * the top of the take instead — which looks like a plausible chord, every time, and is simply
 * the wrong one.
 *
 * ⚠️ AND IT SHARES `partAt` WITH THE SCHEDULER, so which bar sounds where is decided in one
 * place. The keyboard's chord hint used to stand down entirely once a layer was arranged, on the
 * grounds that working the order out again here would be a second copy of that decision. It
 * would have been — the answer was to ask, not to look away.
 */
export function takeTimeAt(
  plan: readonly (number | null)[] | undefined,
  parts: number,
  at: number,
  barLen: number,
): number | null {
  if (!plan || !Number.isFinite(at) || !(barLen > 0) || at < 0) return null
  const bar = Math.floor(at / barLen)
  const src = partAt(plan, bar, parts)
  if (src == null) return null
  return src * barLen + (at - bar * barLen)
}

/**
 * A plan that sounds only in its LAST bar, moved to the last bar of a loop that is now `bars`
 * long — or null when this plan is not one of those, or the loop is too short to have an end.
 *
 * ⚠️ WHY THE FILL NEEDS THIS AND NOTHING ELSE DOES. "On the last bar" lays a drum fill as a plan
 * of nulls and one slot, sized to the bar count AT THE MOMENT IT WAS PRESSED — and a bar past a
 * plan's end is silent (see `partAt`). Measured: a fill laid on a two-bar loop that then grew to
 * four played in bar TWO, the middle, and not in bar four; one laid on four that shrank to two
 * never played at all — while the button went on reading pressed. The label was a promise the
 * arrangement stopped keeping the first time anybody changed the length.
 *
 * ⚠️ ONLY A PLAN THAT IS EXACTLY "LAST SLOT ONLY" FOLLOWS. The fill can be dragged to another
 * bar on purpose — its own comment says so — and an arrangement somebody chose is not this
 * function's to move. Anything else answers null, and a growing song hands it to `growPlan`,
 * which repeats it rather than moving it.
 *
 * ⚠️ AND NOTHING MOVES BELOW TWO BARS. On a one-bar loop every bar is the last one, which is why
 * the button is disabled there; leaving the old plan in place keeps it silent (its last slot is
 * past the end) and lets a return to two or more find it again, where rewriting it to `[0]` would
 * turn the fill into the groove.
 */
export function followLastBar(
  plan: readonly (number | null)[] | undefined,
  bars: number,
): (number | null)[] | null {
  if (!plan || !plan.length || !Number.isInteger(bars) || bars < 2) return null
  const last = plan.length - 1
  const src = plan[last]
  if (src == null || !Number.isFinite(src)) return null
  for (let i = 0; i < last; i++) if (plan[i] != null) return null
  if (plan.length === bars) return null
  return Array.from({ length: bars }, (_, i) => (i === bars - 1 ? src : null))
}

/**
 * An arrangement carried into the bars a song has just grown by — or null when there is nothing
 * to carry: no plan, no growth, or a plan that already reaches that far.
 *
 * ⚠️ EVAN'S CALL, 9 NOV 2026: GROWING A SONG EXTENDS THE ARRANGEMENT. Until then a bar past a
 * plan's end stayed silent (see `partAt`), so an arranged layer went quiet in every bar a song
 * grew by while an untouched layer beside it tiled across them — measured in the room, a two-bar
 * progression arranged and grown read "Bar 3: silent" onwards. It was documented as deliberate and
 * left as a question; this is the answer.
 *
 * ⚠️ THE NEW BARS REPEAT WHAT THE SONG PLAYED, which is what tiling already does for a layer
 * nobody arranged: going 4 → 8 plays the four bars twice. So the phrase is the plan read out to
 * the length the song WAS, with a missing entry read as the silence it was heard as — a plan from
 * a file can be shorter than its song, and repeating only its stored entries would put sound
 * where somebody had been hearing none.
 *
 * ⚠️ AND NOTHING ALREADY STORED IS REWRITTEN. Shrinking never touches a plan, so 8 → 4 → 8 has to
 * give the original eight back rather than the first four twice; an entry that exists is kept,
 * and only the bars the plan never had are filled. That is also why a plan already long enough
 * answers null instead of being cut to the new length.
 *
 * The fill's "On the last bar" is the one arrangement that MOVES rather than repeats, and
 * `followLastBar` is asked first for it — see setBars.
 */
export function growPlan(
  plan: readonly (number | null)[] | undefined,
  from: number,
  to: number,
): (number | null)[] | null {
  if (!plan || !plan.length || !Number.isInteger(from) || !Number.isInteger(to)) return null
  if (from < 1 || to <= from || plan.length >= to) return null
  const phrase = Array.from({ length: Math.max(from, plan.length) }, (_, i) => plan[i] ?? null)
  return Array.from({ length: to }, (_, i) => phrase[i % phrase.length])
}
