import {
  COLOUR_COUNTS,
  LENGTHS,
  TRIES,
  allCodes,
  consistent,
  guessFor,
  mark,
  randomCode,
  valid,
  type Code,
  type Mark,
  type Rules as CodeRules,
} from './codebreaker'
import type { Mode, Rules, Seat } from '../lab/social/room'

/**
 * Codebreaker as a match by turns (src/lab/matches): a race. Each side hides a code and both try
 * to crack the other's, a guess at a time, turn about; whoever cracks it in fewer guesses wins, and
 * the side that guesses second always gets as many guesses as the first had, so going first is no
 * edge. Together, the two friends hide one code and crack the computer's between them, while the
 * computer cracks theirs.
 *
 * ⚠️ THE CODES ARE KEPT BACK (Rules.hidden), as Sea battle's fleets are: in the match's `secret`,
 * never the state, until the race is over, when both are shown. The friend's code comes with their
 * yes and the challenger's with their first guess — the challenger guesses first, so no code is
 * guessed at before it is fixed. The server marks every guess against the hidden code and re-marks
 * every stored one before it marks another. The history keeps a guess without the code it carried.
 */
export type CodeMove = { guess: Code; code?: Code }
export type CodeGuess = { by: Seat; guess: Code; mark: Mark }
export type CodeGame = {
  rules: CodeRules
  /** each side's hidden code: null in a browser until the race is over, and before it is set */
  codes: [Code | null, Code | null]
  placed: [boolean, boolean]
  guesses: CodeGuess[]
}

/** the toy's own rules for a match, its defaults when none are named; null for anything else */
export function readCodeSettings(s: Record<string, unknown>): CodeRules | null {
  const length = s.length ?? 4
  const colours = s.colours ?? 6
  const repeats = s.repeats ?? true
  const tries = s.tries ?? 10
  if (!(LENGTHS as readonly unknown[]).includes(length)) return null
  if (!(COLOUR_COUNTS as readonly unknown[]).includes(colours)) return null
  if (typeof repeats !== 'boolean' || !(TRIES as readonly unknown[]).includes(tries)) return null
  return { length: length as number, colours: colours as number, repeats, tries: tries as number }
}

const other = (s: Seat): Seat => (s === 0 ? 1 : 0)
const count = (g: CodeGame, s: Seat) => g.guesses.filter((x) => x.by === s).length
const cracked = (g: CodeGame, s: Seat) => {
  const i = g.guesses.findIndex((x) => x.by === s && x.mark.exact === g.rules.length)
  return i < 0 ? null : g.guesses.slice(0, i + 1).filter((x) => x.by === s).length
}
const done = (g: CodeGame, s: Seat) => cracked(g, s) !== null || count(g, s) >= g.rules.tries

/**
 * Whose guess it is, or null when the race is over: over when both are done, or when one cracked
 * it in k guesses and the other has had k. Otherwise the side not done with fewer guesses, the
 * challenger on a tie.
 */
export function whoseGuess(g: CodeGame): Seat | null {
  if (done(g, 0) && done(g, 1)) return null
  for (const s of [0, 1] as Seat[]) {
    const k = cracked(g, s)
    if (k !== null && count(g, other(s)) >= k) return null
  }
  if (done(g, 0)) return 1
  if (done(g, 1)) return 0
  return count(g, 1) < count(g, 0) ? 1 : 0
}

const fresh = (rules: CodeRules): CodeGame => ({
  rules,
  codes: [null, null],
  placed: [false, false],
  guesses: [],
})

/** a guess marked against the other side's code, which must be there */
function guessed(g: CodeGame, by: Seat, guess: Code): CodeGame {
  return { ...g, guesses: [...g.guesses, { by, guess, mark: mark(g.codes[other(by)]!, guess) }] }
}

const readCode = (rules: CodeRules, x: unknown): Code | null =>
  Array.isArray(x) && valid(x as Code, rules) ? [...(x as Code)] : null

export function readCodeMove(x: unknown): CodeMove | null {
  const o = x as { guess?: unknown; code?: unknown } | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.guess) || o.guess.length > 5) return null
  if (!o.guess.every((c) => Number.isInteger(c) && c >= 0 && c < 8)) return null
  if (o.code === undefined) return { guess: [...(o.guess as Code)] }
  if (!Array.isArray(o.code) || o.code.length > 5) return null
  return { guess: [...(o.guess as Code)], code: [...(o.code as Code)] }
}

/**
 * The race anybody in the match may see: guesses in turn, each a code the rules allow, the marks
 * the server gave, and — once it is over — both codes, which must give those marks.
 */
export function replayPublic(rules: CodeRules, x: unknown): CodeGame | null {
  const o = x as { placed?: unknown; guesses?: unknown; codes?: unknown } | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.placed) || !Array.isArray(o.guesses))
    return null
  if (o.placed.length !== 2 || !o.placed.every((p) => typeof p === 'boolean')) return null
  let g: CodeGame = { ...fresh(rules), placed: [o.placed[0], o.placed[1]] as [boolean, boolean] }
  for (const e of o.guesses) {
    const by = whoseGuess(g)
    if (by === null || !Array.isArray(e) || e.length !== rules.length + 2) return null
    const guess = readCode(rules, e.slice(0, rules.length))
    const [exact, near] = e.slice(rules.length) as number[]
    if (!guess || !Number.isInteger(exact) || !Number.isInteger(near)) return null
    if (exact < 0 || near < 0 || exact + near > rules.length) return null
    if (!g.placed[0] || !g.placed[1]) return null
    g = { ...g, guesses: [...g.guesses, { by, guess, mark: { exact, near } }] }
  }
  if (o.codes !== undefined) {
    // shown only once the race is over, and they must be the codes the marks were given against
    const codes = o.codes as unknown[]
    if (whoseGuess(g) !== null || !Array.isArray(codes) || codes.length !== 2) return null
    const both = codes.map((c) => readCode(rules, c))
    if (!both[0] || !both[1]) return null
    const joined = rejoin(g, [both[0], both[1]])
    if (!joined) return null
    g = joined
  }
  return g
}

/** the race with its codes put back, every guess marked again against them; null if any differs */
function rejoin(g: CodeGame, codes: [Code | null, Code | null]): CodeGame | null {
  for (const s of [0, 1] as Seat[]) if (g.placed[s] !== (codes[s] !== null)) return null
  let check: CodeGame = { ...fresh(g.rules), placed: g.placed, codes }
  for (const x of g.guesses) {
    check = guessed(check, x.by, x.guess)
    const m = check.guesses[check.guesses.length - 1].mark
    if (m.exact !== x.mark.exact || m.near !== x.mark.near) return null
  }
  return check
}

/**
 * How many of its own marks Fair keeps in mind. The toy's two computers, lucky and clever, are a
 * sixth of a guess apart (4.62 and 4.45 to crack a 4-peg, 6-colour code), which nobody playing
 * could tell; Fair forgets all but its last three marks instead, and sits between. Measured on
 * 16 Nov 2026, guesses to crack it at 4×6 over 400 races, and at 5×8 over 15: Easy (any untried
 * code) 10.95 and 13.0 (it seldom does), Fair 5.22 and 8.33, Hard (clever, every mark) 4.45 and
 * 5.67. Hard's slowest single guess was 126ms on the largest board.
 */
export const FAIR_MEMORY = 3

export function codeRules(rules: CodeRules): Rules<CodeGame, CodeMove> {
  /** the code a move brings, when its side has none set yet; 'none' when it needs none */
  const brings = (g: CodeGame, m: CodeMove, by: Seat) =>
    g.placed[by] ? (m.code === undefined ? 'none' : null) : m.code ? readCode(rules, m.code) : null
  return {
    fresh: () => fresh(rules),
    turn: whoseGuess,
    legal: (g, m, by) => {
      const s = whoseGuess(g)
      if (s === null || (by !== undefined && by !== s)) return false
      if (!readCode(rules, m.guess) || !g.placed[other(s)]) return false
      return brings(g, m, s) !== null
    },
    apply: (g, m) => {
      const s = whoseGuess(g)
      if (s === null) return g
      const c = brings(g, m, s)
      if (c === null) return g
      let cur = g
      if (c !== 'none') {
        const codes: [Code | null, Code | null] = [...g.codes]
        codes[s] = c
        const placed: [boolean, boolean] = [...g.placed]
        placed[s] = true
        cur = { ...g, codes, placed }
      }
      // the other side's code is only on the server, which is where a guess is marked
      return cur.codes[other(s)] ? guessed(cur, s, m.guess) : cur
    },
    encode: (g) => ({
      placed: g.placed,
      guesses: g.guesses.map((x) => [...x.guess, x.mark.exact, x.mark.near]),
      // once the race is over both codes are shown; before, neither is ever here
      ...(whoseGuess(g) === null && g.codes[0] && g.codes[1] ? { codes: g.codes } : {}),
    }),
    decode: (x) => replayPublic(rules, x),
    readMove: readCodeMove,
    modes: ['versus', 'together'],
    computer: {
      side: 1,
      levels: ['easy', 'fair', 'hard'],
      choose: (g, level) => {
        const pool = allCodes(rules)
        const tried = g.guesses.filter((x) => x.by === 1)
        if (level === 'easy') {
          // any code it has not tried yet: it pays no heed to what its marks have said
          const seen = new Set(tried.map((x) => x.guess.join()))
          const left = pool.filter((c) => !seen.has(c.join()))
          return { guess: left[Math.floor(Math.random() * left.length)] }
        }
        // fair heeds only its last FAIR_MEMORY marks, and never repeats a guess
        const heed = level === 'hard' ? tried : tried.slice(-FAIR_MEMORY)
        const seen = new Set(tried.map((x) => x.guess.join()))
        const possible = consistent(pool, heed).filter((c) => !seen.has(c.join()))
        return { guess: guessFor(possible, level === 'hard' ? 'clever' : 'lucky', Math.random) }
      },
    },
    result: (g) => {
      if (whoseGuess(g) !== null) return null
      const [a, b] = [cracked(g, 0), cracked(g, 1)]
      if (a === null && b === null) return 'draw'
      if (b === null || (a !== null && a < b)) return 0
      if (a === null || b < a) return 1
      return 'draw'
    },
    begun: (g) => g.guesses.length > 0,
    hidden: {
      secret: (g) => ({ codes: g.codes }),
      join: (g, secret) => {
        const codes = (secret as { codes?: unknown } | null)?.codes
        if (!Array.isArray(codes) || codes.length !== 2) return null
        const read = codes.map((c) => (c === null ? null : readCode(rules, c)))
        if (codes.some((c, i) => c !== null && read[i] === null)) return null
        return rejoin(g, [read[0], read[1]])
      },
      mine: (g, side) => g.codes[side],
      logged: (m) => ({ guess: m.guess }),
      accept: (g, brought, mode: Mode) => {
        // together, the computer's code is chosen here; versus, the friend brings theirs
        const c = mode === 'together' ? randomCode(rules, Math.random) : readCode(rules, brought)
        if (!c) return null
        return { ...g, codes: [g.codes[0], c], placed: [g.placed[0], true] }
      },
    },
  }
}

/** how a finished race went: the guesses each side took to crack it, or null if it never did */
export const crackedIn = (g: CodeGame, s: Seat) => cracked(g, s)
