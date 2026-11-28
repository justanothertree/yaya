import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { openSocket, sleep, startRelay, until } from './relay-harness.mjs'

/**
 * The real relay's `auth` frame, asked while Supabase has a moment of trouble and then recovers.
 *
 * ⚠️ WHAT THIS IS FOR: the client sends `auth` once per socket (src/game/net.ts) and nothing ever
 * sends it again, so the relay's first answer was its only one. A single 503 or timeout during it
 * read as "not signed in" for the whole life of the socket: a Snake round under a claimed handle
 * went uncredited, and a member in a park or a bout was never let in and was told at the window
 * that the room is for people with an account. scripts/relay-fail-closed.test.mjs is the other
 * half and still holds: an outage that LASTS is still a refusal. This file asks what happens when
 * it does not last.
 *
 * ⚠️ AND A 2xx IS NOT AN ANSWER UNLESS IT SAYS SOMETHING. `is_suspended` answers NULL for "not
 * your business", and the relay read that as good standing — the one door here that failed open.
 * A NULL is a doubt like a 503: asked again, never a yes.
 *
 * ⚠️ EACH ADMISSION HAS A REFUSAL BESIDE IT, so a relay that let everybody in, or asked forever,
 * cannot pass: a refused token and a suspended account cost one round trip and are never let in,
 * a socket that leaves stops being asked about, and nothing is asked once the window has closed.
 * The last two were each made to fail once, by dropping the open-socket check and the window.
 *
 * ⚠️ BUT "ASKED ONCE" CANNOT SEE WHETHER A NO WAS RETRIED. A definite no is cached — the token's
 * for a minute, a suspension too — so a relay that wrongly asked again would hit its own cache
 * and the stand-in would still count one; measured, by making 'no' a retry in signIn.mjs, which
 * left this file green and turned server/lib/signIn.test.mjs red. That a no is final is held
 * there; what is held here is that it costs Supabase nothing more and lets nobody in.
 *
 * The stand-in answers each question about a token from that token's plan, in order, and repeats
 * the last answer once the plan runs out: 'ok' is a user, a number is that status, 'hang' never
 * answers, and a standing's `false` / `true` / `null` is a 200 with that body.
 */

const VOUCH_MS = 4000
const TIMEOUT_MS = 400

const PLANS = {
  'blip-park': { user: [503, 'ok'] },
  'blip-bout': { user: [503, 'ok'] },
  'hang-once-park': { user: ['hang', 'ok'] },
  'standing-blip-park': { standing: [500, false] },
  'standing-null-park': { standing: [null] },
  'standing-null-once-park': { standing: [null, false] },
  'refused-park': { user: [401] },
  'suspended-park': { standing: [true] },
  'down-park': { user: [503] },
  'down-leaves-park': { user: [503] },
  'blip-snake': { user: [503, 'ok'] },
  'refused-snake': { user: [401] },
}
const planOf = (token) => PLANS[token] ?? {}

/** `${path} ${token}` -> times asked */
const asked = new Map()
const count = (path, token) => asked.get(`${path} ${token}`) ?? 0
const USER = '/auth/v1/user'
const STANDING = '/rest/v1/rpc/is_suspended'
/** the `p_players` of every finalize_round_rpc the relay sent, by room */
const finalized = new Map()

const supabase = createServer((req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  const path = (req.url || '').split('?')[0]
  const key = `${path} ${token}`
  const n = count(path, token)
  asked.set(key, n + 1)
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const nth = (list, fallback) => (list?.length ? list[Math.min(n, list.length - 1)] : fallback)
  let raw = ''
  req.on('data', (d) => (raw += d))
  req.on('end', () => {
    if (path === USER) {
      const say = nth(planOf(token).user, 'ok')
      if (say === 'hang') return
      if (say === 'ok') return json(200, { id: `user-${token}`, aud: 'authenticated' })
      return json(say, { msg: 'stand-in says no' })
    }
    if (path === STANDING) {
      const say = nth(planOf(token).standing, false)
      if (say === 'hang') return
      if (typeof say === 'number') return json(say, { message: 'stand-in outage' })
      return json(200, say)
    }
    if (path === '/rest/v1/rpc/finalize_round_rpc') {
      const body = JSON.parse(raw || '{}')
      finalized.set(body.p_room_id, body.p_players)
      return json(
        200,
        (body.p_items ?? []).map((row, i) => ({ ...row, place: i + 1, credited: true })),
      )
    }
    json(404, { message: 'not in the stand-in' })
  })
})

let relay
beforeAll(async () => {
  await new Promise((r) => supabase.listen(0, '127.0.0.1', r))
  relay = await startRelay({
    HEARTBEAT_MS: '600000',
    PARK_VOUCH_MS: String(VOUCH_MS),
    OUTBOUND_TIMEOUT_MS: String(TIMEOUT_MS),
    SUPABASE_URL: `http://127.0.0.1:${supabase.address().port}`,
    SUPABASE_ANON_KEY: 'anon-key-for-the-stand-in',
  })
})
afterAll(async () => {
  await relay?.stop()
  supabase.closeAllConnections()
  await new Promise((r) => supabase.close(r))
})

/** a socket past its hello in `room`, its own relay id learnt from `welcome` */
async function joined(room) {
  const s = openSocket(relay.url)
  await s.opened
  s.send({ type: 'hello', room, create: true })
  if (!(await until(() => s.inbox.some((f) => f.type === 'settings'), 5000)))
    throw new Error(`no hello answer in ${room}`)
  s.id = s.inbox.find((f) => f.type === 'welcome')?.id
  return s
}
const letIn = (s) => s.inbox.some((f) => f.type === 'park')
const turnedAway = (s) => s.inbox.some((f) => f.type === 'error' && f.code === 'members-only')
const roomFor = (token) => (token.endsWith('-bout') ? `fight:${token}` : `park:${token}`)

/** knock with `token` and wait for the door: let in, or the window closed and a moment more */
async function knock(token) {
  const s = await joined(roomFor(token))
  s.send({ type: 'auth', token })
  await until(() => letIn(s) || turnedAway(s), VOUCH_MS + 3000)
  await sleep(200)
  return s
}

describe.concurrent('a sign-in that hit a blip is asked again within the window', () => {
  for (const token of ['blip-park', 'blip-bout']) {
    it(`${token}: the token check answered 503, then the member is let in`, async ({ expect }) => {
      const s = await knock(token)
      try {
        expect(letIn(s), 'let in once Supabase answered').toBe(true)
        expect(turnedAway(s)).toBe(false)
        expect(count(USER, token)).toBe(2)
        expect(count(STANDING, token)).toBe(1)
      } finally {
        s.close()
      }
    })
  }

  it('the token check never came back, the relay gave up, and the next try lets them in', async ({
    expect,
  }) => {
    const token = 'hang-once-park'
    const s = await knock(token)
    try {
      expect(letIn(s), 'let in after the timeout').toBe(true)
      expect(count(USER, token)).toBe(2)
    } finally {
      s.close()
    }
  })

  it('a good token whose standing check answered 500 is asked again and let in', async ({
    expect,
  }) => {
    const token = 'standing-blip-park'
    const s = await knock(token)
    try {
      expect(letIn(s), 'let in once the standing was known').toBe(true)
      expect(count(STANDING, token)).toBe(2)
    } finally {
      s.close()
    }
  })
})

describe.concurrent('a 2xx NULL standing is a doubt, never good standing', () => {
  it('a standing that is always NULL is refused, and was asked again rather than believed', async ({
    expect,
  }) => {
    const token = 'standing-null-park'
    const s = await knock(token)
    try {
      expect(letIn(s), 'a NULL standing must not let anybody in').toBe(false)
      expect(turnedAway(s)).toBe(true)
      expect(count(STANDING, token)).toBeGreaterThanOrEqual(2)
    } finally {
      s.close()
    }
  })

  it('a NULL once, then a real answer, lets them in on the real answer', async ({ expect }) => {
    const token = 'standing-null-once-park'
    const s = await knock(token)
    try {
      expect(letIn(s), 'let in on the second, real, answer').toBe(true)
      expect(count(STANDING, token)).toBe(2)
    } finally {
      s.close()
    }
  })
})

describe.concurrent('a definite no is final, and the asking is bounded', () => {
  it('a refused token is asked once and never let in', async ({ expect }) => {
    const token = 'refused-park'
    const s = await knock(token)
    try {
      expect(letIn(s)).toBe(false)
      expect(turnedAway(s)).toBe(true)
      expect(count(USER, token)).toBe(1)
      expect(count(STANDING, token)).toBe(0)
    } finally {
      s.close()
    }
  })

  it('a suspended account is asked once and never let in', async ({ expect }) => {
    const token = 'suspended-park'
    const s = await knock(token)
    try {
      expect(letIn(s)).toBe(false)
      expect(turnedAway(s)).toBe(true)
      expect(count(STANDING, token)).toBe(1)
    } finally {
      s.close()
    }
  })

  it('an outage that lasts is refused, and nothing is asked once the window has closed', async ({
    expect,
  }) => {
    const token = 'down-park'
    const s = await knock(token)
    try {
      expect(letIn(s)).toBe(false)
      expect(turnedAway(s)).toBe(true)
      /* past the window from the auth frame, with room for one more backed-off wait */
      await sleep(1500)
      const then = count(USER, token)
      await sleep(4500)
      expect(count(USER, token)).toBe(then)
    } finally {
      s.close()
    }
  })

  it('a socket that leaves while its check waits to be retried is not asked about again', async ({
    expect,
  }) => {
    const token = 'down-leaves-park'
    const s = await joined(roomFor(token))
    s.send({ type: 'auth', token })
    expect(await until(() => count(USER, token) === 1, 3000)).toBe(true)
    await sleep(100)
    s.close()
    await sleep(3500)
    expect(count(USER, token)).toBe(1)
  })
})

/**
 * A Snake round, played to its end by one player, and what the relay sent finalize_round_rpc —
 * whose `p_players[].userId` is the only thing that lets a claimed handle be credited.
 */
async function playRound(room, token) {
  const s = await joined(room)
  try {
    s.send({ type: 'name', name: 'Ann' })
    s.send({ type: 'auth', token })
    /* the first answer, and time for one backed-off retry to land before the round ends */
    await until(() => count(USER, token) >= 1, 3000)
    await until(() => count(USER, token) >= 2, 2500)
    await sleep(300)
    s.send({ type: 'ready' })
    s.send({ type: 'restart' })
    if (!(await until(() => s.inbox.some((f) => f.type === 'restart-ack'), 3000)))
      throw new Error('the round did not start')
    s.send({ type: 'over', score: 3 })
    if (!(await until(() => finalized.has(room), 5000))) throw new Error('nothing was finalized')
    return { players: finalized.get(room), id: s.id }
  } finally {
    s.close()
  }
}

describe.concurrent('a Snake round is credited to an account whose check hit a blip', () => {
  it('the token check answered 503, then the round carries the account', async ({ expect }) => {
    const token = 'blip-snake'
    const { players, id } = await playRound('snake-signin-blip', token)
    expect(players).toEqual([{ id, name: 'Ann', userId: `user-${token}` }])
    expect(count(USER, token)).toBe(2)
    /* Snake credits off the token alone: no standing is asked for it */
    expect(count(STANDING, token)).toBe(0)
  })

  it('a refused token is asked once, and the round carries no account', async ({ expect }) => {
    const token = 'refused-snake'
    const { players, id } = await playRound('snake-signin-refused', token)
    expect(players).toEqual([{ id, name: 'Ann' }])
    expect(count(USER, token)).toBe(1)
  })
})
