import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { keepYes, sureOf } from './supabaseAnswer.mjs'

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

/**
 * A token shaped as GoTrue issues one: three base64url parts, the middle one a JSON payload. The
 * signature is junk on purpose, because nothing here may depend on it — the relay reads `exp` to
 * forget sooner, never to believe anything.
 */
const jwt = (payload) =>
  [{ alg: 'HS256', typ: 'JWT' }, payload]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
    .concat('not-a-signature')
    .join('.')

describe('keepYes: how long Supabase’s yes about a token may be kept', () => {
  const now = 1_790_000_000_000
  const TTL = 60_000

  it('a token that expires inside the minute is kept until it expires, and not a moment longer', () => {
    expect(keepYes(jwt({ sub: 'ann', exp: now / 1000 + 30 }), now, TTL)).toBe(30_000)
    expect(keepYes(jwt({ sub: 'ann', exp: now / 1000 + 0.25 }), now, TTL)).toBe(250)
  })

  it('a token already expired, or expiring now, is not kept at all', () => {
    expect(keepYes(jwt({ exp: now / 1000 }), now, TTL)).toBe(0)
    expect(keepYes(jwt({ exp: now / 1000 - 1 }), now, TTL)).toBe(0)
    expect(keepYes(jwt({ exp: 0 }), now, TTL)).toBe(0)
  })

  it('never longer than the minute, however long the token says it lives', () => {
    expect(keepYes(jwt({ exp: now / 1000 + 3600 }), now, TTL)).toBe(TTL)
    expect(keepYes(jwt({ exp: Number.MAX_SAFE_INTEGER }), now, TTL)).toBe(TTL)
  })

  it('a token with no exp it can read is kept the minute, as every token was', () => {
    for (const token of [
      'tok-ann',
      '',
      'a.b',
      'a.b.c.d',
      `x.${Buffer.from('not json').toString('base64url')}.y`,
      jwt({ sub: 'ann' }),
      jwt({ exp: String(now / 1000 + 30) }),
      jwt({ exp: null }),
      jwt({ exp: NaN }),
      jwt(null),
      jwt(42),
      `x.${Buffer.from('{"exp":Infinity}').toString('base64url')}.y`,
    ])
      expect(keepYes(token, now, TTL), token).toBe(TTL)
    expect(keepYes(undefined, now, TTL)).toBe(TTL)
  })
})
