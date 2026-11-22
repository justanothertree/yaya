import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The reason roomThread.ts exists, asked of it directly: a conversation can be on screen twice
 * (Chat, and the call anchor's panel), and two components each opening `chat:<room>` are not two
 * channels — realtime-js dedupes by topic, so the first to unmount removed the channel from
 * under the other. Nothing here needs a browser; the client is a stand-in that counts.
 */
type Insert = (payload: { new: Record<string, unknown> }) => void
const made: { topic: string; fire: Insert }[] = []
const removed: string[] = []
const rpcs: string[] = []
/** what chat_songs_in answers — rows, as PostgREST returns them */
let songRows: Record<string, unknown>[] = []

vi.mock('../dev/previewMember', () => ({
  previewMember: false,
  PREVIEW_ME: { id: 'x', name: 'x' },
  PREVIEW_PEOPLE: [],
  PREVIEW_UNREAD: {},
  previewMsgs: () => ({}),
}))
vi.mock('../hooks/notifySignal', () => ({ notificationsChanged: () => {} }))
vi.mock('../finance/client', () => ({
  getSupabaseClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
    rpc: (name: string) => {
      rpcs.push(name)
      return Promise.resolve({ data: name === 'chat_songs_in' ? songRows : [], error: null })
    },
    channel: (topic: string) => {
      const ch = {
        topic,
        fire: (() => {}) as Insert,
        on(_e: string, _f: unknown, cb: Insert) {
          ch.fire = cb
          return ch
        },
        subscribe() {
          made.push(ch)
          return ch
        },
      }
      return ch
    },
    removeChannel: async (ch: { topic: string }) => {
      removed.push(ch.topic)
    },
  }),
}))

const { threadNow, watchThread } = await import('./roomThread')

const row = (id: string) => ({
  new: { id, room_id: 'r1', user_id: 'them', author_name: 'Them', body: 'hi', created_at: 'now' },
})

beforeEach(() => {
  vi.useFakeTimers()
  made.length = 0
  removed.length = 0
  rpcs.length = 0
  songRows = []
})
afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
})

describe('a conversation watched from two places', () => {
  it('opens one channel for both, and keeps it when the first one leaves', () => {
    const offPage = watchThread('r1', 'dm', true, () => {})
    const offAnchor = watchThread('r1', 'dm', false, () => {})
    expect(made.map((c) => c.topic)).toEqual(['chat:r1'])

    offPage()
    vi.runAllTimers()
    // the anchor is still following: the channel it depends on must still be there
    expect(removed).toEqual([])

    offAnchor()
    vi.runAllTimers()
    expect(removed).toEqual(['chat:r1'])
  })

  it('does not close and reopen when a watcher only changes how it is watching', () => {
    // the anchor's panel opening: a follower leaves and a viewer arrives in the same breath
    const off = watchThread('r1', 'dm', false, () => {})
    off()
    const offAgain = watchThread('r1', 'dm', true, () => {})
    vi.runAllTimers()
    expect(made).toHaveLength(1)
    expect(removed).toEqual([])
    offAgain()
  })

  it('marks an arrival read only while somebody is looking at it', async () => {
    const reads = () => rpcs.filter((n) => n === 'mark_room_read').length

    // a follower alone — the anchor with its panel shut. Nobody has seen the message, so the
    // bell must still be able to say it is unread.
    const offFollower = watchThread('r1', 'dm', false, () => {})
    made[0].fire(row('m1'))
    expect(reads()).toBe(0)

    const offViewer = watchThread('r1', 'dm', true, () => {})
    made[0].fire(row('m2'))
    expect(reads()).toBe(1)

    // and back to nobody looking once the viewer goes
    offViewer()
    made[0].fire(row('m3'))
    expect(reads()).toBe(1)
    offFollower()
  })

  it('tells every watcher about a message once, however it arrives twice', () => {
    let pings = 0
    const off = watchThread('r1', 'dm', true, () => pings++)
    made[0].fire(row('m1'))
    made[0].fire(row('m1'))
    expect(pings).toBe(1)
    off()
  })
})

describe('the songs in a conversation', () => {
  /* a room id the database could have made; the call's loose chat is 'call' */
  const ROOM = '7d1c2f3e-0a4b-4c5d-8e6f-123456789abc'
  const asked = () => rpcs.filter((n) => n === 'chat_songs_in').length
  /** let the reads' promises settle — microtasks, which fake timers do not hold back */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
  const songRow = (message_id: string) => ({
    message_id,
    file_id: 'f-' + message_id,
    name: 'Sunday',
    seconds: 125,
    mime: 'audio/webm',
    mine: false,
    removed: false,
  })
  const said = (id: string, body: string) => ({
    new: { id, room_id: ROOM, user_id: 'them', author_name: 'Them', body, created_at: 'now' },
  })

  it('are read beside the first read, and kept by message', async () => {
    songRows = [songRow('m1')]
    const off = watchThread(ROOM, 'circuit', true, () => {})
    expect(rpcs).toContain('list_room_messages')
    expect(asked()).toBe(1)
    await settle()
    expect(Object.keys(threadNow(ROOM).songs)).toEqual(['m1'])
    expect(threadNow(ROOM).songs.m1.file_id).toBe('f-m1')
    off()
  })

  it('are asked again when a message that could be a song arrives, and only then', async () => {
    const off = watchThread(ROOM, 'circuit', true, () => {})
    await settle()
    const before = asked()
    made[0].fire(said('m2', 'just words'))
    expect(asked()).toBe(before)

    // typed by hand, so the server names no song for it: it stays a message, not a song
    made[0].fire(said('m3', '🎵 Not a song (1:00)'))
    expect(asked()).toBe(before + 1)
    await settle()
    expect(threadNow(ROOM).songs.m3).toBeUndefined()

    // sent by send_chat_song: the answer names it
    songRows = [songRow('m4')]
    made[0].fire(said('m4', '🎵 Sunday (2:05)'))
    expect(asked()).toBe(before + 2)
    await settle()
    expect(threadNow(ROOM).songs.m4?.name).toBe('Sunday')
    off()
  })

  it('are never asked of the call’s own chat, which is no room', async () => {
    const off = watchThread('call', 'dm', true, () => {})
    made[0].fire({ new: { ...said('c1', '🎵 Sunday (2:05)').new, room_id: 'call' } })
    await settle()
    expect(asked()).toBe(0)
    expect(threadNow('call').songs).toEqual({})
    off()
  })
})
