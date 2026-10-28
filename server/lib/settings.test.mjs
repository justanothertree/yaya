import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, boardModeFor, sanitizeSettings } from './settings.mjs'

/**
 * The relay's only check on client-supplied room settings.
 *
 * ⚠️ NOTHING ON THE SERVER HAD A TEST BEFORE THIS ONE, and `npm run lint` had never looked at it
 * either — the config's single block matched TypeScript only, so every `.js` and `.mjs` in the
 * repository was linted by no rules at all and passed. Both halves are the same mistake: a gate
 * that reports on a smaller set than the one it was asked about.
 *
 * ⚠️ EVERY FIXTURE BELOW SETS EVERY FIELD TO SOMETHING OTHER THAN ITS DEFAULT. A round trip is
 * only worth the fields its fixture fills — deleting every rating from chronicle's import left
 * all 34 of its tests green because nothing in the fixture had a rating.
 */

/** a room whose settings are all deliberately unlike the defaults */
const FULL = {
  grid: 42,
  apples: 7,
  passThroughEdges: false,
  canvasSize: 'large',
  race: true,
  tron: true,
  tronRivals: true,
  solidBodies: true,
  ghosts: true,
  hunger: true,
  hungerSeconds: 45,
  raceTarget: 120,
  speedMs: 90,
}

describe('what a client is allowed to set on a room', () => {
  it('accepts every setting the game actually has', () => {
    const out = sanitizeSettings(FULL, DEFAULT_SETTINGS)
    for (const [k, v] of Object.entries(FULL)) expect(out[k], k).toEqual(v)
  })

  /**
   * ⚠️ THE FAILURE THIS GUARDS IS "SILENTLY REVERTS", NOT "ERRORS". Hunger was once missing from
   * the allowlist: the client set it, sent it, and the relay echoed the room's settings back
   * without it — so the toggle flickered and undid itself and the seconds options never appeared.
   * Dropping any one key from the list reads exactly like that, on that one control only.
   */
  it('drops no key on the way through, one at a time', () => {
    for (const key of Object.keys(FULL)) {
      const only = { [key]: FULL[key] }
      const out = sanitizeSettings(only, DEFAULT_SETTINGS)
      expect(out[key], `${key} was dropped`).toEqual(FULL[key])
    }
  })

  it('ignores a key the game does not have', () => {
    const out = sanitizeSettings({ ...FULL, wallhack: true, grid: 42 }, DEFAULT_SETTINGS)
    expect('wallhack' in out).toBe(false)
  })

  /**
   * ⚠️ SILENCE IS "I AM NOT TALKING ABOUT THIS", NEVER "THROW IT AWAY" — the rule chronicle
   * learned the expensive way, where a save that wrote every column deleted the ones the caller
   * forgot. Here the host sends only what they changed, so anything else in the room must survive.
   */
  it('leaves every setting it was not told about exactly as it was', () => {
    const room = sanitizeSettings(FULL, DEFAULT_SETTINGS)
    for (const key of Object.keys(FULL)) {
      const after = sanitizeSettings({ [key]: FULL[key] }, room)
      expect(after, `changing ${key} disturbed something else`).toEqual(room)
    }
  })

  it('keeps the room when handed nothing it can use', () => {
    const room = sanitizeSettings(FULL, DEFAULT_SETTINGS)
    for (const junk of [null, undefined, 'tron', 42, true, []]) {
      expect(sanitizeSettings(junk, room), String(junk)).toEqual(room)
    }
  })

  it('falls back to the defaults when there is no room yet', () => {
    expect(sanitizeSettings(null, null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings({}, undefined)).toEqual(DEFAULT_SETTINGS)
  })

  it('does not let a payload reach Object.prototype', () => {
    const nasty = JSON.parse('{"__proto__":{"pwned":true},"grid":42}')
    const out = sanitizeSettings(nasty, DEFAULT_SETTINGS)
    expect(out.grid).toBe(42)
    expect({}.pwned).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('pwned')
  })
})

/**
 * ⚠️ THE ENDS OF EACH BAND, NOT TWO FIXTURES IN THE MIDDLE. Both fixtures for the park's minion
 * life band sat near the bottom and the creature that exposed the bug rolled near the top.
 */
describe('the bounds, swept at their own edges', () => {
  const bands = [
    { key: 'grid', lo: 10, hi: 60, floors: false },
    { key: 'hungerSeconds', lo: 2, hi: 120, floors: true },
    { key: 'raceTarget', lo: 5, hi: 500, floors: true },
    { key: 'speedMs', lo: 40, hi: 400, floors: true },
  ]

  it.each(bands)('takes $key at both ends and refuses just outside', ({ key, lo, hi }) => {
    const base = sanitizeSettings(FULL, DEFAULT_SETTINGS)
    expect(sanitizeSettings({ [key]: lo }, base)[key], `${key} low end`).toBe(lo)
    expect(sanitizeSettings({ [key]: hi }, base)[key], `${key} high end`).toBe(hi)
    expect(sanitizeSettings({ [key]: lo - 1 }, base)[key], `${key} below`).toBe(base[key])
    expect(sanitizeSettings({ [key]: hi + 1 }, base)[key], `${key} above`).toBe(base[key])
  })

  it.each(bands.filter((b) => b.floors))('stores $key as a whole number', ({ key, lo, hi }) => {
    const mid = Math.floor((lo + hi) / 2) + 0.7
    const got = sanitizeSettings({ [key]: mid }, DEFAULT_SETTINGS)[key]
    expect(Number.isInteger(got), `${key} kept a fraction`).toBe(true)
    expect(got).toBe(Math.floor(mid))
  })

  it.each(bands)('refuses $key as anything but a number', ({ key, lo }) => {
    const base = sanitizeSettings(FULL, DEFAULT_SETTINGS)
    for (const junk of [String(lo), null, true, NaN, [lo], { v: lo }]) {
      const got = sanitizeSettings({ [key]: junk }, base)[key]
      // NaN fails every comparison, so it is refused by the bounds rather than by the type check
      expect(got, `${key} accepted ${JSON.stringify(junk)}`).toBe(base[key])
    }
  })

  /** apples has a floor and deliberately no ceiling — a silly number fills the board, not hangs */
  it('takes any number of apples from one up, and nothing below', () => {
    const base = sanitizeSettings(FULL, DEFAULT_SETTINGS)
    expect(sanitizeSettings({ apples: 1 }, base).apples).toBe(1)
    expect(sanitizeSettings({ apples: 999 }, base).apples).toBe(999)
    expect(sanitizeSettings({ apples: 4.9 }, base).apples).toBe(4)
    for (const no of [0, -1, 0.5]) {
      expect(sanitizeSettings({ apples: no }, base).apples, String(no)).toBe(base.apples)
    }
  })

  it('takes only the three canvas sizes', () => {
    const base = sanitizeSettings(FULL, DEFAULT_SETTINGS)
    for (const ok of ['small', 'medium', 'large']) {
      expect(sanitizeSettings({ canvasSize: ok }, base).canvasSize).toBe(ok)
    }
    for (const no of ['huge', 'SMALL', '', 3, null]) {
      expect(sanitizeSettings({ canvasSize: no }, base).canvasSize, String(no)).toBe(
        base.canvasSize,
      )
    }
  })

  it('takes a boolean as a boolean and nothing else as one', () => {
    const flags = [
      'passThroughEdges',
      'race',
      'tron',
      'tronRivals',
      'solidBodies',
      'ghosts',
      'hunger',
    ]
    const base = sanitizeSettings(FULL, DEFAULT_SETTINGS)
    for (const key of flags) {
      expect(sanitizeSettings({ [key]: false }, base)[key], key).toBe(false)
      expect(sanitizeSettings({ [key]: true }, base)[key], key).toBe(true)
      for (const junk of ['true', 1, 0, null]) {
        expect(sanitizeSettings({ [key]: junk }, base)[key], `${key} ← ${junk}`).toBe(base[key])
      }
    }
  })
})

describe('which board a round is recorded under', () => {
  it('calls a room with neither flag survival', () => {
    expect(boardModeFor({})).toBe('survival')
    expect(boardModeFor(null)).toBe('survival')
    expect(boardModeFor(undefined)).toBe('survival')
  })

  it('names race and tron', () => {
    expect(boardModeFor({ race: true })).toBe('race')
    expect(boardModeFor({ tron: true })).toBe('tron')
  })

  /** both at once is reachable — the settings allowlist takes each flag independently */
  it('lets tron win when a room has both', () => {
    expect(boardModeFor({ race: true, tron: true })).toBe('tron')
  })
})

/**
 * ⚠️ TWO COMMENTS ASK A PERSON TO KEEP THESE IN STEP, WHICH IS THE ONE THING §11 SAYS DOES NOT
 * BELONG ANYWHERE. The client's copy cannot be imported — it is not exported, and that module
 * pulls in React, the renderer and the net client at load — so this reads its source instead.
 *
 * `apples` is the field that has actually moved: it went from 1 to 4 and the client still carries
 * an `LS_APPLES_BUMP_KEY` migration for people whose saved settings predate it. `grid` is not
 * compared because the client writes it as a constant rather than a literal.
 */
describe('the defaults the client and the relay each hold', () => {
  const clientSource = readFileSync(new URL('../../src/game/manager.tsx', import.meta.url), 'utf8')
  const block = clientSource.slice(clientSource.indexOf('const DEFAULT_SETTINGS: Settings = {'))
  const literal = (key) =>
    block.slice(0, block.indexOf('\n}')).match(new RegExp(`${key}:\\s*([^,\\n]+)`))

  it.each([
    ['apples', String(DEFAULT_SETTINGS.apples)],
    ['passThroughEdges', String(DEFAULT_SETTINGS.passThroughEdges)],
    ['canvasSize', `'${DEFAULT_SETTINGS.canvasSize}'`],
  ])('agrees with src/game/manager.tsx about %s', (key, expected) => {
    const found = literal(key)
    expect(found, `could not find ${key} in the client's DEFAULT_SETTINGS`).not.toBeNull()
    expect(found[1].trim()).toBe(expected)
  })
})
