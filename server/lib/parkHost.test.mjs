import { createServer } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OWNER_RETRY_MS, makeParkHosts, ownerOfRoom } from './parkHost.mjs'

/**
 * Asked through a REAL supabase-js client, against a stand-in for PostgREST on loopback, because
 * the bug was in what the library does with a failure: it hands it back as a value rather than
 * throwing it, and a fake client that threw would have agreed with the old code's catch. The
 * stand-in answers park_rooms the way PostgREST does (maybeSingle asks for a list) and does
 * whatever `next` says for each request: answer with an owner, answer with no row, fail with a
 * 500, or never answer at all.
 */
const ROOM = '7e1a5b2c-9d3f-4a60-8b1e-2c4d6f8a0b13'
const OTHER = '0b2d4f6a-8c1e-4a3b-9d5f-7e9a1c3b5d70'
const TIMEOUT_MS = 150

let next = []
let asked = 0
let hung = []
const standIn = createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    asked++
    const what = next.shift() ?? 'owner'
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (what === 'hang') {
      const one = { closed: false }
      res.on('close', () => (one.closed = true))
      hung.push(one)
      return
    }
    if (what === 'fail') return json(500, { message: 'stand-in: something went wrong' })
    if (what === 'none') return json(200, [])
    json(200, [{ owner: 'user-ann' }])
  })
})

let sb
beforeAll(async () => {
  await new Promise((r) => standIn.listen(0, '127.0.0.1', r))
  sb = createClient(`http://127.0.0.1:${standIn.address().port}`, 'service-key-for-the-stand-in', {
    auth: { persistSession: false, autoRefreshToken: false },
  })
})
afterAll(async () => {
  standIn.closeAllConnections()
  await new Promise((r) => standIn.close(r))
})
beforeEach(() => {
  next = []
  asked = 0
  hung = []
})

/** a clock the test moves by hand, and hosts asking the stand-in through the real client */
function hosts(opts = {}) {
  const clock = { t: 1_000_000 }
  const hostOf = makeParkHosts({
    ask: (id) => ownerOfRoom(sb, id, TIMEOUT_MS),
    now: () => clock.t,
    ...opts,
  })
  return { hostOf, clock }
}

describe('ownerOfRoom: an answer, or null when Supabase gave none', () => {
  it('an owner, and a room that is not there, are both answers', async () => {
    expect(await ownerOfRoom(sb, ROOM, TIMEOUT_MS)).toEqual({ owner: 'user-ann' })
    next = ['none']
    expect(await ownerOfRoom(sb, ROOM, TIMEOUT_MS)).toEqual({ owner: null })
  })

  it('a failure is not an answer, though the library hands it back rather than throwing it', async () => {
    next = ['fail']
    /* what the old code read: no throw, data null, so `data?.owner ?? null` said "nobody's" */
    const raw = await sb.from('park_rooms').select('owner').eq('id', ROOM).maybeSingle()
    expect(raw.error).toBeTruthy()
    expect(raw.data).toBeNull()
    next = ['fail']
    expect(await ownerOfRoom(sb, ROOM, TIMEOUT_MS)).toBeNull()
  })

  it('a Supabase that never answers is given up on at the timeout, and the request is cancelled', async () => {
    next = ['hang']
    const t0 = Date.now()
    expect(await ownerOfRoom(sb, ROOM, TIMEOUT_MS)).toBeNull()
    const took = Date.now() - t0
    expect(took).toBeGreaterThanOrEqual(TIMEOUT_MS - 5)
    expect(took).toBeLessThan(TIMEOUT_MS + 1500)
    /* the stand-in sees the client hang up: the signal reached the request, not only the race */
    await expect.poll(() => hung[0]?.closed, { timeout: 2000 }).toBe(true)
  })

  /* the race is the half that is ours: a client that took the signal and then ignored it */
  it('and the wait still ends at the timeout when a client ignores the signal', async () => {
    const deaf = {
      from: () => ({
        select: () => ({
          eq: () => ({ abortSignal: () => ({ maybeSingle: () => new Promise(() => {}) }) }),
        }),
      }),
    }
    const t0 = Date.now()
    expect(await ownerOfRoom(deaf, ROOM, TIMEOUT_MS)).toBeNull()
    expect(Date.now() - t0).toBeLessThan(TIMEOUT_MS + 1500)
  })

  it('no service client is no answer', async () => {
    expect(await ownerOfRoom(null, ROOM, TIMEOUT_MS)).toBeNull()
  })
})

describe('makeParkHosts: only an answer is kept', () => {
  it('the first lookup fails and a later one succeeds', async () => {
    const { hostOf, clock } = hosts()
    next = ['fail']
    expect(await hostOf(ROOM)).toBeNull()
    expect(asked).toBe(1)
    /* inside the window the failure stands, and Supabase is not asked again */
    clock.t += OWNER_RETRY_MS - 1
    expect(await hostOf(ROOM)).toBeNull()
    expect(asked).toBe(1)
    /* past it, the room is asked about again and the owner is found */
    clock.t += 1
    expect(await hostOf(ROOM)).toBe('user-ann')
    expect(asked).toBe(2)
  })

  it('a lookup that times out is asked again later too', async () => {
    const { hostOf, clock } = hosts()
    next = ['hang']
    expect(await hostOf(ROOM)).toBeNull()
    clock.t += OWNER_RETRY_MS
    expect(await hostOf(ROOM)).toBe('user-ann')
    expect(asked).toBe(2)
  })

  it('the retry window is about thirty seconds', () => {
    expect(OWNER_RETRY_MS).toBe(30_000)
  })

  it('an owner is kept for good, and so is a room that is not there', async () => {
    const { hostOf, clock } = hosts()
    next = ['owner', 'none']
    expect(await hostOf(ROOM)).toBe('user-ann')
    expect(await hostOf(OTHER)).toBeNull()
    clock.t += OWNER_RETRY_MS * 1000
    expect(await hostOf(ROOM)).toBe('user-ann')
    expect(await hostOf(OTHER)).toBeNull()
    expect(asked).toBe(2)
  })

  it('callers asking about one room at once share one question', async () => {
    const { hostOf } = hosts()
    const all = await Promise.all([hostOf(ROOM), hostOf(ROOM), hostOf(ROOM)])
    expect(all).toEqual(['user-ann', 'user-ann', 'user-ann'])
    expect(asked).toBe(1)
  })

  it('a question that fails before it is asked still leaves the room askable', async () => {
    const clock = { t: 0 }
    let calls = 0
    const hostOf = makeParkHosts({
      ask: () => {
        calls++
        if (calls === 1) throw new Error('no client')
        return Promise.resolve({ owner: 'user-ann' })
      },
      now: () => clock.t,
    })
    expect(await hostOf(ROOM)).toBeNull()
    clock.t += OWNER_RETRY_MS
    expect(await hostOf(ROOM)).toBe('user-ann')
  })

  it('bounded, by dropping the oldest', async () => {
    const { hostOf } = hosts({ max: 2 })
    const ids = ['a', 'b', 'c'].map((c) => ROOM.slice(0, -1) + c)
    for (const id of ids) await hostOf(id)
    expect(asked).toBe(3)
    await hostOf(ids[2])
    expect(asked).toBe(3)
    await hostOf(ids[0])
    expect(asked).toBe(4)
  })
})
