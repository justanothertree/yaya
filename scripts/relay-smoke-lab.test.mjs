import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { closeVerdict, refusalOnTime, viaRender } from './relay-smoke-lab.mjs'

/**
 * relay-smoke's Lab verdicts, asked directly.
 *
 * ⚠️ THE EXPECTATIONS ARE THE SENTENCES, NOT THE MODULE'S SUMS. "Up to 1 s early and 4 s late of
 * a 12 s timer" is written here as 11 s and 16 s, so a wrong bound in ON_TIME turns this red
 * instead of agreeing with it (CLAUDE.md §2).
 */

const headers = (h) => new Headers(h)

describe('viaRender asks the answer, not the address', () => {
  it('is true only for the header Render puts on what its proxy forwards', () => {
    expect(viaRender(headers({ 'x-render-origin-server': 'Render' }))).toBe(true)
    expect(viaRender(headers({ 'X-Render-Origin-Server': 'render' }))).toBe(true)
  })

  it('is false for a relay with nothing in front of it, or something else in front', () => {
    expect(viaRender(headers({}))).toBe(false)
    expect(viaRender(headers({ server: 'cloudflare' }))).toBe(false)
    expect(viaRender(headers({ 'x-render-origin-server': 'nginx' }))).toBe(false)
    expect(viaRender(headers({ 'x-render-origin-server': '' }))).toBe(false)
    expect(viaRender(null)).toBe(false)
    expect(viaRender(undefined)).toBe(false)
  })
})

describe('the sentence comes on the 12 s timer, give or take', () => {
  const T = 12_000

  it('passes from 1 s early to 4 s late, both ends included', () => {
    for (const gap of [11_000, 11_500, 12_000, 12_200, 15_999, 16_000])
      expect(refusalOnTime(gap, T).ok, `${gap} ms`).toBe(true)
  })

  it('fails earlier than 1 s before the timer — that refuses a friend still signing in', () => {
    for (const gap of [0, 3_000, 10_999]) {
      const v = refusalOnTime(gap, T)
      expect(v.ok, `${gap} ms`).toBe(false)
      expect(v.why).toMatch(/before the 12\.0 s timer/)
    }
  })

  it('fails later than 4 s after it — that is not the door’s timer', () => {
    for (const gap of [16_001, 20_000, 32_200]) {
      const v = refusalOnTime(gap, T)
      expect(v.ok, `${gap} ms`).toBe(false)
      expect(v.why).toMatch(/late for the 12\.0 s timer/)
    }
  })

  it('fails when the sentence never came', () => {
    for (const gap of [NaN, undefined, Infinity]) expect(refusalOnTime(gap, T).ok).toBe(false)
  })

  it('says the gap in its own words when it passes', () => {
    expect(refusalOnTime(12_200, T).why).toBe('the door’s sentence 12.2 s after the welcome')
  })
})

describe('the close after the sentence', () => {
  const local = false
  const render = true

  it('a 1008 close passes anywhere, with nothing to warn about', () => {
    for (const where of [local, render]) {
      const v = closeVerdict({ code: 1008 }, where)
      expect(v.ok).toBe(true)
      expect(v.warn).toBeUndefined()
    }
  })

  it('a local run with no close frame fails — no close, or ws’s 1006 for one that never came', () => {
    expect(closeVerdict(null, local)).toMatchObject({
      ok: false,
      why: expect.stringMatching(/no close came within 5 s/),
    })
    expect(closeVerdict({ code: 1006 }, local)).toMatchObject({
      ok: false,
      why: expect.stringMatching(/1006/),
    })
    expect(closeVerdict(null, local).warn).toBeUndefined()
  })

  it('behind Render the same two pass, with a warning that names the quirk and the local rule', () => {
    for (const close of [null, { code: 1006 }]) {
      const v = closeVerdict(close, render)
      expect(v.ok).toBe(true)
      expect(v.warn).toMatch(/Render's proxy drops the relay's close frame/)
      expect(v.warn).toMatch(/a local run requires the 1008/)
    }
  })

  it('a close frame with any other code fails, behind Render too — the quirk is a MISSING frame', () => {
    for (const code of [1000, 1001, 1011, 4029])
      for (const where of [local, render]) {
        const v = closeVerdict({ code }, where)
        expect(v.ok, `${code} ${where ? 'render' : 'local'}`).toBe(false)
        expect(v.why).toBe(`the socket closed ${code}, not 1008`)
        expect(v.warn).toBeUndefined()
      }
  })
})

describe('the smoke decides nothing of its own', () => {
  const smoke = readFileSync(fileURLToPath(new URL('./relay-smoke.mjs', import.meta.url)), 'utf8')

  it('imports the three verdicts from this module', () => {
    expect(smoke).toMatch(/from '\.\/relay-smoke-lab\.mjs'/)
    for (const name of ['viaRender(', 'refusalOnTime(', 'closeVerdict('])
      expect(smoke).toContain(name)
  })

  it('has no close code or Render header of its own to drift from these', () => {
    expect(smoke).not.toMatch(/\b1008\b/)
    expect(smoke).not.toMatch(/\b1006\b/)
    expect(smoke).not.toMatch(/x-render-origin-server/i)
  })
})
