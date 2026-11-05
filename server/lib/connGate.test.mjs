import { describe, expect, it } from 'vitest'
import { clientAddr, makeConnGate } from './connGate.mjs'

/**
 * The relay's flood gate, asked directly.
 *
 * ⚠️ THIS IS THE DECISION THE RELAY COULD NOT CHECK FROM OUTSIDE. Its own note says so: through
 * Render's proxy a refused socket sees `open`, then no close frame and no error, for at least
 * twelve seconds, so three deploys went into "fixing" a limiter that was working correctly.
 *
 * ⚠️ AND THE DIAGNOSIS WRITTEN DOWN AT THE TIME WAS WRONG TOO, which is the sharper half. The
 * explanation for the "dead" limiter was that the rightmost `x-forwarded-for` entry varied per
 * connection; ws-server.js later retracts that in as many words, having measured what Render
 * actually sends — a single entry, no appended hops. So the record held a fault that did not
 * exist AND a cause that was not the cause, in a file where the only honest check costs a
 * deploy. Reasoning about this has a worse track record than reading it, and that is the whole
 * argument for a test over another careful comment.
 *
 * ⚠️ THE EXPECTATIONS ARE WRITTEN FROM THE SENTENCE, NOT FROM THE SUM. The claim is "N in a
 * window are allowed and the next is refused", so the assertions count against the `perAddr` the
 * gate was built with rather than against a second copy of `recent.length <= perAddr`. The same
 * for the window: a test that recomputed `now - t < windowMs` would agree with an off-by-one
 * instead of catching it, so both boundaries are swept by hand — and they are genuinely
 * different, `<` on the per-address filter and `>=` on the global shift.
 */

const GATE = { windowMs: 1000, perAddr: 3, globalCap: 8 }

describe('clientAddr', () => {
  const req = (xff, socket = '10.0.0.9') => ({
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
    socket: { remoteAddress: socket },
  })

  it('takes the FIRST entry, which is the one the caller claims', () => {
    /* leftmost is the conventional client address and survives Render ever appending hops; on
       this deployment there is only ever one entry, so this case cannot arise there — which is
       exactly why it is asserted here rather than watched for in production */
    expect(clientAddr(req('1.1.1.1, 2.2.2.2, 3.3.3.3'))).toBe('1.1.1.1')
  })

  it('trims, and steps over empty entries', () => {
    expect(clientAddr(req('  ,  , 4.4.4.4 , 5.5.5.5'))).toBe('4.4.4.4')
  })

  it('falls back to the socket when the header is empty or all separators', () => {
    expect(clientAddr(req(' , , '))).toBe('10.0.0.9')
    expect(clientAddr(req(''))).toBe('10.0.0.9')
    expect(clientAddr(req(undefined))).toBe('10.0.0.9')
  })

  it('ignores the header outright when the proxy is not trusted', () => {
    expect(clientAddr(req('1.1.1.1'), false)).toBe('10.0.0.9')
  })

  it('says unknown rather than undefined when there is nothing to go on', () => {
    expect(clientAddr({}, true)).toBe('unknown')
    expect(clientAddr(undefined, true)).toBe('unknown')
  })

  it('does not take an array header as an address', () => {
    /* node gives an array when a header arrives twice; the old code checked for a string and
       this keeps that, because joining them would invent an address nobody sent */
    expect(clientAddr(req(['1.1.1.1', '2.2.2.2']))).toBe('10.0.0.9')
  })
})

describe('the per-address ceiling', () => {
  it('allows exactly perAddr in a window and refuses the next', () => {
    const g = makeConnGate(GATE)
    const verdicts = []
    for (let i = 0; i < GATE.perAddr + 2; i++) verdicts.push(g.allow('a', 1000 + i).ok)
    expect(verdicts).toEqual([...Array(GATE.perAddr).fill(true), false, false])
  })

  it('counts a connection at the very edge of the window and not one past it', () => {
    const g = makeConnGate(GATE)
    g.allow('a', 0)
    g.allow('a', 0)
    g.allow('a', 0) /* three at t=0, the ceiling */

    /* 1ms before the window closes they are all still counted, so a fourth is refused */
    expect(g.allow('a', GATE.windowMs - 1).ok).toBe(false)

    /* and the moment it closes they are gone: `now - t < windowMs` is false at exactly windowMs */
    const fresh = makeConnGate(GATE)
    fresh.allow('a', 0)
    fresh.allow('a', 0)
    fresh.allow('a', 0)
    expect(fresh.allow('a', GATE.windowMs).ok).toBe(true)
  })

  it('keeps one address away from another', () => {
    const g = makeConnGate(GATE)
    for (let i = 0; i < GATE.perAddr + 1; i++) g.allow('a', 1000)
    expect(g.allow('b', 1000).ok).toBe(true)
  })
})

describe('the global backstop', () => {
  it('refuses an address that is well inside its OWN limit', () => {
    /* the shared-fuse property, stated in the module: whoever trips it locks everybody out */
    const g = makeConnGate(GATE)
    for (let i = 0; i < GATE.globalCap; i++) g.allow(`flood-${i}`, 1000)

    const innocent = g.allow('somebody-else', 1000)
    expect(innocent.perAddr).toBe(1)
    expect(innocent.ok).toBe(false)
  })

  it('bounds a forged address that rotates every time — the reason it exists', () => {
    /* ⚠️ THE DOCUMENTED SECURITY PROPERTY, ASSERTED. An attacker prepending a fresh
       x-forwarded-for gets a brand-new per-address budget on every connection, so the
       per-address ceiling bounds them not at all; the global one is the only thing that does. */
    const g = makeConnGate(GATE)
    const perAddrCounts = []
    const verdicts = []
    for (let i = 0; i < GATE.globalCap + 3; i++) {
      const v = g.allow(`forged-${i}`, 1000)
      perAddrCounts.push(v.perAddr)
      verdicts.push(v.ok)
    }
    /* every single one is the first from "its" address — the per-address limit never fires */
    expect(new Set(perAddrCounts)).toEqual(new Set([1]))
    expect(verdicts.filter(Boolean)).toHaveLength(GATE.globalCap)
    expect(verdicts.slice(GATE.globalCap)).toEqual([false, false, false])
  })

  it('slides, so a flood that stops is forgiven', () => {
    const g = makeConnGate(GATE)
    for (let i = 0; i < GATE.globalCap + 1; i++) g.allow(`forged-${i}`, 0)
    expect(g.allow('late', 0).ok).toBe(false)
    /* the global shift is `>=`, so at exactly windowMs the first entries are dropped */
    expect(g.allow('late', GATE.windowMs).ok).toBe(true)
  })
})

describe('prune, so the thing that bounds a flood is not what a flood grows', () => {
  it('forgets an address once its connections age out', () => {
    const g = makeConnGate(GATE)
    for (let i = 0; i < 50; i++) g.allow(`addr-${i}`, 0)
    expect(g.addresses).toBe(50)

    g.prune(GATE.windowMs)
    expect(g.addresses).toBe(0)
  })

  it('keeps an address that is still inside the window', () => {
    const g = makeConnGate(GATE)
    g.allow('old', 0)
    g.allow('new', GATE.windowMs - 1)

    g.prune(GATE.windowMs)
    expect(g.addresses).toBe(1)
    /* and what survived is the live one, with its timestamp intact: a second connection from
       `new` in the same window must still count as its second */
    expect(g.allow('new', GATE.windowMs).perAddr).toBe(2)
  })

  it('reports what the diagnostics endpoint prints', () => {
    const g = makeConnGate(GATE)
    g.allow('a', 0)
    g.allow('a', 0)
    g.allow('b', 0)
    expect(g.addresses).toBe(2)
    expect(g.inWindow).toBe(3)
  })
})
