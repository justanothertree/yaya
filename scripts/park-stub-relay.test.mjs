import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { LAB, SAY } from '../server/lib/labDoor.mjs'
import { STUB, openSocket, sleep, startRelay, until } from './relay-harness.mjs'

/**
 * The stub relay's Lab tables: the real door's decisions, with only Supabase's answers stubbed.
 *
 * ⚠️ AN UNFAITHFUL DOUBLE HIDES BUGS AS WELL AS INVENTING THEM (CLAUDE.md §2), and the way a door
 * double goes unfaithful is by keeping its own copy of a rule. So the first case reads the stub's
 * source: it must import server/lib/labDoor.mjs and must not hold the rules that file owns. The
 * rest drive it as a dev call's tabs would — `stub-who` in place of a session.
 */

let stub
beforeAll(async () => {
  stub = await startRelay({ PARK_STUB_RELAY: 'yes' }, { script: STUB })
})
afterAll(async () => {
  await stub?.stop()
})

const table = () => `lab:${randomBytes(16).toString('base64url')}`
const socks = []
afterAll(() => {
  for (const s of socks) s.close()
})
async function tab(room, uid, friends) {
  const s = openSocket(stub.url)
  socks.push(s)
  await s.opened
  s.send({ type: 'hello', room })
  await until(() => s.inbox.some((f) => f.type === 'welcome'), 5000)
  s.id = s.inbox.find((f) => f.type === 'welcome')?.id
  s.send({ type: 'stub-who', uid, friends })
  await until(() => s.inbox.some((f) => f.type === 'labin' || f.type === 'error'), 5000)
  return s
}

describe('the stub relay', () => {
  it('imports the real door and keeps no copy of its rules', () => {
    const src = readFileSync(STUB, 'utf8')
    expect(src).toMatch(/from '\.\.\/server\/lib\/labDoor\.mjs'/)
    /* the id's shape, the byte ceiling, the sentences and the windows all live in labDoor.mjs */
    expect(src).not.toMatch(/\{22\}/)
    expect(src).not.toMatch(/4096|byteLength/)
    for (const sentence of Object.values(SAY)) expect(src).not.toContain(sentence)
    expect(src).not.toMatch(/\b(50|100|150)\b/)
  })

  it('will not start unless asked twice', () => {
    const r = spawnSync(process.execPath, [STUB], {
      env: { PATH: process.env.PATH ?? '', PORT: '0' },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/refusing to start/)
  })

  it('STUB_WAKE holds every socket opened early until the relay is "awake", then opens it', async () => {
    const WAKE_MS = 1200
    const t0 = Date.now()
    const waking = await startRelay(
      { PARK_STUB_RELAY: 'yes', STUB_WAKE: String(WAKE_MS) },
      { script: STUB },
    )
    try {
      const s = openSocket(waking.url)
      await s.opened
      const took = Date.now() - t0
      s.close()
      expect(took).toBeGreaterThanOrEqual(WAKE_MS - 50)
      /* and once awake, at once */
      const t1 = Date.now()
      const again = openSocket(waking.url)
      await again.opened
      again.close()
      expect(Date.now() - t1).toBeLessThan(WAKE_MS / 2)
    } finally {
      await waking.stop()
    }
  })

  it('two tabs whose stub-who lists each other meet, and their game messages pass', async () => {
    const room = table()
    const ann = await tab(room, 'ann', ['bo'])
    const bo = await tab(room, 'bo', ['ann'])
    expect(ann.inbox.find((f) => f.type === 'labin')).toEqual({ type: 'labin', who: [] })
    expect(bo.inbox.find((f) => f.type === 'labin')).toEqual({
      type: 'labin',
      who: [{ from: ann.id, uid: 'ann' }],
    })
    ann.inbox.length = 0
    bo.send({ type: 'lab', d: 'hi', from: 'forged' })
    await until(() => ann.inbox.some((f) => f.type === 'lab'), 5000)
    expect(ann.inbox.filter((f) => f.type === 'lab')).toEqual([
      { type: 'lab', from: bo.id, uid: 'bo', d: 'hi' },
    ])
  })

  it('one side listing the other is not a friendship: not-friends, with the relay’s sentence', async () => {
    const room = table()
    await tab(room, 'ann', ['bo', 'cy'])
    const cy = await tab(room, 'cy', ['ann', 'bo'])
    const bo = await tab(room, 'bo', ['ann'])
    expect(cy.inbox.some((f) => f.type === 'labin')).toBe(true)
    expect(bo.inbox.filter((f) => f.type === 'error')).toEqual([
      { type: 'error', code: 'not-friends', message: SAY['not-friends'] },
    ])
    expect(await until(() => bo.ws.readyState === WebSocket.CLOSED, 5000)).toBe(true)
  })

  it('a socket knocks on one table for life there too, and one person holds two tables at most', async () => {
    const hop = await tab(table(), 'hop', [])
    hop.inbox.length = 0
    hop.send({ type: 'hello', room: table() })
    await until(() => hop.inbox.length > 0, 5000)
    expect(hop.inbox).toEqual([{ type: 'error', code: 'one-table', message: SAY['one-table'] }])
    await tab(table(), 'mal', [])
    await tab(table(), 'mal', [])
    const third = await tab(table(), 'mal', [])
    expect(third.inbox.filter((f) => f.type === 'error')).toEqual([
      { type: 'error', code: 'too-many-places', message: SAY['too-many-places'] },
    ])
  })

  it('a table full of silent sockets still lets a friend in there too, and none makes way', async () => {
    const room = table()
    const ann = await tab(room, 'quiet-ann', ['quiet-bo'])
    const silent = []
    for (let i = 0; i < 20; i++) {
      const s = openSocket(stub.url)
      socks.push(s)
      await s.opened
      s.send({ type: 'hello', room })
      silent.push(s)
    }
    await until(() => silent.every((s) => s.inbox.length > 0), 5000)
    const bo = await tab(room, 'quiet-bo', ['quiet-ann'])
    expect(bo.inbox.some((f) => f.type === 'labin')).toBe(true)
    await sleep(100)
    expect(silent.map((s) => s.inbox.map((f) => f.type))).toEqual(silent.map(() => ['welcome']))
    expect(ann.inbox.filter((f) => f.type === 'error')).toEqual([])
  })

  it('a frame that reaches only the sender’s own tabs goes nowhere; one that reaches a friend reaches them too', async () => {
    const room = table()
    const one = await tab(room, 'own-ann', ['own-bo'])
    const two = await tab(room, 'own-ann', ['own-bo'])
    two.inbox.length = 0
    one.send({ type: 'lab', d: 'to myself' })
    await sleep(150)
    expect(two.inbox).toEqual([])
    const bo = await tab(room, 'own-bo', ['own-ann'])
    await until(() => two.inbox.some((f) => f.type === 'lab-here'), 5000)
    two.inbox.length = 0
    one.send({ type: 'lab', d: 'to the table' })
    await until(() => bo.inbox.some((f) => f.type === 'lab'), 5000)
    await until(() => two.inbox.some((f) => f.type === 'lab'), 5000)
    expect(two.inbox).toEqual([{ type: 'lab', from: one.id, uid: 'own-ann', d: 'to the table' }])
  })

  it('an account’s window outlives its sockets there too: a reconnect inside the second buys no second fifty', async () => {
    const room = table()
    const peer = await tab(room, 'win-peer', ['win-mal'])
    const first = await tab(room, 'win-mal', ['win-peer'])
    await sleep(100)
    peer.inbox.length = 0
    const t0 = Date.now()
    for (let i = 0; i < LAB.personHz; i++) first.send({ type: 'lab', d: `a${i}` })
    await until(() => peer.inbox.filter((f) => f.type === 'lab').length >= LAB.personHz, 3000)
    first.close()
    await until(() => peer.inbox.some((f) => f.type === 'lab-gone'), 3000)
    const again = await tab(room, 'win-mal', ['win-peer'])
    for (let i = 0; i < LAB.personHz; i++) again.send({ type: 'lab', d: `b${i}` })
    expect(Date.now() - t0).toBeLessThan(700)
    await sleep(250)
    expect(peer.inbox.filter((f) => f.type === 'lab').map((f) => f.d)).toEqual(
      Array.from({ length: LAB.personHz }, (_, i) => `a${i}`),
    )
  })

  it('a socket that has been in a park knocks on no Lab table, and the park is told it left', async () => {
    const park = `park:stub-hop-${randomBytes(4).toString('hex')}`
    const walkIn = async (name) => {
      const s = openSocket(stub.url)
      socks.push(s)
      await s.opened
      s.send({ type: 'hello', room: park })
      await until(() => s.inbox.some((f) => f.type === 'park'), 5000)
      s.id = s.inbox.find((f) => f.type === 'welcome')?.id
      s.send({ type: 'look', name, art: { v: 1 } })
      return s
    }
    const ann = await walkIn('Ann')
    const bo = await walkIn('Bo')
    await sleep(100)
    ann.inbox.length = 0
    bo.inbox.length = 0
    ann.send({ type: 'hello', room: table() })
    await until(() => ann.ws.readyState === WebSocket.CLOSED, 2000)
    /* the park's frames reach nobody who left it */
    bo.send({ type: 'walk', x: 1, y: 2 })
    await until(() => bo.inbox.some((f) => f.type === 'over'), 2000)
    await sleep(100)
    expect(ann.inbox).toEqual([{ type: 'error', code: 'one-table', message: SAY['one-table'] }])
    /* and the park hears what any close tells it, as at the relay */
    expect(bo.inbox).toEqual([
      { type: 'over', from: ann.id },
      { type: 'presence', count: 1 },
    ])
    const cy = await walkIn('Cy')
    expect(cy.inbox.find((f) => f.type === 'park')?.who.map((w) => w.name)).toEqual(['Bo'])
  })

  it('a badly shaped lab: id is bad-room there too', async () => {
    const s = openSocket(stub.url)
    socks.push(s)
    await s.opened
    s.send({ type: 'hello', room: 'lab:short' })
    await until(() => s.inbox.length > 0, 5000)
    expect(s.inbox).toEqual([{ type: 'error', code: 'bad-room', message: SAY['bad-room'] }])
  })
})
