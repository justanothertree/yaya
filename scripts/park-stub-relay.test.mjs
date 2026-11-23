import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { SAY } from '../server/lib/labDoor.mjs'
import { STUB, openSocket, startRelay, until } from './relay-harness.mjs'

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

  it('a badly shaped lab: id is bad-room there too', async () => {
    const s = openSocket(stub.url)
    socks.push(s)
    await s.opened
    s.send({ type: 'hello', room: 'lab:short' })
    await until(() => s.inbox.length > 0, 5000)
    expect(s.inbox).toEqual([{ type: 'error', code: 'bad-room', message: SAY['bad-room'] }])
  })
})
