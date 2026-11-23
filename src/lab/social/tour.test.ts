import { describe, expect, it } from 'vitest'
import {
  followStep,
  ROOM_TOYS,
  sendsFor,
  peopleWords,
  placeWords,
  PLAY_HOLD_MS,
  settleMs,
  summaryOf,
  surprise,
  tourOf,
  whyWords,
  withWords,
  type Shadow,
} from './tour'
import type { Refusal } from './gate'

describe('who is on your toy, in words (withWords)', () => {
  it('says nothing about nobody', () => {
    expect(withWords([])).toBe('')
  })
  it('names one, two and three people in full', () => {
    expect(withWords(['Ann'])).toBe('with Ann')
    expect(withWords(['Ann', 'Bo'])).toBe('with Ann and Bo')
    expect(withWords(['Ann', 'Bo', 'Cy'])).toBe('with Ann, Bo and Cy')
  })
  it('past three, names two and counts the rest — and the count is the rest, not the total', () => {
    expect(withWords(['Ann', 'Bo', 'Cy', 'Dee'])).toBe('with Ann, Bo and 2 more')
    const twelve = Array.from({ length: 11 }, (_, i) => `P${i}`)
    expect(withWords(twelve)).toBe('with P0, P1 and 9 more')
    /* every name the sentence says plus the number it gives is everybody on the toy */
    for (let n = 4; n <= 11; n++) {
      const names = Array.from({ length: n }, (_, i) => `P${i}`)
      const said = withWords(names)
      const more = Number(/and (\d+) more$/.exec(said)?.[1])
      expect(2 + more).toBe(n)
    }
  })
})

/* every field something other than its default: a skin, somebody speaking, a toy, a page */
const roster = [
  { id: 'ann', name: 'Ann', speaking: true },
  { id: 'bo', name: 'Bo', speaking: false },
  { id: 'cy', name: 'Cy', speaking: false },
  { id: 'dee', name: 'Dee', speaking: false },
  { id: 'eve', name: 'Eve', speaking: false },
  { id: 'fay', name: 'Fay', speaking: false },
]
const here = {
  ann: { route: 'lab', sub: 'chess', skin: 'pen' as const },
  bo: { route: 'lab', sub: 'swarm' },
  cy: { route: 'lab', sub: 'secret-toy' },
  dee: { route: 'lab' },
  eve: { route: 'paint', skin: 'star' as const },
  /* fay says nothing */
  ghost: { route: 'lab', sub: 'chess' },
}
const listed = new Set(['chess', 'swarm', 'fourrow'])
const asked = {
  inCall: true,
  onLabPage: true,
  sharing: true,
  verdict: { allowed: true } as const,
  me: 'me',
  roster,
  here,
  myToy: 'swarm',
  openable: (t: string) => listed.has(t),
}
const touring = (over: Partial<Parameters<typeof tourOf>[0]> = {}) => {
  const t = tourOf({ ...asked, ...over })
  if (!t || t.why !== null) throw new Error(`not touring: ${JSON.stringify(t)}`)
  return t
}

describe('the tour (tourOf)', () => {
  it('draws everybody on the call in the call’s order, each in their place', () => {
    const t = touring()
    expect(t.me).toBe('me')
    expect(t.people.map((p) => [p.id, p.place])).toEqual([
      ['ann', { at: 'toy', toy: 'chess' }],
      ['bo', { at: 'with' }],
      ['cy', { at: 'other-toy' }],
      ['dee', { at: 'lab' }],
      ['eve', { at: 'away' }],
      ['fay', { at: 'quiet' }],
    ])
  })
  it('carries each person’s skin and whether they are talking', () => {
    const t = touring()
    expect(t.people[0]).toEqual({
      id: 'ann',
      name: 'Ann',
      skin: 'pen',
      speaking: true,
      place: { at: 'toy', toy: 'chess' },
    })
    expect(t.people[4].skin).toBe('star')
    expect(t.people[1].skin).toBeUndefined()
  })
  it('never draws somebody the call does not have, however recently they said where they were', () => {
    expect(touring().people.some((p) => p.id === 'ghost')).toBe(false)
  })
  it('the order is the roster’s whatever the places are', () => {
    const moved = { ...here, ann: { route: 'paint' }, bo: { route: 'lab', sub: 'chess' } }
    expect(touring({ here: moved }).people.map((p) => p.id)).toEqual(roster.map((p) => p.id))
  })
  it('a toy your Lab does not list is never offered as a place to go', () => {
    expect(touring({ openable: () => false }).people[0].place).toEqual({ at: 'other-toy' })
  })
  it('does not draw you twice when the call lists your own id (two tabs of one account)', () => {
    const t = touring({ roster: [...roster, { id: 'me', name: 'Me', speaking: false }] })
    expect(t.people.some((p) => p.id === 'me')).toBe(false)
  })
  it('a name is cut to 40 characters', () => {
    const long = '🦊'.repeat(10) + 'x'.repeat(50)
    const t = touring({ roster: [{ id: 'ann', name: long, speaking: false }] })
    expect(t.people[0].name).toBe(long.slice(0, 40))
  })
})

describe('when the tour may not show places', () => {
  it('nothing at all off the Lab page or out of a call', () => {
    expect(tourOf({ ...asked, onLabPage: false })).toBeNull()
    expect(tourOf({ ...asked, inCall: false })).toBeNull()
    expect(tourOf({ ...asked, verdict: { allowed: false, why: 'no-call' } })).toBeNull()
  })
  it('a shut gate gives its reason and the call’s names, and no places', () => {
    const t = tourOf({ ...asked, verdict: { allowed: false, why: 'stranger' } })
    expect(t).toEqual({ why: 'stranger', names: ['Ann', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay'] })
  })
  it('the gate comes before sharing: sharing would not open a shut gate', () => {
    const t = tourOf({ ...asked, sharing: false, verdict: { allowed: false, why: 'lounge' } })
    expect(t?.why).toBe('lounge')
  })
  it('not sharing gives names and no places, even with a stale place in hand', () => {
    const t = tourOf({ ...asked, sharing: false })
    expect(t).toEqual({ why: 'not-sharing', names: ['Ann', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay'] })
  })
})

describe('the sentences', () => {
  const refusals: Refusal[] = ['lounge', 'stranger', 'room-unknown', 'friends-unknown', 'alone']
  it('every refusal has its own sentence', () => {
    const said = refusals.map((r) => whyWords(r, ['Ann', 'Bo']))
    for (const s of said) expect(s.length).toBeGreaterThan(10)
    expect(new Set(said).size).toBe(refusals.length)
  })
  it('the stranger sentence names nobody', () => {
    const s = whyWords('stranger', ['Ann', 'Bo', 'Zed'])
    for (const n of ['Ann', 'Bo', 'Zed']) expect(s).not.toContain(n)
  })
  it('not sharing names who is waiting and what pressing the switch shares', () => {
    expect(whyWords('not-sharing', ['Ann'])).toMatch(/^Ann is in the call\. Press 🫱/)
    const s = whyWords('not-sharing', ['Ann', 'Bo'])
    expect(s).toMatch(/^Ann and Bo are in the call\./)
    expect(s).toContain("your pointer, the page you're on and anything you open")
    expect(s).toContain('until the call ends')
  })
  it('names the whole call as the audience, not just the friends here now', () => {
    /* the switch is the call's: the pointer and page go to everyone on it, and to anyone who
       joins later — "share with them" about the people named would describe a smaller audience */
    const s = whyWords('not-sharing', ['Ann', 'Bo'])
    expect(s).toContain('everyone on the call, including anyone who joins later')
    expect(s).not.toMatch(/share with them/)
    /* and the toy only while everyone present is a friend (gate.ts) */
    expect(s).toContain('while everyone here is your friend')
  })
  it('a long call is two names and a count, and the count is the rest', () => {
    expect(peopleWords(['A', 'B', 'C', 'D'])).toBe('A, B, C and D')
    expect(peopleWords(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 others')
  })
  it('each place has its words, and only a listed toy is named', () => {
    const name = (t: string) => (t === 'chess' ? 'Chess' : t)
    expect(touring().people.map((p) => placeWords(p.place, name))).toEqual([
      'on Chess',
      'with you',
      "on a toy that isn't in your Lab",
      'in the Lab',
      'elsewhere on the site',
      'not showing where they are',
    ])
  })
})

describe('the phone’s one line (summaryOf)', () => {
  const name = (t: string) => (t === 'chess' ? 'Chess' : t)
  it('says where everybody who is saying anything is, in the roster’s order', () => {
    expect(summaryOf(touring().people, name)).toBe(
      'Ann on Chess · Bo with you · Cy on another toy · Dee in the Lab · Eve elsewhere',
    )
  })
  it('says that nobody is sharing rather than going blank', () => {
    const quiet: Shadow[] = [{ id: 'a', name: 'Ann', speaking: false, place: { at: 'quiet' } }]
    expect(summaryOf(quiet, name)).toBe('Nobody else is showing where they are')
    expect(summaryOf([], name)).toBe('')
  })
})

describe('following somebody (followStep)', () => {
  /* every field away from its default: a call of four, a leader who moved 5 s ago to a toy you
     can open, you on another, nothing held, played long ago */
  const listedToys = new Set(['life', 'swarm', 'paint'])
  const base = {
    onRoster: true,
    gateOpen: true,
    sharing: true,
    leader: { route: 'lab', sub: 'life' } as { route: string; sub?: string } | undefined,
    myToy: 'swarm' as string | null,
    openable: (t: string) => listedToys.has(t),
    hidden: false,
    seated: false,
    inMatch: false,
    first: false,
    since: 10_000,
    now: 15_000,
    people: 4,
    lastPlay: -1_000_000,
    offered: null as string | null,
  }
  const step = (over: Partial<typeof base> = {}) => followStep({ ...base, ...over })

  it('goes where the leader is once their toy has settled', () => {
    expect(step()).toEqual({ do: 'go', toy: 'life' })
  })
  it('stops when the leader leaves the call, your gate shuts, or you stop sharing', () => {
    expect(step({ onRoster: false })).toEqual({ do: 'stop', why: 'left' })
    expect(step({ gateOpen: false })).toEqual({ do: 'stop', why: 'gate' })
    expect(step({ sharing: false })).toEqual({ do: 'stop', why: 'sharing' })
  })
  it('a leader who goes quiet is waited for, not let go: a hidden tab sends `gone`', () => {
    expect(step({ leader: undefined })).toEqual({ do: 'wait', why: 'quiet' })
  })
  it('waits while there is nowhere to go', () => {
    expect(step({ leader: { route: 'paint' } })).toEqual({ do: 'wait', why: 'away' })
    expect(step({ leader: { route: 'lab' } })).toEqual({ do: 'wait', why: 'unsaid' })
    expect(step({ myToy: 'life' })).toEqual({ do: 'wait', why: 'with' })
    expect(step({ leader: { route: 'lab', sub: 'hidden-toy' } })).toEqual({
      do: 'wait',
      why: 'unopenable',
    })
    expect(step({ hidden: true })).toEqual({ do: 'wait', why: 'hidden' })
  })
  it('never moves you out of a seat or a match, even on the press itself', () => {
    expect(step({ seated: true })).toEqual({ do: 'offer', toy: 'life', why: 'seat' })
    expect(step({ seated: true, first: true })).toEqual({ do: 'offer', toy: 'life', why: 'seat' })
    expect(step({ inMatch: true, first: true })).toEqual({
      do: 'offer',
      toy: 'life',
      why: 'match',
    })
  })
  it('a call-table toy settles four times as long: a move there costs four sends', () => {
    const room = { route: 'lab', sub: 'fourrow' }
    const openAll = () => true
    const settle = settleMs(4, 4)
    expect(settle).toBe(6400)
    expect(step({ leader: room, openable: openAll, now: base.since + settle - 1 })).toEqual({
      do: 'wait',
      why: 'settling',
      at: base.since + settle,
    })
    expect(step({ leader: room, openable: openAll, now: base.since + settle })).toEqual({
      do: 'go',
      toy: 'fourrow',
    })
  })
  it('waits for the leader’s toy to settle, and the press itself does not', () => {
    const settle = settleMs(4)
    expect(step({ now: base.since + settle - 1 })).toEqual({
      do: 'wait',
      why: 'settling',
      at: base.since + settle,
    })
    expect(step({ now: base.since + settle })).toEqual({ do: 'go', toy: 'life' })
    expect(step({ now: base.since + 1, first: true })).toEqual({ do: 'go', toy: 'life' })
  })
  it('somebody who was just playing gets an offer, not a jump; the press itself is a choice', () => {
    expect(step({ lastPlay: base.now - (PLAY_HOLD_MS - 100) })).toEqual({
      do: 'offer',
      toy: 'life',
      why: 'playing',
    })
    expect(step({ lastPlay: base.now - (PLAY_HOLD_MS + 100) })).toEqual({ do: 'go', toy: 'life' })
    expect(step({ lastPlay: base.now - 10, first: true })).toEqual({ do: 'go', toy: 'life' })
  })
  it('an offer is made once per leader move: that toy is never moved to later, and its Go stays', () => {
    /* the seat frees, or the 15 s pass: still an offer, never a move, and still a choice */
    expect(step({ offered: 'life' })).toEqual({ do: 'offer', toy: 'life', why: 'offered' })
    /* the leader's next move is judged afresh */
    expect(step({ offered: 'paint' })).toEqual({ do: 'go', toy: 'life' })
  })
  it('a leader hopping through five toys moves a follower once, to the last', () => {
    const hops = ['paint', 'life', 'paint', 'swarm', 'life']
    let mine = 'swarm'
    const moves: string[] = []
    let since = 0
    for (let t = 0; t <= 4000; t += 50) {
      const at = Math.floor(t / 200)
      const sub = hops[Math.min(at, hops.length - 1)]
      if (t % 200 === 0 && at < hops.length) since = t
      const s = followStep({ ...base, leader: { route: 'lab', sub }, myToy: mine, since, now: t })
      if (s.do === 'go') {
        moves.push(s.toy)
        mine = s.toy
      }
    }
    expect(moves).toEqual(['life'])
  })
})

describe('what Follow costs (settleMs)', () => {
  /**
   * Written from the counting rule, not the formula: a follow move onto a toy costs sendsFor(toy)
   * sends — one `where`, and on a call-table toy the room's handshake too — and Realtime meters each
   * as one message per person on the call. A leader hopping on eleven periods from 1 ms to 10 s, for
   * a minute, between plain toys, between call-table toys, and between one of each, against every
   * call size up to the cap of twelve: no follower may cost more than 2.5 messages a second.
   */
  it('no follower costs more than 2.5 messages a second, whatever the call, the toy or the leader', () => {
    let worst = 0
    for (const toys of [
      ['swarm', 'life'],
      ['fourrow', 'chess'],
      ['swarm', 'fourrow'],
    ]) {
      for (let people = 2; people <= 12; people++) {
        for (const period of [1, 50, 400, 999, 1000, 1001, 1200, 2000, 2401, 4801, 10_000]) {
          let mine = 'z'
          let sent = 0
          let since = 0
          let sub = toys[0]
          for (let t = 0; t <= 60_000; t += 1) {
            if (t > 0 && t % period === 0) {
              sub = sub === toys[0] ? toys[1] : toys[0]
              since = t
            }
            const s = followStep({
              onRoster: true,
              gateOpen: true,
              sharing: true,
              leader: { route: 'lab', sub },
              myToy: mine,
              openable: () => true,
              hidden: false,
              seated: false,
              inMatch: false,
              first: false,
              since,
              now: t,
              people,
              lastPlay: -Infinity,
              offered: null,
            })
            if (s.do === 'go') {
              sent += sendsFor(s.toy)
              mine = s.toy
            }
          }
          worst = Math.max(worst, (sent * people) / 60)
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(2.5)
    /* and the sweep reached the expensive case, rather than a period nothing could follow */
    expect(worst).toBeGreaterThan(2)
  })
  it('a call-table toy costs four sends a move and a plain one costs one', () => {
    expect(sendsFor('fourrow')).toBe(4)
    expect(sendsFor('swarm')).toBe(1)
    expect(sendsFor(undefined)).toBe(1)
  })
})

describe('the call-table toys (ROOM_TOYS) are the ones whose source opens a room', () => {
  /* read, not trusted: every toy module's source, and the Lab's registry that names them */
  const sources = import.meta.glob('../../gpu/*Demo.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  const registry = import.meta.glob('../../sections/labDemos.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  it('matches the toys that call useLabRoom, no more and no fewer', () => {
    const reg = Object.values(registry)[0]
    /* import { FourRowDemo } from '../gpu/FourRowDemo' … { id: 'fourrow', … Demo: FourRowDemo } */
    const fileOf = new Map<string, string>()
    for (const m of reg.matchAll(/import \{ (\w+) \} from '\.\.\/gpu\/(\w+)'/g))
      fileOf.set(m[1], m[2])
    const idOf = new Map<string, string>()
    for (const m of reg.matchAll(/id: '([a-z0-9-]+)',[\s\S]*?Demo: (\w+),/g)) idOf.set(m[2], m[1])
    const withRoom = new Set<string>()
    for (const [path, src] of Object.entries(sources)) {
      if (!src.includes('useLabRoom(')) continue
      const file = path.split('/').pop()!.replace('.tsx', '')
      const demo = [...fileOf].find(([, f]) => f === file)?.[0]
      const id = demo && idOf.get(demo)
      expect(id, `${file} opens a room but the registry does not name it`).toBeTruthy()
      withRoom.add(id!)
    }
    expect(withRoom.size).toBe(22)
    expect([...ROOM_TOYS].sort()).toEqual([...withRoom].sort())
  })
})

describe('two people following each other (a crossing)', () => {
  /**
   * Ann and Bo press Follow on each other at the same moment. Without the tie-break each moves to
   * the other's toy, sees the other on the toy they just left, and moves back — for ever, at the
   * settle's pace. With it, only the one whose id sorts first goes, and they meet.
   */
  it('meets on one toy within a few settles, rather than swapping for ever', () => {
    /* each sees the other's toy as it was LAG ms ago: the call's latency, which is what lets two
       presses cross in the first place */
    const LAG = 150
    const run = (tieBreak: boolean) => {
      const moves: Record<string, { t: number; toy: string }[]> = {
        ann: [{ t: -Infinity, toy: 'swarm' }],
        bo: [{ t: -Infinity, toy: 'life' }],
      }
      const at = (who: string, t: number) => moves[who].filter((m) => m.t <= t).pop()!.toy
      const left: Record<string, { toy: string; at: number } | null> = { ann: null, bo: null }
      const since: Record<string, number> = { ann: 0, bo: 0 }
      const seen: Record<string, string> = { ann: 'life', bo: 'swarm' }
      const first: Record<string, boolean> = { ann: true, bo: true }
      let swaps = 0
      for (let t = 0; t <= 30_000; t += 10) {
        for (const [who, other] of [
          ['ann', 'bo'],
          ['bo', 'ann'],
        ]) {
          const leaderSub = at(other, t - LAG)
          if (leaderSub !== seen[who]) {
            seen[who] = leaderSub
            since[who] = t
          }
          const mine = at(who, t)
          const s = followStep({
            onRoster: true,
            gateOpen: true,
            sharing: true,
            leader: { route: 'lab', sub: leaderSub },
            myToy: mine,
            openable: () => true,
            hidden: false,
            seated: false,
            inMatch: false,
            first: first[who],
            since: since[who],
            now: t,
            people: 2,
            lastPlay: -Infinity,
            offered: null,
            ...(tieBreak ? { left: left[who], goesFirst: who === 'ann' } : {}),
          })
          first[who] = false
          if (s.do === 'go') {
            left[who] = { toy: mine, at: t }
            moves[who].push({ t, toy: s.toy })
            swaps++
          }
        }
      }
      return { met: at('ann', 30_000) === at('bo', 30_000), swaps }
    }
    const fixed = run(true)
    expect(fixed.met).toBe(true)
    expect(fixed.swaps).toBeLessThanOrEqual(3)
    /* and without it they swap the whole time: the test is about the tie-break, not about luck */
    const broken = run(false)
    expect(broken.swaps).toBeGreaterThan(10)
  })
})

describe('🎲 Surprise us (surprise)', () => {
  const ids = ['chess', 'reversi', 'swarm', 'life', 'paint']
  const kind: Record<string, string> = {
    chess: 'board',
    reversi: 'board',
    swarm: 'patterns',
    life: 'patterns',
    paint: 'make',
  }
  const kindOf = (id: string) => kind[id]
  /* a seeded generator, so a thousand rolls are the same thousand every run */
  const seeded = (seed: number) => () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    return seed / 2_147_483_648
  }
  it('never lands on the toy you are on', () => {
    const r = seeded(7)
    for (let i = 0; i < 1000; i++)
      expect(surprise(ids, 'chess', kindOf, 'all', r)).not.toBe('chess')
  })
  it('reaches every other toy', () => {
    const r = seeded(11)
    const seen = new Set<string | null>()
    for (let i = 0; i < 1000; i++) seen.add(surprise(ids, 'chess', kindOf, 'all', r))
    expect([...seen].sort()).toEqual(['life', 'paint', 'reversi', 'swarm'])
  })
  it('keeps to the kind brought forward', () => {
    const r = seeded(3)
    for (let i = 0; i < 200; i++)
      expect(['swarm', 'life']).toContain(surprise(ids, 'paint', kindOf, 'patterns', r))
    /* on a toy of that kind, the other one of it */
    for (let i = 0; i < 50; i++) expect(surprise(ids, 'swarm', kindOf, 'patterns', r)).toBe('life')
  })
  it('falls back to every toy when the kind has nothing else', () => {
    const r = seeded(5)
    for (let i = 0; i < 100; i++) {
      const got = surprise(ids, 'paint', kindOf, 'make', r)
      expect(got).not.toBe('paint')
      expect(ids).toContain(got)
    }
  })
  it('nowhere else to go is nothing, and a roll of exactly 1 stays in the list', () => {
    expect(surprise(['chess'], 'chess', kindOf, 'all', Math.random)).toBeNull()
    expect(surprise(ids, 'chess', kindOf, 'all', () => 1)).toBe('paint')
    expect(surprise(ids, 'chess', kindOf, 'all', () => 0)).toBe('reversi')
  })
})
