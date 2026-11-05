import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  circuitInviteMessage,
  circuitInviteText,
  circuitJoinCodeOf,
  circuitJoinLink,
  hasJoinCodeInUrl,
  hasPendingJoinCode,
  parkJoinCode,
  takeJoinCode,
} from './inviteLink'

/**
 * A circuit invite is a chat message with a link in it, and nothing else: no pending-invite
 * table, nothing to expire. That makes the whole feature four pure string functions and one
 * hand-off through the URL — and the hand-off is where it went wrong.
 *
 * ⚠️ THE BUG THESE TESTS WERE WRITTEN FOR. A signed-out tap parks the code out of the hash and
 * toasts "Sign in and you'll join that circuit". Everything that then asked whether an invite was
 * waiting asked `hasJoinCodeInUrl()`, which is false by then — so the Circuit opened on the Log,
 * `CircuitsPanel` never mounted, and the only thing that spends the stash never ran. The invite
 * did nothing and said nothing. `hasPendingJoinCode()` asks "is there a code", and the last
 * describe below is that sentence as a test.
 *
 * The DOM is stubbed rather than emulated, the way `src/draw/stores.test.ts` does it: this suite
 * runs in node, and what these functions touch is three globals — `location`, `history` and
 * `sessionStorage`.
 */

/** A tab's worth of session storage, with the throwing variant private mode gives you. */
const fakeSession = (start: Record<string, string> = {}) => {
  const box = new Map(Object.entries(start))
  return {
    getItem: (k: string) => box.get(k) ?? null,
    setItem: (k: string, v: string) => void box.set(k, String(v)),
    removeItem: (k: string) => void box.delete(k),
    get size() {
      return box.size
    },
  }
}

const atUrl = (hash: string, session = fakeSession()) => {
  const loc = { origin: 'https://evancook.dev', pathname: '/', hash }
  const calls: string[] = []
  const history = {
    replaceState: (_s: unknown, _t: string, url: string) => {
      calls.push(url)
      loc.hash = url.slice(url.indexOf('#'))
    },
  }
  vi.stubGlobal('location', loc)
  vi.stubGlobal('sessionStorage', session)
  vi.stubGlobal('history', history)
  vi.stubGlobal('window', { location: loc, sessionStorage: session, history })
  return { loc, session, calls }
}

afterEach(() => vi.unstubAllGlobals())

describe('the message', () => {
  /* the real shape of a code: `circuit_groups.join_code` defaults to
     encode(gen_random_bytes(6), 'hex'), so twelve hex characters */
  const CODE = 'a3f90c17b2e8'

  it('round-trips a code through the message somebody actually receives', () => {
    atUrl('#home')
    const body = circuitInviteMessage(CODE, 'Thursday Lifts')
    expect(circuitJoinCodeOf(body)).toBe(CODE)
  })

  it('round-trips with no circuit name, which is a different message', () => {
    /* the name is optional and changes the sentence, so it is a second round trip rather than
       the same one with a shorter string in it */
    atUrl('#home')
    const body = circuitInviteMessage(CODE)
    expect(body).not.toContain('“')
    expect(circuitJoinCodeOf(body)).toBe(CODE)
  })

  it('puts the link on its own line, so a plain-text client still reads as an invitation', () => {
    atUrl('#home')
    const [first, second, ...rest] = circuitInviteMessage(CODE, 'Thursday Lifts').split('\n')
    expect(first).toContain('Join my circuit')
    expect(first).not.toContain('http')
    expect(second).toBe(circuitJoinLink(CODE))
    expect(rest).toEqual([])
  })

  it('finds nothing in an ordinary message', () => {
    atUrl('#home')
    expect(circuitJoinCodeOf('are you coming on thursday?')).toBeNull()
    expect(circuitJoinCodeOf('')).toBeNull()
    /* the hash without a code is not an invite, and neither is the word join */
    expect(circuitJoinCodeOf('see #circuit — join whenever')).toBeNull()
  })

  it('leaves the human half of the message and takes the whole URL with the link', () => {
    atUrl('#home')
    const text = circuitInviteText(circuitInviteMessage(CODE, 'Thursday Lifts'))
    expect(text).toBe('🏆 Join my circuit “Thursday Lifts”:')
    /* the origin must go with it: half a URL left in a sentence is worse than the whole one */
    expect(text).not.toContain('http')
    expect(text).not.toContain('evancook.dev')
    expect(text).not.toContain('#circuit')
  })

  it('answers null when the message was nothing but a link', () => {
    atUrl('#home')
    expect(circuitInviteText(circuitJoinLink(CODE))).toBeNull()
  })
})

describe('arriving on a link', () => {
  const CODE = 'b7c0519ae412'

  it('sees a code in the hash, and not in a plain room link', () => {
    atUrl(`#circuit?join=${CODE}`)
    expect(hasJoinCodeInUrl()).toBe(true)
    atUrl('#circuit')
    expect(hasJoinCodeInUrl()).toBe(false)
    atUrl('#circuit?tab=log')
    expect(hasJoinCodeInUrl()).toBe(false)
  })

  it('moves the code out of the address bar and keeps the rest of the query', () => {
    /* out of the URL matters twice over: a refresh would re-run the join, and the code would sit
       in the address bar to be read over a shoulder */
    const { loc, session } = atUrl(`#circuit?tab=log&join=${CODE}`)
    parkJoinCode()
    expect(session.getItem('circuit_pending_join')).toBe(CODE)
    expect(loc.hash).toBe('#circuit?tab=log')
    expect(loc.hash).not.toContain(CODE)
  })

  it('tidies the hash down to the room when the code was the only thing in it', () => {
    const { loc } = atUrl(`#circuit?join=${CODE}`)
    parkJoinCode()
    expect(loc.hash).toBe('#circuit')
  })

  it('does nothing at all when there is no code to park', () => {
    const { loc, session, calls } = atUrl('#circuit?tab=feed')
    parkJoinCode()
    expect(session.size).toBe(0)
    expect(calls).toEqual([])
    expect(loc.hash).toBe('#circuit?tab=feed')
  })

  it('hands the code back exactly once', () => {
    /* what makes StrictMode's double mount safe, and a refresh too: the second ask finds nothing
       rather than joining twice */
    atUrl(`#circuit?join=${CODE}`)
    expect(takeJoinCode()).toBe(CODE)
    expect(takeJoinCode()).toBeNull()
  })

  it('survives private mode, where the stash throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    const { loc } = atUrl(
      `#circuit?join=${CODE}`,
      throwing as unknown as ReturnType<typeof fakeSession>,
    )
    expect(() => parkJoinCode()).not.toThrow()
    expect(takeJoinCode()).toBeNull()
    expect(hasPendingJoinCode()).toBe(false)
    /* the code still leaves the URL: it cannot be kept, but it must not be left on display */
    expect(loc.hash).toBe('#circuit')
  })
})

describe('a code that was parked while signed out', () => {
  const CODE = 'c41d8fe09a77'

  it('is still pending after it has left the URL', () => {
    /* ⚠️ THE REGRESSION. Before `hasPendingJoinCode`, this is the moment the invite was lost:
       the hash is clean, so every question about a waiting invite answered no, and the tab that
       spends the stash was never opened. */
    const { loc } = atUrl(`#circuit?join=${CODE}`)
    expect(hasPendingJoinCode()).toBe(true)
    parkJoinCode()
    expect(loc.hash).toBe('#circuit')
    expect(hasJoinCodeInUrl()).toBe(false)
    expect(hasPendingJoinCode()).toBe(true)
  })

  it('stops being pending the moment it is spent', () => {
    atUrl(`#circuit?join=${CODE}`)
    parkJoinCode()
    expect(takeJoinCode()).toBe(CODE)
    expect(hasPendingJoinCode()).toBe(false)
  })

  it('is not pending on a room nobody arrived at by invite', () => {
    /* the floor: if this were true by accident, the Circuit would open on its fifth tab for
       everybody, for ever */
    atUrl('#circuit')
    expect(hasPendingJoinCode()).toBe(false)
    atUrl('#circuit?tab=charts')
    expect(hasPendingJoinCode()).toBe(false)
  })
})
