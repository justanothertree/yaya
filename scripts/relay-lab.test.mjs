import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { LAB, SAY } from '../server/lib/labDoor.mjs'
import { openSocket, sleep, startRelay, until } from './relay-harness.mjs'

/**
 * The real relay's Lab table door, against a Supabase that answers what this file tells it to.
 *
 * ⚠️ WHAT IS UNDER TEST IS THE WIRING. server/lib/labDoor.test.mjs asks each decision directly;
 * what only a running relay can show is that ws-server.js actually puts them together — the chain
 * per room, the timer that spares a socket being checked, `to` reaching one person, the windows,
 * and the silence. The stand-in answers the relay's four questions (`/auth/v1/user`,
 * `is_suspended`, `are_friends`, `is_admin`) and nothing else; it answers `are_friends` only when
 * the caller is one of the pair, as the real function does. scripts/lab-door-probe.mjs asks the
 * same of a real local Supabase, where GoTrue issues the sessions and PostgREST runs the RPCs.
 *
 * ⚠️ EVERY CASE HAS ITS OWN PEOPLE. The relay remembers a definite answer for a minute — a
 * token, a standing, a friendship — so a case that reused Ann would be asking a cache, not the
 * door. Names carry the case's prefix, and the stand-in reads friendships from `pairs`.
 *
 * Timers are shortened (LAB_VOUCH_MS, LAB_DOOR_MS) so the waits are a second, not twelve; the
 * relay refuses to lengthen them past the door's own.
 */

const VOUCH_MS = 800
const DOOR_MS = 2000
const ADMIN = 'tok-the-admin'

/** 'a|b', sorted: the stand-in's friendships */
const pairs = new Set()
const pair = (a, b) => [a, b].sort().join('|')
const befriend = (...names) => {
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) pairs.add(pair(names[i], names[j]))
}
const suspended = new Set()
/** `user <uid>` or `friends <a|b>` -> ms before answering */
const delay = new Map()
/** `friends <a|b>` -> statuses in turn (the last repeats), or 'null' for a NULL body */
const trouble = new Map()
/** every are_friends question, as `u1 u2` */
const asked = []
/** asker -> friends questions from them still unanswered; and the most askers ever at once */
const inFlight = new Map()
let mostAskersAtOnce = 0

const supabase = createServer((req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  const path = (req.url || '').split('?')[0]
  const caller = token.startsWith('tok-') ? token.slice(4) : null
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const body = raw ? JSON.parse(raw) : {}
    if (path === '/auth/v1/user') {
      if (!caller) return json(401, { msg: 'stand-in: no such session' })
      await sleep(delay.get(`user ${caller}`) ?? 0)
      return json(200, { id: caller, aud: 'authenticated' })
    }
    if (path === '/rest/v1/rpc/is_admin') return json(200, token === ADMIN)
    if (path === '/rest/v1/rpc/is_suspended') return json(200, suspended.has(body.p_user_id))
    if (path === '/rest/v1/rpc/are_friends') {
      asked.push(`${body.u1} ${body.u2}`)
      inFlight.set(body.u1, (inFlight.get(body.u1) ?? 0) + 1)
      mostAskersAtOnce = Math.max(mostAskersAtOnce, [...inFlight.values()].filter((n) => n).length)
      const key = `friends ${pair(body.u1, body.u2)}`
      await sleep(delay.get(key) ?? 0)
      inFlight.set(body.u1, inFlight.get(body.u1) - 1)
      const steps = trouble.get(key)
      if (steps?.length) {
        const s = steps.length > 1 ? steps.shift() : steps[0]
        if (s === 'null') return json(200, null)
        if (s !== 200) return json(s, { message: `stand-in ${s}` })
      }
      /* as the real function: an answer only for a caller who is one of the pair */
      if (caller !== body.u1 && caller !== body.u2) return json(200, null)
      return json(200, pairs.has(pair(body.u1, body.u2)))
    }
    json(404, { message: 'not in the stand-in' })
  })
})

let relay
beforeAll(async () => {
  await new Promise((r) => supabase.listen(0, '127.0.0.1', r))
  relay = await startRelay({
    HEARTBEAT_MS: '600000',
    LAB_VOUCH_MS: String(VOUCH_MS),
    LAB_DOOR_MS: String(DOOR_MS),
    /* every case opens sockets from this one address, far past a person's thirty a minute */
    CONN_BURST: '100000',
    CONN_BURST_GLOBAL: '100000',
    SUPABASE_URL: `http://127.0.0.1:${supabase.address().port}`,
    SUPABASE_ANON_KEY: 'anon-key-for-the-stand-in',
  })
})
afterAll(async () => {
  await relay?.stop()
  supabase.closeAllConnections()
  await new Promise((r) => supabase.close(r))
})

const table = () => `lab:${randomBytes(16).toString('base64url')}`
const open = []
/* ⚠️ EVERY CASE LEAVES AN EMPTY RELAY, pass or fail. The table cap is a count across the whole
   relay, so a case that failed halfway and left a table standing would otherwise turn the cap's
   own case red for a reason that has nothing to do with it. */
afterEach(async () => {
  for (const s of open.splice(0)) s.close()
  for (let end = Date.now() + 3000; Date.now() < end; await sleep(50))
    if ((await config()).lab === 0) break
})

/** A socket in `room`, past its welcome, with its own id learnt; `as` sends that person's token. */
async function arrive(room, as) {
  const s = openSocket(relay.url)
  open.push(s)
  await s.opened
  s.send({ type: 'hello', room })
  expect(await until(() => s.inbox.some((f) => f.type === 'welcome'), 5000)).toBe(true)
  s.id = s.inbox.find((f) => f.type === 'welcome').id
  s.inbox.length = 0
  if (as) s.send({ type: 'auth', token: `tok-${as}` })
  return s
}
const heard = (s, type) => s.inbox.filter((f) => f.type === type)
const has = (s, type, ms = 5000) => until(() => heard(s, type).length > 0, ms)
const closed = (s, ms = 5000) => until(() => s.ws.readyState === WebSocket.CLOSED, ms)
const refused = (code) => ({ type: 'error', code, message: SAY[code] })
/** let in: told who was already here */
async function letIn(room, as) {
  const s = await arrive(room, as)
  expect(await has(s, 'labin'), `${as} let in`).toBe(true)
  return s
}
const config = async () =>
  (await fetch(`${relay.http}/relay-config`, { headers: { authorization: `Bearer ${ADMIN}` } }))
    .json()
    .then((b) => b.rooms)
const shut = async (...socks) => {
  for (const s of socks) s.close()
  await until(() => socks.every((s) => s.ws.readyState === WebSocket.CLOSED), 3000)
}

describe('friends meet at a Lab table', () => {
  it('each is told who is here, and hears the other’s messages with from and uid the relay wrote', async () => {
    befriend('m-ann', 'm-bo')
    const room = table()
    const ann = await letIn(room, 'm-ann')
    expect(heard(ann, 'labin')).toEqual([{ type: 'labin', who: [] }])
    const bo = await letIn(room, 'm-bo')
    expect(heard(bo, 'labin')).toEqual([{ type: 'labin', who: [{ from: ann.id, uid: 'm-ann' }] }])
    expect(await has(ann, 'lab-here')).toBe(true)
    expect(heard(ann, 'lab-here')).toEqual([{ type: 'lab-here', from: bo.id, uid: 'm-bo' }])

    ann.inbox.length = 0
    bo.inbox.length = 0
    /* a forged sender is overwritten; a kind the room does not take goes nowhere */
    ann.send({ type: 'lab', d: '{"v":1,"g":"stack"}', from: 'someone-else', uid: 'm-bo' })
    ann.send({ type: 'chat', text: 'not here' })
    ann.send({ type: 'name', name: 'not here either' })
    expect(await has(bo, 'lab')).toBe(true)
    await sleep(150)
    expect(bo.inbox).toEqual([
      { type: 'lab', from: ann.id, uid: 'm-ann', d: '{"v":1,"g":"stack"}' },
    ])
    expect(ann.inbox).toEqual([])

    /* leaving is told to whoever was let in, and only that it happened */
    bo.close()
    expect(await has(ann, 'lab-gone')).toBe(true)
    expect(heard(ann, 'lab-gone')).toEqual([{ type: 'lab-gone', from: bo.id }])
    await shut(ann)
  })

  it('someone who is not a friend of everyone here is refused not-friends, and nobody hears it', async () => {
    befriend('n-ann', 'n-bo')
    befriend('n-ann', 'n-cy')
    const room = table()
    const ann = await letIn(room, 'n-ann')
    const bo = await letIn(room, 'n-bo')
    await sleep(100)
    ann.inbox.length = 0
    bo.inbox.length = 0
    const cy = await arrive(room, 'n-cy')
    expect(await closed(cy)).toBe(true)
    expect(cy.inbox).toEqual([refused('not-friends')])
    await sleep(150)
    expect(ann.inbox).toEqual([])
    expect(bo.inbox).toEqual([])
    await shut(ann, bo)
  })

  it('two who are not friends with each other, arriving together, are never both let in', async () => {
    befriend('r-ann', 'r-bo')
    befriend('r-ann', 'r-cy')
    /* the answers overlap: without the chain, each would be checked against a room with only Ann */
    delay.set(`friends ${pair('r-bo', 'r-ann')}`, 300)
    delay.set(`friends ${pair('r-cy', 'r-ann')}`, 100)
    mostAskersAtOnce = 0
    const room = table()
    const ann = await letIn(room, 'r-ann')
    const [bo, cy] = await Promise.all([arrive(room, 'r-bo'), arrive(room, 'r-cy')])
    await until(
      () => [bo, cy].every((s) => s.inbox.some((f) => f.type === 'labin' || f.type === 'error')),
      5000,
    )
    const outcomes = [bo, cy].map((s) => (s.inbox[0]?.type === 'labin' ? 'in' : s.inbox[0]?.code))
    expect(outcomes.sort()).toEqual(['in', 'not-friends'])
    /* one at a time: the room's chain never has two arrivals' questions out together */
    expect(mostAskersAtOnce).toBe(1)
    await shut(ann, bo, cy)
  })

  it('a suspended account is told members-only, never that it is suspended', async () => {
    suspended.add('s-dee')
    const dee = await arrive(table(), 's-dee')
    expect(await closed(dee)).toBe(true)
    expect(dee.inbox).toEqual([refused('members-only')])
    expect(JSON.stringify(dee.inbox)).not.toMatch(/suspend/i)
  })

  it('a token Supabase refuses is members-only', async () => {
    const s = await arrive(table())
    s.send({ type: 'auth', token: 'not-a-session' })
    expect(await closed(s)).toBe(true)
    expect(s.inbox).toEqual([refused('members-only')])
  })

  it('a second tab is let in, and Supabase is never asked whether somebody is their own friend', async () => {
    const room = table()
    const one = await letIn(room, 't-ann')
    const two = await letIn(room, 't-ann')
    expect(heard(two, 'labin')).toEqual([{ type: 'labin', who: [{ from: one.id, uid: 't-ann' }] }])
    expect(asked.filter((a) => a === 't-ann t-ann')).toEqual([])
    await shut(one, two)
  })
})

describe('the door when Supabase is slow or has trouble', () => {
  it('a socket that never says who it is goes at the timer; one being checked does not', async () => {
    delay.set('user w-slow', VOUCH_MS + 500)
    const room = table()
    const silent = await arrive(room)
    const slow = await arrive(room, 'w-slow')
    const t0 = Date.now()
    expect(await closed(silent)).toBe(true)
    expect(silent.inbox).toEqual([refused('members-only')])
    /* the timer has fired for both; the one still being checked is open, and then let in */
    expect(slow.ws.readyState).toBe(WebSocket.OPEN)
    expect(await has(slow, 'labin')).toBe(true)
    expect(Date.now() - t0).toBeGreaterThan(200)
    expect(slow.inbox).toEqual([{ type: 'labin', who: [] }])
    await shut(slow)
  })

  it('an outage on the friends question is door-unavailable, never not-friends, and is not remembered', async () => {
    befriend('o-ann', 'o-bo')
    const room = table()
    const ann = await letIn(room, 'o-ann')
    trouble.set(`friends ${pair('o-ann', 'o-bo')}`, [503, 200])
    const first = await arrive(room, 'o-bo')
    expect(await closed(first)).toBe(true)
    expect(first.inbox).toEqual([refused('door-unavailable')])
    /* asked again on a new socket, as the client retries: Supabase is asked again, and says yes */
    const again = await letIn(room, 'o-bo')
    expect(asked.filter((a) => a === 'o-bo o-ann')).toHaveLength(2)
    await shut(ann, again)
  })

  it('a NULL, a 401 and a timeout on the friends question are all door-unavailable', async () => {
    for (const [who, how] of [
      ['u-null', 'null'],
      ['u-401', 401],
    ]) {
      befriend('u-ann', who)
      const room = table()
      const ann = await letIn(room, 'u-ann')
      trouble.set(`friends ${pair('u-ann', who)}`, [how])
      const s = await arrive(room, who)
      expect(await closed(s), who).toBe(true)
      expect(s.inbox, who).toEqual([refused('door-unavailable')])
      await shut(ann)
    }
  })

  it('a check still running at the door’s own deadline ends in door-unavailable', async () => {
    befriend('d-ann', 'd-bo')
    /* past the deadline, short of the relay's eight-second fetch timeout */
    delay.set(`friends ${pair('d-ann', 'd-bo')}`, DOOR_MS + 700)
    const room = table()
    const ann = await letIn(room, 'd-ann')
    const t0 = Date.now()
    const bo = await arrive(room, 'd-bo')
    expect(await closed(bo, DOOR_MS + 3000)).toBe(true)
    const took = Date.now() - t0
    expect(bo.inbox).toEqual([refused('door-unavailable')])
    expect(took).toBeGreaterThanOrEqual(DOOR_MS - 100)
    expect(took).toBeLessThan(DOOR_MS + 700)
    /* and the answer that arrives after the deadline lets nobody in */
    await sleep(900)
    expect(ann.inbox.filter((f) => f.type === 'lab-here')).toEqual([])
    await shut(ann)
  })
})

describe('inside a Lab table', () => {
  it('`to` reaches that person’s sockets, all of them, and nobody else', async () => {
    befriend('x-ann', 'x-bo', 'x-eve')
    const room = table()
    const ann = await letIn(room, 'x-ann')
    const bo1 = await letIn(room, 'x-bo')
    const bo2 = await letIn(room, 'x-bo')
    const eve = await letIn(room, 'x-eve')
    await sleep(150)
    for (const s of [ann, bo1, bo2, eve]) s.inbox.length = 0
    ann.send({ type: 'lab', d: 'for bo', to: 'x-bo' })
    bo1.send({ type: 'lab', d: 'for ann', to: 'x-ann' })
    /* addressed to nobody here: refused whole, never sent to everyone */
    ann.send({ type: 'lab', d: 'for cy', to: 'x-cy' })
    await until(() => heard(bo2, 'lab').length && heard(ann, 'lab').length, 5000)
    await sleep(150)
    const forBo = { type: 'lab', from: ann.id, uid: 'x-ann', d: 'for bo' }
    expect(bo1.inbox).toEqual([forBo])
    expect(bo2.inbox).toEqual([forBo])
    expect(ann.inbox).toEqual([{ type: 'lab', from: bo1.id, uid: 'x-bo', d: 'for ann' }])
    expect(eve.inbox).toEqual([])
    await shut(ann, bo1, bo2, eve)
  })

  it('a socket not let in can send nothing, and a burst past the window is cut at fifty', async () => {
    befriend('b-ann', 'b-bo')
    const room = table()
    const ann = await letIn(room, 'b-ann')
    const bo = await letIn(room, 'b-bo')
    const lurker = await arrive(room)
    await sleep(150)
    bo.inbox.length = 0
    lurker.send({ type: 'lab', d: 'from outside' })
    for (let i = 0; i < 60; i++) ann.send({ type: 'lab', d: `n${i}` })
    await until(() => heard(bo, 'lab').length >= LAB.socketHz, 5000)
    await sleep(300)
    expect(heard(bo, 'lab').map((f) => f.d)).toEqual(
      Array.from({ length: LAB.socketHz }, (_, i) => `n${i}`),
    )
    await shut(ann, bo, lurker)
  })

  it('a table holds eight let in and sixteen sockets; past that, lab-full', async () => {
    const room = table()
    const tabs = []
    for (let i = 0; i < LAB.vouched; i++) tabs.push(await letIn(room, 'f-ann'))
    const ninth = await arrive(room, 'f-ann')
    expect(await closed(ninth)).toBe(true)
    expect(ninth.inbox).toEqual([refused('lab-full')])
    const waiting = []
    for (let i = LAB.vouched; i < LAB.sockets; i++) waiting.push(await arrive(room))
    const over = openSocket(relay.url)
    open.push(over)
    await over.opened
    over.send({ type: 'hello', room })
    expect(await closed(over)).toBe(true)
    expect(over.inbox).toEqual([refused('lab-full')])
    await shut(...tabs, ...waiting)
  })
})

describe('how many tables the relay holds, and what it says about them', () => {
  it('six live tables; a seventh is lab-busy, and rooms nobody was let into do not count', async () => {
    expect(await config()).toMatchObject({ lab: 0, labLive: 0 })

    const strangers = []
    for (let i = 0; i < 10; i++) strangers.push(await arrive(table()))
    const rooms = Array.from({ length: LAB.rooms }, table)
    const live = []
    for (const [i, room] of rooms.entries()) live.push(await letIn(room, `l-${i}`))
    expect(await config()).toMatchObject({ lab: 16, labLive: 6 })
    const seventh = await arrive(table(), 'l-7')
    expect(await closed(seventh)).toBe(true)
    expect(seventh.inbox).toEqual([refused('lab-busy')])
    /* a table already live still takes its own: the cap is on tables, not on people */
    const again = await letIn(rooms[0], 'l-0')
    await shut(...strangers, ...live, again)
  })

  it('nothing it logs names a table or a person', () => {
    const log = relay.log()
    expect(log).toMatch(/listening on/)
    expect(log).not.toMatch(/lab:/)
    for (const who of ['m-ann', 'm-bo', 'n-cy', 'r-bo', 'x-eve', 'f-ann', 'l-7'])
      expect(log).not.toContain(who)
  })
})
