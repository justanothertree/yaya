/**
 * Codebreaker: a hidden code of coloured pegs, and a set number of guesses to find it. After each
 * guess you are told how many pegs are the right colour in the right place, and how many more are
 * the right colour in the wrong place. Pure, so codebreaker.test.ts can play every code there is;
 * CodebreakerDemo draws the board.
 *
 * ⚠️ "RIGHT COLOUR, WRONG PLACE" COUNTS EACH PEG ONCE. With a secret of red-red-blue, a guess of
 * red-blue-blue scores one in place (the first red), one in place (the last blue) — and nothing
 * else, because the guess's middle blue has no blue left in the secret to answer to. The count is
 * the overlap of the two colour tallies, less the pegs already in place.
 */

export type Code = number[]
export type Mark = { exact: number; near: number }
export type Rules = { length: number; colours: number; repeats: boolean; tries: number }
export const DEFAULT_RULES: Rules = { length: 4, colours: 6, repeats: true, tries: 10 }
export const LENGTHS = [3, 4, 5] as const
export const COLOUR_COUNTS = [4, 5, 6, 7, 8] as const
export const TRIES = [6, 8, 10, 12] as const

export function mark(secret: Code, guess: Code): Mark {
  let exact = 0
  const a = new Array(10).fill(0)
  const b = new Array(10).fill(0)
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) exact++
    a[secret[i]]++
    b[guess[i]]++
  }
  let both = 0
  for (let c = 0; c < 10; c++) both += Math.min(a[c], b[c])
  return { exact, near: both - exact }
}
export const solved = (m: Mark, rules: Rules) => m.exact === rules.length

/** every code the rules allow */
export function allCodes(rules: Rules): Code[] {
  const out: Code[] = []
  const walk = (prefix: Code) => {
    if (prefix.length === rules.length) {
      out.push(prefix)
      return
    }
    for (let c = 0; c < rules.colours; c++)
      if (rules.repeats || !prefix.includes(c)) walk([...prefix, c])
  }
  walk([])
  return out
}
export const valid = (code: Code, rules: Rules) =>
  code.length === rules.length &&
  code.every((c) => Number.isInteger(c) && c >= 0 && c < rules.colours) &&
  (rules.repeats || new Set(code).size === code.length)

/** the codes that would have answered every guess so far exactly as it was answered */
export function consistent(pool: Code[], history: { guess: Code; mark: Mark }[]): Code[] {
  return pool.filter((s) =>
    history.every(({ guess, mark: m }) => {
      const k = mark(s, guess)
      return k.exact === m.exact && k.near === m.near
    }),
  )
}

/** a source of numbers from a seed, so a daily code is the same for everyone on that day */
export { rng as seeded } from './bricks'
/** the day's code: the same for every player on a given date, and different on the next */
export function dailySeed(date: Date): number {
  const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193)
  return h >>> 0
}
export function randomCode(rules: Rules, rand: () => number): Code {
  const code: Code = []
  while (code.length < rules.length) {
    const c = Math.floor(rand() * rules.colours)
    if (rules.repeats || !code.includes(c)) code.push(c)
  }
  return code
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['lucky', 'clever'] as const
export type Level = (typeof LEVELS)[number]

/**
 * The computer's next guess at your code. Lucky guesses any code still possible. Clever picks the
 * guess whose worst possible answer leaves the fewest codes standing (Knuth's way), choosing among
 * the possible codes so a lucky answer can still end the game; with too many codes left to weigh
 * them all, it weighs a sample.
 */
export function guessFor(possible: Code[], level: Level, rand: () => number): Code {
  if (possible.length <= 2 || level === 'lucky')
    return possible[Math.floor(rand() * possible.length)]
  const candidates =
    possible.length > 300
      ? Array.from({ length: 300 }, () => possible[Math.floor(rand() * possible.length)])
      : possible
  const judge = possible.length > 1500 ? candidates : possible
  let best = candidates[0]
  let bestWorst = Infinity
  for (const g of candidates) {
    const buckets = new Map<number, number>()
    let worst = 0
    for (const s of judge) {
      const m = mark(s, g)
      const k = m.exact * 16 + m.near
      const n = (buckets.get(k) ?? 0) + 1
      buckets.set(k, n)
      if (n > worst) worst = n
      if (worst >= bestWorst) break
    }
    if (worst < bestWorst) {
      bestWorst = worst
      best = g
    }
  }
  return best
}

/* ---------------------------------------------------------------------------- what is kept */

export const CODE_KEY = 'lab_codebreaker_v1'
export const PEGS = ['colours', 'shapes', 'numbers'] as const
export type Saved = {
  rules: Rules
  level: Level
  pegs: (typeof PEGS)[number]
  /** show how many codes are still possible after each guess */
  counting: boolean
  /** games solved by how many guesses they took (index 1 = one guess); [0] counts the failures */
  spread: number[]
  /** the day's result, so the daily code is played once: date key and guesses (0 = not solved) */
  daily: { day: string; guesses: number } | null
}
export const EMPTY: Saved = {
  rules: DEFAULT_RULES,
  level: 'clever',
  pegs: 'colours',
  counting: false,
  spread: Array(13).fill(0),
  daily: null,
}
export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`

export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const pick = <T>(list: readonly T[], x: unknown, d: T): T =>
    list.includes(x as T) ? (x as T) : d
  const r = (typeof o.rules === 'object' && o.rules ? o.rules : {}) as Record<string, unknown>
  const rules: Rules = {
    length: pick(LENGTHS, r.length, DEFAULT_RULES.length),
    colours: pick(COLOUR_COUNTS, r.colours, DEFAULT_RULES.colours),
    repeats: typeof r.repeats === 'boolean' ? r.repeats : DEFAULT_RULES.repeats,
    tries: pick(TRIES, r.tries, DEFAULT_RULES.tries),
  }
  // without repeats a code needs at least as many colours as places
  if (!rules.repeats && rules.colours < rules.length) rules.repeats = true
  const spread = Array(13).fill(0)
  if (Array.isArray(o.spread))
    o.spread.slice(0, 13).forEach((x, i) => {
      if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 1e6) spread[i] = x
    })
  const d = o.daily as Record<string, unknown> | null
  const daily =
    d &&
    typeof d === 'object' &&
    typeof d.day === 'string' &&
    /^\d{4}-\d{1,2}-\d{1,2}$/.test(d.day) &&
    typeof d.guesses === 'number' &&
    Number.isInteger(d.guesses) &&
    d.guesses >= 0 &&
    d.guesses <= 12
      ? { day: d.day, guesses: d.guesses }
      : null
  return {
    rules,
    level: pick(LEVELS, o.level, EMPTY.level),
    pegs: pick(PEGS, o.pegs, EMPTY.pegs),
    counting: typeof o.counting === 'boolean' ? o.counting : EMPTY.counting,
    spread,
    daily,
  }
}
