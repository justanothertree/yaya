/**
 * The Lab's graph matcher: type y = something, and the curve appears over a target to match. Three
 * sliders a, b and c can stand in any equation, so "a*sin(b*x) + c" becomes a thing to play with.
 *
 * ⚠️ THE EQUATION IS PARSED, NEVER EVALUATED AS JAVASCRIPT. Whatever is typed is tokenised and
 * parsed by a small precedence-climbing parser into a tree of the operations below and nothing
 * else — so there is no way from the box to the page, and a typo gets an answer that points at it
 * instead of a stack trace. It takes the forms people write by hand: 2x, 3sin(x), sinx, (x-1)(x+1), x².
 *
 * Pure, so all of it can be asked a question without a browser.
 */

export type Vars = { x: number; a: number; b: number; c: number }
type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: keyof Vars }
  | { k: 'neg'; e: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; l: Node; r: Node }
  | { k: 'call'; f: keyof typeof FUNCS; e: Node }

const FUNCS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  abs: Math.abs,
  sqrt: Math.sqrt,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  floor: Math.floor,
} as const
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E }
const VARS = ['x', 'a', 'b', 'c'] as const

type Tok =
  | { t: 'num'; v: number; at: number }
  | { t: 'id'; v: string; at: number }
  | { t: 'op'; v: string; at: number }
  | { t: 'end'; at: number }

export class ParseError extends Error {
  /** where in what was typed the trouble is, counted in characters */
  at: number
  constructor(message: string, at: number) {
    super(message)
    this.at = at
  }
}

function tokens(src: string): Tok[] {
  const out: Tok[] = []
  // the forms people type that are not plain ASCII: × ÷ − and superscript squares and cubes
  const s = src.replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/²/g, '^2').replace(/³/g, '^3') // prettier-ignore
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (/\s/.test(ch)) {
      i++
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i))
      if (!m) throw new ParseError(`“${ch}” is not a number`, i)
      out.push({ t: 'num', v: Number(m[1]), at: i })
      i += m[1].length
    } else if (/[a-zπ]/i.test(ch)) {
      const m = /^([a-z]+|π)/i.exec(s.slice(i))!
      // a run of letters is a function, a constant, or variables written next to each other: "ax"
      // ⚠️ split into the longest names it knows, left to right: "sinx" is sin x, "2pix" is 2 pi x,
      // "ab" is a b. A run with anything else in it is refused, pointing at the letter.
      const word = m[1].toLowerCase()
      const names = [...Object.keys(FUNCS), ...Object.keys(CONSTS)].sort(
        (p, q) => q.length - p.length,
      )
      let j = 0
      while (j < word.length) {
        const name = names.find((n) => word.startsWith(n, j))
        if (name) {
          out.push({ t: 'id', v: name, at: i + j })
          j += name.length
        } else if ((VARS as readonly string[]).includes(word[j])) {
          out.push({ t: 'id', v: word[j], at: i + j })
          j++
        } else
          throw new ParseError(`“${word}” is not something this knows — use x, a, b, c, pi, or sin, cos, tan, abs, sqrt, exp, ln, log, floor`, i + j) // prettier-ignore
      }
      i += word.length
    } else if ('+-*/^()'.includes(ch)) {
      out.push({ t: 'op', v: ch, at: i })
      i++
    } else throw new ParseError(`“${ch}” cannot be used here`, i)
  }
  out.push({ t: 'end', at: s.length })
  return out
}

/** "y = …" or just "…" into a tree; throws ParseError, with where, for anything else */
export function parse(src: string): Node {
  const text = src.replace(/^\s*y\s*=/i, '')
  const offset = src.length - text.length
  const ts = tokens(text)
  let p = 0
  const peek = () => ts[p]
  const fail = (m: string, at = peek().at): never => {
    throw new ParseError(m, at + offset)
  }
  // implicit multiplication: a number, a closing bracket or a name followed by a name, a number
  // or an opening bracket — 2x, 3sin(x), (x-1)(x+1), 2pi, ab
  const startsTerm = (t: Tok) => t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '(')

  const expr = (): Node => {
    let l = term()
    while (peek().t === 'op' && (peek() as { v: string }).v.match(/^[+-]$/)) {
      const op = (ts[p++] as { v: '+' | '-' }).v
      l = { k: 'bin', op, l, r: term() }
    }
    return l
  }
  const term = (): Node => {
    let l = unary()
    for (;;) {
      const t = peek()
      if (t.t === 'op' && (t.v === '*' || t.v === '/')) {
        p++
        l = { k: 'bin', op: t.v, l, r: unary() }
      } else if (startsTerm(t)) l = { k: 'bin', op: '*', l, r: power() }
      else return l
    }
  }
  const unary = (): Node => {
    const t = peek()
    if (t.t === 'op' && t.v === '-') {
      p++
      return { k: 'neg', e: unary() }
    }
    if (t.t === 'op' && t.v === '+') {
      p++
      return unary()
    }
    return power()
  }
  const power = (): Node => {
    const base = atom()
    if (peek().t === 'op' && (peek() as { v: string }).v === '^') {
      p++
      // right-associative, and a minus binds to the exponent: x^-2
      return { k: 'bin', op: '^', l: base, r: unary() }
    }
    return base
  }
  const atom = (): Node => {
    const t = ts[p++]
    if (t.t === 'num') return { k: 'num', v: t.v }
    if (t.t === 'id') {
      if (t.v in CONSTS) return { k: 'num', v: CONSTS[t.v] }
      if (t.v in FUNCS) {
        const f = t.v as keyof typeof FUNCS
        const n = peek()
        if (n.t === 'op' && n.v === '(') {
          p++
          const e = expr()
          if (!(peek().t === 'op' && (peek() as { v: string }).v === ')')) fail('a “)” is missing')
          p++
          return { k: 'call', f, e }
        }
        // sin x: the function takes the next term (so sin 2x is sin(2)·x — write sin(2x))
        if (startsTerm(n)) return { k: 'call', f, e: power() }
        return fail(`${f} needs something to work on, like ${f}(x)`, n.at)
      }
      return { k: 'var', name: t.v as keyof Vars }
    }
    if (t.t === 'op' && t.v === '(') {
      const e = expr()
      if (!(peek().t === 'op' && (peek() as { v: string }).v === ')')) fail('a “)” is missing')
      p++
      return e
    }
    if (t.t === 'end')
      return fail(p === 1 ? 'type an equation, like 2x + 1' : 'it stops too soon', t.at)
    return fail(`“${(t as { v: string }).v}” cannot go there`, t.at)
  }
  const tree = expr()
  if (peek().t !== 'end') fail(`“${(peek() as { v: string }).v}” cannot go there`)
  return tree
}

export function evaluate(n: Node, v: Vars): number {
  switch (n.k) {
    case 'num':
      return n.v
    case 'var':
      return v[n.name]
    case 'neg':
      return -evaluate(n.e, v)
    case 'call':
      return FUNCS[n.f](evaluate(n.e, v))
    case 'bin': {
      const l = evaluate(n.l, v)
      const r = evaluate(n.r, v)
      return n.op === '+' ? l + r : n.op === '-' ? l - r : n.op === '*' ? l * r : n.op === '/' ? l / r : l ** r // prettier-ignore
    }
  }
}

/** which of the sliders an equation uses, so the page shows only those */
export function uses(n: Node, out = new Set<string>()): Set<string> {
  if (n.k === 'var' && n.name !== 'x') out.add(n.name)
  if (n.k === 'neg' || n.k === 'call') uses(n.e, out)
  if (n.k === 'bin') {
    uses(n.l, out)
    uses(n.r, out)
  }
  return out
}

/* ------------------------------------------------------------------------------- the plane */

export const VIEW = { x0: -6, x1: 6, y0: -4, y1: 4 }
export const SAMPLES = 1024

/** the curve at SAMPLES points across the view; anything not a number is NaN, a gap */
export function sample(
  n: Node,
  ab: { a: number; b: number; c: number },
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(SAMPLES)
  for (let i = 0; i < SAMPLES; i++) {
    const x = VIEW.x0 + ((VIEW.x1 - VIEW.x0) * i) / (SAMPLES - 1)
    const y = evaluate(n, { x, ...ab })
    out[i] = Number.isFinite(y) ? y : NaN
  }
  return out
}

/**
 * How far yours is from the target, as the mean gap between them over the points where the target
 * is drawn (defined, and on the plane or near it). Where yours is undefined and the target is not,
 * that point counts as a full plane's height away — a curve with a hole is not a match.
 */
export function distance(yours: Float32Array, target: Float32Array): number {
  const tall = VIEW.y1 - VIEW.y0
  let sum = 0
  let n = 0
  for (let i = 0; i < target.length; i++) {
    const t = target[i]
    if (!Number.isFinite(t) || t < VIEW.y0 - tall || t > VIEW.y1 + tall) continue
    const y = yours[i]
    sum += Number.isFinite(y) ? Math.min(Math.abs(y - t), tall) : tall
    n++
  }
  return n ? sum / n : Infinity
}

/** close enough: a twentieth of a square on average — about a pixel and a half on a phone */
export const MATCH = 0.05

/* --------------------------------------------------------------------------- the levels */

export type Level = {
  name: string
  target: string
  /** what kind of curve, then what to change — the hints in order */
  hints: [string, string]
}

export const LEVELS: Level[] = [
  { name: 'Straight up', target: 'x', hints: ['A straight line through the middle.', 'It rises one for every one across.'] }, // prettier-ignore
  { name: 'Steeper', target: '2x + 1', hints: ['A straight line, steeper than y = x.', 'It crosses the up-down axis at 1, and climbs 2 for every 1 across.'] }, // prettier-ignore
  { name: 'Downhill', target: '3 - x/2', hints: ['A straight line that falls.', 'It crosses the up-down axis at 3, and falls 1 for every 2 across.'] }, // prettier-ignore
  { name: 'Bowl', target: 'x^2', hints: ['A parabola — a U shape. Try x².', 'Its lowest point is right in the middle.'] }, // prettier-ignore
  { name: 'Moved bowl', target: '(x - 2)^2 - 1', hints: ['The same U shape as x², moved.', 'Its lowest point is at x = 2, y = −1. (x − 2) moves it right.'] }, // prettier-ignore
  { name: 'Upside down', target: '4 - x^2/2', hints: ['An upside-down parabola: −x² turns the U over.', 'Its top is at y = 4, and it is twice as wide as x².'] }, // prettier-ignore
  { name: 'V', target: 'abs(x - 1) - 2', hints: ['A V shape: abs(x) is the distance from zero.', 'Its point is at x = 1, y = −2.'] }, // prettier-ignore
  { name: 'Wave', target: 'sin(x)', hints: ['A wave. Try sin(x).', 'It crosses zero at the middle, going up.'] }, // prettier-ignore
  { name: 'Taller wave', target: '2sin(x) + 1', hints: ['A sine wave, taller and higher.', 'It swings 2 either side of y = 1.'] }, // prettier-ignore
  { name: 'Faster wave', target: 'sin(2x)', hints: ['A sine wave that repeats twice as often.', 'Doubling x inside sin squeezes it: sin(2x).'] }, // prettier-ignore
  { name: 'Half-pipe', target: 'sqrt(x + 4)', hints: ['Half a sideways parabola: try sqrt(x).', 'It starts at x = −4 and y = 0.'] }, // prettier-ignore
  { name: 'Two arms', target: '1/x', hints: ['One divided by x: two arms that never touch the axes.', 'Try 1/x.'] }, // prettier-ignore
]

/* ---------------------------------------------------------------------------- what is kept */

export const GRAPH_KEY = 'lab_graph_v1'
export type Saved = {
  /** each solved level's fewest hints */
  solved: Record<string, number>
  /** the free plane's equation and sliders, as left */
  free: { text: string; a: number; b: number; c: number }
}
export const EMPTY_SAVED: Saved = { solved: {}, free: { text: 'a*sin(b*x) + c', a: 2, b: 1, c: 0 } }
export const SLIDER = { min: -5, max: 5 }

export function readSaved(text: string | null): Saved {
  const out: Saved = { solved: {}, free: { ...EMPTY_SAVED.free } }
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return out
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  if (typeof o.solved === 'object' && o.solved && !Array.isArray(o.solved))
    for (const l of LEVELS) {
      const h = (o.solved as Record<string, unknown>)[l.name]
      if (Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 3)
        out.solved[l.name] = h as number
    }
  if (typeof o.free === 'object' && o.free && !Array.isArray(o.free)) {
    const f = o.free as Record<string, unknown>
    if (typeof f.text === 'string' && f.text.length <= MAX_TEXT) out.free.text = f.text
    for (const k of ['a', 'b', 'c'] as const) {
      const n = f[k]
      if (Number.isFinite(n)) out.free[k] = Math.max(SLIDER.min, Math.min(SLIDER.max, n as number))
    }
  }
  return out
}
export const MAX_TEXT = 80

/** three stars with no hints, two with one, one with more */
export const stars = (hints: number) => (hints === 0 ? 3 : hints === 1 ? 2 : 1)
