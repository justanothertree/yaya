import { describe, expect, it } from 'vitest'
import { fourRowRules, type FourGame } from '../../gpu/fourrowRoom'
import {
  HOLD_MS,
  act,
  hostOf,
  openRoom,
  present,
  receive,
  type Action,
  type Room,
  type Wire,
} from './room'
// the file's own bytes, through Vite's ?raw, as src tests read files (names.test.ts, bests.test.ts)
import recorded from './__fixtures__/fourrow-wire.json?raw'

/**
 * Every message a Four in a row game in a call puts on the wire, pinned byte for byte.
 *
 * ⚠️ A RECORDING, NOT A RULE, AND IT WAS TAKEN BEFORE THE CHANGE IT GUARDS. room.ts is about to
 * be asked "who hosts" through `lowest(me, present)`, so that a four-chair table can ask the same
 * question without copying it (docs/2026-11-23-lab-live-tables.md, step 1). Who hosts decides who
 * answers a hello, who decides a request, who announces themselves on becoming host and who frees
 * a seat — so a wrong answer changes WHICH messages go out and from whom, not just what one
 * function returns. `__fixtures__/fourrow-wire.json` was written from `play()` below on 8b4d87ea,
 * with room.ts as it was before `lowest` existed, and every change to room.ts since has had to
 * leave it byte for byte the same. A deliberate change to the wire re-records it, in a commit that
 * says why: what is pinned here is what every friend's open tab already speaks.
 *
 * The game is real (fourrow.ts's rules, the classic board the toy opens on) and so are the ids'
 * shape and order: Bo …0001, Ann …0002 and Cy …0003, as the dev call's tabs. Ann and Cy join and
 * sit; three moves; Bo, with the lowest id, arrives to watch and becomes host mid-game; three more
 * moves, decided by Bo; Bo leaves and Ann is host again; Bo comes back; Cy leaves, nothing is sent
 * for a minute, and then Bo frees Cy's seat.
 *
 * ⚠️ BO COMES BACK BECAUSE HIS FIRST ARRIVAL CANNOT TELL answersHello's TWO HALVES APART. When he
 * first arrives, Ann was host before him AND published the room everybody holds, so a hello rule
 * that forgot to leave the newcomer out still had Ann answer, and this file stayed green under it
 * (measured, 26 Nov 2026; room.test.ts caught it). When he comes back, Ann hosts a room that Bo
 * himself published, so only the host-before half has her answer him.
 *
 * Each line of the fixture is one message as it was queued — the step, the sender and the body
 * exactly as `sendParty('lab', body)` is handed it — or a step's heading with who each tab
 * believes is host once the step is done. One message to a line, so a change shows as the lines
 * that changed. The file is in .prettierignore: a formatter re-flowing it would make the bytes
 * compared here the formatter's rather than the wire's.
 *
 * The network is room.test.ts's (whole states, delivered to everyone but the sender until the
 * wire is quiet), copied rather than shared because that file is pinned unchanged by the same step.
 */

const BO = '00000000-0000-0000-0000-000000000001'
const ANN = '00000000-0000-0000-0000-000000000002'
const CY = '00000000-0000-0000-0000-000000000003'
const NAME: Record<string, string> = { [BO]: 'Bo', [ANN]: 'Ann', [CY]: 'Cy' }

const rules = fourRowRules('classic', 4)
type Row =
  | { step: string; hosts: Record<string, string> }
  | { step: string; from: string; body: Wire }

/** the whole game, as the rows of the fixture */
function play(): Row[] {
  const rooms = new Map<string, Room<FourGame>>()
  const wire: { from: string; body: Wire }[] = []
  const rows: Row[] = []
  let step = ''
  let now = 0
  const send = (from: string, out: Wire[]) => {
    for (const body of out) {
      wire.push({ from, body })
      rows.push({ step, from: NAME[from], body })
    }
  }
  const take = (id: string, s: { room: Room<FourGame>; out: Wire[] }) => {
    rooms.set(id, s.room)
    send(id, s.out)
  }
  /** `id`'s toy mounts: its room opens, says hello and sees who is here */
  const opens = (id: string, here: string[]) => {
    take(id, openRoom(rules, 'fourrow', id))
    take(id, present(rules, rooms.get(id)!, here, now))
  }
  /** every open toy in `ids` hears that `here` are on it (where.ts's roster, every 5 s) */
  const see = (ids: string[], here: string[]) => {
    for (const id of ids) take(id, present(rules, rooms.get(id)!, here, now))
  }
  /** deliver everything queued to every open toy in `alive` but its sender, until it is quiet */
  const flush = (alive: string[]) => {
    for (let guard = 0; wire.length && guard < 1000; guard++) {
      const { from, body } = wire.shift()!
      for (const id of alive) if (id !== from) take(id, receive(rules, rooms.get(id)!, from, body))
    }
  }
  const does = (id: string, a: Action<number>, alive: string[]) => {
    take(id, act(rules, rooms.get(id)!, a))
    flush(alive)
  }
  const stepped = (name: string, run: () => void) => {
    step = name
    run()
    const hosts: Record<string, string> = {}
    for (const [id, room] of rooms) hosts[NAME[id]] = NAME[hostOf(room)]
    rows.push({ step, hosts })
  }

  const two = [ANN, CY]
  const three = [BO, ANN, CY]
  stepped('Ann opens Four in a row', () => {
    opens(ANN, [ANN])
    flush([ANN])
  })
  stepped('Cy joins: where lands, then the toy opens', () => {
    see([ANN], two)
    opens(CY, two)
    flush(two)
  })
  stepped('Ann sits, then Cy asks to', () => {
    does(ANN, { t: 'sit', seat: 0 }, two)
    does(CY, { t: 'sit', seat: 1 }, two)
  })
  stepped('moves 1-3, Ann deciding', () => {
    does(ANN, { t: 'move', move: 3 }, two)
    does(CY, { t: 'move', move: 3 }, two)
    does(ANN, { t: 'move', move: 4 }, two)
  })
  stepped('Bo, the lowest id, arrives to watch: where lands, then the toy opens', () => {
    see(two, three)
    flush(two)
    opens(BO, three)
    flush(three)
  })
  stepped('moves 4-6, Bo deciding', () => {
    does(CY, { t: 'move', move: 4 }, three)
    does(ANN, { t: 'move', move: 2 }, three)
    does(CY, { t: 'move', move: 2 }, three)
  })
  stepped('Bo leaves: Ann is host again', () => {
    rooms.delete(BO)
    see(two, two)
    flush(two)
  })
  stepped('Bo comes back, to a room he published: Ann, host before him, hands it to him', () => {
    see(two, three)
    flush(two)
    opens(BO, three)
    flush(three)
  })
  const stay = [BO, ANN]
  stepped('Cy leaves: nothing for a minute, then Bo frees the seat', () => {
    rooms.delete(CY)
    for (const ms of [1000, 1000 + HOLD_MS - 1, 1000 + HOLD_MS]) {
      now = ms
      see(stay, stay)
      flush(stay)
    }
  })
  return rows
}

/** one row to a line, so a changed message is a changed line */
const render = (rows: Row[]) => `[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n]\n`

describe('the wire of a Four in a row game in a call', () => {
  it('is byte for byte the recording taken before room.ts asked lowest()', () => {
    const want = recorded
    const got = render(play())
    // line by line first, so a failure names the messages that changed rather than one long string
    expect(got.split('\n')).toEqual(want.split('\n'))
    expect(got).toBe(want)
  })
  it('is the game it says it is: six moves landed, the host changed hands, and a seat was freed', () => {
    /* read from the recording, not from room.ts: a fixture that pinned a game where nothing
       happened would pass this file forever */
    const rows = JSON.parse(recorded) as Row[]
    /* each seq as first published: a repeat (a hello answered, a new host announcing itself) and
       a newcomer's own empty room at seq 0 say nothing new */
    const bySeq = new Map<number, { from: string; seats: unknown; moves: number }>()
    for (const r of rows)
      if ('body' in r && r.body.t === 'state' && !bySeq.has(r.body.seq))
        bySeq.set(r.body.seq, {
          from: r.from,
          seats: r.body.seats,
          moves: (r.body.game as { moves: number }).moves,
        })
    const states = [...bySeq.entries()].sort(([a], [b]) => a - b).map(([, s]) => s)
    expect(states.at(-1)).toMatchObject({ moves: 6, seats: [ANN, null], from: 'Bo' })
    // the six moves, each decided by whoever hosted when it was made
    const moved = states.filter((s, i) => i > 0 && s.moves === states[i - 1].moves + 1)
    expect(moved.map((s) => s.from)).toEqual(['Ann', 'Ann', 'Ann', 'Bo', 'Bo', 'Bo'])
    const hosts = rows.flatMap((r) => ('hosts' in r ? [r.hosts] : []))
    expect(hosts.map((h) => h.Ann).join(' ')).toBe('Ann Ann Ann Ann Bo Bo Ann Bo Bo')
    // Bo was handed the room he came back to, by Ann, rather than leading from an empty board
    const handed = (r: Row) =>
      r.step.startsWith('Bo comes back') && 'body' in r && r.from === 'Ann' && r.body.t === 'state'
    expect(rows.some(handed)).toBe(true)
    // every tab agrees on the host at the end of every step
    for (const h of hosts) expect(new Set(Object.values(h)).size).toBe(1)
  })
})
