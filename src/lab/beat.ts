/**
 * "Beat my board" links: a finished game of any toy in ARMS, sent to a friend so they can play the
 * SAME luck — the same pieces in the same order, the same dice for the same choices, the same deal —
 * and see whether they do better. Asynchronous head-to-head, with no server: the link carries what
 * makes the board and the score to beat, and travels through the comments and chat that already
 * exist. Any number of friends can open one, and each can send their own result back on the same
 * board, so the scores sit side by side in the chat.
 *
 * ⚠️ THE LINK IS A CLAIM, NOT A RECORD. Nothing checks that the game in it happened, and the page
 * words it as what the link says ("this link says 3:12"), never as a verified score. The one
 * exception is an arm with `checked`: its `check` REPLAYS the result the link carries (Lamps' presses
 * on Lamps' own board), and its banner says exactly what was checked and what was not.
 *
 * ⚠️ AND IT CARRIES NO NAME. Snake's beat link puts a display name in the URL; here the person who
 * pastes the link is already shown as its author wherever it is pasted, so a name would only be
 * untrusted text the page has to print. Everything read from a link is a bounded number, a value
 * from the toy's own table, or a run of presses that is replayed — and anything malformed or out of
 * range is no challenge at all.
 *
 * ⚠️ A LINK ALREADY PASTED IN SOMEBODY'S CHAT MUST OPEN AS IT ALWAYS DID. Stackfall's and Ten
 * thousand's links predate the table; their parameters, their order and their sentences are pinned
 * verbatim in beat.test.ts. A new arm adds a block below its group's marker and changes no line of
 * anybody else's — see docs/2026-11-27-lab-beat-my-board.md.
 *
 * Pure apart from `fromHash` and `dropBeat`, so beat.test.ts can round-trip links and check the deals.
 */
import { seeded } from '../gpu/stack'
/* ── g1 imports ── */
/* ── g2 imports ── */
import { COLUMNS as GOLF_COLUMNS, DEPTH as GOLF_DEPTH } from '../gpu/golf'
import { SIZES as MINE_SIZES, type SizeName as MineSize } from '../gpu/mines'
import { LAYOUTS as TILE_LAYOUTS } from '../gpu/tiles'
import { clock as tilesClock } from '../gpu/daily'
/* ── g3 imports ── */
import { SIZES as PIPES_SIZES } from '../gpu/pipes'
import { SIZES as CAGES_SIZES } from '../gpu/cages'
import { SIZES as BRIDGES_SIZES } from '../gpu/bridges'
import { SIZES as TENTS_SIZES } from '../gpu/tents'
import { clock as boardClock } from '../gpu/daily'
/* ── g4 imports ── */
import * as lampsToy from '../gpu/lamps'
import * as slideToy from '../gpu/slide'

/* ---------------------------------------------------------------------------- seeds */

/**
 * ⚠️ THE READ BOUND IS EVERY SEED A TOY CAN MAKE, NOT EVERY SEED `newSeed` MINTS. A daily board is
 * dealt from `daySeedOf`, which is a full 32-bit FNV hash, and `>>> 0` gives the same range — so a
 * bound of 2^31 − 1 refused 430 of the 730 daily seeds from 27 Nov 2026, that day's own among them.
 */
const SEED_MAX = 2 ** 32 - 1
/**
 * What `newSeed` mints from, kept at the old bound on purpose: a tab still running the bundle from
 * before the read bound widened refuses anything past 2^31 − 1, and every link this one mints opens
 * there too.
 */
const MINT_MAX = 2 ** 31 - 1

/** a fresh seed for a game that might be shared: 1 to 2^31 − 2, never 0 */
export const newSeed = (rand: () => number = Math.random) => 1 + Math.floor(rand() * (MINT_MAX - 1))

/* ---------------------------------------------------------------------------- codecs */

/**
 * How one value travels in the address: the parameter it is written as, and how it is read back.
 * `read` answers null for anything it does not accept, and null anywhere is no challenge.
 * Method syntax, so a table can hold every codec as `Codec<unknown>` without `any`.
 */
export type Codec<T> = { key: string; read(v: string | null): T | null; write(x: T): string }

/** a whole number from `lo` to `hi`, inclusive; leading zeros read as they always have ("05" is 5) */
export const whole = (key: string, lo: number, hi: number): Codec<number> => ({
  key,
  read: (v) =>
    v !== null && /^\d{1,10}$/.test(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null,
  write: String,
})

/** a whole number that may be below zero, written one way only: no "-0", "+5" or "05" */
export const signed = (key: string, lo: number, hi: number): Codec<number> => ({
  key,
  read: (v) =>
    v !== null && /^(0|-?[1-9]\d{0,9})$/.test(v) && Number(v) >= lo && Number(v) <= hi
      ? Number(v)
      : null,
  write: String,
})

/** seconds to a tenth, above zero and at most `hi` — Stackfall's `t`, exactly as it has always been read */
export const tenths = (key: string, hi: number): Codec<number> => ({
  key,
  read: (v) => {
    const x = v !== null && /^\d{1,5}(\.\d)?$/.test(v) ? Number(v) : null
    return x === null || x <= 0 || x > hi ? null : x
  },
  write: (x) => x.toFixed(1),
})

/** one value from a list the toy owns: a size, a layout, a pattern — imported, never retyped */
export const oneOf = <T extends string | number>(key: string, list: readonly T[]): Codec<T> => ({
  key,
  read: (v) => list.find((x) => String(x) === v) ?? null,
  write: String,
})

/** a yes or no, as `1` or `0` */
export const flag = (key: string): Codec<boolean> => ({
  key,
  read: (v) => (v === '1' ? true : v === '0' ? false : null),
  write: (x) => (x ? '1' : '0'),
})

/** one letter per press: A–Z then a–w for lamps 0 to 48, and `_` for an undo (−1) */
const PRESS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvw'
/** a run of presses, at least one and at most `max` — the arm's `check` replays it */
export const presses = (key: string, max: number): Codec<number[]> => ({
  key,
  read: (v) =>
    v !== null && new RegExp(`^[A-Za-w_]{1,${max}}$`).test(v)
      ? [...v].map((c) => (c === '_' ? -1 : PRESS.indexOf(c)))
      : null,
  write: (xs) => xs.map((x) => (x < 0 ? '_' : (PRESS[x] ?? '?'))).join(''),
})

/** the seed field of every arm whose boards are dealt from a full 32-bit seed */
export const SEED = whole('seed', 1, SEED_MAX)

/* ---------------------------------------------------------------------------- the arms */

type Fields = Record<string, Codec<unknown>>
type Vals<F extends Fields> = { [K in keyof F]: F[K] extends Codec<infer T> ? T : never }
type Arm<F extends Fields> = {
  /** the toy's name as the sentence says it: "Beat my run at Stackfall" */
  name: string
  /** what one finished game is called: "a run to beat" */
  noun: string
  /** what the friend gets the same of: "Same pieces, same order" */
  same: string
  /** how the scores are compared, in words: "last longer" */
  goal: string
  /** URL order is declaration order, after `demo` */
  fields: F
  /** the fields that make the board; the rest is the score */
  board: readonly (keyof F & string)[]
  /** a rule across fields; false is no challenge */
  check?: (b: Vals<F>) => boolean
  /** ONLY when `check` replays the result: what was checked, in a sentence */
  checked?: string
  /** smaller is better, figure by figure */
  rank: (b: Vals<F>) => readonly number[]
  /** the score as the sentence and the banner say it: "3:12 with 45 lines" */
  says: (b: Vals<F>) => string
}
const arm = <F extends Fields>(a: Arm<F>) => a

/** a Stackfall run ranks by its time at the tenth the link carries, then by its lines */
const stackRank = (time: number, lines: number) => [-Math.round(time * 10), -lines]
const stackClock = (time: number) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`

/**
 * Every toy a link can name. A new arm goes directly after its group's marker, in one block, and
 * touches no other line; its FIXTURE row in beat.test.ts then runs every generic test against it.
 */
export const ARMS = {
  stack: arm({
    name: 'Stackfall',
    noun: 'run',
    same: 'Same pieces, same order',
    goal: 'last longer',
    fields: { seed: SEED, time: tenths('t', 86_400), lines: whole('lines', 0, 99_999) },
    board: ['seed'],
    rank: (b) => stackRank(b.time, b.lines),
    says: (b) => `${stackClock(b.time)} with ${b.lines} lines`,
  }),
  dice: arm({
    name: 'Ten thousand',
    noun: 'run',
    same: 'Same dice for the same choices',
    goal: 'fewer turns wins',
    fields: { seed: SEED, turns: whole('turns', 1, 400) },
    board: ['seed'],
    rank: (b) => [b.turns],
    says: (b) => `10,000 in ${b.turns} turns`,
  }),
  /* ── g1 arms ── */
  yacht: arm({
    name: 'Yacht',
    noun: 'game',
    same: 'Same dice for the same keeps',
    goal: 'more points wins',
    // 297 is the most twelve boxes hold; beat.test.ts works it out from every throw of five dice
    fields: { seed: SEED, points: whole('points', 0, 297) },
    board: ['seed'],
    rank: (b) => [-b.points],
    says: (b) => `${b.points} points`,
  }),
  shut: arm({
    name: 'Shut the box',
    noun: 'turn',
    same: 'Same dice for the same choices',
    goal: 'fewer left wins',
    // 45 is every tile still up; beat.test.ts adds up the box's own tiles
    fields: { seed: SEED, left: whole('left', 0, 45) },
    board: ['seed'],
    rank: (b) => [b.left],
    says: (b) => (b.left ? `${b.left} left` : '0 left — the box shut'),
  }),
  /* ── g2 arms ── */
  golf: arm({
    name: 'Golf patience',
    noun: 'deal',
    same: 'Same cards, same order',
    goal: 'lower wins',
    fields: {
      seed: SEED,
      wrap: flag('wrap'),
      /* golf.ts's own reader bounds: every column card left, down to clearing them all with the
         whole stock unturned (52 cards, less the columns and the one face up to start) */
      score: signed('score', GOLF_COLUMNS * GOLF_DEPTH + 1 - 52, GOLF_COLUMNS * GOLF_DEPTH),
    },
    board: ['seed', 'wrap'],
    rank: (b) => [b.score],
    says: (b) =>
      `${b.score > 0 ? `+${b.score}` : b.score < 0 ? `−${-b.score}` : '0'}${b.wrap ? ', king and ace neighbours' : ''}`,
  }),
  mines: arm({
    name: 'Mines',
    noun: 'board',
    same: 'Same board, opened from the same square',
    goal: 'faster wins',
    fields: {
      seed: SEED,
      size: oneOf('size', Object.keys(MINE_SIZES) as MineSize[]),
      /* the board is laid around the square it opened from, so that square is part of the board */
      start: whole('start', 0, Math.max(...Object.values(MINE_SIZES).map((z) => z.w * z.h)) - 1),
      /* in tenths, as the toy keeps its own times; a day at most */
      tenths: whole('tenths', 1, 864_000),
    },
    board: ['seed', 'size', 'start'],
    check: (b) => b.start < MINE_SIZES[b.size].w * MINE_SIZES[b.size].h,
    rank: (b) => [b.tenths],
    says: (b) => `${(b.tenths / 10).toFixed(1)} s on a ${b.size} board`,
  }),
  tiles: arm({
    name: 'Tile pairs',
    /* "deal", as the toy's own New deal says: "a tiles to beat" is not English */
    noun: 'deal',
    same: 'Same tiles, and the same shuffles for the same presses',
    goal: 'faster wins; hints and shuffles add time',
    fields: {
      seed: SEED,
      layout: oneOf(
        'layout',
        TILE_LAYOUTS.map((l) => l.id),
      ),
      /* whole seconds, the hint and shuffle penalties included, as the toy counts them */
      secs: whole('secs', 1, 86_400),
    },
    board: ['seed', 'layout'],
    rank: (b) => [b.secs],
    says: (b) =>
      `${tilesClock(b.secs)} on ${TILE_LAYOUTS.find((l) => l.id === b.layout)?.name ?? b.layout}`,
  }),
  /* ── g3 arms ── */
  /* Pipes, Cages, Island bridges and Tents: a board made from its seed and its size (and for Pipes
     whether the edges wrap), solved against the clock. The time is the toy's own, every hint's 30 s
     included, and "an" goes before a size whose word starts with a vowel: an 8×8, an 11×11. */
  pipes: arm({
    name: 'Pipes',
    noun: 'board',
    same: 'Same board',
    goal: 'faster wins, then fewer turns',
    fields: {
      seed: SEED,
      size: oneOf('size', PIPES_SIZES),
      wrap: flag('wrap'),
      secs: whole('secs', 1, 86_400),
      turns: whole('turns', 1, 99_999),
    },
    board: ['seed', 'size', 'wrap'],
    // the order the toy's own keepBest ranks a day's finishes in: the time, then the turns
    rank: (b) => [b.secs, b.turns],
    says: (b) =>
      `${boardClock(b.secs)} and ${b.turns} turn${b.turns === 1 ? '' : 's'} on ${[8, 11, 18].includes(b.size) ? 'an' : 'a'} ${b.size}×${b.size}${b.wrap ? ' wrapping' : ''} board`,
  }),
  cages: arm({
    name: 'Cages',
    noun: 'board',
    same: 'Same board',
    goal: 'faster wins; hints add time',
    fields: { seed: SEED, size: oneOf('size', CAGES_SIZES), secs: whole('secs', 1, 86_400) },
    board: ['seed', 'size'],
    rank: (b) => [b.secs],
    says: (b) =>
      `${boardClock(b.secs)} on ${[8, 11, 18].includes(b.size) ? 'an' : 'a'} ${b.size}×${b.size} board`,
  }),
  bridges: arm({
    name: 'Island bridges',
    noun: 'map',
    same: 'Same map',
    goal: 'faster wins; hints add time',
    fields: { seed: SEED, size: oneOf('size', BRIDGES_SIZES), secs: whole('secs', 1, 86_400) },
    board: ['seed', 'size'],
    rank: (b) => [b.secs],
    says: (b) =>
      `${boardClock(b.secs)} on ${[8, 11, 18].includes(b.size) ? 'an' : 'a'} ${b.size}×${b.size} map`,
  }),
  tents: arm({
    name: 'Tents',
    noun: 'field',
    same: 'Same field',
    goal: 'faster wins; hints add time',
    fields: { seed: SEED, size: oneOf('size', TENTS_SIZES), secs: whole('secs', 1, 86_400) },
    board: ['seed', 'size'],
    rank: (b) => [b.secs],
    says: (b) =>
      `${boardClock(b.secs)} on ${[8, 11, 18].includes(b.size) ? 'an' : 'a'} ${b.size}×${b.size} field`,
  }),
  /* ── g4 arms ── */
  lamps: arm({
    name: 'Lamps',
    noun: 'board',
    same: 'Same board',
    goal: 'fewer presses wins, and an undo counts',
    fields: {
      seed: SEED,
      size: oneOf('size', lampsToy.SIZES),
      pattern: oneOf('pattern', lampsToy.PATTERNS),
      presses: presses('presses', lampsToy.MAX_ACTIONS),
    },
    board: ['seed', 'size', 'pattern'],
    /* ⚠️ REPLAYED, NOT BELIEVED: the toy's own board and the toy's own rule for a finish — dark at
       the end and not before, an undo counted. runSolve, never verifyLamps, which refuses any day
       but yesterday, today and tomorrow, and a link can name a board from any day or none */
    check: (b) =>
      lampsToy.runSolve(lampsToy.make(b.size, b.pattern, b.seed), b.size, b.pattern, b.presses).ok,
    checked: 'They were replayed on this page and do switch it off; hints are not in the link.',
    rank: (b) => [b.presses.length],
    /* the pattern in the toy's own words, never its glyph alone: a screen reader reads ✖ as
       "heavy multiplication x", and a friend reading the chat has no button beside it to look at */
    says: (b) =>
      `${b.presses.length} presses on a ${b.size}×${b.size} ${lampsToy.PATTERN_NAMES[b.pattern]} board`,
  }),
  slide: arm({
    name: 'Slide',
    noun: 'board',
    same: 'Same board',
    goal: 'fewer pushes wins',
    fields: {
      // the toy's own seeds, not SEED: an endless board is only ever dealt from 1 to SEEDS
      seed: whole('seed', 1, slideToy.SEEDS),
      difficulty: oneOf('difficulty', Object.keys(slideToy.DIFFICULTY) as slideToy.Difficulty[]),
      pushes: whole('pushes', 1, 9_999),
    },
    board: ['seed', 'difficulty'],
    // every board of a difficulty takes at least its band's fewest pushes (slide.ts generate)
    check: (b) => b.pushes >= slideToy.DIFFICULTY[b.difficulty].min,
    rank: (b) => [b.pushes],
    says: (b) => `${b.pushes} pushes on a ${b.difficulty} board`,
  }),
}

export type Game = keyof typeof ARMS
export type Beat = { [G in Game]: { game: G } & Vals<(typeof ARMS)[G]['fields']> }[Game]

/**
 * One arm seen from outside its own types, for the code that walks every arm alike. The cast is
 * the one place the table's precise types are set aside: each arm is only ever handed a row that
 * its own `fields` read.
 */
type Row = Record<string, unknown>
type AnyArm = Arm<Fields>
const loose = (game: Game) => ARMS[game] as unknown as AnyArm

/** the arm a link's `demo` names — its own, never one inherited from Object ("constructor") */
const armOf = (demo: string | null): Game | null =>
  demo !== null && Object.prototype.hasOwnProperty.call(ARMS, demo) ? (demo as Game) : null

/** the hash part of a link: `#lab?demo=<game>&…`, the fields in the arm's own order */
export function beatHash(b: Beat): string {
  const q = new URLSearchParams({ demo: b.game })
  const row: Row = b
  for (const [name, c] of Object.entries(loose(b.game).fields)) q.set(c.key, c.write(row[name]))
  return `#lab?${q.toString()}`
}

/** a whole link, on this site */
export const beatLink = (b: Beat, base: string) => `${base}${beatHash(b)}`

/**
 * A challenge from a location hash, or null — anything malformed or out of range is no challenge.
 * Unknown parameters are ignored, and a repeated one counts by its first value.
 */
export function readBeat(hash: string): Beat | null {
  const m = /^#lab\?(.*)$/.exec(hash)
  if (!m) return null
  const q = new URLSearchParams(m[1])
  const game = armOf(q.get('demo'))
  if (!game) return null
  const a = loose(game)
  const row: Row = { game }
  for (const [name, c] of Object.entries(a.fields)) {
    const v = c.read(q.get(c.key))
    if (v === null) return null
    row[name] = v
  }
  if (a.check && !a.check(row)) return null
  return row as Beat
}

/** the challenge in this page's address, if any */
export const fromHash = (): Beat | null => {
  try {
    return readBeat(window.location.hash)
  } catch {
    return null
  }
}

/**
 * Leave a challenge: the address goes back to the toy alone, with no new history entry.
 *
 * ⚠️ `#lab?demo=<game>`, NEVER A BARE `#lab`. The address is how a call learns which toy you are on
 * (links.ts `currentToy`), and a bare `#lab` names none — friends saw "on the Lab" and Follow lost
 * you. The toy has not changed, so no TOY_EVENT: nobody has anything new to learn. And the history
 * entry's state is kept, as every other rewrite of the Lab's address keeps it.
 */
export function dropBeat(game: Game) {
  try {
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${location.search}#lab?${new URLSearchParams({ demo: game })}`,
    )
  } catch {
    /* an address that cannot be rewritten keeps its challenge; nothing breaks */
  }
}

/* ---------------------------------------------------------------------------- the dice deal */

/**
 * The random source for one roll of a race: the k-th roll of turn `turn` on deal `seed`. Every die
 * comes from a fresh stream for that (turn, roll), so two people who make the same choices see the
 * same dice, and a choice that leaves fewer dice takes the first few of the same six — the deal
 * never shifts because somebody kept one die more.
 */
export function dealRand(seed: number, turn: number, roll: number): () => number {
  // mix the three numbers into one seed; any fixed, well-spread mix will do
  let h = (seed ^ Math.imul(turn + 1, 0x9e3779b1) ^ Math.imul(roll + 1, 0x85ebca77)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return seeded(h || 1)
}

/* ---------------------------------------------------------------------------- who did better */

/** -1 when `mine` ranks ahead, 1 when behind, 0 when level — figure by figure, smaller first */
function order(mine: readonly number[], link: readonly number[]) {
  for (let i = 0; i < Math.max(mine.length, link.length); i++) {
    if (mine[i] < link[i]) return -1
    if (mine[i] > link[i]) return 1
  }
  return 0
}
const ahead = (mine: readonly number[], link: readonly number[]) => order(mine, link) < 0

/** a Stackfall run beats the link's when it lasts longer; a tie on time goes to more lines */
export const beatsStack = (b: { time: number; lines: number }, time: number, lines: number) =>
  ahead(stackRank(time, lines), stackRank(b.time, b.lines))

/** a race beats the link's in fewer turns */
export const beatsDice = (b: { turns: number }, turns: number) => turns < b.turns

/** two results are on the same board: the same game, and every field that makes the board equal */
export function sameBoard(x: Beat, y: Beat): boolean {
  if (x.game !== y.game) return false
  const rx: Row = x
  const ry: Row = y
  return loose(x.game).board.every((k) => rx[k] === ry[k])
}

/** how my result stands against the link's, or null when they were not played on the same board */
export function outcome(mine: Beat, link: Beat): 'beat' | 'level' | 'short' | null {
  if (!sameBoard(mine, link)) return null
  const a = loose(mine.game)
  const o = order(a.rank(mine), a.rank(link))
  return o < 0 ? 'beat' : o > 0 ? 'short' : 'level'
}

const says = (b: Beat) => loose(b.game).says(b)

/** the end of a result line: how this game stood against the link's, or nothing off its board */
export function verdict(mine: Beat, link: Beat): string {
  const o = outcome(mine, link)
  if (o === 'beat') return ` You beat the link’s ${says(link)}!`
  if (o === 'level') return ` Level with the link’s ${says(link)}.`
  if (o === 'short') return ` The link says ${says(link)} — not this time.`
  return ''
}

/**
 * The sentence copied with a link, so it reads as an invitation wherever it is pasted. Given the
 * link this game answered, it reads as a reply — but only on that link's own board: a result from
 * another board says nothing about the link, so it goes out as a plain invitation.
 */
export function beatMessage(b: Beat, link: string, answering?: Beat): string {
  const a = loose(b.game)
  if (!answering || !sameBoard(b, answering))
    return `🏁 Beat my ${a.noun} at ${a.name}: ${says(b)}. ${a.same}:\n${link}`
  if (outcome(b, answering) === 'beat')
    return `🏆 I beat the link at ${a.name}: ${says(b)} — it said ${says(answering)}. ${a.same}, your go:\n${link}`
  return `🏁 My go at ${a.name}: ${says(b)} — the link I was sent said ${says(answering)}. ${a.same}, your go:\n${link}`
}

/** the banner over a toy opened from a link; `today` when the link's board is today's board here */
export function bannerText(b: Beat, today = false): { lead: string; body: string } {
  const a = loose(b.game)
  const body = a.checked
    ? `checked here — ${says(b)}. ${a.checked} ${a.same} — ${a.goal}.`
    : `this link says ${says(b)}. ${a.same} — ${a.goal}.`
  return {
    lead: `A ${a.noun} to beat:`,
    body: today ? `${body} It is today’s board here, so it counts as your today’s.` : body,
  }
}

/**
 * Whether a result can be sent: its link reads back to exactly the same link. A score past a bound
 * (a Stackfall run over a day, a Lamps solve past 400 presses) would mint a link that opens as no
 * challenge at all, so it is not offered.
 */
export function shareable(b: Beat): boolean {
  const h = beatHash(b)
  const back = readBeat(h)
  return back !== null && beatHash(back) === h
}
