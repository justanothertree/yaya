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
/** floods still running, and whether the relay's windows need a second to empty — see flood() */
const floods = []
let flooded = false
/* ⚠️ EVERY CASE LEAVES AN EMPTY RELAY, pass or fail. The table cap is a count across the whole
   relay, so a case that failed halfway and left a table standing would otherwise turn the cap's
   own case red for a reason that has nothing to do with it. The windows are relay-wide too: a
   flood that failed before it stopped would starve the next case of its moves. */
afterEach(async () => {
  for (const stop of floods.splice(0)) stop()
  if (flooded) await sleep(1100)
  flooded = false
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

  it('a table lets eight in; a ninth, friend of all of them, is lab-full', async () => {
    /* eight people, not one person's eight tabs: an account holds four sockets at most */
    const people = Array.from({ length: LAB.vouched + 1 }, (_, i) => `f-${i}`)
    befriend(...people)
    const room = table()
    const inside = []
    for (const who of people.slice(0, LAB.vouched)) inside.push(await letIn(room, who))
    const ninth = await arrive(room, people[LAB.vouched])
    expect(await closed(ninth)).toBe(true)
    expect(ninth.inbox).toEqual([refused('lab-full')])
    await shut(...inside)
  })
})

/**
 * Every lab frame these sockets are allowed, and more, until the returned function is called:
 * sixty a socket every tenth of a second, far past any window, so whatever a window lets through
 * is taken. The relay's windows are relay-wide, so after a case that floods, afterEach stops it
 * if the case did not and waits for them to empty.
 */
function flood(socks) {
  let on = true
  flooded = true
  void (async () => {
    while (on) {
      for (const s of socks)
        for (let i = 0; i < 60; i++)
          if (s.ws.readyState === WebSocket.OPEN) s.send({ type: 'lab', d: 'x' })
      await sleep(100)
    }
  })()
  const stop = () => (on = false)
  floods.push(stop)
  return stop
}
/** twenty moves from one socket, spread over most of a second, while something else may flood */
async function moves(from) {
  const sent = Array.from({ length: 20 }, (_, k) => `move ${k}`)
  for (const d of sent) {
    from.send({ type: 'lab', d })
    await sleep(40)
  }
  return sent
}

describe('a socket that never says who it is, and the friends it must not keep out', () => {
  it('goes on its first hello’s clock: a hello anywhere else is refused, and the room hears nothing', async () => {
    const room = table()
    const ann = await letIn(room, 'h-ann')
    await sleep(50)
    ann.inbox.length = 0
    for (const away of [
      () => ({ type: 'hello', room: table() }),
      () => ({ type: 'hello', room: `h-snake-${randomBytes(4).toString('hex')}`, create: true }),
    ]) {
      const s = await arrive(room)
      const t0 = Date.now()
      /* away and straight back, three times a timer — which used to start the timer again */
      const hop = setInterval(() => {
        if (s.ws.readyState !== WebSocket.OPEN) return
        s.send(away())
        s.send({ type: 'hello', room })
      }, VOUCH_MS / 3)
      const gone = await closed(s, 3 * VOUCH_MS)
      clearInterval(hop)
      expect(gone).toBe(true)
      expect(Date.now() - t0).toBeLessThan(VOUCH_MS + 300)
      expect(s.inbox).toEqual([refused('one-table')])
    }
    await sleep(150)
    expect(ann.inbox).toEqual([])
    await shut(ann)
  })

  it('a table full of sockets that have said nothing still lets a friend in: one makes way', async () => {
    befriend('e-ann', 'e-bo')
    const room = table()
    const ann = await letIn(room, 'e-ann')
    ann.inbox.length = 0
    /* together, so all fifteen are well inside the timer when Bo knocks */
    const silent = await Promise.all(Array.from({ length: LAB.sockets - 1 }, () => arrive(room)))
    const bo = await letIn(room, 'e-bo')
    expect(await until(() => silent.some((s) => s.ws.readyState === WebSocket.CLOSED), 3000)).toBe(
      true,
    )
    const out = silent.filter((s) => s.ws.readyState !== WebSocket.OPEN)
    expect(out).toHaveLength(1)
    expect(out[0].inbox).toEqual([refused('lab-full')])
    /* and Ann heard Bo arrive, and nothing about anybody who made way */
    expect(await has(ann, 'lab-here')).toBe(true)
    await sleep(100)
    expect(heard(ann, 'lab-here')).toEqual([{ type: 'lab-here', from: bo.id, uid: 'e-bo' }])
    expect(ann.inbox.filter((f) => f.type !== 'lab-here')).toEqual([])
    await shut(ann, bo, ...silent)
  })

  it('a socket whose check is running never makes way: a table of them is lab-full', async () => {
    const who = Array.from({ length: LAB.sockets }, (_, i) => `c-${i}`)
    for (const u of who) delay.set(`user ${u}`, 1500)
    const room = table()
    const checking = await Promise.all(who.map((u) => arrive(room, u)))
    await sleep(100)
    const late = openSocket(relay.url)
    open.push(late)
    await late.opened
    late.send({ type: 'hello', room })
    expect(await closed(late)).toBe(true)
    expect(late.inbox).toEqual([refused('lab-full')])
    expect(checking.every((s) => s.ws.readyState === WebSocket.OPEN)).toBe(true)
    await shut(...checking)
  })
})

describe('one account, and what it may take from everybody else', () => {
  it('a member alone at a table holds no live table: six of them, and two friends still get one', async () => {
    const lone = []
    for (let i = 0; i < LAB.rooms; i++) lone.push(await letIn(table(), `k-${i}`))
    expect(await config()).toMatchObject({ lab: LAB.rooms, labLive: 0 })
    befriend('k-ann', 'k-bo')
    const room = table()
    const ann = await letIn(room, 'k-ann')
    const bo = await letIn(room, 'k-bo')
    expect(await config()).toMatchObject({ lab: LAB.rooms + 1, labLive: 1 })
    await shut(...lone, ann, bo)
  })

  it('one account is let into two tables and four sockets at most; past that, too-many-places', async () => {
    const [t1, t2, t3] = [table(), table(), table()]
    const a = await letIn(t1, 'p-mal')
    const b = await letIn(t2, 'p-mal')
    const third = await arrive(t3, 'p-mal')
    expect(await closed(third)).toBe(true)
    expect(third.inbox).toEqual([refused('too-many-places')])
    /* another tab at a table she is already at is no new table, up to four sockets in all */
    const c = await letIn(t1, 'p-mal')
    const d = await letIn(t2, 'p-mal')
    const fifth = await arrive(t1, 'p-mal')
    expect(await closed(fifth)).toBe(true)
    expect(fifth.inbox).toEqual([refused('too-many-places')])
    /* and a place given back can be used again */
    await shut(d)
    const again = await letIn(t1, 'p-mal')
    await shut(a, b, c, again)
  })

  it('a frame that reaches nobody costs nothing: three members flooding empty tables cost a real one no move', async () => {
    befriend('z-ann', 'z-bo')
    const room = table()
    const ann = await letIn(room, 'z-ann')
    const bo = await letIn(room, 'z-bo')
    const lone = []
    for (let i = 0; i < 3; i++) lone.push(await letIn(table(), `z-lone-${i}`))
    const stop = flood(lone)
    await sleep(300)
    bo.inbox.length = 0
    const sent = await moves(ann)
    await sleep(200)
    stop()
    expect(heard(bo, 'lab').map((f) => f.d)).toEqual(sent)
    await shut(ann, bo, ...lone)
  })

  it('one account cannot take the relay’s window, however many sockets and tables it floods from', async () => {
    befriend('y-ann', 'y-bo')
    const room = table()
    const ann = await letIn(room, 'y-ann')
    const bo = await letIn(room, 'y-bo')
    /* two tabs at each of two tables, so every frame she sends has somebody to reach: her own */
    const [t1, t2] = [table(), table()]
    const mal = []
    for (const t of [t1, t1, t2, t2]) mal.push(await letIn(t, 'y-mal'))
    const stop = flood(mal)
    await sleep(300)
    bo.inbox.length = 0
    const sent = await moves(ann)
    await sleep(200)
    stop()
    expect(heard(bo, 'lab').map((f) => f.d)).toEqual(sent)
    await shut(ann, bo, ...mal)
  })
})

describe('a door check that outlives its socket’s place in the room', () => {
  it('lets nobody in, tells the room nothing, and leaves no socket unbounded', async () => {
    befriend('g-ann', 'g-bo')
    delay.set(`friends ${pair('g-ann', 'g-bo')}`, 600)
    const room = table()
    const bo = await letIn(room, 'g-bo')
    await sleep(50)
    bo.inbox.length = 0
    const ann = await arrive(room, 'g-ann')
    /* while her friends question is on its way: away, and straight back */
    expect(await until(() => asked.includes('g-ann g-bo'), 3000)).toBe(true)
    ann.send({ type: 'hello', room: table() })
    ann.send({ type: 'hello', room })
    expect(await closed(ann, VOUCH_MS + 1000)).toBe(true)
    /* past the moment the answer arrives */
    await sleep(800)
    expect(heard(ann, 'labin')).toEqual([])
    expect(bo.inbox).toEqual([])
    await shut(bo)
  })
})

describe('how many tables the relay holds, and what it says about them', () => {
  it('six live tables; a seventh is lab-busy, and rooms nobody was let into do not count', async () => {
    expect(await config()).toMatchObject({ lab: 0, labLive: 0 })

    /* a member alone at a table before the cap fills, waiting for a friend */
    befriend('l-lone', 'l-lone-friend')
    const lone = table()
    const waiting = await letIn(lone, 'l-lone')
    const rooms = Array.from({ length: LAB.rooms }, table)
    const live = []
    for (const [i, room] of rooms.entries()) {
      befriend(`l-${i}-a`, `l-${i}-b`, `l-${i}-c`)
      live.push(await letIn(room, `l-${i}-a`), await letIn(room, `l-${i}-b`))
    }
    const strangers = await Promise.all(Array.from({ length: 10 }, () => arrive(table())))
    expect(await config()).toMatchObject({ lab: 1 + LAB.rooms + 10, labLive: LAB.rooms })
    /* a seventh table is refused as it opens, and a lone one as it would become the seventh */
    const seventh = await arrive(table(), 'l-7')
    expect(await closed(seventh)).toBe(true)
    expect(seventh.inbox).toEqual([refused('lab-busy')])
    const friend = await arrive(lone, 'l-lone-friend')
    expect(await closed(friend)).toBe(true)
    expect(friend.inbox).toEqual([refused('lab-busy')])
    /* a table already live still takes its own: the cap is on tables, not on people */
    const third = await letIn(rooms[0], 'l-0-c')
    await shut(...strangers, waiting, ...live, third)
  })

  it('nothing it logs names a table or a person', () => {
    const log = relay.log()
    expect(log).toMatch(/listening on/)
    expect(log).not.toMatch(/lab:/)
    for (const who of ['m-ann', 'm-bo', 'n-cy', 'r-bo', 'x-eve', 'f-8', 'l-7', 'p-mal', 'g-ann'])
      expect(log).not.toContain(who)
  })
})
