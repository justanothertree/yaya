/**
 * Rock, paper, scissors against a computer that reads your habits — and a coin to call. Pure, so
 * rps.test.ts can play thousands of rounds against scripted players without a page.
 *
 * ⚠️ THE COMPUTER CHOOSES BEFORE YOU DO. `pick` sees only the rounds already played, never the move
 * being made, so it cannot cheat; all it has is that people are bad at being random. A player who
 * really is random wins a third, draws a third and loses a third against it, and the test holds it
 * to that.
 *
 * How it reads you: several small guessers each predict your next move from a different pattern —
 * what you play most, what you play after your own last move, after your last two, and after its
 * last move (people tend to answer what just beat them). Each is scored on how well it would have
 * guessed recently, and the computer plays against the best one's guess. A habit is found within a
 * few rounds; change it and the guesser that knew it loses its score.
 */

export type Move = 0 | 1 | 2
export const MOVES: Move[] = [0, 1, 2]
export const NAMES = ['rock', 'paper', 'scissors'] as const
export const ICONS = ['✊', '✋', '✌️'] as const

/** the move that beats m */
export const beats = (m: Move): Move => ((m + 1) % 3) as Move
/** 1 if a beats b, -1 if b beats a, 0 for a draw */
export const result = (a: Move, b: Move): 1 | 0 | -1 => (a === b ? 0 : beats(b) === a ? 1 : -1)

export type Round = { me: Move; it: Move }

type Guesser = {
  name: string
  /** counts of what you played next, keyed by the context this guesser looks at */
  why: (h: Round[], m: Move) => string
  key: (h: Round[]) => string | null
}

const GUESSERS: Guesser[] = [
  { name: 'most', key: () => '', why: (_, m) => `you play ${NAMES[m]} most` },
  {
    name: 'after-yours',
    key: (h) => (h.length >= 1 ? `${h[h.length - 1].me}` : null),
    why: (h, m) => `after ${NAMES[h[h.length - 1].me]} you usually play ${NAMES[m]}`,
  },
  {
    name: 'after-your-two',
    key: (h) => (h.length >= 2 ? `${h[h.length - 2].me}${h[h.length - 1].me}` : null),
    why: (h, m) =>
      `after ${NAMES[h[h.length - 2].me]} then ${NAMES[h[h.length - 1].me]} you usually play ${NAMES[m]}`,
  },
  {
    name: 'after-mine',
    key: (h) => (h.length >= 1 ? `${h[h.length - 1].it}` : null),
    why: (h, m) =>
      `when I have just played ${NAMES[h[h.length - 1].it]} you usually play ${NAMES[m]}`,
  },
  {
    name: 'after-result',
    key: (h) => {
      if (!h.length) return null
      const last = h[h.length - 1]
      return `${result(last.me, last.it)}${last.me}`
    },
    why: (h, m) => {
      const last = h[h.length - 1]
      const r = result(last.me, last.it)
      return `after you ${r > 0 ? 'win' : r < 0 ? 'lose' : 'draw'} with ${NAMES[last.me]} you usually play ${NAMES[m]}`
    },
  },
]

/**
 * how fast old evidence fades, per round. ⚠️ TUNED BY SELF-PLAY, 10 Nov 2026: 0.9 → 0.958 scored
 * 0.904 → 0.919 points a round against a squad of twelve scripted habits on held-out seeds, the
 * gain all in the sloppy players (a noisy win-stay/lose-shift 0.75 → 0.79), and still 0.50
 * against pure chance. A slower fade remembers a habit through the noise that hides it.
 */
const FADE = 0.958

/** the most-played next move for this guesser's context, or null with no evidence yet */
function guess(g: Guesser, h: Round[]): Move | null {
  const k = g.key(h)
  if (k === null) return null
  const counts = [0, 0, 0]
  // walk the history: every earlier point with the same context, and what came next there
  for (let i = 0; i < h.length; i++) {
    const before = h.slice(0, i)
    if (g.key(before) !== k) continue
    counts[h[i].me] += Math.pow(FADE, h.length - 1 - i)
  }
  const top = Math.max(...counts)
  if (top < 0.5) return null
  const best = MOVES.filter((m) => counts[m] === top)
  return best.length === 1 ? best[0] : null
}

/** how well each guesser would have done over the history, recent rounds counting most */
function scores(h: Round[]): number[] {
  return GUESSERS.map((g) => {
    let s = 0
    for (let i = 1; i < h.length; i++) {
      const p = guess(g, h.slice(0, i))
      if (p === null) continue
      s = s * FADE + (p === h[i].me ? 1 : -0.5)
    }
    return s
  })
}

export type Pick = {
  it: Move
  /** the move it expected from you, and why — or null when it was guessing */
  expected: Move | null
  reason: string | null
}

/**
 * The computer's move for the next round. With no guesser doing better than chance it plays at
 * random, which cannot be exploited either.
 */
export function pick(h: Round[], rand: () => number): Pick {
  const s = scores(h)
  let best = -1
  for (let i = 0; i < GUESSERS.length; i++) {
    if (s[i] <= 0.5) continue
    if (guess(GUESSERS[i], h) === null) continue
    if (best < 0 || s[i] > s[best]) best = i
  }
  if (best < 0) return { it: Math.floor(rand() * 3) as Move, expected: null, reason: null }
  const expected = guess(GUESSERS[best], h)!
  return { it: beats(expected), expected, reason: GUESSERS[best].why(h, expected) }
}

/** the history it looks at: the last few dozen rounds, so a long session stays quick */
export const MEMORY = 45
export const recent = (h: Round[]) => h.slice(-MEMORY)

/* ---------------------------------------------------------------------------- the coin */

export type Side = 'heads' | 'tails'
export const flip = (rand: () => number): Side => (rand() < 0.5 ? 'heads' : 'tails')

/* ---------------------------------------------------------------------------- what is kept */

/** a match against the computer is first to this many wins */
export const FIRST_TO = 10

export const RPS_KEY = 'lab_rps_v1'
export type Saved = {
  matchesWon: number
  matchesLost: number
  /** rounds over all time against the computer */
  won: number
  lost: number
  drawn: number
  /** the coin: longest run of right calls, and all calls */
  streak: number
  calls: number
  right: number
}
export const EMPTY: Saved = {
  matchesWon: 0,
  matchesLost: 0,
  won: 0,
  lost: 0,
  drawn: 0,
  streak: 0,
  calls: 0,
  right: 0,
}
export function readSaved(text: string | null): Saved {
  const out = { ...EMPTY }
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return out
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  for (const k of Object.keys(EMPTY) as (keyof Saved)[]) {
    const x = o[k]
    if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1e9) out[k] = x
  }
  out.right = Math.min(out.right, out.calls)
  return out
}

/** a seeded random source, for the tests */
export { rng as seeded } from './bricks'
