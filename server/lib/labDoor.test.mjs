import { describe, expect, it } from 'vitest'
import {
  LAB,
  SAY,
  admitAfter,
  doorFor,
  friendsAt,
  helloFrames,
  isLabId,
  kindAllowed,
  leaveFrames,
  listable,
  liveRoomsFull,
  looksLab,
  pairsToAsk,
  rate,
  readLab,
  verdictOf,
  vouchTimerCloses,
} from './labDoor.mjs'

/**
 * The Lab table's door, asked rule by rule. The relay (server/ws-server.js) and the stub
 * (scripts/park-stub-relay.mjs) both import this file; scripts/relay-lab.test.mjs asks the
 * running relay the same questions through a socket, and scripts/lab-door-probe.mjs asks it
 * against a real local Supabase.
 *
 * The cast: Bo is already in. Ann and Cy are both Bo's friends and are not each other's.
 */

const FRIENDS = new Set(['ann|bo', 'bo|cy'])
const friends = (a, b) => FRIENDS.has([a, b].sort().join('|'))
const B22 = 'AbCdEfGhIjKlMnOpQrSt_-'

describe('which ids are Lab tables (2.6)', () => {
  it('lab: and exactly 22 base64url characters, and nothing else', () => {
    expect(B22).toHaveLength(22)
    expect(isLabId(`lab:${B22}`)).toBe(true)
    for (const bad of [
      `lab:${B22.slice(1)}`, // 21
      `lab:${B22}x`, // 23
      `lab:${B22.slice(1)}/`,
      `lab:${B22.slice(1)}.`,
      `lab:${B22.slice(1)} `,
      ` lab:${B22}`,
      `xlab:${B22}`,
      `lab:${B22}\n`,
      `LAB:${B22}`,
      `lab:`,
      'lab',
      null,
      42,
    ])
      expect(isLabId(bad), JSON.stringify(bad)).toBe(false)
  })

  it('a badly shaped lab: id is still a Lab id in intent, so it is refused rather than listed', () => {
    for (const id of ['lab:x', `lab:${B22}x`, 'lab:']) {
      expect(looksLab(id), id).toBe(true)
      expect(listable(id), id).toBe(false)
    }
    for (const id of ['default', 'park:abc', 'fight:abc', 'lab', 'labs:x', 'my lab:x']) {
      expect(looksLab(id), id).toBe(false)
      expect(listable(id), id).toBe(true)
    }
  })
})

describe('reading a lab frame (2.7)', () => {
  const here = ['bo', 'ann']

  it('measures the message in UTF-8 bytes: 4,096 passes and 4,097 is refused', () => {
    /* four bytes and two UTF-16 units each, so `.length` would call this half its weight */
    const heavy = '😀'.repeat(LAB.bytes / 4)
    expect(Buffer.byteLength(heavy)).toBe(LAB.bytes)
    expect(heavy.length).toBeLessThan(LAB.bytes)
    expect(readLab({ d: heavy }, here)).toEqual({ d: heavy, to: null })
    const over = heavy + 'a'
    expect(over.length).toBeLessThan(LAB.bytes)
    expect(readLab({ d: over }, here)).toBeNull()
    expect(readLab({ d: 'a'.repeat(LAB.bytes) }, here)).not.toBeNull()
    expect(readLab({ d: 'a'.repeat(LAB.bytes + 1) }, here)).toBeNull()
  })

  it('refuses a message that is not a non-empty string', () => {
    for (const d of [undefined, null, '', 7, { a: 1 }, ['x'], true])
      expect(readLab({ d }, here), JSON.stringify(d)).toBeNull()
    expect(readLab(null, here)).toBeNull()
    expect(readLab('d', here)).toBeNull()
  })

  it('a `to` must name somebody let into this room, or the whole frame is refused', () => {
    expect(readLab({ d: 'x', to: 'bo' }, here)).toEqual({ d: 'x', to: 'bo' })
    expect(readLab({ d: 'x', to: 'bo' }, new Set(here))).toEqual({ d: 'x', to: 'bo' })
    expect(readLab({ d: 'x', to: null }, here)).toEqual({ d: 'x', to: null })
    for (const to of ['cy', '', 'BO', 0, {}, ['bo']])
      expect(readLab({ d: 'x', to }, here), JSON.stringify(to)).toBeNull()
  })
})

describe('the windows (2.8)', () => {
  for (const [name, perSec] of [
    ['one socket', LAB.socketHz],
    ['one room', LAB.roomHz],
    ['every Lab room together', LAB.globalHz],
  ])
    it(`${name}: ${perSec} in a second pass, the next is dropped, and it recovers`, () => {
      let times = []
      const t0 = 1_000_000
      for (let i = 0; i < perSec; i++) {
        const w = rate(times, t0 + i, perSec)
        expect(w.ok, `message ${i + 1}`).toBe(true)
        times = [...w.times, t0 + i]
      }
      const over = rate(times, t0 + perSec, perSec)
      expect(over.ok).toBe(false)
      /* refused, so nothing was added: the caller pushes only what it sends */
      expect(over.times).toHaveLength(perSec)
      /* a second after the first one, it has left the window and one more fits */
      const later = rate(times, t0 + 1000, perSec)
      expect(later.ok).toBe(true)
      expect(later.times).toHaveLength(perSec - 1)
    })

  it('the limits are the plan’s: 50 a socket, 100 a room, 150 across the relay', () => {
    expect([LAB.socketHz, LAB.roomHz, LAB.globalHz]).toEqual([50, 100, 150])
  })
})

/**
 * A room with Bo in it, two arrivals, and a Supabase whose answers come back in an order this
 * test chooses: whenever any question is waiting, the one earliest in `order` is answered.
 */
async function arrive({ who, order, door = doorFor(), room = ['bo'] }) {
  const pending = []
  const log = []
  const ask = (me) => (u) =>
    new Promise((resolve) => {
      const key = `${me}-${u}`
      log.push(`ask ${key}`)
      pending.push({ key, answer: () => resolve(friends(me, u) ? 'yes' : 'no') })
    })
  const rank = (key) => {
    const i = order.findIndex((k) => k === key || k === key.split('-').reverse().join('-'))
    return i < 0 ? order.length : i
  }
  const results = {}
  let settled = 0
  for (const uid of who)
    void door
      .check({
        uid,
        /* a fresh list each time, as the relay builds one: a live array would let a stale read
           see the room change underneath it, and hide the very mistake under test */
        vouched: () => [...room],
        ask: ask(uid),
        counts: () => [room.length],
        enter: () => room.push(uid),
      })
      .then((v) => {
        results[uid] = v
        log.push(`verdict ${uid} ${v}`)
        settled++
      })
  for (let spins = 0; settled < who.length && spins < 1000; spins++) {
    await new Promise((r) => setTimeout(r, 0))
    if (!pending.length) continue
    pending.sort((a, b) => rank(a.key) - rank(b.key))
    pending.shift().answer()
  }
  return { results, log, room }
}

describe('the race (2.9): two strangers arriving together are never both let in', () => {
  const orders = [
    ['cy-bo', 'ann-bo', 'ann-cy'],
    ['ann-bo', 'cy-bo', 'ann-cy'],
    ['ann-cy', 'cy-bo', 'ann-bo'],
    ['cy-bo', 'ann-cy', 'ann-bo'],
  ]
  for (const who of [
    ['ann', 'cy'],
    ['cy', 'ann'],
  ])
    for (const order of orders)
      it(`arriving ${who.join(' then ')}, answered ${order.join(', ')}`, async () => {
        const { results, room } = await arrive({ who, order })
        const verdicts = Object.values(results).sort()
        expect(verdicts).toEqual(['admit', 'not-friends'])
        /* whoever got in is in the room, once, and the other is not */
        const inside = who.filter((u) => results[u] === 'admit')
        expect(room).toEqual(['bo', ...inside])
      })

  it('the chain: no question about the second arrival is asked before the first has its answer', async () => {
    const { log } = await arrive({ who: ['ann', 'cy'], order: ['cy-bo', 'ann-bo', 'ann-cy'] })
    const first = log.indexOf(log.find((l) => l.startsWith('verdict ann')))
    expect(first).toBeGreaterThan(-1)
    const early = log.slice(0, first).filter((l) => l.startsWith('ask cy-'))
    expect(early).toEqual([])
    /* and so Cy is asked about Ann directly, once, rather than discovering her afterwards */
    expect(log.filter((l) => l.startsWith('ask cy-'))).toEqual(['ask cy-bo', 'ask cy-ann'])
  })

  it('the re-read: somebody let in while my answers were on their way is asked about too', async () => {
    const room = ['bo']
    const asked = []
    const got = await friendsAt(
      'ann',
      () => [...room],
      async (u) => {
        asked.push(u)
        /* Cy is let in (by some other path) while Ann's question about Bo is on its way */
        if (u === 'bo') room.push('cy')
        await new Promise((r) => setTimeout(r, 0))
        return friends('ann', u) ? 'yes' : 'no'
      },
    )
    expect(asked).toEqual(['bo', 'cy'])
    expect(got).toBe('no')
  })
})

describe('the verdict (2.10)', () => {
  it('only a definite no from the friends question is not-friends', () => {
    expect(verdictOf({ token: 'yes', standing: 'yes', friends: 'yes' })).toBe('admit')
    expect(verdictOf({ token: 'yes', standing: 'yes', friends: 'no' })).toBe('not-friends')
    expect(verdictOf({ token: 'yes', standing: 'yes', friends: 'unsure' })).toBe('door-unavailable')
  })

  it('anything unsure is door-unavailable, at every question', () => {
    expect(verdictOf({ token: 'unsure' })).toBe('door-unavailable')
    expect(verdictOf({ token: 'yes', standing: 'unsure' })).toBe('door-unavailable')
    expect(verdictOf({ token: 'yes', standing: 'yes', friends: 'maybe' })).toBe('door-unavailable')
  })

  it('a refused token and a suspended account are both members-only, never "suspended"', () => {
    expect(verdictOf({ token: 'no' })).toBe('members-only')
    expect(verdictOf({ token: 'no', standing: 'yes', friends: 'yes' })).toBe('members-only')
    expect(verdictOf({ token: 'yes', standing: 'no' })).toBe('members-only')
    expect(verdictOf({ token: 'yes', standing: 'no', friends: 'unsure' })).toBe('members-only')
  })

  it('in order: an earlier no wins over a later one, and a question not yet asked is null', () => {
    expect(verdictOf({ token: 'unsure', standing: 'no', friends: 'no' })).toBe('door-unavailable')
    expect(verdictOf({ token: 'yes' })).toBeNull()
    expect(verdictOf({ token: 'yes', standing: 'yes' })).toBeNull()
    expect(verdictOf()).toBeNull()
  })

  it('a no from anybody present outweighs an unsure about anybody else, and the gone are ignored', () => {
    const a = new Map([
      ['bo', 'unsure'],
      ['cy', 'no'],
      ['dee', 'no'],
    ])
    expect(admitAfter('ann', ['bo', 'cy'], a)).toBe('no')
    expect(admitAfter('ann', ['bo'], a)).toBe('unsure')
    /* Dee said no and has left: that is no longer anybody's business */
    expect(admitAfter('ann', ['bo', 'bo'], new Map([...a, ['bo', 'yes']]))).toBe('yes')
    expect(admitAfter('ann', ['bo', 'eve'], a)).toBeNull()
    expect(admitAfter('ann', [], new Map())).toBe('yes')
  })

  it('a question that throws is unsure, never a no', async () => {
    const got = await friendsAt(
      'ann',
      () => ['bo'],
      () => Promise.reject(new TypeError('fetch failed')),
    )
    expect(got).toBe('unsure')
  })
})

describe('the silent-socket timer (2.11)', () => {
  it('closes a socket that never sent auth, and never one whose check is running or queued', () => {
    expect(vouchTimerCloses({ sentAuth: false, vouched: false })).toBe(true)
    expect(vouchTimerCloses({})).toBe(true)
    expect(vouchTimerCloses({ sentAuth: true, vouched: false })).toBe(false)
    expect(vouchTimerCloses({ sentAuth: true, vouched: true })).toBe(false)
  })

  it('the timer is 12 s and the door’s own deadline 40 s', () => {
    expect([LAB.vouchMs, LAB.doorMs]).toEqual([12_000, 40_000])
  })
})

describe('one person, two tabs (2.12)', () => {
  it('a joiner is never asked about themselves', () => {
    expect(pairsToAsk('ann', ['ann', 'bo', 'bo', 'ann'])).toEqual(['bo'])
    expect(pairsToAsk('ann', ['ann'])).toEqual([])
  })

  it('so the second tab is let in, with Supabase never asked whether Ann is her own friend', async () => {
    const room = ['ann']
    const asked = []
    const v = await doorFor().check({
      uid: 'ann',
      vouched: () => room,
      /* are_friends(me, me) is false — a friendship is a row between two accounts */
      ask: async (u) => (asked.push(u), u === 'ann' ? 'no' : 'yes'),
      counts: () => [room.length],
      enter: () => room.push('ann'),
    })
    expect(v).toBe('admit')
    expect(asked).toEqual([])
    expect(room).toEqual(['ann', 'ann'])
  })
})

describe('how many live rooms the relay holds (2.13)', () => {
  it('rooms nobody has been let into do not count, however many there are', () => {
    expect(liveRoomsFull(Array(20).fill(0), 0)).toBe(false)
    expect(liveRoomsFull([...Array(20).fill(0), 1, 2, 3, 1, 1], 0)).toBe(false)
  })

  it('a seventh live room is refused, and a room already live never is', () => {
    expect(LAB.rooms).toBe(6)
    const six = [1, 2, 8, 1, 1, 3]
    expect(liveRoomsFull([...six, 0, 0], 0)).toBe(true)
    expect(liveRoomsFull(six, 2)).toBe(false)
  })

  it('the door says lab-busy at the moment of letting somebody in, not before', async () => {
    const room = []
    const v = await doorFor().check({
      uid: 'ann',
      vouched: () => room,
      ask: async () => 'yes',
      counts: () => [1, 1, 1, 1, 1, 1, 0],
      enter: () => room.push('ann'),
    })
    expect(v).toBe('lab-busy')
    expect(room).toEqual([])
  })

  it('and lab-full when eight sockets are in already, before anybody is asked anything', async () => {
    const room = Array(LAB.vouched).fill('bo')
    let asked = 0
    const v = await doorFor().check({
      uid: 'ann',
      vouched: () => room,
      ask: async () => (asked++, 'yes'),
      counts: () => [room.length],
      enter: () => room.push('ann'),
    })
    expect(v).toBe('lab-full')
    expect(asked).toBe(0)
  })

  it('nobody is let in who left while being checked', async () => {
    const room = ['bo']
    let left = false
    const v = await doorFor().check({
      uid: 'ann',
      vouched: () => room,
      ask: async () => ((left = true), 'yes'),
      counts: () => [room.length],
      gone: () => left,
      enter: () => room.push('ann'),
    })
    expect(v).toBeNull()
    expect(room).toEqual(['bo'])
  })
})

describe('what a Lab room accepts and says (2.14)', () => {
  it('auth and lab, and nothing else', () => {
    expect(kindAllowed('auth')).toBe(true)
    expect(kindAllowed('lab')).toBe(true)
    for (const t of [
      'chat',
      'name',
      'preview',
      'tick',
      'claim',
      'settings',
      'restart',
      'look',
      'walk',
      'step',
      'stub-who',
      'hello',
      'list',
      undefined,
    ])
      expect(kindAllowed(t), String(t)).toBe(false)
  })

  it('an arrival hears its own id and nothing else; a leaving is told only if it was let in', () => {
    expect(helloFrames('s1')).toEqual([{ type: 'welcome', id: 's1' }])
    expect(leaveFrames('s1', true)).toEqual([{ type: 'lab-gone', from: 's1' }])
    expect(leaveFrames('s1', false)).toEqual([])
  })

  it('the door’s sentences, word for word', () => {
    expect(SAY).toEqual({
      'members-only': 'A Lab table is for friends on a call, signed in on the site.',
      'not-friends': 'Somebody at this table is not your friend on the site.',
      'door-unavailable': 'Could not check who is at this table just now.',
      'lab-full': 'This table already has eight people connected.',
      'lab-busy': 'The game server is full right now.',
      'bad-room': 'That is not a Lab table.',
    })
  })
})
