import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { SMALL } from '../instrument/songExport'
import {
  LINK_LIFE_MS,
  SEND_TIMEOUT_MS,
  SIGNED_OUT,
  SONGS_BYTES,
  SONGS_OFF,
  SONG_BYTES,
  TOO_SLOW,
  afterPlayError,
  bareMime,
  lengthLabel,
  mergeSongs,
  nameCap,
  removeSong,
  roomChoices,
  sendSong,
  songSeconds,
  songTitle,
  songsIn,
  songsMine,
  startedPlaying,
  stoppedPlaying,
  usedLabel,
  type ChatSong,
} from './chatSongs'

/**
 * Songs in chat, asked without a browser or a server (docs/2026-11-22-chat-songs.md).
 *
 * The client is a stand-in that records what was asked of it, and `fetch` is stubbed: the two
 * steps of a send, the upload's headers, and every way the server can say "not yet" are questions
 * about what this file DOES with an answer, which needs no network. The answers themselves are
 * shaped like the real ones — supabase-js's own error classes, real `Response`s, and the body the
 * platform was measured sending for a function that is not deployed.
 */
type Invoked = { name: string; body: unknown; headers: Record<string, string>; timeout?: number }
/** what a call asked the function to do: the op header for the upload, the JSON's op otherwise */
const opOf = (i: Omit<Invoked, 'name'>) =>
  i.headers['x-song-op'] ?? String((i.body as { op?: unknown } | null)?.op)
const calls: string[] = []
const invoked: Invoked[] = []
let onInvoke: (i: Omit<Invoked, 'name'>) => { data?: unknown; error?: unknown } = () => ({})
let onRpc: (
  name: string,
  args: Record<string, unknown>,
) => { data?: unknown; error?: unknown } = () => ({ data: [] })
const added: unknown[][] = []
const gone: string[] = []
/** what getSession answers: a session, or null once a sign-in has lapsed */
let session: { access_token: string } | null = { access_token: 'token' }

vi.mock('../dev/previewMember', () => ({ previewMember: false }))
vi.mock('../finance/env', () => ({
  getFinanceEnv: () => ({ supabaseUrl: 'https://project.test', supabaseAnonKey: 'anon' }),
}))
vi.mock('../finance/client', () => ({
  getSupabaseClient: () => ({
    functions: {
      invoke: async (
        name: string,
        {
          body,
          headers = {},
          timeout,
        }: { body: unknown; headers?: Record<string, string>; timeout?: number },
      ) => {
        invoked.push({ name, body, headers, timeout })
        calls.push(opOf({ body, headers }))
        return { data: null, error: null, ...onInvoke({ body, headers }) }
      },
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name)
      return { data: null, error: null, ...onRpc(name, args) }
    },
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
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
  session = { access_token: 'token' }
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

describe('the type a recording is claimed, kept and checked as', () => {
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
  const blob = (size = 1234) => new Blob([new Uint8Array(size)], { type: 'audio/webm;codecs=opus' })
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
  const upload = () => invoked.find((i) => opOf(i) === 'upload')!

  it('hands the function the file itself, then sends — with no PUT and no "ready" after it', async () => {
    onInvoke = (i) => (opOf(i) === 'upload' ? { data: { id: 'f1' } } : {})
    onRpc = () => ({ data: [msg] })
    const file = blob()
    const r = await sendSong(ROOM, file, '  Sunday  ', 125.6)
    expect(r).toEqual({ msg })
    expect(calls).toEqual(['upload', 'send_chat_song'])
    // nothing went anywhere but the function: a signed PUT is what let a file be swapped in later
    expect(fetched).toEqual([])
    // the body is the recording, byte for byte the export — not a description of it
    expect(upload().body).toBe(file)
    expect(upload().headers).toEqual({
      'x-song-op': 'upload',
      'x-song-room': ROOM,
      // the recorder's type carries ;codecs=opus, which no allowed type does
      'x-song-mime': 'audio/webm',
      // whole seconds, floored: the label on both sides is the same sum
      'x-song-seconds': '125',
      'x-song-name': 'Sunday',
    })
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

  it('sends a name the server reads back as the same name, whatever is in it', async () => {
    onInvoke = () => ({ error: said(400, 'stop here') })
    for (const name of ['Café “é”', 'Night drive / take #3 & 4%', '🎸 riff', 'two\nlines\there']) {
      invoked.length = 0
      await sendSong(ROOM, blob(), name, 60)
      // what the function does with the header: decode it
      expect(decodeURIComponent(upload().headers['x-song-name'])).toBe(songTitle(name))
    }
  })

  it('cuts a name to the 60 characters the server keeps, counting an emoji as one', async () => {
    onInvoke = () => ({ error: said(400, 'stop here') })
    await sendSong(ROOM, blob(), '🎸'.repeat(70), 60)
    const name = decodeURIComponent(upload().headers['x-song-name'])
    // char_length counts code points: sixty guitars, which is 120 UTF-16 units
    expect(Array.from(name)).toHaveLength(60)
    expect(name).toBe('🎸'.repeat(60))
  })

  it('never sends half an emoji, which the kept name can end in and the header cannot carry', async () => {
    // songName.ts cuts at 60 UTF-16 units, so an emoji across the boundary comes back as its first half
    const kept = ('a'.repeat(59) + '🎸').slice(0, 60)
    expect(kept.charCodeAt(59)).toBe(0xd83c) // a lone high surrogate — the thing under test
    expect(() => encodeURIComponent(kept)).toThrow(URIError)
    const offered = nameCap(kept)
    expect(offered).toBe('a'.repeat(59))
    // and an emoji that FITS is kept whole: 59 letters and a guitar are 60 code points
    expect(nameCap('a'.repeat(59) + '🎸' + 'b')).toBe('a'.repeat(59) + '🎸')
    // a stray low half anywhere goes too, not only at the end
    expect(nameCap('x\uDF78y')).toBe('xy')
    onInvoke = () => ({ error: said(400, 'stop here') })
    await expect(sendSong(ROOM, blob(), kept, 60)).resolves.toEqual({ why: 'stop here' })
    expect(decodeURIComponent(upload().headers['x-song-name'])).toBe('a'.repeat(59))
  })

  it('squeezes the spaces before it cuts, as the claim does, so nothing it would keep is lost', () => {
    // chat_song_claim: btrim(left(btrim(regexp_replace(name, '\s+', ' ', 'g')), 60))
    const name = 'a' + ' '.repeat(10) + 'b'.repeat(58)
    expect(songTitle(name)).toBe('a ' + 'b'.repeat(58))
    expect(Array.from(songTitle(name))).toHaveLength(60)
  })

  it('refuses a file over 5 MB before sending a byte of it, in the claim’s own words', async () => {
    // 5 MB is the server's 5,242,880 bytes, and the file size is counted in bytes on both sides
    expect(SONG_BYTES).toBe(5 * 1024 * 1024)
    const r = await sendSong(ROOM, blob(SONG_BYTES + 1), 'Sunday', 60)
    expect(r).toEqual({ why: 'that one is over 5 MB' })
    expect(invoked).toEqual([])
    // and one exactly at the ceiling is the server's to judge
    onInvoke = () => ({ data: { id: 'f1' } })
    onRpc = () => ({ data: [msg] })
    expect(await sendSong(ROOM, blob(SONG_BYTES), 'Sunday', 60)).toEqual({ msg })
  })

  it('says "not switched on" for a function that is not deployed — which a page sees as no response at all', async () => {
    // the preflight to a missing function is answered 404, so the browser never sends the POST
    onInvoke = () => ({ error: new FunctionsFetchError(new TypeError('Failed to fetch')) })
    onFetch = async () => notFound()
    const r = await sendSong(ROOM, blob(), 'Sunday', 125)
    expect(r).toEqual({ why: SONGS_OFF })
    // asked with a plain GET, which has no preflight
    expect(fetched.map((f) => [f.url, f.init?.method])).toEqual([
      ['https://project.test/functions/v1/chat-songs', undefined],
    ])
    expect(calls).toEqual(['upload', 'GET'])
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
    onInvoke = () => ({ error: said(413, 'that one is over 5 MB') })
    expect(await sendSong(ROOM, blob(), 'Sunday', 125)).toEqual({ why: 'that one is over 5 MB' })
    onInvoke = () => ({ error: said(422, 'that does not sound like a recording') })
    expect(await sendSong(ROOM, blob(), 'Sunday', 125)).toEqual({
      why: 'that does not sound like a recording',
    })
    // no probe is needed when the response itself answered, and a refused upload sends nothing
    expect(fetched).toEqual([])
    expect(calls).toEqual(['upload', 'upload', 'upload'])
    expect(added).toEqual([])
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
    onInvoke = () => ({ data: { id: 'f1' } })
    onRpc = () => ({
      error: { code: 'PGRST202', message: 'Could not find the function public.send_chat_song' },
    })
    expect(await sendSong(ROOM, blob(), 'Sunday', 125)).toEqual({ why: SONGS_OFF })
    expect(added).toEqual([])
  })

  it('does not send a message for an upload that answered no id', async () => {
    onInvoke = () => ({ data: { put: 'https://r2.test/put' } })
    const r = await sendSong(ROOM, blob(), 'Sunday', 125)
    expect(r).toEqual({ why: 'That song didn’t go up.' })
    expect(calls).toEqual(['upload'])
  })
})

/**
 * ⚠️ "SENDING…" MUST END, and say why. A send whose sign-in had lapsed used to spin: supabase-js
 * sent the anon key, the function refused it before reading the 5 MB, and that refusal never
 * arrived (supabase/functions/chat-songs, `drain`). The function answers now; these are about
 * what the page says when it does, and about never waiting for ever.
 */
describe('a send whose sign-in has lapsed, or that stalls', () => {
  const blob = () => new Blob([new Uint8Array(1234)], { type: 'audio/webm' })

  it('says signed out, and uploads nothing, when there is no session at all', async () => {
    session = null
    expect(await sendSong(ROOM, blob(), 'Sunday', 60)).toEqual({ why: SIGNED_OUT })
    expect(invoked).toEqual([])
  })

  it('says signed out for the function’s own 401', async () => {
    onInvoke = () => ({ error: said(401, 'not authenticated') })
    expect(await sendSong(ROOM, blob(), 'Sunday', 60)).toEqual({ why: SIGNED_OUT })
  })

  it('says signed out for the gateway’s 401, which carries no sentence of its own', async () => {
    /* measured 25 Nov 2026: an expired or forged token, refused before the function runs */
    onInvoke = () => ({
      error: new FunctionsHttpError(
        new Response(JSON.stringify({ code: 'UNAUTHORIZED_LEGACY_JWT', message: 'Invalid JWT' }), {
          status: 401,
        }),
      ),
    })
    expect(await sendSong(ROOM, blob(), 'Sunday', 60)).toEqual({ why: SIGNED_OUT })
  })

  it('gives the upload a deadline, so it cannot wait for ever', async () => {
    onInvoke = () => ({ error: said(400, 'stop here') })
    await sendSong(ROOM, blob(), 'Sunday', 60)
    expect(invoked.find((i) => opOf(i) === 'upload')?.timeout).toBe(SEND_TIMEOUT_MS)
  })

  it('says it took too long when the deadline passes, not that the server was unreachable', async () => {
    onInvoke = () => ({
      error: new FunctionsFetchError(new DOMException('The operation was aborted.', 'AbortError')),
    })
    expect(await sendSong(ROOM, blob(), 'Sunday', 60)).toEqual({ why: TOO_SLOW })
  })

  it('still sends when there is a session, and the function says yes', async () => {
    onInvoke = (i) => (opOf(i) === 'upload' ? { data: { id: 'f1' } } : {})
    onRpc = () => ({ data: [{ id: 'm1', room_id: ROOM }] })
    const r = await sendSong(ROOM, blob(), 'Sunday', 60)
    expect('msg' in r).toBe(true)
  })
})

describe('choosing the chat', () => {
  const dm = (id: string, name: string, peer: string | null) => ({
    id,
    kind: 'dm',
    name,
    peer_user_id: peer,
  })
  const circuit = (id: string, name: string) => ({ id, kind: 'circuit', name })
  const handles: Record<string, string> = { u1: 'alex_r', u2: 'alexm' }
  const usernameOf = (id: string) => handles[id] ?? null

  it('names every chat so that no two read alike', () => {
    const rooms = [
      dm('r1', 'Alex', 'u1'),
      dm('r2', 'Alex', 'u2'),
      dm('r3', 'Alex', 'u3'), // nobody the directory knows
      dm('r4', 'Alex', null),
      circuit('r5', 'The Crew'),
      circuit('r6', 'The Crew'),
      { id: 'r7', kind: 'lounge', name: 'The Lounge' },
      dm('r8', 'Morgan', 'u9'),
      circuit('r9', 'Alex'), // a circuit called Alex is told apart by its kind already
    ]
    const got = roomChoices(rooms, usernameOf)
    // what a reader sees: the kind's icon and the name — every line different
    const lines = got.map((c) => c.kind + ' ' + c.name)
    expect(new Set(lines).size).toBe(rooms.length)
    expect(got.map((c) => c.id)).toEqual(rooms.map((r) => r.id))
    const name = Object.fromEntries(got.map((c) => [c.id, c.name]))
    // a DM's person by their handle, when the directory knows them
    expect(name.r1).toBe('Alex (@alex_r)')
    expect(name.r2).toBe('Alex (@alexm)')
    // and by kind and place when it does not
    expect(name.r3).toBe('Alex (DM 1)')
    expect(name.r4).toBe('Alex (DM 2)')
    expect(name.r5).toBe('The Crew (circuit 1)')
    expect(name.r6).toBe('The Crew (circuit 2)')
    // a name nothing shares is left alone
    expect(name.r7).toBe('The Lounge')
    expect(name.r8).toBe('Morgan')
    expect(name.r9).toBe('Alex')
  })
})

describe('your songs in chat', () => {
  it('reads every row, its numbers however they arrive', async () => {
    onRpc = (name) =>
      name === 'chat_songs_mine'
        ? {
            data: [
              {
                file_id: 'f2',
                name: 'Gone room',
                seconds: '61',
                bytes: 2_000_000,
                sent: true,
                room_kind: null,
              },
              {
                file_id: 'f1',
                name: 'Never sent',
                seconds: 12,
                bytes: '300000',
                sent: false,
                room_kind: 'dm',
              },
            ],
          }
        : {}
    expect(await songsMine()).toEqual({
      songs: [
        {
          file_id: 'f2',
          name: 'Gone room',
          seconds: 61,
          bytes: 2_000_000,
          sent: true,
          room_kind: null,
        },
        {
          file_id: 'f1',
          name: 'Never sent',
          seconds: 12,
          bytes: 300_000,
          sent: false,
          room_kind: 'dm',
        },
      ],
    })
    expect(calls).toEqual(['chat_songs_mine'])
  })

  it('says "not switched on" while the SQL is not applied, so the list can hide', async () => {
    onRpc = () => ({ error: { code: 'PGRST202', message: 'no such function' } })
    expect(await songsMine()).toEqual({ why: SONGS_OFF })
  })

  it('shows the room used in the server’s MB, and never less than it is', () => {
    // the server's sentences: "over 5 MB" is 5,242,880 bytes and "come to 25 MB" is 26,214,400
    expect(SONGS_BYTES).toBe(25 * 1024 * 1024)
    expect(usedLabel(SONG_BYTES)).toBe('5 of 25 MB')
    expect(usedLabel(SONGS_BYTES)).toBe('25 of 25 MB')
    // one byte short of the ceiling is still the ceiling to read; one byte is not nothing
    expect(usedLabel(SONGS_BYTES - 1)).toBe('25 of 25 MB')
    expect(usedLabel(1)).toBe('0.1 of 25 MB')
    expect(usedLabel(0)).toBe('0 of 25 MB')
    // rounding up, never down: no figure reads lower than the bytes it stands for
    for (const b of [1, 999_999, 1_048_577, 3_300_000, 20_000_001]) {
      const shown = Number(usedLabel(b).split(' ')[0])
      expect(shown * 1_048_576, String(b)).toBeGreaterThanOrEqual(b)
    }
  })
})

describe('a player that failed', () => {
  // the HTML spec's MediaError codes
  const ABORTED = 1
  const NETWORK = 2
  const DECODE = 3
  const SRC_NOT_SUPPORTED = 4
  const fresh = 5_000
  const expired = 3_600_000 + 5_000

  it('ends on "can’t play" for a recording this browser cannot decode, rather than ▶ for ever', () => {
    expect(afterPlayError(SRC_NOT_SUPPORTED, fresh)).toBe('cannot')
    expect(afterPlayError(DECODE, fresh)).toBe('cannot')
  })

  it('offers ▶ again for an expired link, which fails with the very same code', () => {
    // the link is signed for an hour (3600 s), and R2's 403 reads as "not supported" to a browser
    expect(LINK_LIFE_MS).toBe(3600 * 1000)
    expect(afterPlayError(SRC_NOT_SUPPORTED, expired)).toBe('again')
    expect(afterPlayError(DECODE, expired)).toBe('again')
  })

  it('offers ▶ again when the network or the person stopped it', () => {
    for (const code of [ABORTED, NETWORK, undefined])
      expect(afterPlayError(code, fresh), String(code)).toBe('again')
  })
})

describe('songs playing', () => {
  const player = () => {
    const p = { paused: 0, pause: () => void p.paused++ }
    return p
  }

  it('one at a time: starting one pauses whichever was playing', () => {
    const a = player()
    const b = player()
    startedPlaying(a)
    startedPlaying(b)
    expect(a.paused).toBe(1)
    expect(b.paused).toBe(0)
    // starting the one already playing stops nothing
    startedPlaying(b)
    expect(b.paused).toBe(0)
    // and one that has stopped by itself is not paused again by the next
    stoppedPlaying(b)
    startedPlaying(a)
    expect(b.paused).toBe(0)
    stoppedPlaying(a)
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
