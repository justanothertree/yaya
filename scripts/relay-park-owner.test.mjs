import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openSocket, sleep, startRelay, until } from './relay-harness.mjs'

/**
 * The real relay, asked who owns a park while its Supabase fails, and again once it is back.
 *
 * ⚠️ WHAT THIS IS FOR: the relay used to remember a FAILED owner lookup as "nobody owns this
 * room", for ever. supabase-js hands a failure back as `{ data: null, error }` rather than
 * throwing it, so one blip while a host moved between maps refused every scene that host sent
 * until the relay restarted, and a refused scene is silent by design, so nobody would know.
 * server/lib/parkHost.mjs holds the rule now; this checks that ws-server.js is wired to it and
 * that a host's scene really does reach a guest again.
 *
 * The stand-in answers a park's questions (a session behind `tok-<name>`, nobody suspended)
 * and does whatever `next` says for park_rooms: fail with a 500, never answer, or say the room
 * is Ann's. Both timers are shortened by the environment, which may shorten them and never
 * lengthen them.
 */
const OUTBOUND_TIMEOUT_MS = 300
const RETRY_MS = 700
const OWNER = 'user-ann'

let next = []
let asked = 0
const hung = []
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
      asked++
      const what = next.shift() ?? 'owner'
      if (what === 'hang') {
        const one = { closed: false }
        res.on('close', () => (one.closed = true))
        hung.push(one)
        return
      }
      if (what === 'fail') return json(500, { message: 'stand-in: something went wrong' })
      if (String(req.headers.accept).includes('vnd.pgrst.object'))
        return json(200, { owner: OWNER })
      return json(200, [{ owner: OWNER }])
    }
    /* the service key starts the trade scheduler; this is what switches it off for good */
    if (path === '/rest/v1/rpc/run_due_scheduled_trades')
      return json(404, { code: 'PGRST202', message: 'stand-in: could not find the function' })
    json(404, { message: 'not in the stand-in' })
  })
})

let relay
beforeAll(async () => {
  await new Promise((r) => standIn.listen(0, '127.0.0.1', r))
  relay = await startRelay({
    HEARTBEAT_MS: '600000',
    OUTBOUND_TIMEOUT_MS: String(OUTBOUND_TIMEOUT_MS),
    PARK_OWNER_RETRY_MS: String(RETRY_MS),
    SUPABASE_URL: `http://127.0.0.1:${standIn.address().port}`,
    SUPABASE_ANON_KEY: 'anon-key-for-the-stand-in',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-the-stand-in',
  })
})
afterAll(async () => {
  await relay?.stop()
  standIn.closeAllConnections()
  await new Promise((r) => standIn.close(r))
})

/** Ann (the owner) and Bo, both in `park`, both let in */
async function annAndBo(park) {
  const people = {}
  for (const name of ['ann', 'bo']) {
    const s = openSocket(relay.url)
    await s.opened
    s.send({ type: 'hello', room: park, create: true })
    s.send({ type: 'auth', token: `tok-${name}` })
    expect(await until(() => s.inbox.some((f) => f.type === 'park'), 5000), `${name} let in`).toBe(
      true,
    )
    people[name] = s
  }
  return people
}
const scenesFor = (s) => s.inbox.filter((f) => f.type === 'scene').map((f) => f.at)

describe("a park's owner, asked while Supabase fails and again once it is back", () => {
  it('a failed lookup refuses the scene, and the next one after the window lets it through', async () => {
    const { ann, bo } = await annAndBo('park:7e1a5b2c-9d3f-4a60-8b1e-2c4d6f8a0b13')
    try {
      asked = 0
      next = ['fail']
      ann.send({ type: 'scene', map: 'meadow', at: 5 })
      await until(() => asked === 1, 3000)
      await sleep(200)
      expect(scenesFor(bo)).toEqual([])
      /* Supabase is back, but inside the window the failure stands and it is not asked */
      ann.send({ type: 'scene', map: 'meadow', at: 6 })
      await sleep(200)
      expect(scenesFor(bo)).toEqual([])
      expect(asked).toBe(1)
      /* past the window, the room is asked about again, and the owner's scene goes out */
      await sleep(RETRY_MS)
      ann.send({ type: 'scene', map: 'cave', at: 7 })
      expect(await until(() => scenesFor(bo).length > 0, 3000)).toBe(true)
      expect(scenesFor(bo)).toEqual([7])
      expect(asked).toBe(2)
      /* and the answer is kept: another scene, no other question */
      ann.send({ type: 'scene', map: 'meadow', at: 8 })
      expect(await until(() => scenesFor(bo).length > 1, 3000)).toBe(true)
      expect(asked).toBe(2)
    } finally {
      ann.close()
      bo.close()
    }
  })

  it('a lookup nobody answers is given up on at the timeout, and asked again after the window', async () => {
    const { ann, bo } = await annAndBo('park:0b2d4f6a-8c1e-4a3b-9d5f-7e9a1c3b5d70')
    try {
      asked = 0
      next = ['hang']
      const t0 = Date.now()
      ann.send({ type: 'scene', map: 'meadow', at: 5 })
      /* the relay hangs up on the question it gave up on */
      expect(await until(() => hung[0]?.closed, OUTBOUND_TIMEOUT_MS + 3000)).toBe(true)
      expect(Date.now() - t0).toBeGreaterThanOrEqual(OUTBOUND_TIMEOUT_MS - 50)
      expect(scenesFor(bo)).toEqual([])
      await sleep(RETRY_MS)
      ann.send({ type: 'scene', map: 'cave', at: 6 })
      expect(await until(() => scenesFor(bo).length > 0, 3000)).toBe(true)
      expect(scenesFor(bo)).toEqual([6])
      expect(asked).toBe(2)
    } finally {
      ann.close()
      bo.close()
    }
  })
})
