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
      return Promise.resolve({ data: [], error: null })
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

const { watchThread } = await import('./roomThread')

const row = (id: string) => ({
  new: { id, room_id: 'r1', user_id: 'them', author_name: 'Them', body: 'hi', created_at: 'now' },
})

beforeEach(() => {
  vi.useFakeTimers()
  made.length = 0
  removed.length = 0
  rpcs.length = 0
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
