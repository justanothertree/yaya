import { describe, expect, it } from 'vitest'
import { nextTry, signInStep, standingOf } from './signIn.mjs'

/**
 * The relay's `auth` frame: what Supabase's answers mean, and when to ask again.
 *
 * Asked the way the relay meets them — a status and a parsed body for `is_suspended`, the
 * 'yes' | 'no' | 'unsure' of supabaseAnswer.mjs for the token — and, for the retry, by playing a
 * sign-in out on a clock: attempts that each cost some time, against a Supabase that fails until
 * some moment and answers after it. What is asserted is what a member would see (were they let
 * in, did anything start after the window closed), never the waits' own arithmetic.
 */

describe('standingOf: is this account in good standing, by what is_suspended said?', () => {
  it('a 2xx false is good standing, and a 2xx true is a suspension', () => {
    expect(standingOf(200, false)).toBe('yes')
    expect(standingOf(200, true)).toBe('no')
  })

  it('a 2xx that says neither is a doubt, never good standing', () => {
    /* is_suspended answers NULL for "not your business"; nothing but a boolean is an answer */
    for (const body of [null, undefined, 'false', 'true', 0, 1, {}, []])
      expect(standingOf(200, body), JSON.stringify(body)).toBe('unsure')
  })

  it('a 401 or a 403 is a definite no, whatever the body', () => {
    expect(standingOf(401, false)).toBe('no')
    expect(standingOf(403, null)).toBe('no')
  })

  it('an outage is a doubt, whatever the body', () => {
    for (const status of [500, 502, 503, 504, 429, 404, 400])
      expect(standingOf(status, false), String(status)).toBe('unsure')
    expect(standingOf(new TypeError('fetch failed'), false)).toBe('unsure')
    expect(standingOf(null, false)).toBe('unsure')
  })
})

describe('signInStep: what one attempt at signing in comes to', () => {
  for (const needsStanding of [false, true]) {
    const where = needsStanding ? 'a park or a bout' : 'Snake'

    it(`${where}: a refused token is final`, () => {
      expect(signInStep({ token: 'no', needsStanding })).toBe('refused')
    })

    it(`${where}: a token Supabase could not check is asked again`, () => {
      expect(signInStep({ token: 'unsure', needsStanding })).toBe('retry')
      /* only a real answer is believed, and nothing else is a refusal either */
      expect(signInStep({ token: undefined, needsStanding })).toBe('retry')
    })
  }

  it('Snake: a good token is signed in, and needs no standing', () => {
    expect(signInStep({ token: 'yes', needsStanding: false })).toBe('signed-in')
  })

  it('a park or a bout: only a good standing lets somebody in', () => {
    expect(signInStep({ token: 'yes', standing: 'yes', needsStanding: true })).toBe('vouched')
  })

  it('a park or a bout: a suspended account is final', () => {
    expect(signInStep({ token: 'yes', standing: 'no', needsStanding: true })).toBe('refused')
  })

  it('a park or a bout: a standing nobody could check is asked again, never let in', () => {
    for (const standing of ['unsure', undefined])
      expect(signInStep({ token: 'yes', standing, needsStanding: true })).toBe('retry')
  })
})

/**
 * A sign-in played out on a clock. Every attempt takes `cost` ms; Supabase fails every attempt
 * that starts before `answersFrom` and answers every one that starts at or after it. Returns
 * when each attempt started and whether one was answered.
 */
function playOut({ cost, windowMs, answersFrom = Infinity }) {
  const starts = []
  let t = 0
  for (let attempt = 1; attempt < 1000; attempt++) {
    starts.push(t)
    if (t >= answersFrom) return { starts, answered: true }
    t += cost
    const wait = nextTry(attempt, 0, t, windowMs)
    if (wait === null) return { starts, answered: false }
    t += wait
  }
  throw new Error('the asking never stopped')
}

/** the relay's own numbers: PARK_VOUCH_MS and OUTBOUND_TIMEOUT_MS in ws-server.js */
const WINDOW_MS = 12_000
const TIMEOUT_MS = 8_000

describe('nextTry: a blip is ridden out inside the window, and an outage is not hammered', () => {
  it('a blip of up to three seconds is ridden out, however fast the failures come back', () => {
    for (const answersFrom of [1, 500, 1000, 2000, 3000])
      for (const cost of [5, 50, 300])
        expect(
          playOut({ cost, windowMs: WINDOW_MS, answersFrom }).answered,
          `blip ${answersFrom}ms, each try ${cost}ms`,
        ).toBe(true)
  })

  it('a first try that hangs to the timeout still gets a second inside the window', () => {
    const { starts, answered } = playOut({ cost: TIMEOUT_MS, windowMs: WINDOW_MS, answersFrom: 1 })
    expect(answered).toBe(true)
    expect(starts.length).toBe(2)
    expect(starts[1]).toBeLessThan(WINDOW_MS)
  })

  it('no attempt ever starts after the window has closed', () => {
    for (const windowMs of [2000, 4000, WINDOW_MS])
      for (const cost of [0, 5, 50, 400, 3000, TIMEOUT_MS]) {
        const { starts } = playOut({ cost, windowMs })
        for (const at of starts)
          expect(at, `window ${windowMs}, try ${cost}`).toBeLessThan(windowMs)
      }
  })

  it('a lasting outage is asked again, but each wait is longer than the one before', () => {
    let t = 0
    const waits = []
    for (let attempt = 1; ; attempt++) {
      t += 5
      const wait = nextTry(attempt, 0, t, Infinity)
      if (wait === null) break
      waits.push(wait)
      t += wait
    }
    expect(waits.length).toBeGreaterThan(0)
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThan(waits[i - 1])
  })

  it('it stops by itself even when the window never closes', () => {
    expect(() => playOut({ cost: 0, windowMs: Infinity })).not.toThrow()
  })
})
