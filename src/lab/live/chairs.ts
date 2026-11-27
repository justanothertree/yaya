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
 * rather than copied; `later` puts how far the rounds have got before the seq, and breaks
 * `newer`'s last tie, one publisher's two tables, by code.
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
 * sit. That is the plan's own count of an arrival, two states (§3.6). Nor does a fold of who has
 * heard the code. A table owed to a host that lacks it waits a second of its own, for another
 * reason (owesHost). The caller ticks `present` at `dueAt` so whatever is held goes out on time.
 *
 * ⚠️ A STATE SAYS WHO PUBLISHED IT (`by`). Whoever hands a table on — a hello's answer from the
 * publisher, what is owed a host — sends the host's state as it was, so every tab breaks a tie
 * between two hosts on the same id. Recorded as its relayer's, a relayed seq 1 lost the tie at a
 * newcomer that a direct copy would have won, and two codes stood on one call (review of
 * 26 Nov 2026). Who is listened to is still the sender: `by` is a name in the state, like a
 * chair's.
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
 *   the lower publisher's (test 4.5).
 * - **Re-minted between rounds when anybody who heard it has left the call**, never mid-round, so a
 *   round is never cut off from its own room. A start still held for the pace has begun for
 *   nobody, so a leaver in that second re-mints too (betweenRounds) — unless this tab has heard
 *   the same round started by another host on this code, which has begun it for whoever took
 *   that.
 * - ⚠️ `knew` IS EVERYONE WHO HAS HEARD THIS CODE, AS FAR AS THE HOST CAN TELL — NOT ONLY THOSE ON
 *   THE CALL WHEN IT WAS MINTED, which is what the plan wrote. Somebody who joined the call
 *   afterwards heard the code in the next state just the same, and the plan's rule would let them
 *   leave holding it. A state goes to the whole call, so whenever one carrying this code goes out —
 *   sent by the host, or heard by it from somebody else, which is how a newcomer with the lowest id
 *   is first handed the table — the host folds its call roster into `knew`, in a state of its own
 *   that goes out at once: bookkeeping, like a hello's answer, and lost if it waited and the
 *   newcomer left within the second. A newcomer with the lowest id, new to the call, costs that
 *   one state more than at a call table (4 sends, not 3). And somebody who reaches the host's
 *   roster just after a state went out is counted as having heard it (heardFirst).
 * - ⚠️ AND WHOEVER HANDS A TABLE ON COUNTS ITS OWN CALL AS HAVING HEARD THE CODE (`relayed`,
 *   verification of 27 Nov 2026). A newcomer's fold was the only record that they had heard it,
 *   and one lost copy of it, or a newcomer who hung up first, left `knew` without them: the next
 *   round began on a code somebody gone had heard. The tab that answered their hello had them on
 *   its call as it sent, so it keeps that, and counts it when it hosts.
 * - Somebody in `knew` who has not reached this host's roster yet reads as somebody who left, so a
 *   host whose roster lags can re-mint for nobody: an extra state and a fresh code, between rounds
 *   only, which errs the safe way for a capability.
 * - `knew` holds at most 16 different people (readChairs refuses a repeat), which cannot hide a
 *   leaver: a call holds at most 12 (voiceSession's CALL_HARD_LIMIT), so a full `knew` always
 *   names somebody who has left, and the next round re-mints.
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
  /**
   * who published the state we hold, as it says (`by`), whoever handed it to us: breaks a tie
   * between two hosts' equal seqs, the same way on every tab
   */
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
  /**
   * The round `n` of the last state this tab sent, took off the wire, or heard from anybody. A
   * round on in this table past it is a start still held for the pace, which nobody has heard, so
   * nobody has begun it
   */
  told: number
  /**
   * Since when (this tab's clock) the host has shown me it lacks the table I hold, or null: a
   * `present` PACE_MS on sends it (owesHost)
   */
  hostBehind: number | null
  /**
   * Who was on my call when I handed `code` on as somebody else's table (a hello's answer, a debt
   * paid): they heard it, whatever `knew` says, and I count them when I host that code. Never sent
   */
  relayed: { code: string; ids: string[] } | null
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

/**
 * The table on the wire: a chair is [id, since, cpu]; `by` is who published it. A publisher is in
 * `knew` unless `knew` was already full, so `by` can name one id that `knew` and the chairs do not
 */
export type StateBody = {
  t: 'state'
  seq: number
  by: string
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
  'seq' | 'from' | 'chairs' | 'mode' | 'opts' | 'code' | 'knew' | 'round'
>

/** the least time between two states that carry changes */
export const PACE_MS = 1000
/**
 * How long after a state goes out somebody can reach the host's roster having already heard it: a
 * state goes to everybody subscribed to the call, and the host counts them once their voice hello
 * has reached it, a hop later (well under a second; this allows three)
 */
export const ROSTER_LAG_MS = 3000
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
    told: 0,
    hostBehind: null,
    relayed: null,
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

/** when something held is due to go out — a change waiting for the pace, a table owed the host */
export function dueAt(c: Chairs<unknown>): number | null {
  const change = c.owed && c.sent !== null ? c.sent + PACE_MS : null
  const owed = c.hostBehind === null ? null : c.hostBehind + PACE_MS
  return change === null ? owed : owed === null ? change : Math.min(change, owed)
}

/** no round has begun for anybody: none is on, or the one on is a start still held for the pace */
const betweenRounds = (c: Chairs<unknown>) => c.round.phase !== 'on' || c.round.n > c.told

/** how far a table's rounds have got: a start is past the open table before it, an end past both */
const progress = (r: Round) => r.n * PHASES.length + PHASES.indexOf(r.phase)
/**
 * Whether state `s` is later than table `c`: the one further into its rounds; at the same point,
 * the higher seq; then room.ts's `newer`, the lower publisher's; and a publisher's two different
 * tables at one seq, the lower code's.
 *
 * ⚠️ A ROUND STARTED IS NOT UNDONE BY A TIE (review of 26 Nov 2026). Ann, whose view had not yet
 * caught up with Bo, still hosted; she took Cy's start, Bo took Dee's sit, both at one seq. By
 * publisher alone Bo's won, so Cy and Dee watched round 1 begin and end without a move, and begin
 * again when the start reached Bo; a start Ann held for the pace was simply lost. A lost sit costs
 * a press; a lost start costs a round its referee may already be playing (step 5).
 *
 * ⚠️ NOR BY A HIGHER SEQ FROM A TABLE THAT NEVER HAD IT (verification of 27 Nov 2026). The start
 * Ann sent as she hung up reached Dee, and Cy, who never had it, hosted on: Dee owed it her, a
 * second on. Anything Cy published in that second — the captain's mode, a friend joining the
 * call — was a later seq, and Dee took it, so the round she was playing was gone everywhere. Rounds
 * only ever go forward along one table, so the table further on is the one that has seen more,
 * whatever its seq; and what Cy changed in that second is a press lost, not a round.
 *
 * ⚠️ AND ONE PUBLISHER CAN HOLD TWO TABLES AT ONE SEQ: a host whose toy reopens before anybody
 * sits mints a fresh "seq 1 by me" while somebody still holds its last one, and neither was later
 * than the other, so two codes stood on the call for good. The lower code wins, on every tab.
 */
const later = (s: Pick<Read<unknown>, 'seq' | 'from' | 'round' | 'code'>, c: Read<unknown>) =>
  progress(s.round) !== progress(c.round)
    ? progress(s.round) > progress(c.round)
    : s.seq !== c.seq
      ? s.seq > c.seq
      : s.from !== c.from
        ? newer(s.seq, s.from, c.seq, c.from)
        : s.code < c.code

/* ── what goes out ─────────────────────────────────────────────────────────────────────────── */

export const wireOf = <O>(c: Chairs<O>): Live => ({
  v: 1,
  sub: c.sub,
  t: 'state',
  seq: c.seq,
  by: c.from,
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
/** who was on my call when I handed this table's code on, as somebody else's */
const relayedOf = (c: Chairs<unknown>) => (c.relayed?.code === c.code ? c.relayed.ids : [])
/** who is on the call now and not yet in `knew`, while there is room to say so */
const unheard = (c: Chairs<unknown>) =>
  c.knew.length >= MAX_KNEW ? [] : [c.me, ...c.roster].filter((id) => !c.knew.includes(id))
/**
 * The host's state as it goes out: everybody on the call now has heard its code, and so has
 * everybody who was on it when I handed the code on (`relayed`)
 */
function heard<O>(c: Chairs<O>): Chairs<O> {
  const add =
    c.knew.length >= MAX_KNEW
      ? []
      : [...new Set([...unheard(c), ...relayedOf(c)])].filter((id) => !c.knew.includes(id))
  if (!add.length) return c
  return { ...c, knew: [...c.knew, ...add].slice(0, MAX_KNEW), seq: c.seq + 1, from: c.me }
}

/** the table goes out now, or — a change within PACE_MS of the last state — with the next one */
function send<O>(c: Chairs<O>, now: number, paced: boolean): Step<O> {
  if (paced && c.sent !== null && now - c.sent < PACE_MS)
    return { table: { ...c, owed: true }, out: [] }
  const host = isHost(c)
  const said = host ? heard(c) : c
  /* handed on as somebody else's: everybody on my call hears the code, and their own count of it
     may never arrive */
  const relayed = host
    ? said.relayed
    : { code: said.code, ids: [...new Set([...relayedOf(said), c.me, ...c.roster])] }
  return {
    table: { ...said, sent: now, owed: false, told: said.round.n, hostBehind: null, relayed },
    out: [wireOf(said)],
  }
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
  if (c.code && betweenRounds(c) && stale(next)) next = minted(next)
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
  if (!isId(b.by)) return null
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
  if (new Set(b.knew).size !== b.knew.length) return null
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
    from: b.by,
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

/**
 * Whether what `from` just said shows my host without the table I hold, which I then owe it: a
 * hello from my new host that somebody else is to answer, or an earlier state from my host.
 *
 * ⚠️ THE HOST CAN LACK THE TABLE EVERYBODY ELSE HOLDS, AND NOTHING USED TO SAY SO (review of
 * 26 Nov 2026). room.ts's `owes` has the first way: a lowest-id newcomer whose hello the host
 * before them never answers, because they closed the toy or hung first. Here there is a second. A
 * host's last state still on its way when the host hangs up is refused by every tab whose roster
 * has already let them go (only somebody on my call is listened to), so the next host can carry on
 * from the table before it while everybody else holds it: its first state tied that one's seq and
 * lost the tie, a round on at Dee and none at Cy, until the next change wiped the round out.
 *
 * What is owed goes at a `present` PACE_MS on (dueAt says when), unless that table or a later one
 * reaches me first from anybody: the host has heard it too. ⚠️ THE WAIT IS LONGER THAN room.ts's,
 * WHICH PAYS AT THE NEXT LOOK, BECAUSE A HOST HERE HOLDS CHANGES FOR THE PACE: the tab owing is
 * often a second behind the old host's own held change, which the answer answersHello names
 * carries. Paid at once, the stale table reached the newcomer first, the newcomer started a round
 * on it, and the answer undid the round (the review's fuzzer, seed 246 of a realistic call, on
 * this fix's first draft).
 *
 * Two earlier states say nothing, as in room.ts: a newcomer's own fresh table (seq 1, minted by
 * its sender), which is its hello again and can come more than once as its roster fills; and a
 * late copy of a state the host published itself, on the code I hold, to somebody holding a later
 * one it published.
 *
 * ⚠️ "ON THE CODE I HOLD" IS WHAT TELLS A LATE COPY FROM A HOST WHOSE TOY REOPENED (verification
 * of 27 Nov 2026). Both are "by" the host. Read by publisher alone, every state of the new session
 * was a late copy, and a tab holding the old table owed nothing until the new seq passed its own,
 * however many changes that took. A reopened toy mints a new code; a late copy carries the one I
 * hold, unless the code changed between, and then what goes out is one state nobody needed.
 *
 * ⚠️ AND "AT A SEQ BELOW MINE" (third verification of 27 Nov 2026). A reopened toy handed its old
 * table is on my code too: Ann answered Bo's hello with the table before his start, and his start
 * then landed at her. Every later state of Bo's was on that code, by him and not as far into its
 * rounds, so `later` never took it and the late-copy rule owed him nothing, however many changes
 * there were: Ann held round 1, Bo hosted none, and her report of its end was refused. So a late
 * copy is a state the host published at a seq below mine, or one it handed on from somebody else
 * (a copy it relayed at my seq, before it took its own, says only that it was late). What a
 * publisher's seq going back (`later`) makes of a real late copy at a seq above mine is one state
 * nobody needed.
 */
const owesHost = (c: Chairs<unknown>, from: string, heard: 'a hello not mine' | Read<unknown>) =>
  c.hostBehind === null &&
  c.seq > 0 &&
  from === hostOf(c) &&
  (heard === 'a hello not mine' ||
    (!(heard.seq === 1 && heard.from === from) &&
      !(c.from === from && heard.code === c.code && (heard.from !== from || heard.seq < c.seq))))

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
    let next: Chairs<O> = c
    // a change of my own still held is older than this, whoever sent it
    if (later(s, c)) next = { ...c, ...s, owed: false, told: s.round.n, hostBehind: null }
    // the table I hold, from anybody: the host has heard it too
    else if (!later(c, s)) next = c.hostBehind === null ? c : { ...c, hostBehind: null }
    else if (owesHost(c, from, s)) next = { ...c, hostBehind: now }
    /* the round this table holds, begun on somebody's screen though I did not take their state
       (one taken is told already): two hosts for a moment, each with one start, and mine held for
       the pace. It has begun for them, so it is not between rounds for me either, and is never
       re-minted under them (betweenRounds; verification of 27 Nov 2026).

       ⚠️ ON MY CODE (third verification of 27 Nov 2026). A start on another code is one whoever
       took it leaves when my state reaches them, whatever I do, so it has begun nothing of mine:
       credited, it stopped the re-mint a leaver called for, and round 1 was played on a code
       somebody who had hung up holds */
    if (next.told < s.round.n && s.code === next.code) next = { ...next, told: s.round.n }
    /* that state went to the whole call: as host, everybody on it has now heard the code it
       carries, though I did not send it — the one way a newcomer with the lowest id is handed it.
       Said at once, as a hello's answer is: held for PACE_MS, it is lost if I leave within it */
    if (isHost(next) && s.code === next.code && unheard(next).length) return send(next, now, false)
    return next === c ? none : { table: next, out: [] }
  }
  if (b.t === 'hello') {
    if (answersHello(c.me, c.present, from, c.seq, c.from)) return tell(c, now)
    return owesHost(c, from, 'a hello not mine')
      ? { table: { ...c, hostBehind: now }, out: [] }
      : none
  }
  if (!isHost(c)) return none
  const a = readAsk(rules, b)
  return a ? decide(rules, c, from, a, now) : none
}

/**
 * Whether somebody on my call who is not in `knew` reached my roster so soon after I last sent a
 * state that it may have reached them first.
 *
 * ⚠️ A STATE GOES TO EVERYBODY SUBSCRIBED TO THE CALL, AND THE HOST'S ROSTER COUNTS THEM A HOP
 * LATER (review of 26 Nov 2026). Eve joined while Ann hosted; Cy stood, and Ann's state went to
 * the whole call, Eve included, before Ann's roster had her, so `knew` did not. Eve sat on that
 * roster for as long as the table stayed quiet, hung up, and two rounds played on the code she had
 * heard. Somebody who reaches the roster within ROSTER_LAG_MS of a state is counted, in a state of
 * its own that goes out at once, as the fold on hearing does. Later than that they cannot have
 * heard it, and cost nothing. A state the host hears rather than sends opens no such window: the
 * fold on hearing counts the roster as it stands then, and somebody a hop behind it is left.
 */
const heardFirst = (c: Chairs<unknown>, now: number) =>
  c.code !== '' && c.sent !== null && now - c.sent < ROSTER_LAG_MS && unheard(c).length > 0

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
  /* keyed by whatever id a chair holds, so nothing may be inherited: on a plain object
     'constructor' reads back Object, `now - Object` is NaN, and that chair is held for ever */
  const missing: Record<string, number> = Object.create(null)
  for (const ch of c.chairs)
    if (ch.id && !here.has(ch.id))
      missing[ch.id] = Object.hasOwn(c.missing, ch.id) ? c.missing[ch.id] : now
  const next: Chairs<O> = { ...c, present: others, roster: call, missing }
  /* what I owe the host goes once it is due: nobody has handed it the table in that time. A host
     owes nobody, and pays any debt it had as a guest with the table it tells (send) */
  if (!isHost(next))
    return next.hostBehind !== null && now - next.hostBehind >= PACE_MS
      ? send(next, now, false)
      : owing(next, now)
  const between = betweenRounds(next)
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
  if (!wasHost || arrived || heardFirst(next, now)) return tell(next, now)
  return owing(next, now)
}
