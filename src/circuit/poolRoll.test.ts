import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROLL_MS, buildReel, reelStep, rollWeight, weightedPick } from './poolRoll'

/**
 * The wheel four people watch at once.
 *
 * The pool could pick on one laptop, but then one person announces a result the others take on
 * trust — "a worse version of that person just choosing", as the module's own header puts it. So
 * the sender broadcasts the winner AND the exact reel, and every screen runs the same strip of
 * names and stops on the same one. Three pure functions carry that, and until now none of them
 * had ever been asked anything.
 *
 * ⚠️ WHAT WOULD GO WRONG IS NOT A CRASH. A reel that ends on the wrong entry, or a step function
 * that stops one short, shows a different winner to each person in a room who are all looking at
 * their own phone — and the thing a randomiser is for is being trusted.
 *
 * `Math.random` is stubbed where the answer has to be exact, and left alone where the property
 * is about the spread.
 */

afterEach(() => vi.restoreAllMocks())

describe('rollWeight', () => {
  it('leaves an option nobody voted for able to come up', () => {
    /* ⚠️ THE REASON THE BASE IS 1. `weightedPick` can never return a 0-weight item while
       anything else is positive — the running total never reaches it — so a bare vote count
       would mean an unvoted option is not in the draw at all. */
    expect(rollWeight(0)).toBeGreaterThan(0)
  })

  it('makes a vote worth having without making it decisive', () => {
    /* more votes must be strictly better, and one vote must not swamp the rest: the wheel is
       for settling an argument without pretending the vote was unanimous */
    expect(rollWeight(1)).toBeGreaterThan(rollWeight(0))
    expect(rollWeight(5)).toBeGreaterThan(rollWeight(1))
    /* against nine unvoted options, one option with a single vote is still a minority */
    expect(rollWeight(1)).toBeLessThan(9 * rollWeight(0))
  })

  it('treats a negative count as none, however it got there', () => {
    expect(rollWeight(-3)).toBe(rollWeight(0))
  })
})

describe('weightedPick', () => {
  it('has nothing to pick from an empty list', () => {
    expect(weightedPick([], () => 1)).toBeNull()
  })

  it('picks the only option, whatever its weight', () => {
    expect(weightedPick(['a'], () => 7)).toBe('a')
    expect(weightedPick(['a'], () => 0)).toBe('a')
  })

  it('can reach every option when the weights are equal', () => {
    /* swept across the whole range of Math.random rather than trusting one draw */
    const items = ['a', 'b', 'c', 'd']
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) {
      vi.spyOn(Math, 'random').mockReturnValue(i / 100)
      seen.add(weightedPick(items, () => 1)!)
    }
    expect([...seen].sort()).toEqual(items)
  })

  it('never returns an option whose weight is zero while another is positive', () => {
    /* the mechanical fact `rollWeight`'s base of 1 exists for. Asserted directly so that the
       day somebody "simplifies" the base away, two tests fail and one of them says why. */
    const items = ['loud', 'quiet']
    for (let i = 0; i < 100; i++) {
      vi.spyOn(Math, 'random').mockReturnValue(i / 100)
      expect(weightedPick(items, (x) => (x === 'loud' ? 3 : 0))).toBe('loud')
    }
  })

  it('still answers when every weight is zero, rather than refusing to roll', () => {
    const items = ['a', 'b', 'c']
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) {
      vi.spyOn(Math, 'random').mockReturnValue(i / 60)
      seen.add(weightedPick(items, () => 0)!)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('gives a heavier option the bigger share of the draw', () => {
    /* three to one, measured over the whole range rather than asserted as a probability */
    const items = ['heavy', 'light']
    let heavy = 0
    for (let i = 0; i < 400; i++) {
      vi.spyOn(Math, 'random').mockReturnValue(i / 400)
      if (weightedPick(items, (x) => (x === 'heavy' ? 3 : 1)) === 'heavy') heavy++
    }
    expect(heavy / 400).toBeGreaterThan(0.6)
    expect(heavy / 400).toBeLessThan(0.9)
  })
})

describe('buildReel', () => {
  const LABELS = ['🎬 Dune', '📺 Taskmaster', '🎬 Arrival', '📺 Detectorists']

  it('ends on the winner, which is the only thing every screen must agree on', () => {
    for (const w of LABELS) expect(buildReel(LABELS, w).at(-1)).toBe(w)
  })

  it('ends on the winner even when the winner is not on the list', () => {
    /* a board that has moved on under the sender: the reel still has to land where the broadcast
       says it lands, or two people see different results */
    expect(buildReel(LABELS, '🎬 Something else').at(-1)).toBe('🎬 Something else')
  })

  it('is just the winner when there is nothing to spin through', () => {
    expect(buildReel([], '🎬 Dune')).toEqual(['🎬 Dune'])
  })

  it('shows nothing but the names it was given, and the winner', () => {
    const reel = buildReel(LABELS, '🎬 Arrival')
    for (const name of reel.slice(0, -1)) expect(LABELS).toContain(name)
  })

  it('is long enough to read as a spin and short enough to send', () => {
    /* the cap matters on the wire: `readRoll` slices an incoming reel to MAX_REEL, so a sender
       that built a longer one would have its tail cut off — taking the winner with it */
    for (const n of [1, 2, 4, 9, 20, 50]) {
      const labels = Array.from({ length: n }, (_, i) => `item ${i}`)
      const reel = buildReel(labels, 'item 0')
      expect(reel.length).toBeGreaterThanOrEqual(13)
      expect(reel.length).toBeLessThanOrEqual(48)
    }
  })

  it('starts somewhere different each time, so the spin does not look scripted', () => {
    const starts = new Set<string>()
    for (let i = 0; i < 40; i++) {
      vi.spyOn(Math, 'random').mockReturnValue(i / 40)
      starts.add(buildReel(LABELS, '🎬 Dune')[0])
    }
    expect(starts.size).toBeGreaterThan(1)
  })
})

describe('reelStep', () => {
  it('starts on the first entry', () => {
    expect(reelStep(0, 20)).toBe(0)
  })

  it('lands on the LAST entry exactly when the roll is over', () => {
    /* ⚠️ THE WHOLE CONTRACT. The last entry is the winner; a step function that stopped one
       short would show every person in the room the name before the one that was broadcast. */
    for (const n of [1, 2, 13, 20, 48]) expect(reelStep(ROLL_MS, n)).toBe(n - 1)
  })

  it('stays on the winner after the roll, however late a frame arrives', () => {
    for (const late of [ROLL_MS + 1, ROLL_MS * 2, 60_000]) expect(reelStep(late, 20)).toBe(19)
  })

  it('never goes backwards', () => {
    /* a wheel that flicks back a name reads as a glitch, and the ease-out makes it tempting to
       compute this from a rate rather than from elapsed time */
    let last = -1
    for (let t = 0; t <= ROLL_MS; t += 17) {
      const at = reelStep(t, 24)
      expect(at).toBeGreaterThanOrEqual(last)
      last = at
    }
  })

  it('clamps a negative elapsed to the start rather than off the front', () => {
    /* another machine's clock is not a time you can do arithmetic with, which is why the module
       refuses to schedule against one — but a receiver can still hand this a negative */
    expect(reelStep(-500, 20)).toBe(0)
  })

  it('crawls at the end, which is what makes it read as deciding', () => {
    /* the ease-out stated as a property rather than as its formula: the first half of the roll
       covers most of the reel, and the last tenth covers almost none of it */
    const n = 40
    expect(reelStep(ROLL_MS / 2, n)).toBeGreaterThan(n * 0.7)
    expect(n - 1 - reelStep(ROLL_MS * 0.9, n)).toBeLessThan(n * 0.05)
  })
})
