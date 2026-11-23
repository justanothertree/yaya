import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { SAY } from '../server/lib/labDoor.mjs'
import { DEFAULT_SETTINGS } from '../server/lib/settings.mjs'
import { openSocket, sleep, startRelay, until } from './relay-harness.mjs'

/**
 * Exactly what a socket hears from the REAL relay when somebody says hello, and when a peer
 * leaves — for a Snake room, a park and a bout — and, in a park and a bout, what a member who
 * has been let in sends and is sent while a stranger stands beside them. Recorded on main
 * (c37cc877; the members' half on 21beec1c, whose relay is the same file) and pinned here.
 *
 * ⚠️ WHY A RECORDING AND NOT A RULE. The next change to the relay adds a kind of room whose
 * whole point is that it is QUIET: a socket the door has not let in hears one frame and nothing
 * else. That change has to restructure the hello and the close, which are the two paths every
 * Snake lobby, park and bout already runs on — and none of them had a test, because the relay
 * opens a socket at import and so could only be asked through one. A rule written about those
 * paths would be a second opinion; the recording is the first one.
 *
 * ⚠️ AND IT PINS LESS THAN "THE ROOMS THAT EXIST TODAY", WHICH IS WHAT THIS ONCE CLAIMED. With
 * no Supabase nobody is ever let in, so the first relay below pins the hello and the leave to
 * sockets nobody has vouched for — and a park's whole reason for having a door went unpinned. A
 * review proved it with two one-line edits to the relay: `look` sent to the whole room, so a
 * member's drawing reached a stranger, and the roster's scene made null, so whoever arrived late
 * never learnt the map. Every relay test stayed green under both. The second relay has a
 * stand-in for what a park asks Supabase, so its members really are let in: the roster, every
 * frame a park or a bout forwards, and the stranger hearing none of them. What is still NOT
 * here is everything past that — a Snake round after its hello (ready, seed, tick, results,
 * finalize), the rate windows, the caps, room moves and the heartbeat — and a change to any of
 * those turns nothing in this file red.
 *
 * ⚠️ IT RECORDS WHAT THE RELAY DOES, NOT WHAT IT SHOULD. Some of what is pinned here is odd and
 * is pinned anyway: the creator hears `host` and `presence` TWICE (once from the broadcast it is
 * part of, once sent to it directly); a park and a bout are told Snake's board settings; a
 * socket nobody has vouched for in a park hears `host`, `presence` and `over`, which is a gap in
 * the park's door of its own; and it hears a member's `chat` and `name` and is heard in both,
 * because those two go to the whole room in every kind of room. The park's client sends
 * neither, so only a console reaches that half. Fixing any of these is a decision about live
 * clients, so it should arrive as a deliberate edit to this file rather than as a side effect.
 *
 * ⚠️ EVERY FRAME IN THE WINDOW COUNTS, including ones nobody expected. A step waits until each
 * socket holds at least what it should — bounded, so a missing frame fails rather than hangs —
 * then waits a moment longer so a frame nobody expected has time to land. The relay sends all of
 * a step's frames in one synchronous turn once it has what it needs, so a late extra is not a
 * timing question. A step whose answer needs the stand-in waits for the frame itself; a step
 * that expects silence after one is asking what the relay already holds (it keeps a park's
 * owner once it has asked), so that silence is not a race either.
 *
 * Ids are random, so each socket's id is learnt from its own `welcome` and written as `<A>`.
 * The first relay runs with no Supabase at all, which is what keeps every socket in it unvouched
 * and every frame deterministic; HEARTBEAT_MS keeps a ping sweep out of the window.
 *
 * ⚠️ AND THE LAB TABLE, WHICH IS THE CHANGE THE RECORDING WAS MADE FOR. A Lab room is the quiet
 * one: a socket the door has not let in hears its `welcome` and the door's answer, and the room
 * hears nothing about it, arriving or leaving. The first relay has no Supabase, so nobody can be
 * let in at a table and what is pinned is exactly that silence; LAB_VOUCH_MS shortens the wait
 * for the door's answer. What happens once somebody IS let in needs answers from Supabase about
 * friendships too, and is scripts/relay-lab.test.mjs.
 */

const welcome = (id, visitor) => ({ type: 'welcome', id, visitor })
const host = (hostId) => ({ type: 'host', hostId })
const presence = (count) => ({ type: 'presence', count })
const settings = (s) => ({ type: 'settings', settings: s })
const over = (from) => ({ type: 'over', from, reason: 'quit' })
const refused = (code) => ({ type: 'error', code, message: SAY[code] })

/* long enough for the steps before it to finish under load, short enough not to slow the suite;
   the step that expects the door's answer waits for the frame itself, not for a guess */
const LAB_VOUCH_MS = 2500
const TABLE = 'lab:RelayFramesTable00000_'

let relay
beforeAll(async () => {
  relay = await startRelay({ HEARTBEAT_MS: '600000', LAB_VOUCH_MS: String(LAB_VOUCH_MS) })
})
afterAll(async () => {
  await relay?.stop()
})

/** One room's worth of sockets on `on`, named A, B, C…, driven a step at a time. */
function room(on = relay) {
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
        const s = openSocket(on.url)
        await s.opened
        socks.set(name, s)
        s.send({ type: 'hello', ...msg })
      }, want),
    close: (name, want) =>
      step(async () => {
        socks.get(name).close()
        socks.delete(name)
      }, want),
    /** nothing done by anybody: just what arrives in the next `ms` */
    wait: (ms, want) => step(() => sleep(ms), want),
    /** one message from `name`, or several in order down the same socket, as one step */
    send: (name, msg, want) =>
      step(async () => {
        for (const m of [msg].flat()) socks.get(name).send(m)
      }, want),
    closed: (name) => until(() => socks.get(name)?.ws.readyState === WebSocket.CLOSED, 5000),
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

describe('a Lab table, to sockets the door has not let in', () => {
  it('each arrival hears its own id; the room hears nothing; at the timer, the sentence and a close', async () => {
    expect(TABLE).toMatch(/^lab:[A-Za-z0-9_-]{22}$/)
    const r = room()
    try {
      /* create: true, as every other room's client sends it — a Lab room ignores it */
      await r.hello('A', { room: TABLE, create: true }, { A: [{ type: 'welcome', id: '<A>' }] })
      await r.hello('B', { room: TABLE }, { A: [], B: [{ type: 'welcome', id: '<B>' }] })
      /* nothing a Lab room does not take is answered or passed on — not even a chat line */
      await r.send('A', { type: 'chat', text: 'hello?' }, {})
      await r.send('A', { type: 'lab', d: 'anyone?' }, {})
      await r.send('A', { type: 'name', name: 'Ann' }, {})
      await r.wait(0, {
        A: [refused('members-only')],
        B: [refused('members-only')],
      })
      expect(await r.closed('A')).toBe(true)
      expect(await r.closed('B')).toBe(true)
    } finally {
      r.closeAll()
    }
  })

  it('a socket leaving before the timer tells the room nothing', async () => {
    const r = room()
    try {
      await r.hello('A', { room: TABLE }, { A: [{ type: 'welcome', id: '<A>' }] })
      await r.hello('B', { room: TABLE }, { B: [{ type: 'welcome', id: '<B>' }] })
      await r.close('B', { A: [] })
    } finally {
      r.closeAll()
    }
  })

  it('a badly shaped lab: id is refused with bad-room and becomes no room at all', async () => {
    const r = room()
    try {
      for (const bad of ['lab:x', `${TABLE}x`, 'lab:'])
        await r.hello(bad, { room: bad, create: true }, { [bad]: [refused('bad-room')] })
      for (const bad of ['lab:x', `${TABLE}x`, 'lab:']) expect(await r.closed(bad)).toBe(true)
      /* and a Snake hello to it afterwards finds no room there: it was never created */
      await r.hello('S', { room: 'lab:x' }, { S: [refused('bad-room')] })
    } finally {
      r.closeAll()
    }
  })

  it('list shows the Snake lobby and never a Lab table', async () => {
    const r = room()
    try {
      await r.hello('A', { room: TABLE }, { A: [{ type: 'welcome', id: '<A>' }] })
      await r.hello(
        'S',
        { room: 'relay-frames-listed', create: true },
        {
          A: [],
          S: [
            { type: 'welcome', id: '<S>', visitor: 0 },
            host('<S>'),
            host('<S>'),
            presence(1),
            presence(1),
            settings(DEFAULT_SETTINGS),
          ],
        },
      )
      await r.send(
        'S',
        { type: 'list' },
        {
          S: [
            {
              type: 'rooms',
              items: [{ id: 'relay-frames-listed', name: 'relay-frames-listed', count: 1 }],
            },
          ],
        },
      )
    } finally {
      r.closeAll()
    }
  })
})

/**
 * The second relay: one whose Supabase is a stand-in on loopback, so a token can let somebody
 * in. It answers what a park asks and nothing else — the session behind a token, the account's
 * standing, and who owns a hosted park. `tok-<name>` is a session for `user-<name>`, anything
 * else is refused, nobody is suspended, and PARK is Ann's, so her scene is the owner's and Bo's
 * is not.
 *
 * ⚠️ THE OWNER LOOKUP NEEDS THE SERVICE KEY, AND THE SERVICE KEY STARTS THE TRADE SCHEDULER.
 * Its first call is told the function does not exist, which is what switches it off for good —
 * the same thing production's first tick does — so it cannot drop a log line or a request into
 * the middle of a step.
 *
 * ⚠️ THE STRANGER IS ON A CLOCK. A socket that never proves itself is told `members-only` at
 * PARK_VOUCH_MS, and that frame would land in whichever step was running. Main cannot shorten
 * the wait, and a shorter one here would be a different recording from main's, so it is left
 * alone and S's whole visit is a run of steps that takes a fraction of it. A `members-only` in
 * S's inbox means the machine was that slow, not that the door changed.
 */
const PARK = 'park:7e1a5b2c-9d3f-4a60-8b1e-2c4d6f8a0b13'
const BOUT = 'fight:relay-frames-members'
const OWNER = 'user-ann'

const standIn = createServer((req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  const path = (req.url || '').split('?')[0]
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  req.resume()
  req.on('end', () => {
    if (path === '/auth/v1/user') {
      if (!token.startsWith('tok-')) return json(401, { msg: 'stand-in: no such session' })
      return json(200, { id: `user-${token.slice(4)}`, aud: 'authenticated' })
    }
    if (path === '/rest/v1/rpc/is_suspended') return json(200, false)
    if (path === '/rest/v1/park_rooms') {
      const rows = req.url.includes(`id=eq.${PARK.slice('park:'.length)}`) ? [{ owner: OWNER }] : []
      /* maybeSingle on a GET asks for a list and takes its one row; asked for an object, one */
      if (String(req.headers.accept).includes('vnd.pgrst.object')) return json(200, rows[0] ?? null)
      return json(200, rows)
    }
    if (path === '/rest/v1/rpc/run_due_scheduled_trades')
      return json(404, { code: 'PGRST202', message: 'stand-in: could not find the function' })
    json(404, { message: 'not in the stand-in' })
  })
})

const art = (n) => ({ v: 1, n, strokes: [[n, n + 1, n + 2]] })
const letIn = (who = [], boss = null, scene = null) => ({ type: 'park', who, boss, scene })
const look = (from, name, n) => ({ type: 'look', from, name, art: art(n) })
const auth = (name) => ({ type: 'auth', token: `tok-${name}` })
/** every field away from its default, three past their range and one between tenths */
const ANN_WALKS = { type: 'walk', x: 0.25, y: 2, f: -1, m: 1, a: 3, d: 9, j: 4.4, c: 12, k: 1 }
const ANN_AT = { x: 0.25, y: 1, f: -1, m: 1, a: 3, d: 7, j: 4, c: 9, k: 1 }
/** and nothing usable, so every field falls back to what an old client means by leaving it out */
const BO_WALKS = { type: 'walk', x: 'far', y: null, f: 0, m: 0, a: 'x', d: -4 }
const BO_AT = { x: 0, y: 0, f: 1, m: 0, a: 0, d: 0, j: 0, c: 0, k: 0 }
const BOSS_STEPS = { type: 'bstep', x: 0.5, y: -1, f: -1, a: 8, c: 2, h: 0.75, t: true, d: 3 }
const BOSS_AT = { x: 0.5, y: 0, f: -1, a: 8, c: 2, h: 0.75, t: true, d: 3 }
const BIG = { from: '<A>', name: 'Big', art: art(3), ...BOSS_AT }

describe('a park and a bout, to members who have been let in and a stranger who has not', () => {
  let members
  beforeAll(async () => {
    await new Promise((r) => standIn.listen(0, '127.0.0.1', r))
    members = await startRelay({
      HEARTBEAT_MS: '600000',
      SUPABASE_URL: `http://127.0.0.1:${standIn.address().port}`,
      SUPABASE_ANON_KEY: 'anon-key-for-the-stand-in',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-the-stand-in',
    })
  })
  afterAll(async () => {
    await members?.stop()
    standIn.closeAllConnections()
    await new Promise((r) => standIn.close(r))
  })

  it('a park: the roster, every frame it forwards, a late arrival told the boss and the scene', async () => {
    const r = room(members)
    try {
      await r.hello(
        'A',
        { room: PARK, create: true },
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
      /* being handed the roster is being let in, and there is nobody in it yet */
      await r.send('A', auth('ann'), { A: [letIn()] })
      await r.hello(
        'B',
        { room: PARK, create: true },
        {
          A: [presence(2)],
          B: [welcome('<B>', 1), host('<A>'), presence(2), presence(2), settings(DEFAULT_SETTINGS)],
        },
      )
      await r.send('B', auth('bo'), { B: [letIn()] })
      /* S says hello and never proves anything: from here to S leaving, S hears no park frame */
      await r.hello(
        'S',
        { room: PARK, create: true },
        {
          A: [presence(3)],
          B: [presence(3)],
          S: [welcome('<S>', 2), host('<A>'), presence(3), presence(3), settings(DEFAULT_SETTINGS)],
        },
      )
      await r.send('A', { type: 'look', name: 'Ann', art: art(1) }, { B: [look('<A>', 'Ann', 1)] })
      await r.send('B', { type: 'look', name: 'Bo', art: art(2) }, { A: [look('<B>', 'Bo', 2)] })
      await r.send('A', ANN_WALKS, { B: [{ type: 'walk', from: '<A>', ...ANN_AT }] })
      await r.send('B', BO_WALKS, { A: [{ type: 'walk', from: '<B>', ...BO_AT }] })
      await r.send(
        'A',
        { type: 'boss', name: 'Big', art: art(3) },
        { B: [{ type: 'boss', from: '<A>', name: 'Big', art: art(3) }] },
      )
      await r.send('A', BOSS_STEPS, { B: [{ type: 'bstep', from: '<A>', ...BOSS_AT }] })
      /* the loser of the race is told so, and handed the boss that is out, where it is */
      await r.send(
        'B',
        { type: 'boss', name: 'Mine', art: art(4) },
        {
          B: [
            { type: 'error', code: 'boss-taken', message: 'Somebody else has a boss out already' },
            { type: 'boss', ...BIG },
          ],
        },
      )
      /* the owner's scene goes out; a guest's is dropped in silence, and so is an older one */
      await r.send(
        'A',
        { type: 'scene', map: 'meadow', at: 5 },
        { B: [{ type: 'scene', from: '<A>', map: 'meadow', at: 5 }] },
      )
      await r.send('B', { type: 'scene', map: 'cave', at: 9 }, {})
      await r.send('A', { type: 'scene', map: 'cave', at: 4 }, {})
      await r.send(
        'B',
        { type: 'door', to: 'cave' },
        { A: [{ type: 'door', from: '<B>', to: 'cave' }] },
      )
      /* nothing S draws, moves, calls or asks reaches anybody — only its name and its chat line,
         which are broadcast to the whole room (see the header) */
      await r.send(
        'S',
        [
          { type: 'name', name: 'Sly' },
          { type: 'look', name: 'Sly', art: art(9) },
          { type: 'walk', x: 0.5, y: 0.5 },
          { type: 'boss', name: 'Lurk', art: art(9) },
          { type: 'bstep', x: 0.5, y: 0.5, h: 1 },
          { type: 'scene', map: 'lair', at: 99 },
          { type: 'door', to: 'lair' },
          { type: 'chat', text: 'psst' },
        ],
        {
          A: [
            { type: 'name', name: 'Sly', from: '<S>' },
            { type: 'chat', text: 'psst', from: '<S>', name: 'Sly' },
          ],
          B: [
            { type: 'name', name: 'Sly', from: '<S>' },
            { type: 'chat', text: 'psst', from: '<S>', name: 'Sly' },
          ],
        },
      )
      await r.send(
        'A',
        { type: 'chat', text: 'hi' },
        {
          B: [{ type: 'chat', text: 'hi', from: '<A>', name: 'Ann' }],
          S: [{ type: 'chat', text: 'hi', from: '<A>', name: 'Ann' }],
        },
      )
      await r.hello(
        'C',
        { room: PARK, create: true },
        {
          A: [presence(4)],
          B: [presence(4)],
          S: [presence(4)],
          C: [welcome('<C>', 3), host('<A>'), presence(4), presence(4), settings(DEFAULT_SETTINGS)],
        },
      )
      /* whoever arrives late is told who is here as they last were, the boss that is out, and
         the scene — and never the stranger, who has no look the relay would keep */
      await r.send('C', auth('cy'), {
        C: [
          letIn(
            [
              { from: '<A>', name: 'Ann', art: art(1), ...ANN_AT },
              { from: '<B>', name: 'Bo', art: art(2), ...BO_AT },
            ],
            BIG,
            { map: 'meadow', at: 5 },
          ),
        ],
      })
      await r.close('S', {
        A: [over('<S>'), presence(3)],
        B: [over('<S>'), presence(3)],
        C: [over('<S>'), presence(3)],
      })
      /* only whoever called it may put it away */
      await r.send('B', { type: 'boss', art: null }, {})
      await r.send(
        'A',
        { type: 'boss', art: null },
        {
          B: [{ type: 'boss', from: '<A>', art: null }],
          C: [{ type: 'boss', from: '<A>', art: null }],
        },
      )
      await r.send(
        'A',
        { type: 'boss', name: 'Big', art: art(3) },
        {
          B: [{ type: 'boss', from: '<A>', name: 'Big', art: art(3) }],
          C: [{ type: 'boss', from: '<A>', name: 'Big', art: art(3) }],
        },
      )
      await r.close('A', {
        B: [host('<B>'), over('<A>'), presence(2)],
        C: [host('<B>'), over('<A>'), presence(2)],
      })
      /* the boss and the scene went with the one who ran them, so the next arrival hears neither */
      await r.hello(
        'D',
        { room: PARK, create: true },
        {
          B: [presence(3)],
          C: [presence(3)],
          D: [welcome('<D>', 4), host('<B>'), presence(3), presence(3), settings(DEFAULT_SETTINGS)],
        },
      )
      await r.send('D', auth('di'), {
        D: [letIn([{ from: '<B>', name: 'Bo', art: art(2), ...BO_AT }])],
      })
    } finally {
      r.closeAll()
    }
  })

  it('a bout: a stranger beside a fighter hears nothing; two fighters hear each other', async () => {
    const r = room(members)
    try {
      await r.hello(
        'A',
        { room: BOUT, create: true },
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
      await r.send('A', auth('ann'), { A: [letIn()] })
      /* a bout holds two, so the stranger takes the second place and is shown nothing in it */
      await r.hello(
        'S',
        { room: BOUT, create: true },
        {
          A: [presence(2)],
          S: [welcome('<S>', 1), host('<A>'), presence(2), presence(2), settings(DEFAULT_SETTINGS)],
        },
      )
      await r.send(
        'A',
        [
          { type: 'look', name: 'Ann', art: art(5) },
          { type: 'step', n: 10, in: 5 },
        ],
        {},
      )
      await r.send(
        'S',
        [
          { type: 'look', name: 'Sly', art: art(9) },
          { type: 'step', n: 10, in: 5 },
        ],
        {},
      )
      await r.close('S', { A: [over('<S>'), presence(1)] })
      await r.hello(
        'B',
        { room: BOUT, create: true },
        {
          A: [presence(2)],
          B: [welcome('<B>', 2), host('<A>'), presence(2), presence(2), settings(DEFAULT_SETTINGS)],
        },
      )
      /* the look A sent while nobody could hear it was kept, and is the roster */
      await r.send('B', auth('bo'), { B: [letIn([{ from: '<A>', name: 'Ann', art: art(5) }])] })
      await r.send('B', { type: 'look', name: 'Bo', art: art(6) }, { A: [look('<B>', 'Bo', 6)] })
      /* six bits of buttons and a whole frame number; anything else is not a step, and a walk
         is a park's */
      await r.send(
        'A',
        { type: 'step', n: 11, in: 0x1ff },
        { B: [{ type: 'step', from: '<A>', n: 11, in: 63 }] },
      )
      await r.send(
        'B',
        [
          { type: 'step', n: 1.5, in: 1 },
          { type: 'step', n: -1, in: 1 },
          { type: 'walk', x: 0.5, y: 0.5 },
          { type: 'step', n: 12, in: 5 },
        ],
        { A: [{ type: 'step', from: '<B>', n: 12, in: 5 }] },
      )
      await r.close('A', { B: [host('<B>'), over('<A>'), presence(1)] })
    } finally {
      r.closeAll()
    }
  })
})
