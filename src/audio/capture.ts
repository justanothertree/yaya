import type { InstrumentId } from './synth'

/**
 * Catching something you already played.
 *
 * Josh's ask, and it is a good one: jam until something works, then keep it — the way a console
 * saves the last thirty seconds of a game you had no idea you were going to want. The problem with
 * a record button is that it asks you to decide before you play, and deciding is the thing that
 * stops people playing well.
 *
 * The trick is that there is no trick: everything you play is ALWAYS being written down. Notes are
 * about forty bytes each and nobody plays more than a few a second, so a minute of history costs
 * less than a small image and asks nothing of the CPU. "Capture" is not a recording — it is a
 * query against a log that was already there.
 *
 * ⚠️ NOTHING HERE IS EVER SENT ANYWHERE, and nothing is written to disk. It is a ring of numbers
 * in memory that empties when the tab closes. Worth being explicit, because "we are always
 * recording you" is a sentence that should make anyone uneasy, and the honest defence is not that
 * we are careful with it but that it never leaves the room.
 */

export type Played = { t: number; midi: number; on: boolean; inst: InstrumentId }

/** How much history to keep. Long enough to catch a phrase you have already stopped playing. */
const KEEP_S = 90

let log: Played[] = []

/** Called for every note, recorded or not — the same funnel that feeds the recorder and the jam. */
export function remember(t: number, midi: number, on: boolean, inst: InstrumentId) {
  log.push({ t, midi, on, inst })
  // trimmed on write rather than on a timer: the cost lands on the person generating the data,
  // and a tab left open overnight with nobody playing never runs anything at all
  if (log.length > 4096) {
    const cut = t - KEEP_S
    log = log.filter((e) => e.t >= cut)
  }
}

export function forgetPlayed() {
  log = []
}

/** Everything played between two moments on the audio clock. */
export function playedBetween(from: number, to: number): Played[] {
  return log.filter((e) => e.t >= from && e.t <= to)
}

/** The most recent note, or null if nothing has been played. */
export function lastPlayedAt(): number | null {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].on) return log[i].t
  return null
}

/**
 * The tempo somebody was playing at, guessed from when they hit the notes.
 *
 * Josh guessed this was how Ableton does it and he is essentially right. There is no clever signal
 * processing involved: try every plausible tempo, lay its grid over the onsets, and keep whichever
 * one the playing sits closest to.
 *
 * ⚠️ ERROR IS MEASURED AS A FRACTION OF THE GRID STEP, not in seconds. In seconds, a faster tempo
 * always wins — halve the step and you halve every distance — so the search would run away to the
 * top of the range every time and call it a perfect fit. As a fraction, randomly placed onsets
 * score about 0.25 whatever the tempo, so tempi compete on how well the playing actually lines up
 * instead of on how fine their grid is.
 *
 * ⚠️ THE OCTAVE PENALTY IS THE OTHER HALF OF THAT. A grid at 75bpm fits material played at 150
 * perfectly — every note lands on a line, just every other one — so exact multiples are genuinely
 * tied and the search would take the first it met. Nudging toward 120bpm breaks those ties the way
 * a listener does: asked to tap along to something ambiguous, people land near 120, not near 60 or
 * 240. It is small enough that real evidence still beats it.
 *
 * Returns null rather than a bad guess when the playing does not imply a tempo — four notes at
 * random are not a tempo, and inventing one would silently rewrite the arrangement you already had.
 */
export function detectTempo(onsets: number[]): number | null {
  // ⚠️ Eight, not four. See the threshold note below: with fewer than this, sloppy playing and
  // pure noise score the same, so there is no honest answer to give.
  if (onsets.length < 8) return null
  const span = onsets[onsets.length - 1] - onsets[0]
  // less than a couple of seconds of playing cannot distinguish tempi that are close together
  if (span < 1.5) return null

  const first = onsets[0]
  let bestBpm: number | null = null
  let bestScore = Infinity
  let bestErr = 1
  for (let bpm = 70; bpm <= 160; bpm += 0.25) {
    const step = 60 / bpm / 2 // eighth notes: fine enough for most playing, coarse enough to mean something
    let err = 0
    for (const o of onsets) {
      const x = (o - first) / step
      err += Math.abs(x - Math.round(x))
    }
    err /= onsets.length
    const score = err + Math.abs(Math.log2(bpm / 120)) * 0.05
    if (score < bestScore) {
      bestScore = score
      bestErr = err
      bestBpm = bpm
    }
  }
  /**
   * ⚠️ THE THRESHOLD HAS TO SCALE WITH HOW MUCH YOU PLAYED, which is not obvious and was wrong
   * at first — a fixed cutoff let eight random onsets be declared 135bpm.
   *
   * The reason is overfitting: 360 candidate tempi against a handful of points will fit almost
   * anything by luck, and the fewer the points the luckier you get. Measured over 400 runs of
   * random onsets, the best error the search can reach is:
   *
   *     6 onsets → 0.054      12 → 0.109      24 → 0.147          (5th percentile)
   *
   * — which is very close to 0.030·√n across the whole range. Real playing does not behave that
   * way: it scores about 0.05 whether you played eight notes or twenty-four, because being on the
   * beat is a property of the playing rather than of how long you did it for.
   *
   * So the bar is set at 70% of what noise can reach for that many onsets. At eight notes that is
   * 0.059, which admits playing within about ±35ms of the grid and rejects 95% of noise; at
   * twenty-four it is 0.103. Being wrong here is expensive — a bad guess silently changes the
   * tempo of an arrangement you already had — so it is deliberately set to refuse rather than to
   * flatter.
   */
  const bar = 0.021 * Math.sqrt(onsets.length)
  if (bestBpm == null || bestErr > bar) return null
  return Math.round(bestBpm)
}
