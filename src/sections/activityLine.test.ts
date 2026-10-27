import { describe, expect, it } from 'vitest'
import { activityLine, type ActivityItem } from './activityLine'

/**
 * ⚠️ THE QUESTION IS "DOES EVERY KIND GET A SENTENCE OF ITS OWN", NOT "IS THIS THE STRING".
 *
 * A rating used to fall through to the snake-score line and render "Scored 94 · Mistfall Hunter".
 * A test comparing each kind against a string typed out from the code would have agreed with that
 * happily — it is the same sum twice. Feeding every kind the SAME score, detail and timestamp and
 * requiring the lines to differ asks the question the bug answers wrongly, and shares no
 * arithmetic with the thing it is asking.
 */
const KINDS = ['circuit_log', 'rating', 'snake_score', 'snake_trophy'] as const

const sameEvent = (kind: ActivityItem['kind']): ActivityItem => ({
  kind,
  at: '2026-08-11T18:30:00Z',
  detail: 'Mistfall Hunter',
  score: 94,
  items: [{ name: 'Push-ups', unit: 'reps', val: 40, points: 94 }],
})

describe('activityLine', () => {
  it('writes a different sentence for every kind of event', () => {
    const lines = KINDS.map((k) => activityLine(sameEvent(k)))
    expect(new Set(lines).size).toBe(KINDS.length)
  })

  it('never answers with the kind name itself', () => {
    /* the exhaustiveness branch stringifies `a.kind`; it must stay unreachable */
    for (const k of KINDS) expect(activityLine(sameEvent(k))).not.toContain(k)
  })

  it('calls a rating a rating, and says what was rated', () => {
    expect(activityLine(sameEvent('rating'))).toMatch(/^Rated Mistfall Hunter 94 · /)
  })

  it('does not call a rating a score', () => {
    expect(activityLine(sameEvent('rating'))).not.toMatch(/Scored/)
  })

  it('still says Scored for a snake score', () => {
    expect(activityLine(sameEvent('snake_score'))).toMatch(/^Scored 94 · /)
  })

  /** a film with no title left is still an event — "Rated 94" alone names nothing */
  it('has a word for a rating whose title has gone', () => {
    expect(activityLine({ ...sameEvent('rating'), detail: null })).toMatch(/^Rated something 94 · /)
  })

  /** 40 reps, never 40.0 — and 2.5 stays 2.5 */
  it('writes a workout in whole reps where they are whole', () => {
    const l = activityLine({
      ...sameEvent('circuit_log'),
      items: [
        { name: 'Push-ups', unit: 'reps', val: 40, points: 1 },
        { name: 'Plank', unit: 'min', val: 2.5, points: 1 },
      ],
    })
    expect(l).toContain('40 reps Push-ups')
    expect(l).toContain('2.5 min Plank')
  })
})
