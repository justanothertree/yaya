import { describe, expect, it } from 'vitest'
import {
  lookLanded,
  lookRetryIn,
  lookSending,
  planLook,
  replayVerdict,
  type LookIntent,
  type LookMemo,
} from './lookPublish'

/**
 * The look on a profile is a mirror of choices made in one browser, so two rules pull against
 * each other: a page LOAD must never publish (a new phone's defaults would overwrite the real
 * look), and a CHANGE must reach the profile even when the first write does not land. Every
 * expectation below is one of those two sentences.
 */

const UID = 'member-1'
const DARK = JSON.stringify({ p_theme: 'dark', p_palette: null, p_flair: null, p_backdrop: null })
const ALT = JSON.stringify({ p_theme: 'alt', p_palette: null, p_flair: 'sparks', p_backdrop: null })

/** The page's first look at this person, on a browser that has chosen nothing. */
function firstRun(sig = DARK): LookMemo {
  const p = planLook(null, null, UID, sig)
  expect(p.publish).toBe(false)
  return p.memo
}

describe('a page load is not a choice', () => {
  it('the first run publishes nothing', () => {
    expect(planLook(null, null, UID, DARK).publish).toBe(false)
  })

  it('a second run with the same look publishes nothing', () => {
    expect(planLook(firstRun(), null, UID, DARK).publish).toBe(false)
  })

  it('signing in as somebody else is their own first run', () => {
    const memo = firstRun()
    expect(planLook(memo, null, 'member-2', ALT).publish).toBe(false)
  })
})

describe('a change reaches the profile', () => {
  it('a change is published', () => {
    expect(planLook(firstRun(), null, UID, ALT).publish).toBe(true)
  })

  it('a change whose write failed is sent again on the next run', () => {
    const tried = planLook(firstRun(), null, UID, ALT)
    expect(tried.publish).toBe(true)
    /* the write went out and did not land — and the same look comes round */
    const memo = lookSending(tried.memo, UID)
    expect(planLook(memo, null, UID, ALT).publish).toBe(true)
  })

  it('a change that landed is not sent again', () => {
    const tried = planLook(firstRun(), null, UID, ALT)
    const memo = lookLanded(lookSending(tried.memo, UID), UID, ALT)
    expect(planLook(memo, null, UID, ALT).publish).toBe(false)
  })

  it('going back before anything was sent sends nothing — the profile still has it', () => {
    const tried = planLook(firstRun(DARK), null, UID, ALT)
    /* ALT was replaced inside the debounce, so the profile still holds DARK */
    expect(planLook(tried.memo, null, UID, DARK).publish).toBe(false)
  })

  it('going back after a write went out unanswered is sent, because the profile may hold it', () => {
    const tried = planLook(firstRun(DARK), null, UID, ALT)
    const memo = lookSending(tried.memo, UID)
    expect(planLook(memo, null, UID, DARK).publish).toBe(true)
  })

  it('a landing for somebody else does not count for this person', () => {
    const tried = planLook(firstRun(), null, UID, ALT)
    const memo = lookLanded(lookSending(tried.memo, UID), 'member-2', ALT)
    expect(planLook(memo, null, UID, ALT).publish).toBe(true)
  })
})

describe('a reload finishes what this browser chose', () => {
  const pending: LookIntent = { uid: UID, look: ALT, base: DARK }

  it('a look chosen here that never landed is checked against the profile on the next load — never sent blind', () => {
    const p = planLook(null, pending, UID, ALT)
    expect(p.verify).toBe(true)
    expect(p.publish).toBe(false)
  })

  it('and once it lands it is not sent again', () => {
    const p = planLook(null, pending, UID, ALT)
    const memo = lookLanded(lookSending(p.memo, UID), UID, ALT)
    expect(planLook(memo, null, UID, ALT).publish).toBe(false)
  })

  it('and if it fails again it is still owed', () => {
    const p = planLook(null, pending, UID, ALT)
    expect(planLook(lookSending(p.memo, UID), pending, UID, ALT).publish).toBe(true)
  })

  it('a pending look this browser no longer wears is dropped, not sent', () => {
    const p = planLook(null, pending, UID, DARK)
    expect(p.publish).toBe(false)
    expect(p.forgetIntent).toBe(true)
  })

  it("somebody else's pending look is neither sent nor dropped", () => {
    const theirs: LookIntent = { uid: 'member-2', look: DARK, base: null }
    const p = planLook(null, theirs, UID, DARK)
    expect(p.publish).toBe(false)
    expect(p.forgetIntent).toBe(false)
  })
})

describe('retrying a write that did not land', () => {
  it('waits longer each time, and gives up', () => {
    const waits: number[] = []
    for (let n = 0; ; n++) {
      const w = lookRetryIn(n, { status: 0 })
      if (w === null) break
      waits.push(w)
      expect(n).toBeLessThan(20)
    }
    expect(waits.length).toBeGreaterThan(1)
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThan(waits[i - 1])
    /* not hammering a server that is struggling, and not a timer that runs for the whole visit */
    expect(waits[0]).toBeGreaterThanOrEqual(1000)
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(5 * 60 * 1000)
  })

  it('retries what could not be reached or was briefly unavailable', () => {
    /* a dropped connection, a 5xx, an expired token mid-refresh, rate limiting */
    for (const status of [0, 401, 408, 429, 500, 502, 503, 504]) {
      expect(lookRetryIn(0, { status })).not.toBeNull()
    }
  })

  it('does not retry a refusal, which would only be refused again', () => {
    /* set_my_profile_look raises (400) for a paused account or a malformed look */
    for (const status of [400, 403, 404, 409, 422]) {
      expect(lookRetryIn(0, { status })).toBeNull()
    }
  })
})

describe('a reload never replays an older look over a newer one', () => {
  /* chosen here as ALT while the profile was known to hold DARK, and never seen to land */
  const owed: LookIntent = { uid: UID, look: ALT, base: DARK }
  const NEWER = '{"p_theme":"light","p_palette":null,"p_flair":"stars","p_backdrop":null}'

  it('is not sent over a profile that changed since it was chosen — the newer look wins', () => {
    expect(replayVerdict(owed, NEWER)).toBe('superseded')
  })

  it('is sent when the profile still holds what it held when the look was chosen', () => {
    expect(replayVerdict(owed, DARK)).toBe('send')
  })

  it('is not sent when the profile already holds it — the debt is paid', () => {
    expect(replayVerdict(owed, ALT)).toBe('landed')
  })

  it('is not sent while the profile could not be read — it stays owed', () => {
    expect(replayVerdict(owed, undefined)).toBe('wait')
  })

  it('is never sent blind: with no known starting point it only counts as landed or superseded', () => {
    const blind = { ...owed, base: null }
    expect(replayVerdict(blind, DARK)).toBe('superseded')
    expect(replayVerdict(blind, ALT)).toBe('landed')
  })
})
