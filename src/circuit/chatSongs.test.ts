import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { SMALL } from '../instrument/songExport'
import {
  SONGS_OFF,
  bareMime,
  lengthLabel,
  mergeSongs,
  removeSong,
  sendSong,
  songSeconds,
  songsIn,
  type ChatSong,
} from './chatSongs'

/**
 * Songs in chat, asked without a browser or a server (docs/2026-11-22-chat-songs.md).
 *
 * The client is a stand-in that records what was asked of it, and `fetch` is stubbed: the four
 * steps of a send, the PUT's headers, and every way the server can say "not yet" are questions
 * about what this file DOES with an answer, which needs no network. The answers themselves are
 * shaped like the real ones — supabase-js's own error classes, real `Response`s, and the body the
 * platform was measured sending for a function that is not deployed.
 */
type Invoked = { name: string; body: Record<string, unknown> }
const calls: string[] = []
const invoked: Invoked[] = []
let onInvoke: (body: Record<string, unknown>) => { data?: unknown; error?: unknown } = () => ({})
let onRpc: (
  name: string,
  args: Record<string, unknown>,
) => { data?: unknown; error?: unknown } = () => ({ data: [] })
const added: unknown[][] = []
const gone: string[] = []

vi.mock('../dev/previewMember', () => ({ previewMember: false }))
vi.mock('../finance/env', () => ({
  getFinanceEnv: () => ({ supabaseUrl: 'https://project.test', supabaseAnonKey: 'anon' }),
}))
vi.mock('../finance/client', () => ({
  getSupabaseClient: () => ({
    functions: {
      invoke: async (name: string, { body }: { body: Record<string, unknown> }) => {
        invoked.push({ name, body })
        calls.push(String(body.op))
        return { data: null, error: null, ...onInvoke(body) }
      },
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name)
      return { data: null, error: null, ...onRpc(name, args) }
    },
  }),
}))
vi.mock('./roomThread', () => ({
  addToThread: (...a: unknown[]) => added.push(a),
  songGone: (id: string) => gone.push(id),
}))

const ROOM = '7d1c2f3e-0a4b-4c5d-8e6f-123456789abc'
/** what the platform sends for a function that is not deployed, measured 22 Nov 2026 */
const notFound = () =>
  new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }), {
    status: 404,
    headers: { 'sb-error-code': 'NOT_FOUND' },
  })
/** what it sends for one that is, asked without a token — `pictures`, measured the same day */
const deployedButNoToken = () =>
  new Response(JSON.stringify({ code: 'UNAUTHORIZED_NO_AUTH_HEADER' }), {
    status: 401,
    headers: { 'sb-error-code': 'UNAUTHORIZED_NO_AUTH_HEADER' },
  })
const said = (status: number, error: string) =>
  new FunctionsHttpError(new Response(JSON.stringify({ error }), { status }))

let fetched: { url: string; init?: RequestInit }[] = []
let onFetch: (url: string, init?: RequestInit) => Promise<Response> = async () =>
  new Response(null, { status: 200 })

beforeEach(() => {
  calls.length = 0
  invoked.length = 0
  added.length = 0
  gone.length = 0
  fetched = []
  onInvoke = () => ({})
  onRpc = () => ({ data: [] })
  onFetch = async () => new Response(null, { status: 200 })
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    fetched.push({ url, init })
    calls.push(init?.method ?? 'GET')
    return onFetch(url, init)
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a song’s length, as the message spells it', () => {
  it('reads back as the seconds it was made from, for every length a song may be', () => {
    // the world's reading of "m:ss": m minutes and ss seconds, ss always two digits under 60
    for (let n = 0; n <= 900; n++) {
      const label = lengthLabel(n)
      const m = /^(\d+):(\d\d)$/.exec(label)
      expect(m, label).not.toBeNull()
      expect(Number(m![2])).toBeLessThan(60)
      expect(Number(m![1]) * 60 + Number(m![2])).toBe(n)
    }
  })

  it('floors a fraction, as send_chat_song does, rather than rounding it up', () => {
    // floor(seconds / 60) and floor(seconds) % 60 in the SQL: 59.9s is still under a minute
    expect(lengthLabel(59.9)).toBe('0:59')
    expect(lengthLabel(119.999)).toBe('1:59')
    expect(lengthLabel(125.7)).toBe('2:05')
    expect(lengthLabel(900)).toBe('15:00')
  })

  it('sends whole seconds, and never the 0 the claim would refuse as "not a song’s length"', () => {
    expect(songSeconds(125.97)).toBe(125)
    expect(songSeconds(0.4)).toBe(1)
    expect(lengthLabel(songSeconds(47.99))).toBe('0:47')
  })
})

describe('the type a recording is claimed, put and checked as', () => {
  it('drops the codec', () => {
    expect(bareMime('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(bareMime('audio/ogg; codecs=opus')).toBe('audio/ogg')
    expect(bareMime('Audio/MP4;codecs=mp4a.40.2')).toBe('audio/mp4')
  })

  it('is one the claim keeps, for every format the export may record in', () => {
    // chat_song_claim: mime exactly audio/mp4, audio/webm or audio/ogg
    const kept = ['audio/mp4', 'audio/webm', 'audio/ogg']
    for (const [type] of SMALL) expect(kept, type).toContain(bareMime(type))
  })
})

describe('songs read more than once', () => {
  const song = (id: string, removed = false): ChatSong => ({
    message_id: id,
    file_id: 'f-' + id,
    name: id,
    seconds: 60,
    mime: 'audio/webm',
    mine: false,
    removed,
  })

  it('come to the same answer whatever order the reads land in', () => {
    // an early read (before s2 was sent), a later one (s1 removed since), and the send itself
    const early = { s1: song('s1') }
    const later = { s1: song('s1', true), s2: song('s2') }
    const sent = { s3: song('s3') }
    const orders = [
      [early, later, sent],
      [later, early, sent],
      [sent, later, early],
      [early, sent, later],
      [later, sent, early],
      [sent, early, later],
    ]
    const results = orders.map((o) =>
      o.reduce<Record<string, ChatSong>>((have, got) => mergeSongs(have, got), {}),
    )
    for (const r of results) {
      expect(Object.keys(r).sort()).toEqual(['s1', 's2', 's3'])
      // a removal is never undone by an answer that left before it
      expect(r.s1.removed).toBe(true)
      expect(r.s3.removed).toBe(false)
    }
  })
})

describe('sending a song', () => {
  const blob = () => new Blob([new Uint8Array(1234)], { type: 'audio/webm;codecs=opus' })
  const msg = {
    id: 'm1',
    room_id: ROOM,
    author_user_id: 'me',
    author_name: 'Me',
    author_username: 'me',
    mine: true,
    body: '🎵 Sunday (2:05)',
    created_at: 'now',
  }

  it('claims, puts, has it checked, then sends — and the PUT carries the type that was claimed', async () => {
    onInvoke = (b) => (b.op === 'upload' ? { data: { id: 'f1', put: 'https://r2.test/put' } } : {})
    onRpc = () => ({ data: [msg] })
    const r = await sendSong(ROOM, blob(), '  Sunday  ', 125)
    expect(r).toEqual({ msg })
    expect(calls).toEqual(['upload', 'PUT', 'ready', 'send_chat_song'])
    expect(invoked[0].body).toEqual({
      op: 'upload',
      room: ROOM,
      mime: 'audio/webm',
      bytes: 1234,
      seconds: 125,
      name: 'Sunday',
    })
    const put = fetched.find((f) => f.init?.method === 'PUT')!
    expect(put.url).toBe('https://r2.test/put')
    // the blob's own type carries ;codecs=opus — sent as that, `ready` would drop the object
    expect((put.init!.headers as Record<string, string>)['Content-Type']).toBe('audio/webm')
    expect(invoked[1].body).toEqual({ op: 'ready', id: 'f1' })
    expect(added).toEqual([
      [
        ROOM,
        msg,
        {
          message_id: 'm1',
          file_id: 'f1',
          name: 'Sunday',
          seconds: 125,
          mime: 'audio/webm',
          mine: true,
          removed: false,
        },
      ],
    ])
  })

  it('cuts a name to the 60 characters the server keeps, counting an emoji as one', async () => {
    onInvoke = (b) => (b.op === 'upload' ? { error: said(400, 'stop here') } : {})
    await sendSong(ROOM, blob(), '🎸'.repeat(70), 60)
    expect(Array.from(String(invoked[0].body.name))).toHaveLength(60)
  })

  it('says "not switched on" for a function that is not deployed — which a page sees as no response at all', async () => {
    // the preflight to a missing function is answered 404, so the browser never sends the POST
    onInvoke = () => ({ error: new FunctionsFetchError(new TypeError('Failed to fetch')) })
    onFetch = async () => notFound()
    const r = await sendSong(ROOM, blob(), 'Sunday', 125)
    expect(r).toEqual({ why: SONGS_OFF })
    // asked with a plain GET, which has no preflight, and nothing was uploaded
    expect(fetched.map((f) => [f.url, f.init?.method])).toEqual([
      ['https://project.test/functions/v1/chat-songs', undefined],
    ])
  })

  it('does not call a dropped connection "not switched on"', async () => {
    onInvoke = () => ({ error: new FunctionsFetchError(new TypeError('Failed to fetch')) })
    onFetch = async () => deployedButNoToken()
    const deployedYet = await sendSong(ROOM, blob(), 'Sunday', 125)
    onFetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    const offline = await sendSong(ROOM, blob(), 'Sunday', 125)
    for (const r of [deployedYet, offline]) {
      expect(r).toHaveProperty('why')
      expect((r as { why: string }).why).not.toBe(SONGS_OFF)
    }
  })

  it('reads the platform’s 404 as "not switched on", and a refusal as the refusal', async () => {
    onInvoke = () => ({ error: new FunctionsHttpError(notFound()) })
    expect(await sendSong(ROOM, blob(), 'Sunday', 125)).toEqual({ why: SONGS_OFF })
    onInvoke = () => ({ error: said(400, 'that one is over 5 MB') })
    expect(await sendSong(ROOM, blob(), 'Sunday', 125)).toEqual({ why: 'that one is over 5 MB' })
    // no probe is needed when the response itself answered
    expect(fetched).toEqual([])
  })

  it('says "not switched on" when the function is there and the SQL is not', async () => {
    // the function passes an RPC's error on as {error: message}; PostgREST's code is lost on the way
    onInvoke = () => ({
      error: said(
        400,
        'Could not find the function public.chat_song_claim(p_bytes, p_mime, p_name, p_room, p_seconds) in the schema cache',
      ),
    })
    expect(await sendSong(ROOM, blob(), 'Sunday', 125)).toEqual({ why: SONGS_OFF })
  })

  it('says "not switched on" when send_chat_song is missing (PGRST202)', async () => {
    onInvoke = (b) => (b.op === 'upload' ? { data: { id: 'f1', put: 'https://r2.test/put' } } : {})
    onRpc = () => ({
      error: { code: 'PGRST202', message: 'Could not find the function public.send_chat_song' },
    })
    expect(await sendSong(ROOM, blob(), 'Sunday', 125)).toEqual({ why: SONGS_OFF })
    expect(added).toEqual([])
  })

  it('stops at a refused PUT, and never marks it ready', async () => {
    onInvoke = (b) => (b.op === 'upload' ? { data: { id: 'f1', put: 'https://r2.test/put' } } : {})
    onFetch = async () => new Response(null, { status: 403 })
    const r = await sendSong(ROOM, blob(), 'Sunday', 125)
    expect((r as { why: string }).why).toMatch(/403/)
    expect(calls).toEqual(['upload', 'PUT'])
  })
})

describe('reading a room’s songs', () => {
  it('never asks about a room the database did not make', async () => {
    for (const room of ['call', 'dev-call', 'r1'])
      expect(await songsIn(room)).toEqual({ songs: {} })
    expect(calls).toEqual([])
  })

  it('keys them by message, and reads numeric seconds however they arrive', async () => {
    onRpc = (name, args) =>
      name === 'chat_songs_in' && args.p_room === ROOM
        ? {
            data: [
              {
                message_id: 'm1',
                file_id: 'f1',
                name: 'Sunday',
                seconds: '125',
                mime: 'audio/webm',
                mine: true,
                removed: false,
              },
            ],
          }
        : {}
    const r = await songsIn(ROOM)
    expect(r).toEqual({
      songs: {
        m1: {
          message_id: 'm1',
          file_id: 'f1',
          name: 'Sunday',
          seconds: 125,
          mime: 'audio/webm',
          mine: true,
          removed: false,
        },
      },
    })
  })

  it('says "not switched on" while the SQL is not applied (PGRST202 or 42883)', async () => {
    for (const code of ['PGRST202', '42883']) {
      onRpc = () => ({ error: { code, message: 'no such function' } })
      expect(await songsIn(ROOM)).toEqual({ why: SONGS_OFF })
    }
  })
})

describe('removing a song', () => {
  it('tells the open threads only once it has gone', async () => {
    onInvoke = () => ({ error: said(400, 'no such song') })
    expect(await removeSong('f1')).toEqual({ why: 'no such song' })
    expect(gone).toEqual([])
    onInvoke = () => ({ data: { ok: true, orphaned: false } })
    expect(await removeSong('f1')).toBeNull()
    expect(gone).toEqual(['f1'])
  })
})
