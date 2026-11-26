import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The REAL handler in index.ts, asked in what ORDER it does things — which verdict.ts cannot be
 * asked, because order lives in the handler. Deno, Supabase and R2 are stood in for; nothing here
 * reaches a network.
 *
 * ⚠️ WHY THESE TESTS EXIST. Two things were measured wrong on the live function (25 Nov 2026):
 *   - a play or remove was PARSED before its caller was named — an anonymous request of 1 MB of
 *     garbage was answered "that was not json" where it should have been "not authenticated";
 *   - an answer sent while a body was still unread never arrived — an upload refused before its
 *     body was read hung for as long as the client waited.
 * So each test below watches the BODY: whether any of it had been pulled when the caller was
 * checked, and whether it was read to its end before the answer went. The stream is built with no
 * read-ahead (highWaterMark 0), so a pull happens only when the handler asks for one.
 */

type Who = { data: { user: { id: string } | null }; error: { message: string } | null }

const state = {
  /** what getUser answers, and how many body pulls had happened when it was asked */
  who: { data: { user: null }, error: { message: 'expired' } } as Who,
  pullsWhenNamed: -1,
  body: null as null | { pulls: number; ended: boolean; cancelled: boolean },
  rpcs: [] as string[],
}

const anon = (): Who => ({ data: { user: null }, error: { message: 'JWT expired' } })
const member = (): Who => ({
  data: { user: { id: '11111111-1111-4111-8111-111111111111' } },
  error: null,
})

vi.mock('jsr:@supabase/supabase-js@2', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => {
        state.pullsWhenNamed = state.body?.pulls ?? 0
        return state.who
      },
    },
    rpc: async (fn: string) => {
      state.rpcs.push(fn)
      if (fn === 'is_suspended') return { data: false, error: null }
      if (fn === 'chat_song_get')
        return { data: [{ key: 'songs/x.webm', mime: 'audio/webm' }], error: null }
      if (fn === 'chat_song_abandoned') return { data: [], error: null }
      return { data: null, error: null }
    },
  }),
}))

vi.mock('npm:aws4fetch@1.0.20', () => ({
  AwsClient: class {
    async sign(req: Request) {
      return new Request(req.url + '&X-Amz-Signature=stand-in', { method: req.method })
    }
    async fetch() {
      return new Response(null, { status: 200 })
    }
  },
}))

let handler: (req: Request) => Promise<Response>

beforeAll(async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: 'https://stand-in.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    R2_ACCOUNT_ID: 'acct',
    R2_BUCKET: 'bucket',
    R2_ACCESS_KEY_ID: 'id',
    R2_SECRET_ACCESS_KEY: 'secret',
  }
  ;(globalThis as unknown as { Deno: unknown }).Deno = {
    serve: (h: typeof handler) => {
      handler = h
    },
    env: { get: (k: string) => env[k] },
  }
  await import('./index.ts')
})

beforeEach(() => {
  state.who = anon()
  state.pullsWhenNamed = -1
  state.body = null
  state.rpcs = []
})

/** a request whose body is `size` bytes in 64 KiB chunks, every pull counted */
function post(size: number, headers: Record<string, string>, text?: string) {
  const watch = { pulls: 0, ended: false, cancelled: false }
  state.body = watch
  const bytes = text === undefined ? null : new TextEncoder().encode(text)
  const total = bytes ? bytes.length : size
  let sent = 0
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        watch.pulls++
        if (sent >= total) {
          watch.ended = true
          controller.close()
          return
        }
        const n = Math.min(65_536, total - sent)
        controller.enqueue(bytes ? bytes.slice(sent, sent + n) : new Uint8Array(n))
        sent += n
      },
      cancel() {
        watch.cancelled = true
      },
    },
    { highWaterMark: 0 },
  )
  return new Request('https://stand-in.supabase.co/functions/v1/chat-songs', {
    method: 'POST',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json', ...headers },
    body,
    duplex: 'half',
  } as RequestInit)
}

const play = (id = '22222222-2222-4222-8222-222222222222') => JSON.stringify({ op: 'play', id })
const upload = {
  'x-song-op': 'upload',
  'x-song-mime': 'audio/webm',
  'x-song-seconds': '60',
  'x-song-name': 'a',
}

describe('a play or remove is not read before its caller is named', () => {
  it('names the caller before pulling a byte of the body', async () => {
    state.who = member()
    const res = await handler(post(0, {}, play()))
    expect(state.pullsWhenNamed).toBe(0)
    expect(res.status).toBe(200)
    expect(state.rpcs).toContain('chat_song_get')
  })

  it('refuses an unnamed caller as unauthenticated, not as bad json, however big the body', async () => {
    const res = await handler(post(1_048_576, {}))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'not authenticated' })
    expect(state.pullsWhenNamed).toBe(0)
    /* and the body was read off to its end, so the answer can arrive */
    expect(state.body?.ended).toBe(true)
    expect(state.body?.cancelled).toBe(false)
  })

  it('takes a play of up to 4 KB and refuses a bigger one with 413, read to its end', async () => {
    state.who = member()
    const padded = (n: number) => {
      const base = play()
      return base.slice(0, -1) + ' '.repeat(n - base.length) + '}'
    }
    expect((await handler(post(0, {}, padded(4096)))).status).toBe(200)
    const res = await handler(post(0, {}, padded(4097)))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'that request is too big' })
    expect(state.body?.ended).toBe(true)
    expect(state.body?.cancelled).toBe(false)
    expect(state.rpcs.filter((f) => f === 'chat_song_get')).toHaveLength(1)
  })

  it('still answers what is not json', async () => {
    state.who = member()
    const res = await handler(post(0, {}, 'null'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'that was not json' })
  })
})

describe('an upload that is refused is answered, not left hanging', () => {
  it('reads off an upload refused for its caller before answering 401', async () => {
    const res = await handler(post(5_242_880, upload))
    expect(res.status).toBe(401)
    expect(state.pullsWhenNamed).toBe(0)
    expect(state.body?.ended).toBe(true)
    expect(state.body?.cancelled).toBe(false)
  })

  it('reads an upload over 5 MB off to its end, then answers 413', async () => {
    state.who = member()
    const res = await handler(post(6 * 1_048_576, upload))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'that one is over 5 MB' })
    expect(state.body?.ended).toBe(true)
    expect(state.body?.cancelled).toBe(false)
    /* and claimed nothing: the size is refused before any song is started */
    expect(state.rpcs).not.toContain('chat_song_claim')
  })

  it('cuts off an upload past the drain cap rather than reading it for ever', async () => {
    state.who = member()
    const res = await handler(post(16 * 1_048_576, upload))
    expect(res.status).toBe(413)
    expect(state.body?.cancelled).toBe(true)
    expect(state.body?.ended).toBe(false)
  })
})
