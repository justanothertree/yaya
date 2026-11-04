import { describe, it, expect } from 'vitest'
import { timelineSays, goalsSays, type Reach } from './sharingCopy'

/**
 * What these pin is the ORDER of the chain, not the wording.
 *
 * ⚠️ THE EXPECTATIONS ARE WRITTEN FROM THE WORLD'S SHAPE, which here means: what must a reader be
 * told FIRST so that acting on it helps. A sentence telling somebody to pick friends for a card
 * nobody can see is advice that cannot work, and it is what the panel gave until `timelineReaches`
 * existed. So every case asserts which LINK is named, by the one word only that link's sentence
 * contains, rather than comparing the whole string — a copy edit should not turn these red, and a
 * reordered ternary must.
 *
 * ⚠️ AND IT SWEEPS ALL EIGHT COMBINATIONS, INCLUDING THE FOUR THE SERVER CANNOT PRODUCE.
 * `goalsReach` ⇒ `wantsGoals` ⇒ `hasCard` on the server, because all three are read off the same
 * blocks — but a client that trusted that implication would answer nonsense to a payload from an
 * older or newer deployment, and the cheapest way not to depend on it is to say what every
 * combination does.
 *
 * Made to fail twice, from a scratchpad copy rather than a checkout, and both counts are measured:
 *   swap the first two links of `goalsSays`          2 of 15 red
 *   delete the `timelineReaches` branch — the bug    1 of 15 red
 * The first number is small and that is the honest shape of it: `hasCard` and `wantsGoals` differ
 * on only two of the eight triples, because the other six have one of them deciding either way. It
 * is still the sweep that catches the swap, and no fixture could — the two combinations that tell
 * them apart are the ones the server never produces.
 */

const base: Reach = {
  timeline: false,
  timelineReaches: false,
  hasCard: false,
  wantsGoals: false,
  goalsReach: false,
}
const r = (over: Partial<Reach>): Reach => ({ ...base, ...over })

/** every combination of the three booleans the goals line reads */
const triples: Array<[boolean, boolean, boolean]> = [
  [false, false, false],
  [false, false, true],
  [false, true, false],
  [false, true, true],
  [true, false, false],
  [true, false, true],
  [true, true, false],
  [true, true, true],
]

describe('goalsSays names the outermost missing link', () => {
  it.each(triples)('hasCard=%s wantsGoals=%s goalsReach=%s', (hasCard, wantsGoals, goalsReach) => {
    const said = goalsSays(r({ hasCard, wantsGoals, goalsReach }))
    if (!hasCard) {
      /* no card: say so, and never mention the switch on a card that is not there */
      expect(said).toMatch(/no Chronicle card/)
    } else if (!wantsGoals) {
      expect(said).toMatch(/not showing goals/)
    } else if (!goalsReach) {
      /* the link that was invisible before the server grew `goalsReach` */
      expect(said).toMatch(/nobody else can see it/)
    } else {
      expect(said).toMatch(/Who can see each goal/)
    }
  })

  it('never tells somebody to pick friends for a card that is missing or unseen', () => {
    for (const [hasCard, wantsGoals, goalsReach] of triples) {
      if (hasCard && wantsGoals && goalsReach) continue
      expect(goalsSays(r({ hasCard, wantsGoals, goalsReach }))).not.toMatch(/Who can see each goal/)
    }
  })

  it('does not claim a level hides a goal from somebody who can see the card', () => {
    /* the card carries counts without titles by design, so no line here may promise otherwise */
    for (const [hasCard, wantsGoals, goalsReach] of triples) {
      expect(goalsSays(r({ hasCard, wantsGoals, goalsReach }))).not.toMatch(/nobody knows|hidden/i)
    }
  })
})

describe('timelineSays puts the card before the rows', () => {
  it('off is off, whatever is ticked', () => {
    expect(timelineSays(r({ timeline: false, timelineReaches: true }), 7)).toMatch(/^Off\./)
  })

  it('an unseen card is named before the ticks, even with activities ticked', () => {
    /* ⚠️ THE CASE THAT SHIPPED WRONG: three ticked activities on a card set to Only me read as
       "Friends can see your sittings on 3 activities". The reach is nobody. */
    const said = timelineSays(r({ timeline: true, timelineReaches: false }), 3)
    expect(said).toMatch(/nobody else can see it/)
    expect(said).not.toMatch(/Friends can see/)
    expect(said).not.toMatch(/\b3\b/)
  })

  it('a seen card with nothing ticked says so', () => {
    expect(timelineSays(r({ timeline: true, timelineReaches: true }), 0)).toMatch(/no activity is/)
  })

  it('counts in the unit the sentence speaks, singular and plural', () => {
    const one = timelineSays(r({ timeline: true, timelineReaches: true }), 1)
    const many = timelineSays(r({ timeline: true, timelineReaches: true }), 4)
    expect(one).toContain('1 activity')
    expect(many).toContain('4 activities')
  })

  it('does not claim the timeline carries goals', () => {
    /* the switch is `config.timeline`; goals ride `config.goals` and their own levels, so this
       sentence may not fold the two together in either direction */
    const said = timelineSays(r({ timeline: true, timelineReaches: true }), 2)
    expect(said).not.toMatch(/no goals\b/)
    expect(said).toMatch(/Goals are below/)
  })
})
