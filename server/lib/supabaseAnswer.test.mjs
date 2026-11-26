import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { sureOf } from './supabaseAnswer.mjs'

/**
 * Asked with what `fetch` actually produces, not with labels for it: a status number from a
 * Response, and the errors `fetch` rejects with — a TypeError when the network fails, and a
 * DOMException named TimeoutError (or AbortError) when `AbortSignal.timeout` fires.
 */
describe('sureOf: did Supabase answer, or could it not be asked?', () => {
  it('a 2xx is an answer', () => {
    for (const s of [200, 201, 204, 299]) expect(sureOf(s), String(s)).toBe('yes')
  })

  it('a 401 and a 403 are a definite refusal', () => {
    expect(sureOf(401)).toBe('no')
    expect(sureOf(403)).toBe('no')
  })

  it('an outage is never a refusal: 5xx, 429, a dropped network, a timeout, no config', () => {
    for (const s of [500, 502, 503, 504, 429]) expect(sureOf(s), String(s)).toBe('unsure')
    expect(sureOf(new TypeError('fetch failed'))).toBe('unsure')
    expect(sureOf(new DOMException('The operation was aborted', 'AbortError'))).toBe('unsure')
    expect(sureOf(new DOMException('The operation timed out', 'TimeoutError'))).toBe('unsure')
    expect(sureOf(null)).toBe('unsure')
    expect(sureOf(undefined)).toBe('unsure')
  })

  /* a missing RPC (404) or a request built wrongly (400) is about the relay, never the person */
  it('any other status is unsure too, so only a 401 or a 403 can ever be cached as a no', () => {
    for (const s of [100, 301, 304, 400, 404, 409, 422, 0, NaN])
      expect(sureOf(s), String(s)).toBe('unsure')
  })

  /* the two the relay meets, produced the way it meets them rather than constructed by hand */
  it('what fetch really rejects with, on a silent server and on a closed port, is unsure', async () => {
    const silent = createServer(() => {})
    await new Promise((r) => silent.listen(0, '127.0.0.1', r))
    const { port } = silent.address()
    try {
      const timedOut = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(50),
      }).catch((e) => e)
      expect(timedOut?.name).toBe('TimeoutError')
      expect(sureOf(timedOut)).toBe('unsure')
    } finally {
      silent.closeAllConnections()
      await new Promise((r) => silent.close(r))
    }
    const refused = await fetch(`http://127.0.0.1:${port}/`).catch((e) => e)
    expect(refused).toBeInstanceOf(TypeError)
    expect(sureOf(refused)).toBe('unsure')
  })
})
