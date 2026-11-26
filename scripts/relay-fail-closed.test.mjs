import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { openSocket, sleep, startRelay, until } from './relay-harness.mjs'

/**
 * Every door on the relay that asks Supabase, asked while Supabase cannot answer.
 *
 * ⚠️ "AN OUTAGE IS NOT A REFUSAL" IS HALF A RULE, AND THE OTHER HALF IS THE ONE THAT MATTERS
 * HERE. The relay stopped CACHING an outage as a refusal (server/lib/supabaseAnswer.mjs), so
 * asking again after a 503 can let somebody in. That must never become letting them in on the
 * 503 itself — an answer nobody gave is not a yes, whichever way the sentence is read. So each
 * door is asked three ways that are not answers: a 5xx, a call that never comes back (the relay
 * gives up at OUTBOUND_TIMEOUT_MS, shortened here), and a relay with no Supabase configured at
 * all. Every one of them must end in the door's refusal, and in nothing else afterwards.
 *
 * The doors:
 * - a park and a bout, which ask the token and then the account's standing. Being let in is the
 *   `park` roster, so a refusal is no roster, `members-only` when the window closes, and nothing
 *   it says reaching anybody who was let in;
 * - /ice, whose TURN relay is for members: a refusal is STUN alone, `relay: false`;
 * - /relay-config, as the admin gate every admin route shares: a refusal is a 403.
 *
 * ⚠️ EACH CASE CHECKS IT ASKED THE QUESTION IT IS ABOUT. A standing case passes the token first,
 * and says so by the stand-in having been asked `is_suspended`; a timeout case says so by the
 * stand-in having seen the relay hang up. Without that, a door refusing for an earlier reason
 * would pass a case written about a later one.
 *
 * ⚠️ AND A DOOR THAT REFUSES EVERYBODY PASSES ALL OF THIS, so the same stand-in also lets a good
 * token, a member in good standing and an admin through. Those are what make the refusals mean
 * something.
 */

const VOUCH_MS = 2000
const TIMEOUT_MS = 400

/** `${path} ${token}` -> times asked */
const asked = new Map()
/** `${path} ${token}` keys whose request the relay closed before the stand-in answered */
const abandoned = new Set()
const count = (path, token) => asked.get(`${path} ${token}`) ?? 0
/**
 * Whether the relay hung up on `key`. Waited for rather than read: the relay answers its own
 * caller in the same turn it aborts, so the stand-in can hear the hang-up a moment after the test
 * hears the answer — reading it at once was a race, caught by a mutation that touched neither.
 */
const hungUp = (key) => until(() => abandoned.has(key), 3000)

/**
 * A Supabase that answers by the token's name: `ok…` is a user, `down…` a 503, `hang…` nothing at
 * all. Standing reads `standing-down` and `standing-hang` the same way, and admin `admin-ok`,
 * `admin-down` and `admin-hang`.
 */
const supabase = createServer((req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  const path = (req.url || '').split('?')[0]
  const key = `${path} ${token}`
  asked.set(key, count(path, token) + 1)
  res.on('close', () => {
    if (!res.writableFinished) abandoned.add(key)
  })
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  req.resume()
  req.on('end', () => {
    if (path === '/auth/v1/user') {
      if (token.startsWith('hang')) return
      if (token.startsWith('down')) return json(503, { msg: 'stand-in outage' })
      if (token.startsWith('ok')) return json(200, { id: `user-${token}`, aud: 'authenticated' })
      return json(401, { msg: 'stand-in refusal' })
    }
    if (path === '/rest/v1/rpc/is_suspended') {
      if (token.includes('standing-hang')) return
      if (token.includes('standing-down')) return json(500, { message: 'stand-in outage' })
      return json(200, false)
    }
    if (path === '/rest/v1/rpc/is_admin') {
      if (token === 'admin-hang') return
      if (token === 'admin-down') return json(502, { message: 'stand-in outage' })
      return json(200, token === 'admin-ok')
    }
    json(404, { message: 'not in the stand-in' })
  })
})

/** the relay with a Supabase that cannot answer, and one with none configured at all */
let relay
let bare
beforeAll(async () => {
  await new Promise((r) => supabase.listen(0, '127.0.0.1', r))
  const shared = {
    HEARTBEAT_MS: '600000',
    PARK_VOUCH_MS: String(VOUCH_MS),
    OUTBOUND_TIMEOUT_MS: String(TIMEOUT_MS),
  }
  ;[relay, bare] = await Promise.all([
    startRelay({
      ...shared,
      SUPABASE_URL: `http://127.0.0.1:${supabase.address().port}`,
      SUPABASE_ANON_KEY: 'anon-key-for-the-stand-in',
    }),
    startRelay(shared),
  ])
})
afterAll(async () => {
  await Promise.all([relay?.stop(), bare?.stop()])
  supabase.closeAllConnections()
  await new Promise((r) => supabase.close(r))
})

/** a socket past its hello in `room`, its own relay id learnt from `welcome` */
async function joined(on, room) {
  const s = openSocket(on.url)
  await s.opened
  s.send({ type: 'hello', room, create: true })
  if (!(await until(() => s.inbox.some((f) => f.type === 'settings'), 5000)))
    throw new Error(`no hello answer in ${room}`)
  s.id = s.inbox.find((f) => f.type === 'welcome')?.id
  return s
}
const letIn = (s) => s.inbox.some((f) => f.type === 'park')
const turnedAway = (s) => s.inbox.some((f) => f.type === 'error' && f.code === 'members-only')

/**
 * Knock on a park or a bout with `token`, then try to be seen. Resolves when the door's window
 * has closed and a moment more has passed, so a late admission would have landed.
 */
async function knock(on, room, token) {
  const s = await joined(on, room)
  s.send({ type: 'auth', token })
  await until(() => turnedAway(s) || letIn(s), VOUCH_MS + 3000)
  s.send({ type: 'look', name: 'stranger', art: { v: 1, strokes: [] } })
  s.send({ type: 'walk', x: 0.5, y: 0.5, f: 1, m: 1 })
  await sleep(300)
  return s
}

/** somebody the stand-in does let in, in the park the refused knock on, hearing everything */
let witness
const PARK = 'park:fail-closed'
beforeAll(async () => {
  witness = await joined(relay, PARK)
  witness.send({ type: 'auth', token: 'ok-witness' })
  if (!(await until(() => letIn(witness), 5000))) throw new Error('the stand-in let nobody in')
})
afterAll(() => witness?.close())

/** nothing the refused socket said reached the one who was let in */
const heardFrom = (s) => witness.inbox.filter((f) => f.from === s.id && f.type !== 'over')

describe.concurrent('a park and a bout refuse when Supabase cannot answer', () => {
  for (const [kind, room] of [
    ['park', () => PARK],
    ['bout', (t) => `fight:${t}`],
  ]) {
    it(`${kind}: the token check answered 503`, async ({ expect }) => {
      const token = `down-${kind}`
      const s = await knock(relay, room(token), token)
      try {
        expect(count('/auth/v1/user', token)).toBeGreaterThanOrEqual(1)
        expect(count('/rest/v1/rpc/is_suspended', token)).toBe(0)
        expect(letIn(s)).toBe(false)
        expect(turnedAway(s)).toBe(true)
        if (kind === 'park') expect(heardFrom(s)).toEqual([])
      } finally {
        s.close()
      }
    })

    it(`${kind}: the token check never came back, and the relay gave up`, async ({ expect }) => {
      const token = `hang-${kind}`
      const s = await knock(relay, room(token), token)
      try {
        expect(await hungUp(`/auth/v1/user ${token}`)).toBe(true)
        expect(count('/rest/v1/rpc/is_suspended', token)).toBe(0)
        expect(letIn(s)).toBe(false)
        expect(turnedAway(s)).toBe(true)
        if (kind === 'park') expect(heardFrom(s)).toEqual([])
      } finally {
        s.close()
      }
    })

    it(`${kind}: a good token, and the standing check answered 500`, async ({ expect }) => {
      const token = `ok-standing-down-${kind}`
      const s = await knock(relay, room(token), token)
      try {
        expect(count('/rest/v1/rpc/is_suspended', token)).toBeGreaterThanOrEqual(1)
        expect(letIn(s)).toBe(false)
        expect(turnedAway(s)).toBe(true)
        if (kind === 'park') expect(heardFrom(s)).toEqual([])
      } finally {
        s.close()
      }
    })

    it(`${kind}: a good token, and the standing check never came back`, async ({ expect }) => {
      const token = `ok-standing-hang-${kind}`
      const s = await knock(relay, room(token), token)
      try {
        expect(await hungUp(`/rest/v1/rpc/is_suspended ${token}`)).toBe(true)
        expect(letIn(s)).toBe(false)
        expect(turnedAway(s)).toBe(true)
        if (kind === 'park') expect(heardFrom(s)).toEqual([])
      } finally {
        s.close()
      }
    })

    it(`${kind}: a relay with no Supabase configured`, async ({ expect }) => {
      const token = `ok-unconfigured-${kind}`
      const s = await knock(bare, room(token), token)
      try {
        expect(count('/auth/v1/user', token)).toBe(0)
        expect(letIn(s)).toBe(false)
        expect(turnedAway(s)).toBe(true)
      } finally {
        s.close()
      }
    })
  }

  it('and the same door lets a good token in good standing through', async ({ expect }) => {
    const token = 'ok-member-bout'
    const s = await joined(relay, `fight:${token}`)
    try {
      s.send({ type: 'auth', token })
      expect(await until(() => letIn(s), 5000)).toBe(true)
      expect(count('/rest/v1/rpc/is_suspended', token)).toBe(1)
      expect(letIn(witness)).toBe(true)
    } finally {
      s.close()
    }
  })
})

/** an HTTP route, asked with `token`, bounded so a relay that never answers fails the case */
async function ask(on, path, token) {
  const r = await fetch(`${on.http}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(5000),
  })
  return { status: r.status, body: await r.json() }
}

describe.concurrent('/ice gives STUN alone when the token cannot be checked', () => {
  it('the token check answered 503', async ({ expect }) => {
    const { status, body } = await ask(relay, '/ice', 'down-ice')
    expect(count('/auth/v1/user', 'down-ice')).toBe(1)
    expect(status).toBe(200)
    expect(body.relay).toBe(false)
  })

  it('the token check never came back, and the relay gave up', async ({ expect }) => {
    const { status, body } = await ask(relay, '/ice', 'hang-ice')
    expect(await hungUp('/auth/v1/user hang-ice')).toBe(true)
    expect(status).toBe(200)
    expect(body.relay).toBe(false)
  })

  it('a relay with no Supabase configured', async ({ expect }) => {
    const { status, body } = await ask(bare, '/ice', 'ok-ice-unconfigured')
    expect(count('/auth/v1/user', 'ok-ice-unconfigured')).toBe(0)
    expect(status).toBe(200)
    expect(body.relay).toBe(false)
  })

  it('and a good token gets the relay', async ({ expect }) => {
    const { body } = await ask(relay, '/ice', 'ok-ice')
    expect(body.relay).toBe(true)
  })
})

describe.concurrent('the admin gate refuses when is_admin cannot answer', () => {
  it('is_admin answered 502', async ({ expect }) => {
    const { status, body } = await ask(relay, '/relay-config', 'admin-down')
    expect(count('/rest/v1/rpc/is_admin', 'admin-down')).toBe(1)
    expect(status).toBe(403)
    expect(body).toEqual({ error: 'admin only' })
  })

  it('is_admin never came back, and the relay gave up', async ({ expect }) => {
    const { status, body } = await ask(relay, '/relay-config', 'admin-hang')
    expect(await hungUp('/rest/v1/rpc/is_admin admin-hang')).toBe(true)
    expect(status).toBe(403)
    expect(body).toEqual({ error: 'admin only' })
  })

  it('a relay with no Supabase configured', async ({ expect }) => {
    const { status } = await ask(bare, '/relay-config', 'admin-ok')
    expect(status).toBe(403)
  })

  it('and an admin is let through', async ({ expect }) => {
    const { status } = await ask(relay, '/relay-config', 'admin-ok')
    expect(status).toBe(200)
  })
})
