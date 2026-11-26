import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stampOfServer } from '../server/lib/buildStamp.mjs'
import { openSocket, sleep, startRelay, until } from './relay-harness.mjs'

/**
 * The real relay, against a Supabase that answers whatever this file tells it to.
 *
 * ⚠️ WHAT IS UNDER TEST IS THE RELAY'S MEMORY, NOT SUPABASE. server/lib/supabaseAnswer.mjs
 * decides what a status MEANS and has its own test; what only a running relay can show is what
 * it then DOES with that — whether a refused token is kept for the minute and an outage is not.
 * So the stand-in is as small as the relay's questions: GoTrue's `/auth/v1/user` (the user, with
 * an `id`, or an error status) and two PostgREST scalars, `is_suspended` and `is_admin`. It is on
 * loopback and is not a Supabase in any other sense; scripts/lab-door-probe.mjs is where the real
 * stack gets asked.
 *
 * ⚠️ RETRIES ARE PACED BY THE STAND-IN, NOT BY THE CLOCK. The relay allows one `auth` in flight
 * per socket and silently drops another, so a second attempt sent too soon proves nothing either
 * way. Each case waits until the stand-in has answered the first, then asks again a few times —
 * and the relay's own allowance (five a minute) is never reached.
 */

const SERVER = fileURLToPath(new URL('../server', import.meta.url))
const ADMIN = 'admin-token'

/** token -> the statuses `/auth/v1/user` gives it, in turn; the last one repeats */
const plan = new Map()
/** `${path} ${token}` -> how many times it was asked */
const asked = new Map()
const count = (path, token) => asked.get(`${path} ${token}`) ?? 0

const supabase = createServer((req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  const path = (req.url || '').split('?')[0]
  asked.set(`${path} ${token}`, count(path, token) + 1)
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  /* drain any body before answering, as a real server would */
  req.resume()
  req.on('end', () => {
    if (path === '/auth/v1/user') {
      const steps = plan.get(token) ?? [401]
      const status = steps.length > 1 ? steps.shift() : steps[0]
      if (status === 200) return json(200, { id: `user-${token}`, aud: 'authenticated' })
      return json(status, { msg: `stand-in ${status}` })
    }
    if (path === '/rest/v1/rpc/is_suspended') return json(200, false)
    if (path === '/rest/v1/rpc/is_admin') return json(200, token === ADMIN)
    json(404, { message: 'not in the stand-in' })
  })
})

let relay
beforeAll(async () => {
  await new Promise((r) => supabase.listen(0, '127.0.0.1', r))
  relay = await startRelay({
    HEARTBEAT_MS: '600000',
    SUPABASE_URL: `http://127.0.0.1:${supabase.address().port}`,
    SUPABASE_ANON_KEY: 'anon-key-for-the-stand-in',
  })
})
afterAll(async () => {
  await relay?.stop()
  supabase.closeAllConnections()
  await new Promise((r) => supabase.close(r))
})

/** a socket in a park of its own, past its hello */
async function inPark(room) {
  const s = openSocket(relay.url)
  await s.opened
  s.send({ type: 'hello', room, create: true })
  expect(await until(() => s.inbox.some((f) => f.type === 'settings'), 5000)).toBe(true)
  s.inbox.length = 0
  return s
}
const letIn = (s) => s.inbox.some((f) => f.type === 'park')

/** auth, wait for the stand-in to answer it, then ask again up to `more` times or until let in */
async function authTwice(s, token, more = 3) {
  s.send({ type: 'auth', token })
  expect(await until(() => count('/auth/v1/user', token) >= 1, 5000)).toBe(true)
  for (let i = 0; i < more && !letIn(s); i++) {
    await sleep(200)
    s.send({ type: 'auth', token })
    await until(() => letIn(s), 1000)
  }
}

describe("a member's token, while Supabase has trouble", () => {
  it('a 503 is not remembered: asked again, the same token gets in', async () => {
    plan.set('tok-outage', [503, 200])
    const s = await inPark('park:answers-outage')
    try {
      await authTwice(s, 'tok-outage')
      expect(letIn(s)).toBe(true)
      expect(count('/auth/v1/user', 'tok-outage')).toBe(2)
    } finally {
      s.close()
    }
  })

  it('a 401 IS remembered for the minute, as it always was: asked again, Supabase is not', async () => {
    plan.set('tok-expired', [401, 200])
    const s = await inPark('park:answers-expired')
    try {
      await authTwice(s, 'tok-expired')
      expect(letIn(s)).toBe(false)
      expect(count('/auth/v1/user', 'tok-expired')).toBe(1)
    } finally {
      s.close()
    }
  })
})

describe('what the relay says about itself', () => {
  it('/health says ok, and which build: the stamp of the files it is running from', async () => {
    const r = await fetch(`${relay.http}/health`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, build: stampOfServer(SERVER) })
  })

  it('/relay-config counts open rooms by kind — rooms, not sockets — and only for an admin', async () => {
    const socks = []
    const join = async (room) => {
      const s = openSocket(relay.url)
      await s.opened
      s.send({ type: 'hello', room, create: true })
      expect(await until(() => s.inbox.some((f) => f.type === 'settings'), 5000)).toBe(true)
      socks.push(s)
    }
    const config = async (token) => {
      const r = await fetch(`${relay.http}/relay-config`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      })
      return { status: r.status, body: await r.json() }
    }
    try {
      await join('answers-snake')
      await join('park:answers-count')
      await join('park:answers-count')
      await join('fight:answers-count')
      /* the parks the cases above opened close on their own clock, so wait for them to go */
      const want = { snake: 1, park: 1, bout: 1 }
      let last
      for (const end = Date.now() + 5000; Date.now() < end; await sleep(50)) {
        last = await config(ADMIN)
        if (JSON.stringify(last.body.rooms) === JSON.stringify(want)) break
      }
      expect(last.status).toBe(200)
      expect(last.body.rooms).toEqual(want)
      /* counts and nothing else: not one room id */
      expect(JSON.stringify(last.body)).not.toMatch(/answers-/)

      expect((await config(null)).status).toBe(403)
      const stranger = await config('tok-not-admin')
      expect(stranger.status).toBe(403)
      expect(stranger.body).toEqual({ error: 'admin only' })
    } finally {
      for (const s of socks) s.close()
    }
  })
})
