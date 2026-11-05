import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ARPS,
  STEP_BEATS,
  alignTo,
  arpIndex,
  arpRunner,
  stepSeconds,
  type ArpId,
  type ArpNote,
} from './arp'

/**
 * A sequencer, asked questions without a browser.
 *
 * ⚠️ THIS IS THE WHOLE REASON `now` AND `every` ARE PARAMETERS. A scheduler built on a bare
 * `setInterval` can only be checked by waiting, in real time, in a pane — which in this
 * repository means it would not be checked, and the park's boss fight is the standing example of
 * what shipping on reasoning alone costs. Here the clock is a variable and the timer is a
 * function this file calls by hand, so a four-minute figure is eight lines and no seconds pass.
 *
 * The property that matters most is the one a sequencer fails at: a note-off that never arrives.
 * Every test that schedules anything checks that every note has an end, and that the end is
 * after the start.
 */

/** A clock and a timer under this file's control. */
const rig = () => {
  let t = 0
  let fire: (() => void) | null = null
  const played: ArpNote[] = []
  const r = arpRunner({
    now: () => t,
    play: (n) => played.push(n),
    every: (fn) => {
      fire = fn
      return () => {
        fire = null
      }
    },
  })
  return {
    runner: r,
    played,
    /** advance the clock and run the timer the way a browser would */
    tickTo(to: number, by = 0.025) {
      while (t < to) {
        t = Math.min(to, t + by)
        fire?.()
      }
    },
    at: () => t,
    running: () => fire !== null,
  }
}

afterEach(() => vi.restoreAllMocks())

describe('which note of the chord', () => {
  it('climbs and wraps', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => arpIndex('up', 3, s))).toEqual([0, 1, 2, 0, 1, 2])
  })

  it('falls and wraps', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => arpIndex('down', 3, s))).toEqual([2, 1, 0, 2, 1, 0])
  })

  it('goes up and comes back without playing the ends twice', () => {
    /**
     * ⚠️ THE MISTAKE EVERY FIRST IMPLEMENTATION MAKES. The naive cycle is 0,1,2,2,1,0 — up
     * through the notes then back down through them — which plays the top and the bottom twice
     * and is the difference between a figure that breathes and one that limps.
     */
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((s) => arpIndex('updown', 3, s))).toEqual([
      0, 1, 2, 1, 0, 1, 2, 1,
    ])
  })

  it('goes up and comes back over four notes too', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((s) => arpIndex('updown', 4, s))).toEqual([
      0, 1, 2, 3, 2, 1, 0, 1,
    ])
  })

  it('stays in range for every pattern, size and step', () => {
    /* the property under the four examples: an index off the end is an undefined note, which
       reaches the synth as NaN and plays silence nobody can explain */
    for (const [id] of ARPS)
      for (let count = 1; count <= 8; count++)
        for (let step = 0; step < 40; step++)
          for (const roll of [0, 0.5, 0.999]) {
            const i = arpIndex(id as ArpId, count, step, roll)
            expect(i, `${id} ${count}@${step}`).toBeGreaterThanOrEqual(0)
            expect(i, `${id} ${count}@${step}`).toBeLessThan(count)
          }
  })

  it('reaches every note of the chord, in every pattern', () => {
    /* a pattern that never plays the third note of a triad is a pattern with a bug in it */
    for (const [id] of ARPS) {
      if (id === 'off') continue
      const seen = new Set<number>()
      for (let s = 0; s < 60; s++) seen.add(arpIndex(id as ArpId, 4, s, (s % 10) / 10))
      expect([...seen].sort(), id).toEqual([0, 1, 2, 3])
    }
  })

  it('has nothing to choose from an empty or single-note chord', () => {
    for (const [id] of ARPS) {
      expect(arpIndex(id as ArpId, 0, 7)).toBe(0)
      expect(arpIndex(id as ArpId, 1, 7)).toBe(0)
    }
  })

  it('clamps a roll of exactly 1 rather than indexing off the end', () => {
    /* Math.random() never returns 1, so nothing in the app would ever have shown this */
    expect(arpIndex('random', 3, 0, 1)).toBe(2)
    expect(arpIndex('random', 3, 0, 0)).toBe(0)
  })
})

describe('how fast', () => {
  it('is an eighth note of the loop tempo', () => {
    /* stated from the world: at 120bpm a beat is half a second and an eighth is a quarter */
    expect(stepSeconds(120)).toBeCloseTo(0.25, 6)
    expect(stepSeconds(60)).toBeCloseTo(0.5, 6)
    expect(STEP_BEATS).toBe(0.5)
  })

  it('gets faster as the tempo rises', () => {
    expect(stepSeconds(200)).toBeLessThan(stepSeconds(40))
  })

  it('refuses to divide by a tempo of zero', () => {
    expect(Number.isFinite(stepSeconds(0))).toBe(true)
  })
})

describe('the runner', () => {
  it('plays the first note immediately, not a beat later', () => {
    /* ⚠️ a short press must make a sound. An arpeggiator that waits one step before its first
       note reads as a dead key on anything shorter than a beat. */
    const r = rig()
    r.runner.update([60, 64, 67], 'up', 120)
    expect(r.played).toHaveLength(1)
    expect(r.played[0].midi).toBe(60)
    expect(r.played[0].at).toBe(0)
  })

  it('gives every note an end, after its start', () => {
    /**
     * ⚠️ THE ONE A SEQUENCER FAILS AT. A note-off that never arrives is a drone nobody can
     * stop, and it is why `play` is handed both moments in one call — there is no second half
     * to miss.
     */
    const r = rig()
    r.runner.update([60, 64, 67], 'updown', 96)
    r.tickTo(4)
    expect(r.played.length).toBeGreaterThan(10)
    for (const n of r.played) {
      expect(n.until, `note at ${n.at}`).toBeGreaterThan(n.at)
      expect(n.until - n.at).toBeLessThanOrEqual(stepSeconds(96))
    }
  })

  it('keeps an even pulse at the tempo it was given', () => {
    const r = rig()
    r.runner.update([60, 64], 'up', 120)
    r.tickTo(2)
    const gaps = r.played.slice(1).map((n, i) => n.at - r.played[i].at)
    for (const g of gaps) expect(g).toBeCloseTo(0.25, 6)
  })

  it('gives every note its own voice, so none stops another', () => {
    const r = rig()
    r.runner.update([60, 64, 67], 'up', 120)
    r.tickTo(3)
    expect(new Set(r.played.map((n) => n.voice)).size).toBe(r.played.length)
  })

  it('plays the chord in order', () => {
    const r = rig()
    r.runner.update([60, 64, 67], 'up', 120)
    r.tickTo(1.4)
    expect(r.played.slice(0, 6).map((n) => n.midi)).toEqual([60, 64, 67, 60, 64, 67])
  })
})

describe('holding and letting go', () => {
  it('stops when the last key is released', () => {
    const r = rig()
    r.runner.update([60, 64], 'up', 120)
    r.tickTo(1)
    const n = r.played.length
    r.runner.update([], 'up', 120)
    r.tickTo(3)
    expect(r.played).toHaveLength(n)
    expect(r.running()).toBe(false)
  })

  it('widens the figure without restarting it when a key is added', () => {
    /**
     * ⚠️ THE STEP COUNTER SURVIVES. A pulse that jumped back to the first note every time a
     * finger landed would make it impossible to play along with anything — and the symptom
     * would be a stutter rather than an error.
     */
    const r = rig()
    r.runner.update([60, 64], 'up', 120)
    r.tickTo(0.6)
    const before = r.played.length
    const lastAt = r.played[r.played.length - 1].at
    r.runner.update([60, 64, 67], 'up', 120)
    r.tickTo(1.4)
    const after = r.played.slice(before)
    expect(after.length).toBeGreaterThan(0)
    /* the pulse did not skip or double back: the next note lands one step after the last */
    expect(after[0].at - lastAt).toBeCloseTo(0.25, 6)
    expect(r.played.map((n) => n.midi)).toContain(67)
  })

  it('says what is still sounding when it is stopped mid-note', () => {
    /* ⚠️ `stopLive()` only kills `k:` and `p:` voices, so Panic cannot reach an `arp:` one —
       the runner has to hand them over itself or a note rings on after "make it stop" */
    const r = rig()
    r.runner.update([60, 64, 67], 'up', 120)
    r.tickTo(0.3)
    const open = r.runner.stop()
    expect(open.length).toBeGreaterThan(0)
    for (const n of open) expect(n.until).toBeGreaterThan(r.at())
  })

  it('has nothing still sounding when stopped long after the last note', () => {
    const r = rig()
    r.runner.update([60], 'up', 120)
    r.tickTo(0.3)
    r.runner.update([], 'up', 120)
    r.tickTo(9)
    expect(r.runner.stop()).toEqual([])
  })

  it('stops its timer so nothing runs on in the background', () => {
    const r = rig()
    r.runner.update([60, 64], 'up', 120)
    expect(r.running()).toBe(true)
    r.runner.stop()
    expect(r.running()).toBe(false)
  })

  it('can be started again after being stopped', () => {
    const r = rig()
    r.runner.update([60], 'up', 120)
    r.runner.stop()
    const n = r.played.length
    r.runner.update([67], 'up', 120)
    r.tickTo(1)
    expect(r.played.length).toBeGreaterThan(n)
    expect(r.played[r.played.length - 1].midi).toBe(67)
  })

  it('never starts for the off pattern', () => {
    const r = rig()
    r.runner.update([60, 64], 'off', 120)
    r.tickTo(2)
    expect(r.played).toEqual([])
    expect(r.running()).toBe(false)
  })
})

describe('a timer that misbehaves', () => {
  it('catches up rather than crawling when ticks are missed', () => {
    /**
     * ⚠️ A WHILE, NOT AN IF. A backgrounded tab comes back with several steps already due.
     * Committing one per tick would make the figure crawl until it caught up — and the pulse
     * would be wrong for exactly as long as the tab was away, which is the hardest kind of bug
     * to reproduce on purpose.
     */
    const r = rig()
    r.runner.update([60, 64, 67], 'up', 120)
    r.tickTo(2, 2) // one single enormous tick: two seconds in one go
    /* eight steps of 0.25s fit in two seconds, plus whatever the look-ahead reaches */
    expect(r.played.length).toBeGreaterThanOrEqual(8)
    const gaps = r.played.slice(1).map((n, i) => n.at - r.played[i].at)
    for (const g of gaps) expect(g).toBeCloseTo(0.25, 6)
  })

  it('does not commit for ever if the clock stands still', () => {
    /* a frozen clock is the one way the while could spin: the look-ahead is finite, so it
       commits what fits and stops */
    const r = rig()
    r.runner.update([60, 64], 'up', 120)
    const first = r.played.length
    r.tickTo(0, 0)
    for (let i = 0; i < 50; i++) r.tickTo(0.0001, 0.0001)
    expect(r.played.length).toBeLessThan(first + 10)
  })
})

describe('the picker', () => {
  it('offers Held first, because that is what the room did before', () => {
    expect(ARPS[0][0]).toBe('off')
  })

  it('gives every pattern a distinct id, a label and a sentence', () => {
    for (const [id, label, hint] of ARPS) {
      expect(label.length, id).toBeGreaterThan(0)
      expect(hint.length, id).toBeGreaterThan(0)
      expect(hint.endsWith('.'), id).toBe(false)
    }
    expect(new Set(ARPS.map(([id]) => id)).size).toBe(ARPS.length)
  })

  it('offers no two patterns that play the same figure', () => {
    const seen = new Map<string, string>()
    for (const [id] of ARPS) {
      if (id === 'off' || id === 'random') continue
      const sig = Array.from({ length: 12 }, (_, s) => arpIndex(id as ArpId, 4, s)).join(',')
      expect(seen.has(sig), `${id} is the same figure as ${seen.get(sig)}`).toBe(false)
      seen.set(sig, id)
    }
  })

  it('makes Wander actually wander', () => {
    /* it is the one pattern whose point is not being predictable, so it has to be shown not to
       be a fourth copy of Up */
    const rolls = [0.1, 0.9, 0.4, 0.7, 0.2, 0.99, 0.05]
    const got = rolls.map((roll, s) => arpIndex('random', 4, s, roll))
    expect(new Set(got).size).toBeGreaterThan(2)
    expect(got.join(',')).not.toBe([0, 1, 2, 3, 0, 1, 2].join(','))
  })
})

describe('a very long hold', () => {
  /**
   * ⚠️ THE FIRST VERSION HAD A TIME BOMB IN IT, and it read as a safety feature. The runner kept
   * every note it had ever committed and stopped at 4,096 of them "in case the clock goes
   * backwards" — which at an eighth note of 96bpm is about twenty-one minutes of continuous
   * play, after which the arpeggiator was dead for the rest of the session, because the list was
   * never emptied and the very next tick tripped the guard again.
   *
   * Nobody holds one key for twenty-one minutes, which is precisely why it would have sat there
   * for ever. These two tests are cheap only because the clock is a variable: twenty minutes of
   * music passes in a few milliseconds.
   */
  it('is still playing after half an hour', () => {
    /**
     * ⚠️ THIS SAID "TWENTY MINUTES" AND DID NOT CATCH THE BUG IT IS NAMED AFTER. Twenty minutes
     * at an eighth of 96bpm is 3,840 steps and the old cap was 4,096 — so with the time bomb
     * put back deliberately, this test stayed GREEN while the one about hoarding went red. A
     * test written against a threshold has to go PAST it, and the arithmetic that says where it
     * is belongs in the test rather than in the author's head: 4096 × 0.3125s is 21.3 minutes.
     */
    const r = rig()
    r.runner.update([60, 64, 67], 'up', 96)
    r.tickTo(1800, 1) // half an hour, a second at a time — 5,760 steps, well past 4,096
    const n = r.played.length
    expect(n).toBeGreaterThan(5000)
    r.tickTo(1830, 1)
    expect(r.played.length, 'notes kept coming after the half-hour mark').toBeGreaterThan(n)
  })

  it('does not hoard the notes it has already played', () => {
    /* the everyday half of the same mistake: an array growing all evening */
    const r = rig()
    r.runner.update([60, 64, 67], 'up', 96)
    r.tickTo(600, 1)
    expect(r.played.length).toBeGreaterThan(1000)
    expect(r.runner.scheduled().length, 'only what is still to come').toBeLessThan(20)
  })
})

describe('what is sounding right now', () => {
  it('names the note the keyboard should be lighting', () => {
    const r = rig()
    r.runner.update([60, 64, 67], 'up', 120) // a step is 0.25s
    r.tickTo(0.1)
    expect(r.runner.soundingAt(0.01)?.midi).toBe(60)
    r.tickTo(0.6)
    expect(r.runner.soundingAt(0.26)?.midi).toBe(64)
    expect(r.runner.soundingAt(0.51)?.midi).toBe(67)
  })

  it('names nothing in the gap between two notes', () => {
    /* a step is held for 90% of its length, so there is a real silence before the next —
       the keyboard should go dark in it rather than smearing one note into the next */
    const r = rig()
    r.runner.update([60, 64], 'up', 120)
    r.tickTo(0.6)
    expect(r.runner.soundingAt(0.24)).toBeNull()
  })

  it('names nothing before it starts or after it stops', () => {
    const r = rig()
    expect(r.runner.soundingAt(0)).toBeNull()
    r.runner.update([60], 'up', 120)
    r.tickTo(0.5)
    r.runner.stop()
    r.tickTo(5)
    expect(r.runner.soundingAt(5)).toBeNull()
  })
})

describe('playing in time with a loop', () => {
  /**
   * ⚠️ TWO PULSES AT THE SAME TEMPO AND A RANDOM PHASE DO NOT SOUND SLIGHTLY LATE, they sound
   * like a mistake — and the offset never resolves, because nothing is pulling them together.
   * A free-running arpeggiator over a recorded loop is exactly that, and it is the difference
   * between a toy and something you can build a part with.
   */
  describe('alignTo', () => {
    it('finds the next point on the grid', () => {
      expect(alignTo(0.7, 0, 0.25)).toBeCloseTo(0.75, 9)
      expect(alignTo(0.1, 0, 0.25)).toBeCloseTo(0.25, 9)
    })

    it('moves strictly forward, even when it is already exactly on a point', () => {
      /* ⚠️ STRICTLY. Returning `from` for a time that is already on the grid would schedule two
         notes at the same instant and then stall, because the pulse never advances. */
      expect(alignTo(0.5, 0, 0.25)).toBeCloseTo(0.75, 9)
      expect(alignTo(0, 0, 0.25)).toBeCloseTo(0.25, 9)
    })

    it('works from a grid that did not start at zero', () => {
      /* the loop's origin is whenever somebody pressed play */
      expect(alignTo(10.1, 3.4, 0.5)).toBeCloseTo(10.4, 9)
      expect(alignTo(3.4, 3.4, 0.5)).toBeCloseTo(3.9, 9)
    })

    it('handles a point before the origin', () => {
      /* a note pressed during the count-in, before the loop's start */
      expect(alignTo(-0.6, 0, 0.25)).toBeCloseTo(-0.5, 9)
    })

    it('gives up rather than dividing by a gap of zero', () => {
      for (const gap of [0, -1, NaN]) expect(alignTo(5, 0, gap)).toBe(5)
      expect(alignTo(5, NaN, 0.25)).toBe(5)
    })
  })

  it('still sounds the first note on the press', () => {
    /* the whole reason the SECOND step is what gets snapped: a short press must make a sound */
    const r = rig()
    r.runner.update([60, 64], 'up', 120, 0.17) // a grid at a deliberately awkward phase
    expect(r.played).toHaveLength(1)
    expect(r.played[0].at).toBe(0)
  })

  it('is on the loop grid by the second note, and stays there', () => {
    const r = rig()
    /* a loop that started at 0.17 — a step is 0.25s at 120bpm, so the grid is 0.17, 0.42, … */
    r.runner.update([60, 64, 67], 'up', 120, 0.17)
    r.tickTo(2)
    const after = r.played.slice(1)
    expect(after.length).toBeGreaterThan(4)
    for (const n of after) {
      const off = (n.at - 0.17) / 0.25
      expect(Math.abs(off - Math.round(off)), `note at ${n.at} is off the grid`).toBeLessThan(1e-6)
    }
  })

  it('does not drift away from the grid over a long hold', () => {
    const r = rig()
    r.runner.update([60, 64, 67], 'updown', 96, 1.3)
    r.tickTo(300, 0.5)
    const last = r.played[r.played.length - 1]
    const off = (last.at - 1.3) / stepSeconds(96)
    expect(
      Math.abs(off - Math.round(off)),
      `drifted by the ${r.played.length}th note`,
    ).toBeLessThan(1e-6)
  })

  it('runs free when there is no loop to be in time with', () => {
    /* unchanged behaviour: every note a whole step from the last, starting on the press */
    const r = rig()
    r.runner.update([60, 64], 'up', 120)
    r.tickTo(1.2)
    for (let i = 1; i < r.played.length; i++)
      expect(r.played[i].at - r.played[i - 1].at).toBeCloseTo(0.25, 9)
    expect(r.played[0].at).toBe(0)
  })

  it('shortens only the FIRST gap, never lengthens the figure', () => {
    /**
     * ⚠️ THE GAP THAT CLOSES THE PHASE IS SHORTER THAN A STEP, never longer. Snapping forward
     * to the next grid point can only ever ask for less than one full step, so the figure never
     * pauses — a hole at the start would be heard as a stumble on every press.
     */
    for (const phase of [0.01, 0.07, 0.12, 0.2, 0.249]) {
      const r = rig()
      r.runner.update([60, 64], 'up', 120, phase)
      r.tickTo(0.9)
      const first = r.played[1].at - r.played[0].at
      expect(first, `phase ${phase}`).toBeGreaterThan(0)
      expect(first, `phase ${phase}`).toBeLessThanOrEqual(0.25 + 1e-9)
    }
  })
})
