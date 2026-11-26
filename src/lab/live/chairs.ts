/**
 * A live table on the call: four chairs (or two) for a game friends play together in real time,
 * with a captain who sets it up and starts each round (docs/2026-11-23-lab-live-tables.md).
 *
 * Built the way room.ts builds a call's two-seat room, and pure for the same reason: the table is
 * a value, and every input — somebody's message, who is here, who is on the call, the clock, a
 * button pressed here — returns the next table and the messages to send. chairs.test.ts plays
 * whole tables between several of these over an in-memory network, with people arriving, leaving
 * and coming back, messages repeated and arriving late, and two hosts for a moment. Nothing here
 * sends or draws anything: the call's `live` messages are step 6's to wire.
 *
 * The call carries only who sits where and the round. Play itself goes over the relay, in the
 * friends-only Lab room `code` names, and a seated friend's browser referees it (step 5).
 *
 *
 * THREE ROLES, NEVER ONE ELECTION
 *
 * The HOST writes the table: the lowest id on the toy, seated or not — `lowest` from room.ts, so
 * the two kinds of table can never pick different hosts from the same people. Everybody else asks
 * (`sit`, `stand`, …) and the host answers with `state`, the whole table. A host may be watching:
 * it only writes chairs and never plays. `newer` and `answersHello` are room.ts's too, imported
 * rather than copied.
 *
 * The CAPTAIN sets the table — mode, options, computers, who sits where — and starts each round.
 * Derived, never elected: of the seated people here, whoever sat earliest. That is Evan's answer
 * of 26 Nov 2026 to who "the challenger" is at a live table — whoever sat down first, and if they
 * leave, the next person to sit takes over. So there is a captain whenever anybody is seated, and
 * a captain who goes is replaced the moment they are gone, with nobody voting on it.
 *
 * The REFEREE runs a round's play on the relay, and is step 5's.
 *
 *
 * ⚠️ `since` IS A SEQ, NOT A CLOCK. The captain is decided by who sat first, and the host who
 * seated somebody is not the host who will compare them: hosts change as people come and go, and
 * every tab's clock (`performance.now()`) starts at its own zero. A seq is the one counter every
 * host carries on from where the last left it, so "sat at state 7" means the same thing to all of
 * them. A ruling seats one person, so two people never share a `since`; were they ever to, the
 * lower id would win the tie.
 *
 * ⚠️ AT MOST ONE STATE A SECOND, AND ONLY CHANGES WAIT. A change made within PACE_MS of the last
 * state sent is held, and the next state carries every change since — whole state means the
 * latest is all anybody needs. Answering a hello and announcing the table to somebody who has
 * just arrived are not changes and never wait: a newcomer handed nothing is a newcomer who cannot
 * sit. That is the plan's own count of an arrival, two states (§3.6). The caller ticks `present`
 * at `dueAt` so a held change goes out on time.
 *
 * ⚠️ A MOVE NAMES WHO IS MOVED. `swap {a, b}` alone is undone by its own repeat and lands on the
 * wrong person when it arrives after the table has changed — Bo stands, Dee sits where he was, and
 * a late "swap 0 with 2" moves Dee. So the captain's swap carries `id`, the person they chose
 * ("Choose who to move", §1.2 step 7), and the host refuses it unless that person is still in
 * chair `a`. It is room.ts's `at` on a move, said about the one person the request is about.
 *
 *
 * THE CODE (§4 of the plan)
 *
 * `code` names the table's Lab room on the relay: 16 bytes from crypto.getRandomValues, 22
 * base64url characters, so it is never derived from anything and never guessed. It is a
 * capability: whoever has it can knock on the room (the relay's door then asks whether they are
 * friends with everybody inside). Live states go to everyone on the call, so everyone on the call
 * while a code is in use has it.
 *
 * - **Minted by the host on the first state it sends, as a state of its own.** A newcomer with the
 *   lowest id is host the moment they arrive and holds nothing yet, so the table it announces is a
 *   fresh one at seq 1. Were the first mint folded into the first sit, that fresh seq 1 would beat
 *   a real one from a higher id (newer's tie-break) and the sit would be lost. As its own state,
 *   the worst a fresh host can replace is another fresh table, and every tab ends with one code:
 *   the lower sender's (test 4.5).
 * - **Re-minted between rounds when anybody who heard it has left the call**, never mid-round, so a
 *   round is never cut off from its own room.
 * - ⚠️ `knew` IS EVERYONE WHO HAS HEARD THIS CODE, AS FAR AS THE HOST CAN TELL — NOT ONLY THOSE ON
 *   THE CALL WHEN IT WAS MINTED, which is what the plan wrote. Somebody who joined the call
 *   afterwards heard the code in the next state just the same, and the plan's rule would let them
 *   leave holding it. A state goes to the whole call, so whenever one carrying this code goes out —
 *   sent by the host, or heard by it from somebody else, which is how a newcomer with the lowest id
 *   is first handed the table — the host folds its call roster into `knew`, in a state of its own
 *   that goes out at once: bookkeeping, like a hello's answer, and lost if it waited and the
 *   newcomer left within the second. A newcomer with the lowest id, new to the call, costs that
 *   one state more than at a call table (4 sends, not 3).
 * - `knew` holds at most 16, which cannot hide a leaver: a call holds at most 12 people
 *   (voiceSession's CALL_HARD_LIMIT), so a full `knew` always names somebody who has left, and the
 *   next round re-mints.
 *
 *
 * WHO IS LISTENED TO
 *
 * Only somebody on my call (§3.1). ⚠️ BUT A CHAIR'S ID IS NOT CHECKED AGAINST MY ROSTER, which the
 * plan's §3.1 asked for. A seated friend who leaves the call keeps their chair for HOLD_MS, or to
 * the end of a round that is on, and the table is meant to say so (§1.2 step 13). A rule refusing
 * any state that names somebody off my call would refuse every state in exactly that window, and
 * freeze the table for everybody but its host — the round's end included. The host seats only
 * somebody who asked, on its own call; the check that matters is who is heard, and it stays.
 */

import { HOLD_MS, answersHello, lowest, newer, type Mode } from '../social/room'

export type Chair = { id: string | null; since: number; cpu: number | null } // cpu: a level index
export type Phase = 'open' | 'on' | 'over'
export const PHASES: readonly Phase[] = ['open', 'on', 'over']
/**
 * The round: `n` counts rounds started (0 before the first), and `starters` is who plays each
 * chair in round `n` — the people seated when it started, and anybody who has since taken a
 * computer's chair mid-round (`takeMidRound`)
 */
export type Round = { n: number; phase: Phase; starters: (string | null)[]; result: unknown | null }

export type Chairs<O> = {
  sub: string
  me: string
  seq: number
  /** who sent the state we hold — breaks a tie between two hosts' equal seqs */
  from: string
  /** everyone else on this toy, by id */
  present: string[]
  /** since when (ms, this tab's clock) each seated person has been missing from the toy */
  missing: Record<string, number>
  /** everyone else on the call, by id: who is listened to, and who has heard the code */
  roster: string[]
  /** length rules.n: 2 or 4 */
  chairs: Chair[]
  mode: Mode
  opts: O
  /** 22 base64url characters, or '' before the host's first state */
  code: string
  /** everyone who has heard this code, as far as the host can tell (for the re-mint, §4) */
  knew: string[]
  round: Round
  /** this tab's clock when it last sent a state, or null */
  sent: number | null
  /** a change made here and not yet sent, waiting for PACE_MS */
  owed: boolean
}

export type LiveRules<O> = {
  sub: string
  n: 2 | 4
  modes: readonly Mode[]
  /** the computer's levels, easiest first; null: this toy has no computer (Night crossing) */
  levels: readonly string[] | null
  readOpts: (x: unknown) => O | null
  fresh: O
  /** null, or the words for why not (§1.2 step 4) */
  canStart: (c: Chairs<O>) => string | null
  /** whether a watcher may take a computer's chair while a round is on (Spades) */
  takeMidRound: boolean
  /** a chair's own name: "Partner", "Pilot"… */
  label?: (chair: number, mine: number | null) => string
  /** a finished round's result off the wire, or null when it is malformed (§3.1) */
  readResult: (x: unknown) => unknown | null
  /**
   * Which side a chair plays on, when the toy's teams are not teamOf's: Spades' partnerships in
   * every mode, or Stackfall's people against its one computer together
   */
  team?: (c: Chairs<O>, chair: number) => number
}

/** a request: anyone may `sit` and `stand`; a starter reports `over`; the rest are the captain's */
export type Ask<O> =
  | { t: 'sit'; chair: number }
  | { t: 'stand' }
  | { t: 'cpu'; chair: number; level: number | null }
  /** `id` is who the captain chose to move, sitting in `a` */
  | { t: 'swap'; a: number; b: number; id: string }
  | { t: 'mode'; mode: Mode }
  | { t: 'opts'; o: O }
  | { t: 'start'; n: number }
  | { t: 'over'; n: number; result: unknown }

/** the table on the wire: a chair is [id, since, cpu] */
export type StateBody = {
  t: 'state'
  seq: number
  chairs: [string | null, number, number | null][]
  mode: Mode
  opts: unknown
  code: string
  knew: string[]
  round: { n: number; phase: Phase; starters: (string | null)[]; result: unknown }
}

/** what goes out, as the body of a party `live` message on the call (§3.1) */
export type Live = { v: 1; sub: string } & ({ t: 'hello' } | Ask<unknown> | StateBody)

export type Step<O> = { table: Chairs<O>; out: Live[] }

/** the fields of a state, as readChairs reads them off the wire */
export type Read<O> = Pick<
  Chairs<O>,
  'seq' | 'chairs' | 'mode' | 'opts' | 'code' | 'knew' | 'round'
>

/** the least time between two states that carry changes */
export const PACE_MS = 1000
export const CODE = /^[A-Za-z0-9_-]{22}$/
const MAX_SEQ = 1e9
const MAX_ROUND = 1e6
const MAX_KNEW = 16
const EMPTY: Chair = { id: null, since: 0, cpu: null }

/** a table's code from its 16 random bytes: base64url, unpadded */
export const codeFrom = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export function openChairs<O>(rules: LiveRules<O>, me: string): Step<O> {
  const table: Chairs<O> = {
    sub: rules.sub,
    me,
    seq: 0,
    from: me,
    present: [],
    missing: {},
    roster: [],
    chairs: Array.from({ length: rules.n }, () => EMPTY),
    mode: rules.modes[0],
    opts: rules.fresh,
    code: '',
    knew: [],
    round: {
      n: 0,
      phase: 'open',
      starters: Array<string | null>(rules.n).fill(null),
      result: null,
    },
    sent: null,
    owed: false,
  }
  return { table, out: [{ v: 1, sub: rules.sub, t: 'hello' }] }
}

/* ── who is who ────────────────────────────────────────────────────────────────────────────── */

export const hostOf = (c: Chairs<unknown>) => lowest(c.me, c.present)
export const isHost = (c: Chairs<unknown>) => hostOf(c) === c.me
const hereOf = (c: Chairs<unknown>) => new Set([c.me, ...c.present])

/** the chair somebody sits in, or null */
export const chairOf = (c: Chairs<unknown>, id = c.me): number | null => {
  const i = c.chairs.findIndex((ch) => ch.id === id)
  return i < 0 ? null : i
}

/** the people sitting, in chair order — computers are not people */
export const seatedHumans = (c: Chairs<unknown>): string[] =>
  c.chairs.flatMap((ch) => (ch.id === null ? [] : [ch.id]))

/**
 * Who sets the table: of the seated people here, the one who sat earliest, a tie going to the
 * lower id. `here` is who counts as here, everybody on the toy unless the caller says otherwise.
 */
export function captainOf(
  c: Chairs<unknown>,
  here: ReadonlySet<string> = hereOf(c),
): string | null {
  let best: { id: string; since: number } | null = null
  for (const ch of c.chairs) {
    if (ch.id === null || !here.has(ch.id)) continue
    if (!best || ch.since < best.since || (ch.since === best.since && ch.id < best.id))
      best = { id: ch.id, since: ch.since }
  }
  return best?.id ?? null
}

/** why a round cannot start yet, for the line under ▶ Start */
export type NotYet = { t: 'playing' } | { t: 'waiting'; id: string } | { t: 'toy'; words: string }

/**
 * Whether the captain may start a round: none on, every seated person here, and the toy's own
 * rule. The host asks it of who is on the toy; the table asks it of who is linked to the relay,
 * which is what "Waiting for Bo to connect…" is about.
 */
export function startable<O>(
  rules: LiveRules<O>,
  c: Chairs<O>,
  here: ReadonlySet<string> = hereOf(c),
): NotYet | null {
  if (c.round.phase === 'on') return { t: 'playing' }
  const gone = seatedHumans(c).find((id) => !here.has(id))
  if (gone !== undefined) return { t: 'waiting', id: gone }
  const words = rules.canStart(c)
  return words === null ? null : { t: 'toy', words }
}

/**
 * The side a chair plays on. Versus, every chair its own; together at four, the chairs across
 * from each other (0 and 2 against 1 and 3, as Light trails' teams); together at two, one side. A
 * toy whose teams differ says so in `rules.team`.
 */
export const teamOf = <O>(rules: LiveRules<O>, c: Chairs<O>, chair: number): number =>
  rules.team ? rules.team(c, chair) : c.mode === 'versus' ? chair : rules.n === 4 ? chair % 2 : 0

/** when a held change is due to go out, or null when nothing is held */
export const dueAt = (c: Chairs<unknown>): number | null =>
  c.owed && c.sent !== null ? c.sent + PACE_MS : null

/* ── what goes out ─────────────────────────────────────────────────────────────────────────── */

export const wireOf = <O>(c: Chairs<O>): Live => ({
  v: 1,
  sub: c.sub,
  t: 'state',
  seq: c.seq,
  chairs: c.chairs.map((ch) => [ch.id, ch.since, ch.cpu]),
  mode: c.mode,
  opts: c.opts,
  code: c.code,
  knew: [...c.knew],
  round: {
    n: c.round.n,
    phase: c.round.phase,
    starters: [...c.round.starters],
    result: c.round.result,
  },
})

const newCode = () => codeFrom(crypto.getRandomValues(new Uint8Array(16)))
/** a fresh code, known so far to everybody on the call */
const minted = <O>(c: Chairs<O>): Chairs<O> => ({
  ...c,
  code: newCode(),
  knew: [c.me, ...c.roster].slice(0, MAX_KNEW),
})
/** somebody who has heard this code has left the call */
const stale = (c: Chairs<unknown>) => c.knew.some((id) => id !== c.me && !c.roster.includes(id))
/** who is on the call now and not yet in `knew`, while there is room to say so */
const unheard = (c: Chairs<unknown>) =>
  c.knew.length >= MAX_KNEW ? [] : [c.me, ...c.roster].filter((id) => !c.knew.includes(id))
/** the host's state as it goes out: everybody on the call now has heard its code */
function heard<O>(c: Chairs<O>): Chairs<O> {
  const add = unheard(c)
  if (!add.length) return c
  return { ...c, knew: [...c.knew, ...add].slice(0, MAX_KNEW), seq: c.seq + 1, from: c.me }
}

/** the table goes out now, or — a change within PACE_MS of the last state — with the next one */
function send<O>(c: Chairs<O>, now: number, paced: boolean): Step<O> {
  if (paced && c.sent !== null && now - c.sent < PACE_MS)
    return { table: { ...c, owed: true }, out: [] }
  const told = isHost(c) ? heard(c) : c
  return { table: { ...told, sent: now, owed: false }, out: [wireOf(told)] }
}
const owing = <O>(c: Chairs<O>, now: number): Step<O> =>
  c.owed && c.sent !== null && now - c.sent >= PACE_MS ? send(c, now, false) : { table: c, out: [] }

/** the table as it stands, to somebody who needs it now: the host's (minted if new), or a copy */
function tell<O>(c: Chairs<O>, now: number): Step<O> {
  if (isHost(c)) return send(c.code ? c : { ...minted(c), seq: c.seq + 1, from: c.me }, now, false)
  return c.seq > 0 ? send(c, now, false) : { table: c, out: [] }
}

/** the host's change: the table one seq on (`seq` is the change's own, for `since`) */
function publish<O>(
  c: Chairs<O>,
  now: number,
  change: (seq: number) => Partial<Chairs<O>>,
): Step<O> {
  const base = c.code ? c : { ...minted(c), seq: c.seq + 1, from: c.me }
  const seq = base.seq + 1
  let next: Chairs<O> = { ...base, ...change(seq), seq, from: c.me }
  // between rounds, judged before this change: a round starts on a code nobody gone still holds
  if (c.code && c.round.phase !== 'on' && stale(next)) next = minted(next)
  return send(next, now, true)
}

/* ── the host deciding ─────────────────────────────────────────────────────────────────────── */

const put = (chairs: readonly Chair[], i: number, ch: Chair) =>
  chairs.map((x, j) => (j === i ? ch : x))

/** the host acting on a request — its own, or somebody else's */
function decide<O>(
  rules: LiveRules<O>,
  c: Chairs<O>,
  from: string,
  a: Ask<O>,
  now: number,
): Step<O> {
  const none = { table: c, out: [] }
  const on = c.round.phase === 'on'
  const mine = chairOf(c, from)
  const captain = captainOf(c) === from
  if (a.t === 'sit') {
    const ch = c.chairs[a.chair]
    if (mine !== null || ch.id !== null) return none
    // mid-round, only a computer's chair, and only where the toy lets a watcher take one over
    if (on && !(rules.takeMidRound && ch.cpu !== null)) return none
    return publish(c, now, (seq) => ({
      chairs: put(c.chairs, a.chair, { id: from, since: seq, cpu: null }),
      round: on
        ? { ...c.round, starters: c.round.starters.map((s, i) => (i === a.chair ? from : s)) }
        : c.round,
    }))
  }
  if (a.t === 'stand') {
    if (on || mine === null) return none
    return publish(c, now, () => ({ chairs: put(c.chairs, mine, EMPTY) }))
  }
  if (a.t === 'over') {
    // from somebody playing round n, while it is on: the first report ends it
    if (!on || a.n !== c.round.n || !c.round.starters.includes(from)) return none
    return publish(c, now, () => ({ round: { ...c.round, phase: 'over', result: a.result } }))
  }
  // everything else is the captain's
  if (!captain) return none
  if (a.t === 'start') {
    if (a.n !== c.round.n + 1 || startable(rules, c) !== null) return none
    const starters = c.chairs.map((ch) => ch.id)
    return publish(c, now, () => ({ round: { n: a.n, phase: 'on', starters, result: null } }))
  }
  // and between rounds
  if (on) return none
  if (a.t === 'cpu') {
    const ch = c.chairs[a.chair]
    const level = a.level
    if (ch.id !== null || ch.cpu === level) return none
    // a computer changing level keeps its place; one added sits down now
    return publish(c, now, (seq) => ({
      chairs: put(
        c.chairs,
        a.chair,
        level === null ? EMPTY : { id: null, since: ch.cpu === null ? seq : ch.since, cpu: level },
      ),
    }))
  }
  if (a.t === 'swap') {
    // the person the captain chose is still where the captain saw them: a repeat, or a swap
    // arriving after the table changed, is not this table's
    if (c.chairs[a.a].id !== a.id) return none
    const [x, y] = [c.chairs[a.a], c.chairs[a.b]]
    // each keeps their own `since`: being moved is not sitting down again
    return publish(c, now, () => ({ chairs: put(put(c.chairs, a.a, y), a.b, x) }))
  }
  if (a.t === 'mode') {
    if (a.mode === c.mode) return none
    return publish(c, now, () => ({ mode: a.mode }))
  }
  if (JSON.stringify(a.o) === JSON.stringify(c.opts)) return none
  return publish(c, now, () => ({ opts: a.o }))
}
/** something I did here: the host does it, anybody else asks the host */
export function act<O>(rules: LiveRules<O>, c: Chairs<O>, a: Ask<O>, now: number): Step<O> {
  const ok = readAsk(rules, a)
  if (!ok) return { table: c, out: [] }
  if (isHost(c)) return decide(rules, c, c.me, ok, now)
  return { table: c, out: [{ v: 1, sub: c.sub, ...ok }] }
}

/* ── off the wire ──────────────────────────────────────────────────────────────────────────── */

const isId = (x: unknown): x is string => typeof x === 'string' && x.length >= 1 && x.length <= 64
const isCount = (x: unknown, max: number): x is number =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max
const isChair = (rules: { n: number }, x: unknown): x is number =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) < rules.n
const isLevel = (rules: { levels: readonly string[] | null }, x: unknown): x is number =>
  rules.levels !== null &&
  Number.isInteger(x) &&
  (x as number) >= 0 &&
  (x as number) < rules.levels.length

/** a request off the wire, every field checked, or null */
function readAsk<O>(rules: LiveRules<O>, x: unknown): Ask<O> | null {
  const b = x as Partial<Record<string, unknown>> | null
  if (!b || typeof b !== 'object') return null
  if (b.t === 'sit') return isChair(rules, b.chair) ? { t: 'sit', chair: b.chair } : null
  if (b.t === 'stand') return { t: 'stand' }
  if (b.t === 'cpu')
    return isChair(rules, b.chair) &&
      (b.level === null ? rules.levels !== null : isLevel(rules, b.level))
      ? { t: 'cpu', chair: b.chair, level: b.level as number | null }
      : null
  if (b.t === 'swap')
    return isChair(rules, b.a) && isChair(rules, b.b) && b.a !== b.b && isId(b.id)
      ? { t: 'swap', a: b.a, b: b.b, id: b.id }
      : null
  if (b.t === 'mode')
    return rules.modes.includes(b.mode as Mode) ? { t: 'mode', mode: b.mode as Mode } : null
  if (b.t === 'opts') {
    const o = rules.readOpts(b.o)
    return o === null ? null : { t: 'opts', o }
  }
  if (b.t === 'start') return isCount(b.n, MAX_ROUND) && b.n >= 1 ? { t: 'start', n: b.n } : null
  if (b.t === 'over') {
    if (!isCount(b.n, MAX_ROUND) || b.n < 1) return null
    const result = b.result === null ? null : rules.readResult(b.result)
    return b.result !== null && result === null ? null : { t: 'over', n: b.n, result }
  }
  return null
}

/**
 * A state off the wire, every field checked and one bad field refusing the whole of it (§3.1), or
 * null. Each check is a line of its own, so chairs.test.ts can take any one away and watch the
 * state it is there for get in.
 */
export function readChairs<O>(rules: LiveRules<O>, body: unknown): Read<O> | null {
  const b = body as Partial<Record<string, unknown>> | null
  if (!b || typeof b !== 'object') return null
  if (b.v !== 1) return null
  if (b.sub !== rules.sub) return null
  if (b.t !== 'state') return null
  if (!Number.isInteger(b.seq)) return null
  const seq = b.seq as number
  if (seq < 1 || seq > MAX_SEQ) return null
  if (!Array.isArray(b.chairs) || b.chairs.length !== rules.n) return null
  const chairs: Chair[] = []
  for (const x of b.chairs as unknown[]) {
    if (!Array.isArray(x) || x.length !== 3) return null
    const [id, since, cpu] = x as unknown[]
    if (id !== null && !isId(id)) return null
    if (!isCount(since, MAX_SEQ)) return null
    if (since > seq) return null
    if (cpu !== null && !isLevel(rules, cpu)) return null
    if (id !== null && cpu !== null) return null
    chairs.push({ id, since, cpu })
  }
  const ids = chairs.flatMap((ch) => (ch.id === null ? [] : [ch.id]))
  if (new Set(ids).size !== ids.length) return null
  if (!rules.modes.includes(b.mode as Mode)) return null
  const opts = rules.readOpts(b.opts)
  if (opts === null) return null
  if (typeof b.code !== 'string' || !CODE.test(b.code)) return null
  if (!Array.isArray(b.knew) || b.knew.length > MAX_KNEW) return null
  if (!(b.knew as unknown[]).every(isId)) return null
  const r = b.round as Partial<Record<string, unknown>> | null
  if (!r || typeof r !== 'object') return null
  if (!isCount(r.n, MAX_ROUND)) return null
  if (!PHASES.includes(r.phase as Phase)) return null
  if ((r.n === 0) !== (r.phase === 'open')) return null
  if (!Array.isArray(r.starters) || r.starters.length !== rules.n) return null
  if (!(r.starters as unknown[]).every((s) => s === null || isId(s))) return null
  if (r.result !== null && r.phase !== 'over') return null
  const result = r.result === null ? null : rules.readResult(r.result)
  if (r.result !== null && result === null) return null
  return {
    seq,
    chairs,
    mode: b.mode as Mode,
    opts,
    code: b.code,
    knew: [...(b.knew as string[])],
    round: {
      n: r.n,
      phase: r.phase as Phase,
      starters: [...(r.starters as (string | null)[])],
      result,
    },
  }
}

/** somebody else's message, off the wire — everything in it checked before it is believed */
export function receive<O>(
  rules: LiveRules<O>,
  c: Chairs<O>,
  from: string,
  body: unknown,
  now: number,
): Step<O> {
  const none = { table: c, out: [] }
  if (from === c.me || !c.roster.includes(from)) return none
  const b = body as Partial<Record<string, unknown>> | null
  if (!b || typeof b !== 'object' || b.v !== 1 || b.sub !== c.sub) return none
  if (b.t === 'state') {
    const s = readChairs(rules, b)
    if (!s) return none
    // a change of my own still held is older than this, whoever sent it
    const next = newer(s.seq, from, c.seq, c.from) ? { ...c, ...s, from, owed: false } : c
    /* that state went to the whole call: as host, everybody on it has now heard the code it
       carries, though I did not send it — the one way a newcomer with the lowest id is handed it.
       Said at once, as a hello's answer is: held for PACE_MS, it is lost if I leave within it */
    if (isHost(next) && s.code === next.code && unheard(next).length) return send(next, now, false)
    return next === c ? none : { table: next, out: [] }
  }
  if (b.t === 'hello')
    return answersHello(c.me, c.present, from, c.seq, c.from) ? tell(c, now) : none
  if (!isHost(c)) return none
  const a = readAsk(rules, b)
  return a ? decide(rules, c, from, a, now) : none
}

/**
 * Who else is on this toy and on the call, at time `now` (this tab's clock): the host announces
 * the table to somebody new, frees a chair whose occupant has been gone HOLD_MS while no round is
 * on, and re-mints the code when somebody who heard it has left the call; and a change held for
 * PACE_MS goes out.
 */
export function present<O>(
  c: Chairs<O>,
  ids: readonly string[],
  roster: readonly string[],
  now: number,
): Step<O> {
  const others = [...new Set(ids)].filter((id) => id !== c.me).sort()
  const call = [...new Set(roster)].filter((id) => id !== c.me).sort()
  const wasHost = isHost(c)
  const here = new Set([c.me, ...others])
  const missing: Record<string, number> = {}
  for (const ch of c.chairs) if (ch.id && !here.has(ch.id)) missing[ch.id] = c.missing[ch.id] ?? now
  const next: Chairs<O> = { ...c, present: others, roster: call, missing }
  if (!isHost(next)) return owing(next, now)
  const between = next.round.phase !== 'on'
  const gone = next.chairs.map(
    (ch) =>
      between && ch.id !== null && missing[ch.id] !== undefined && now - missing[ch.id] >= HOLD_MS,
  )
  if (gone.some(Boolean) || (between && next.code !== '' && stale(next)))
    return publish(next, now, () => ({
      chairs: next.chairs.map((ch, i) => (gone[i] ? EMPTY : ch)),
    }))
  // a host who has just become one, or somebody new arrived: everybody hears the table as it is
  const arrived = others.some((id) => !c.present.includes(id))
  if (!wasHost || arrived) return tell(next, now)
  return owing(next, now)
}
