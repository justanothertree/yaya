import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../server/lib/settings.mjs'
import { openSocket, sleep, startRelay, until } from './relay-harness.mjs'

/**
 * Exactly what a socket hears from the REAL relay when somebody says hello, and when a peer
 * leaves — for a Snake room, a park and a bout. Recorded on main (c37cc877) and pinned here.
 *
 * ⚠️ WHY A RECORDING AND NOT A RULE. The next change to the relay adds a kind of room whose
 * whole point is that it is QUIET: a socket the door has not let in hears one frame and nothing
 * else. That change has to restructure the hello and the close, which are the two paths every
 * Snake lobby, park and bout already runs on — and none of them had a test, because the relay
 * opens a socket at import and so could only be asked through one. A rule written about those
 * paths would be a second opinion; the recording is the first one. Anything the restructure
 * changes for the rooms that exist today turns this red, frame by frame.
 *
 * ⚠️ IT RECORDS WHAT THE RELAY DOES, NOT WHAT IT SHOULD. Some of what is pinned here is odd and
 * is pinned anyway: the creator hears `host` and `presence` TWICE (once from the broadcast it is
 * part of, once sent to it directly); a park and a bout are told Snake's board settings; and a
 * socket nobody has vouched for in a park hears `host`, `presence` and `over`, which is a gap in
 * the park's door of its own. Fixing any of those is a decision about live clients, so it should
 * arrive as a deliberate edit to this file rather than as a side effect.
 *
 * ⚠️ EVERY FRAME IN THE WINDOW COUNTS, including ones nobody expected. A step waits until each
 * socket holds at least what it should — bounded, so a missing frame fails rather than hangs —
 * then waits a moment longer so a frame nobody expected has time to land. The relay sends all of
 * a step's frames in one synchronous turn, so a late extra is not a timing question.
 *
 * Ids are random, so each socket's id is learnt from its own `welcome` and written as `<A>`.
 * The relay runs with no Supabase at all, which is what keeps every socket unvouched and every
 * frame deterministic; HEARTBEAT_MS keeps a ping sweep out of the window.
 */

const welcome = (id, visitor) => ({ type: 'welcome', id, visitor })
const host = (hostId) => ({ type: 'host', hostId })
const presence = (count) => ({ type: 'presence', count })
const settings = (s) => ({ type: 'settings', settings: s })
const over = (from) => ({ type: 'over', from, reason: 'quit' })

let relay
beforeAll(async () => {
  relay = await startRelay({ HEARTBEAT_MS: '600000' })
})
afterAll(async () => {
  await relay?.stop()
})

/** One room's worth of sockets, named A, B, C…, driven a step at a time. */
function room() {
  const socks = new Map()
  const names = new Map()
  const norm = (v) => {
    if (typeof v === 'string') return names.has(v) ? `<${names.get(v)}>` : v
    if (Array.isArray(v)) return v.map(norm)
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]))
    return v
  }
  async function step(act, want) {
    for (const s of socks.values()) s.inbox.length = 0
    await act()
    const full = Object.fromEntries([...socks.keys()].map((n) => [n, want[n] ?? []]))
    await until(() => [...socks].every(([n, s]) => s.inbox.length >= full[n].length), 5000)
    await sleep(150)
    for (const [n, s] of socks)
      for (const f of s.inbox)
        if (f?.type === 'welcome' && typeof f.id === 'string') names.set(f.id, n)
    const got = Object.fromEntries([...socks].map(([n, s]) => [n, s.inbox.map(norm)]))
    expect(got).toEqual(full)
  }
  return {
    hello: (name, msg, want) =>
      step(async () => {
        const s = openSocket(relay.url)
        await s.opened
        socks.set(name, s)
        s.send({ type: 'hello', ...msg })
      }, want),
    close: (name, want) =>
      step(async () => {
        socks.get(name).close()
        socks.delete(name)
      }, want),
    closeAll: () => {
      for (const s of socks.values()) s.close()
      socks.clear()
    },
  }
}

describe('what the real relay sends on hello and on a peer leaving', () => {
  it('a Snake room: the creator, two joiners, a guest leaving, then the host', async () => {
    const id = 'relay-frames-snake'
    /* every board setting away from its default, so a dropped field cannot hide behind one;
       laid over the defaults because that is what a creator's settings are (sanitizeSettings) */
    const asked = { grid: 20, apples: 2, passThroughEdges: false, canvasSize: 'small' }
    const board = { ...DEFAULT_SETTINGS, ...asked }
    const r = room()
    try {
      await r.hello(
        'A',
        { room: id, create: true, settings: asked },
        {
          A: [
            welcome('<A>', 0),
            host('<A>'),
            host('<A>'),
            presence(1),
            presence(1),
            settings(board),
          ],
        },
      )
      await r.hello(
        'B',
        { room: id },
        {
          A: [presence(2)],
          B: [welcome('<B>', 1), host('<A>'), presence(2), presence(2), settings(board)],
        },
      )
      await r.hello(
        'C',
        { room: id },
        {
          A: [presence(3)],
          B: [presence(3)],
          C: [welcome('<C>', 2), host('<A>'), presence(3), presence(3), settings(board)],
        },
      )
      await r.close('C', { A: [over('<C>'), presence(2)], B: [over('<C>'), presence(2)] })
      await r.close('A', { B: [host('<B>'), over('<A>'), presence(1)] })
      await r.close('B', {})
    } finally {
      r.closeAll()
    }
  })

  /* the client sends `create: true` on every park and bout hello (src/park/room.ts,
     src/pets/boutRoom.ts), and no settings — so these rooms are told the defaults */
  it('a park: the same frames, to sockets nobody has vouched for', async () => {
    const id = 'park:relay-frames'
    const r = room()
    try {
      await r.hello(
        'A',
        { room: id, create: true },
        {
          A: [
            welcome('<A>', 0),
            host('<A>'),
            host('<A>'),
            presence(1),
            presence(1),
            settings(DEFAULT_SETTINGS),
          ],
        },
      )
      await r.hello(
        'B',
        { room: id, create: true },
        {
          A: [presence(2)],
          B: [welcome('<B>', 1), host('<A>'), presence(2), presence(2), settings(DEFAULT_SETTINGS)],
        },
      )
      await r.hello(
        'C',
        { room: id, create: true },
        {
          A: [presence(3)],
          B: [presence(3)],
          C: [welcome('<C>', 2), host('<A>'), presence(3), presence(3), settings(DEFAULT_SETTINGS)],
        },
      )
      await r.close('C', { A: [over('<C>'), presence(2)], B: [over('<C>'), presence(2)] })
      await r.close('A', { B: [host('<B>'), over('<A>'), presence(1)] })
      await r.close('B', {})
    } finally {
      r.closeAll()
    }
  })

  it('a bout: two fighters, a third refused with nothing told to the two, the host leaving', async () => {
    const id = 'fight:relay-frames'
    const r = room()
    try {
      await r.hello(
        'A',
        { room: id, create: true },
        {
          A: [
            welcome('<A>', 0),
            host('<A>'),
            host('<A>'),
            presence(1),
            presence(1),
            settings(DEFAULT_SETTINGS),
          ],
        },
      )
      await r.hello(
        'B',
        { room: id, create: true },
        {
          A: [presence(2)],
          B: [welcome('<B>', 1), host('<A>'), presence(2), presence(2), settings(DEFAULT_SETTINGS)],
        },
      )
      await r.hello(
        'C',
        { room: id, create: true },
        {
          C: [
            {
              type: 'error',
              code: 'bout-full',
              message: 'That bout already has two fighters in it',
            },
          ],
        },
      )
      /* refused, so never in the room: leaving tells nobody anything */
      await r.close('C', {})
      await r.close('A', { B: [host('<B>'), over('<A>'), presence(1)] })
      await r.close('B', {})
    } finally {
      r.closeAll()
    }
  })
})
