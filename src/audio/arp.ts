/**
 * Hold a chord; hear it one note at a time.
 *
 * The third rung of the ladder scale lock started. Scale lock made every key a right note;
 * chords made one key a handful of right notes; this makes that handful into a part. Hold one
 * key with Triad and Up and you are playing a broken chord at the loop's tempo, which is the
 * single cheapest way for somebody who cannot play to produce something that sounds composed.
 *
 * ⚠️ EVERY NOTE IS BORN WITH ITS DEATH SCHEDULED. `play` is handed both the moment the note
 * starts and the moment it ends, and both are committed to the audio clock in the same call. A
 * sequencer's characteristic failure is a note-off that never arrives — the timer dies, the tab
 * backgrounds, an exception lands between the two halves — and a drone nobody can stop. Here
 * there is no second half to miss, so the worst a broken runner can do is stop playing.
 *
 * ⚠️ AND THE TIMER IS INJECTED, which is the only reason any of this is testable. A scheduler
 * built on a bare `setInterval` can only be checked by waiting, in a browser, in real time —
 * which in this repository means it would not be checked at all. `every` and `now` are
 * parameters, so `arp.test.ts` drives the clock by hand and asks what was scheduled.
 */

export type ArpId = 'off' | 'up' | 'down' | 'updown' | 'random'

/**
 * ⚠️ FIVE, AND `off` FIRST — the room's tempo list again. There is no rate picker on purpose:
 * the step is an eighth note of the loop's own BPM, and the BPM control is two rows up. A second
 * number meaning "how fast, but differently from the other how-fast" is the kind of choice that
 * makes a toy feel like equipment.
 */
export const ARPS: Array<[ArpId, string, string]> = [
  ['off', 'Held', 'The chord rings while you hold it'],
  ['up', 'Up', 'One note at a time, climbing'],
  ['down', 'Down', 'One note at a time, falling'],
  ['updown', 'Up and down', 'Climbs, then comes back'],
  ['random', 'Wander', 'Picks its way around the chord'],
]

/** Eighth notes: four steps to the bar, which reads as playing rather than as a machine. */
export const STEP_BEATS = 0.5

/** How long one step lasts at this tempo. */
export const stepSeconds = (bpm: number, beats = STEP_BEATS) => (60 / Math.max(1, bpm)) * beats

/**
 * Which note of a chord of `count` sounds at `step`.
 *
 * @param roll 0–1, used only by `random`, passed in so the whole thing stays pure.
 *
 * ⚠️ `updown` DOES NOT REPEAT ITS ENDS. For three notes the cycle is 0,1,2,1 and not 0,1,2,2,1,0
 * — playing the top and bottom twice is the difference between a figure that breathes and one
 * that limps, and it is the mistake every first implementation makes.
 */
export function arpIndex(id: ArpId, count: number, step: number, roll = 0): number {
  if (count <= 0) return 0
  if (count === 1) return 0
  const n = Math.floor(step)
  switch (id) {
    case 'down':
      return (((count - 1 - (n % count)) % count) + count) % count
    case 'updown': {
      /* the cycle is 2n-2 long: up through every note, then back down the inner ones */
      const span = 2 * count - 2
      const at = ((n % span) + span) % span
      return at < count ? at : span - at
    }
    case 'random':
      /* ⚠️ clamped, because a roll of exactly 1 would index off the end — and `Math.random()`
         never returns 1, so nothing in the app would ever have shown it */
      return Math.min(count - 1, Math.max(0, Math.floor(roll * count)))
    default:
      return ((n % count) + count) % count
  }
}

/** One note the runner has committed to the clock. */
export type ArpNote = { voice: string; midi: number; at: number; until: number }

export type ArpRunner = {
  /**
   * What is held right now, and at what tempo. An empty list stops the pulse.
   *
   * ⚠️ THE STEP COUNTER IS NOT RESET when the held notes change. Adding a key mid-figure should
   * widen the figure, not restart it — a pulse that jumped back to the first note every time a
   * finger landed would make it impossible to play along with anything.
   */
  update(notes: number[], pattern: ArpId, bpm: number): void
  /** Stop at once, and say which notes are still sounding so the caller can silence them. */
  stop(): ArpNote[]
  /** What is sounding now, if anything — for showing the figure on the keyboard. */
  soundingAt(t: number): ArpNote | null
  /** What is still sounding or still to come. Past notes are forgotten. */
  scheduled(): ArpNote[]
}

/** How far ahead to commit notes to the clock. Long enough to survive a late timer. */
const LOOKAHEAD = 0.12
/** How often to look. Comfortably inside the look-ahead, so a missed tick is not a missed note. */
const TICK_MS = 25
/** A note lasts most of its step, so the figure is legato without the notes piling up. */
const HOLD = 0.9

export function arpRunner(opts: {
  now: () => number
  play: (n: ArpNote) => void
  /** Start a repeating timer; return its canceller. Injected so tests can drive it by hand. */
  every?: (fn: () => void) => () => void
}): ArpRunner {
  const every =
    opts.every ??
    ((fn) => {
      const h = setInterval(fn, TICK_MS)
      return () => clearInterval(h)
    })
  let notes: number[] = []
  let pattern: ArpId = 'off'
  let bpm = 120
  let nextAt: number | null = null
  let step = 0
  let cancel: (() => void) | null = null
  /**
   * ⚠️ ONLY WHAT IS STILL TO COME, AND THE FIRST VERSION KEPT EVERYTHING.
   *
   * It appended every note for the life of the runner and leaned on
   * `if (out.length > 4096) stop` as a "runaway guard". That is not a runaway guard, it is a
   * TIME BOMB: at an eighth note of 96bpm it trips after about twenty-one minutes of continuous
   * play, and because the list was never emptied the arpeggiator was then dead for the rest of
   * the session — `update` restarts it and the very next tick trips the guard again. Nobody
   * holds one key for twenty-one minutes, which is exactly why it would have sat there; the
   * array growing all evening is the everyday half of the same mistake.
   *
   * Pruned every tick the list holds a handful, the guard means what its name says, and
   * `soundingAt` is a cheap question rather than a scan over the whole night.
   */
  let out: ArpNote[] = []
  let seq = 0

  const live = () => out.filter((n) => n.until > opts.now())

  const tick = () => {
    if (nextAt === null || notes.length === 0) return
    /* forget what has finished, with a grace so `soundingAt` is not raced by the prune */
    const cut = opts.now() - 0.25
    if (out.length > 8) out = out.filter((n) => n.until > cut)
    const gap = stepSeconds(bpm)
    /* ⚠️ A WHILE, NOT AN IF. A tab that was throttled comes back with several steps already due;
       committing only one per tick would make the figure crawl until it caught up. */
    while (nextAt !== null && nextAt <= opts.now() + LOOKAHEAD) {
      const i = arpIndex(pattern, notes.length, step, Math.random())
      const n: ArpNote = {
        voice: `arp:${seq++}`,
        midi: notes[i],
        at: nextAt,
        until: nextAt + gap * HOLD,
      }
      out.push(n)
      opts.play(n)
      step++
      nextAt += gap
      /* a true runaway guard now: with pruning the list holds a handful, so reaching this
         means the clock is not advancing and committing more would never end */
      if (out.length > 512) {
        nextAt = null
        break
      }
    }
  }

  const halt = () => {
    cancel?.()
    cancel = null
    nextAt = null
  }

  return {
    update(next, p, tempo) {
      notes = next
      pattern = p
      bpm = tempo
      if (notes.length === 0 || p === 'off') {
        halt()
        return
      }
      if (nextAt === null) {
        /* ⚠️ THE FIRST NOTE IS NOW, NOT ONE STEP FROM NOW. An arpeggiator that waits a beat
           before its first note feels broken on a short press — you tap a key and hear nothing.
           The step counter starts at 0 so the first thing you hear is the note you pressed. */
        nextAt = opts.now()
        step = 0
        cancel = every(tick)
      }
      tick()
    },
    stop() {
      const sounding = live()
      halt()
      notes = []
      return sounding
    },
    soundingAt(t) {
      /* the last one that has started and not finished — steps do not overlap, so there is at
         most one, and taking the last is the right answer if they ever do */
      let now: ArpNote | null = null
      for (const n of out) if (n.at <= t && n.until > t) now = n
      return now
    },
    scheduled: () => [...out],
  }
}
