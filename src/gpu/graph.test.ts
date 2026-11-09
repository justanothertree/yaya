import { describe, expect, it } from 'vitest'
import source from './graph.ts?raw'
import {
  EMPTY_SAVED,
  LEVELS,
  MATCH,
  ParseError,
  SAMPLES,
  VIEW,
  distance,
  evaluate,
  parse,
  readSaved,
  sample,
  uses,
} from './graph'

const at = (src: string, x: number, a = 2, b = 3, c = 5) => evaluate(parse(src), { x, a, b, c })
const AB = { a: 2, b: 1, c: 0 }

describe('reading an equation', () => {
  // each written again as plain JavaScript, so the parser is checked against something it shares
  // nothing with
  const CASES: [string, (x: number) => number][] = [
    ['2x + 1', (x) => 2 * x + 1],
    ['y = 3sin(x)', (x) => 3 * Math.sin(x)],
    ['sinx', (x) => Math.sin(x)],
    ['sin x + 1', (x) => Math.sin(x) + 1],
    ['(x-1)(x+1)', (x) => (x - 1) * (x + 1)],
    ['x^2', (x) => x * x],
    ['x²', (x) => x * x],
    ['2x^2', (x) => 2 * x * x],
    ['-x^2', (x) => -(x * x)],
    ['x^-2', (x) => x ** -2],
    ['2pix', (x) => 2 * Math.PI * x],
    ['abs(x - 1) - 2', (x) => Math.abs(x - 1) - 2],
    ['3 - x/2', (x) => 3 - x / 2],
    ['1/x', (x) => 1 / x],
    ['e^x', (x) => Math.E ** x],
    ['sqrt(x + 4)', (x) => Math.sqrt(x + 4)],
    ['−x', (x) => -x],
    ['3×x', (x) => 3 * x],
    ['6÷x', (x) => 6 / x],
    ['a*sin(b*x) + c', (x) => 2 * Math.sin(3 * x) + 5],
    ['ax + b', (x) => 2 * x + 3],
    ['π', () => Math.PI],
  ]
  it('agrees with plain JavaScript, at many points, for the forms people write', () => {
    for (const [src, f] of CASES)
      for (const x of [-5.5, -2, -0.3, 0.7, 1.9, 4.25]) {
        const want = f(x)
        // both undefined is agreement too: sqrt of a negative is NaN either way
        if (Number.isNaN(want)) expect(at(src, x), `${src} at ${x}`).toBeNaN()
        else expect(at(src, x), `${src} at ${x}`).toBeCloseTo(want, 9)
      }
  })
  it('knows its precedence: powers, then times and divide, then plus and minus', () => {
    expect(at('1 + 2*3', 0)).toBe(7)
    expect(at('2*3^2', 0)).toBe(18)
    expect(at('-2^2', 0)).toBe(-4)
    expect(at('2^3^2', 0)).toBe(512) // right to left
    expect(at('8/4/2', 0)).toBe(1) // left to right
    expect(at('(1 + 2)*3', 0)).toBe(9)
  })
  it('points at the trouble, and never fails any other way', () => {
    const where = (src: string) => {
      try {
        parse(src)
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError)
        return (e as ParseError).at
      }
      return null
    }
    expect(where('')).toBe(0)
    expect(where('x + qz')).toBe(4)
    expect(where('(x + 1')).toBe(6)
    expect(where('x)')).toBe(1)
    expect(where('2 $ 3')).toBe(2)
    expect(where('y = sin')).toBe(7)
    expect(where('2 +')).toBe(3)
    // three thousand strings of pieces in random order: an answer or a ParseError, nothing else
    let s = 9
    const rand = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 2 ** 32)
    const bits = [
      'x',
      '2',
      '(',
      ')',
      '+',
      '-',
      '*',
      '/',
      '^',
      'sin',
      'abs',
      'a',
      ' ',
      '.',
      '3.5',
      'pi',
    ]
    for (let t = 0; t < 3000; t++) {
      const src = Array.from({ length: 1 + Math.floor(rand() * 9) }, () => bits[Math.floor(rand() * bits.length)]).join('') // prettier-ignore
      try {
        const v = evaluate(parse(src), { x: 1.3, a: 1, b: 2, c: 3 })
        expect(typeof v).toBe('number')
      } catch (e) {
        expect(e, src).toBeInstanceOf(ParseError)
      }
    }
  })
  it('never hands what was typed to JavaScript to run', () => {
    expect(source).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(/)
  })
  it('knows which sliders an equation uses', () => {
    expect([...uses(parse('a*sin(b*x) + c'))].sort()).toEqual(['a', 'b', 'c'])
    expect([...uses(parse('2x + a'))]).toEqual(['a'])
    expect(uses(parse('x^2')).size).toBe(0)
  })
})

describe('matching', () => {
  it('the same curve written another way is a match; a near miss is not', () => {
    const t = sample(parse('x^2'), AB)
    expect(distance(sample(parse('x*x'), AB), t)).toBe(0)
    expect(distance(sample(parse('(x)(x) + 0'), AB), t)).toBe(0)
    expect(distance(sample(parse('x^2 + 0.1'), AB), t)).toBeGreaterThan(MATCH)
  })
  it('a hole where the target has a curve is a full plane away; where the target has none, nothing counts', () => {
    const t = sample(parse('x'), AB)
    const holes = sample(parse('sqrt(x)^2'), AB) // undefined for x < 0
    expect(distance(holes, t)).toBeCloseTo((VIEW.y1 - VIEW.y0) / 2, 1)
    // and the other way: the target sqrt(x + 4) is undefined left of −4, where anything goes
    const half = sample(parse('sqrt(x + 4)'), AB)
    const wild = sample(parse('sqrt(x + 4) + floor(-x/10 - 0.6)*0'), AB)
    expect(distance(wild, half)).toBe(0)
  })
  it('every level parses, matches itself, and is not matched by any other level', () => {
    const curves = LEVELS.map((l) => sample(parse(l.target), AB))
    curves.forEach((c, i) => {
      expect(distance(c, c), LEVELS[i].name).toBe(0)
      expect(c.length).toBe(SAMPLES)
      curves.forEach((d, j) => {
        if (i !== j)
          expect(distance(d, c), `${LEVELS[j].name} for ${LEVELS[i].name}`).toBeGreaterThan(
            MATCH * 4,
          )
      })
    })
    expect(new Set(LEVELS.map((l) => l.name)).size).toBe(LEVELS.length)
  })
})

describe('what is kept', () => {
  it('reads back a full record, every field away from its default', () => {
    const saved = {
      solved: { Bowl: 0, Wave: 2, V: 1 },
      free: { text: 'x^3 - a', a: -1.5, b: 4, c: 0.25 },
    }
    expect(readSaved(JSON.stringify(saved))).toEqual(saved)
  })
  it('a damaged record loses only what is damaged', () => {
    const got = readSaved(
      JSON.stringify({
        solved: { Bowl: 7, Wave: 1, Nope: 0, V: 'x' },
        free: { text: 'x'.repeat(200), a: 99, b: 'q', c: -2 },
      }),
    )
    expect(got).toEqual({
      solved: { Wave: 1 },
      free: { text: EMPTY_SAVED.free.text, a: 5, b: EMPTY_SAVED.free.b, c: -2 },
    })
    expect(readSaved('{')).toEqual(EMPTY_SAVED)
  })
})
