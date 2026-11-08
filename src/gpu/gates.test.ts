import { describe, expect, it } from 'vitest'
import {
  BOARD,
  LEVELS,
  MAX_GATES,
  check,
  connect,
  curve,
  disconnect,
  evaluate,
  gateAt,
  loops,
  move,
  nameOf,
  nearestPin,
  pinAt,
  pinName,
  place,
  readSaved,
  remove,
  sinks,
  sources,
  stars,
  used,
  type Circuit,
  type Kind,
  type Level,
} from './gates'

const level = (name: string) => LEVELS.find((l) => l.name === name)!

/** a circuit from a parts list: each part [kind, input, input?], an input a switch's name or
 *  '#k' for part k's output (1-based); then what each lamp is wired from */
function build(l: Level, parts: [Kind, string, string?][], outs: string[]): Circuit {
  let c: Circuit = { gates: [], wires: {} }
  for (const [kind] of parts) c = place(c, kind)!
  const key = (s: string) =>
    s.startsWith('#') ? `g${c.gates[Number(s.slice(1)) - 1].id}` : `i${l.inputs.indexOf(s)}`
  parts.forEach(([, a, b], i) => {
    const id = c.gates[i].id
    for (const [k, from] of [a, b].entries()) {
      if (from === undefined) continue
      const next = connect(l, c, key(from), `g${id}.${k}`)
      expect(next, `${l.name}: ${from} → part ${i + 1}`).not.toBeNull()
      c = next!
    }
  })
  outs.forEach((o, i) => (c = connect(l, c, key(o), `o${i}`)!))
  return c
}

const REFERENCE: Record<string, [[Kind, string, string?][], string[]]> = {
  Not: [[['NAND', 'A', 'A']], ['#1']],
  And: [
    [
      ['NAND', 'A', 'B'],
      ['NOT', '#1'],
    ],
    ['#2'],
  ],
  Or: [
    [
      ['NOT', 'A'],
      ['NOT', 'B'],
      ['NAND', '#1', '#2'],
    ],
    ['#3'],
  ],
  Xor: [
    [
      ['OR', 'A', 'B'],
      ['NAND', 'A', 'B'],
      ['AND', '#1', '#2'],
    ],
    ['#3'],
  ],
  'Half adder': [
    [
      ['XOR', 'A', 'B'],
      ['AND', 'A', 'B'],
    ],
    ['#1', '#2'],
  ],
  'Odd one out': [
    [
      ['XOR', 'A', 'B'],
      ['XOR', '#1', 'C'],
    ],
    ['#2'],
  ],
  'Full adder': [
    [
      ['XOR', 'A', 'B'],
      ['XOR', '#1', 'Carry in'],
      ['AND', 'A', 'B'],
      ['AND', '#1', 'Carry in'],
      ['OR', '#3', '#4'],
    ],
    ['#2', '#5'],
  ],
  Chooser: [
    [
      ['NOT', 'Pick'],
      ['AND', '#1', 'A'],
      ['AND', 'Pick', 'B'],
      ['OR', '#2', '#3'],
    ],
    ['#4'],
  ],
  Majority: [
    [
      ['AND', 'A', 'B'],
      ['OR', 'A', 'B'],
      ['AND', 'C', '#2'],
      ['OR', '#1', '#3'],
    ],
    ['#4'],
  ],
  'Same?': [
    [
      ['XOR', 'A1', 'B1'],
      ['XOR', 'A0', 'B0'],
      ['OR', '#1', '#2'],
      ['NOT', '#3'],
    ],
    ['#4'],
  ],
  'Two-bit adder': [
    [
      ['XOR', 'A0', 'B0'],
      ['AND', 'A0', 'B0'],
      ['XOR', 'A1', 'B1'],
      ['XOR', '#3', '#2'],
      ['AND', 'A1', 'B1'],
      ['AND', '#3', '#2'],
      ['OR', '#5', '#6'],
    ],
    ['#7', '#4', '#1'],
  ],
}

describe('the levels', () => {
  it('every level has a reference circuit at its par, using only what its palette offers', () => {
    expect(Object.keys(REFERENCE).sort()).toEqual(LEVELS.map((l) => l.name).sort())
    for (const l of LEVELS) {
      const [parts, outs] = REFERENCE[l.name]
      for (const [kind] of parts) expect(l.palette, `${l.name}: ${kind}`).toContain(kind)
      const c = build(l, parts, outs)
      const r = check(l, c)
      expect(r.solved, l.name).toBe(true)
      expect(r.rows.length).toBe(1 << l.inputs.length)
      expect(used(c, l), l.name).toBe(l.par)
      expect(stars(l, used(c, l))).toBe(3)
    }
  })

  it('the tables are the arithmetic they claim: the two-bit adder adds, the full adder carries', () => {
    const add = level('Two-bit adder')
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++) {
        const [c, s1, s0] = add.want([a >> 1, a & 1, b >> 1, b & 1])
        expect(c * 4 + s1 * 2 + s0).toBe(a + b)
      }
    const full = level('Full adder')
    for (let n = 0; n < 8; n++) {
      const ins = [(n >> 2) & 1, (n >> 1) & 1, n & 1]
      const [s, c] = full.want(ins)
      expect(c * 2 + s).toBe(ins[0] + ins[1] + ins[2])
    }
  })

  it('a wrong circuit fails on exactly the rows it gets wrong, and a gate short is not solved', () => {
    const l = level('Xor')
    // OR where AND should be: right where A and B differ, wrong where they agree
    const c = build(
      l,
      [
        ['OR', 'A', 'B'],
        ['NAND', 'A', 'B'],
        ['OR', '#1', '#2'],
      ],
      ['#3'],
    )
    const r = check(l, c)
    expect(r.solved).toBe(false)
    expect(r.rows.map((x) => x.ok)).toEqual([false, true, true, false])
    expect(check(l, { gates: [], wires: {} }).solved).toBe(false)
  })

  it('stars: three at par, two within two of it, one beyond', () => {
    const l = level('Full adder')
    expect([5, 6, 7, 8, 20].map((n) => stars(l, n))).toEqual([3, 2, 2, 1, 1])
  })
})

describe('wiring', () => {
  const l = level('Xor')
  const two = () => place(place({ gates: [], wires: {} }, 'NAND')!, 'AND')!

  it('one wire into a pin — a second replaces it — and an output feeds any number', () => {
    let c = two()
    c = connect(l, c, 'i0', 'g1.0')!
    c = connect(l, c, 'i1', 'g1.0')!
    expect(c.wires['g1.0']).toBe('i1')
    c = connect(l, c, 'g1', 'g2.0')!
    c = connect(l, c, 'g1', 'g2.1')!
    c = connect(l, c, 'g1', 'o0')!
    expect(Object.values(c.wires).filter((v) => v === 'g1').length).toBe(3)
  })

  it('refuses a loop, however long, and anything that is not a pin of the right kind', () => {
    let c = place(two(), 'OR')!
    expect(connect(l, c, 'g1', 'g1.0')).toBeNull() // a gate into itself
    c = connect(l, c, 'g1', 'g2.0')!
    c = connect(l, c, 'g2', 'g3.0')!
    expect(loops(c, 'g3', 'g1.1')).toBe(true) // 1 → 2 → 3 → 1
    expect(connect(l, c, 'g3', 'g1.1')).toBeNull()
    expect(connect(l, c, 'i0', 'g1.1')).not.toBeNull()
    expect(connect(l, c, 'o0', 'g1.1')).toBeNull() // a lamp is not a source
    expect(connect(l, c, 'g1', 'i0')).toBeNull() // a switch is not a sink
    expect(connect(l, c, 'i5', 'g1.0')).toBeNull() // no such switch
    expect(connect(l, c, 'i0', 'g9.0')).toBeNull() // no such gate
    expect(connect(l, place({ gates: [], wires: {} }, 'NOT')!, 'i0', 'g1.1')).toBeNull() // NOT has one
  })

  it('removing a gate removes every wire into and out of it, and nothing else', () => {
    let c = place(two(), 'OR')!
    c = connect(l, c, 'i0', 'g1.0')!
    c = connect(l, c, 'g1', 'g2.0')!
    c = connect(l, c, 'g2', 'g3.0')!
    c = connect(l, c, 'i1', 'g3.1')!
    c = remove(c, 2)
    expect(c.wires).toEqual({ 'g1.0': 'i0', 'g3.1': 'i1' })
    expect(disconnect(c, 'g1.0').wires).toEqual({ 'g3.1': 'i1' })
  })

  it('an unwired input reads 0 and is reported, so a missing wire never passes for a choice', () => {
    const c = connect(l, place({ gates: [], wires: {} }, 'NAND')!, 'g1', 'o0')!
    const e = evaluate(l, c, [1, 1])
    expect(e.outputs).toEqual([1]) // NAND(0, 0)
    expect(e.loose).toEqual(['g1.0', 'g1.1'])
  })

  it('only the gates that reach a lamp count', () => {
    const [parts, outs] = REFERENCE.Xor
    let c = build(l, parts, outs)
    c = place(c, 'NOT')!
    c = place(c, 'NOT')!
    expect(c.gates.length).toBe(5)
    expect(used(c, l)).toBe(3)
  })
})

describe('the board', () => {
  it('places gates without overlap until it is full, and moves one only to a free place', () => {
    let c: Circuit = { gates: [], wires: {} }
    for (let i = 0; i < MAX_GATES; i++) {
      const next = place(c, 'AND')
      if (!next) break
      c = next
    }
    const n = c.gates.length
    expect(n).toBeGreaterThanOrEqual(16)
    for (const a of c.gates)
      for (const b of c.gates)
        if (a !== b) expect(Math.abs(a.x - b.x) >= 3 || Math.abs(a.y - b.y) >= 2.5).toBe(true)
    const first = c.gates[0]
    expect(move(c, first.id, [c.gates[1].x + 0.2, c.gates[1].y])).toBe(c) // onto another
    const lone = place({ gates: [], wires: {} }, 'OR')!
    expect(move(lone, 1, [8.2, 4.4]).gates[0]).toMatchObject({ x: 8, y: 4.5 })
    expect(move(lone, 1, [-4, 4])).toBe(lone)
    expect(move(lone, 1, [8, BOARD.h])).toBe(lone)
  })

  it('every pin is found where it is drawn, and a gate under a point', () => {
    const l = level('Full adder')
    const [parts, outs] = REFERENCE['Full adder']
    const c = build(l, parts, outs)
    for (const k of [...sources(l, c), ...sinks(l, c)]) {
      const p = pinAt(l, c, k)!
      expect(p[0]).toBeGreaterThan(0)
      expect(p[0]).toBeLessThan(BOARD.w)
      expect(nearestPin(l, c, p, 'any'), k).toBe(k)
    }
    const g = c.gates[2]
    expect(gateAt(c, [g.x + 1, g.y + 1])?.id).toBe(g.id)
    expect(gateAt(c, [0.5, 0.5])).toBeNull()
    expect(pinName(l, c, 'g3.1')).toBe('AND 1 input 2')
    expect(pinName(l, c, 'i2')).toBe('switch Carry in')
    expect(nameOf(c, c.gates[4].id)).toBe('OR 1')
  })

  it('a wire leaves and arrives level, at its pins', () => {
    const pts = curve([2, 3], [9, 7])
    expect(pts[0]).toEqual([2, 3])
    expect(pts[pts.length - 1]).toEqual([9, 7])
    expect(Math.abs(pts[1][1] - 3)).toBeLessThan(Math.abs(pts[1][0] - 2))
  })
})

describe('what is kept', () => {
  it('every level’s circuit comes back exactly, gates moved away from where they were placed', () => {
    const circuits: Record<string, Circuit> = {}
    const best: Record<string, number> = {}
    for (const l of LEVELS) {
      const [parts, outs] = REFERENCE[l.name]
      let c = build(l, parts, outs)
      c = move(c, c.gates[0].id, [c.gates[0].x, c.gates[0].y + 0.5])
      circuits[l.name] = c
      best[l.name] = l.par + 1
    }
    expect(readSaved(JSON.stringify({ circuits, best }))).toEqual({ circuits, best })
  })

  it('a damaged record loses only what is damaged', () => {
    const l = level('And')
    const got = readSaved(
      JSON.stringify({
        circuits: {
          And: {
            gates: [
              { id: 1, kind: 'NAND', x: 4, y: 0.5 },
              { id: 1, kind: 'NOT', x: 10, y: 0.5 }, // the same id twice
              { id: 2, kind: 'FLUX', x: 10, y: 3 }, // no such gate
              { id: 3, kind: 'NOT', x: 4.5, y: 1 }, // on top of gate 1
              { id: 4, kind: 'NOT', x: 99, y: 1 }, // off the board
              { id: 5, kind: 'NOT', x: 10, y: 0.5 },
            ],
            wires: {
              'g1.0': 'i0',
              'g1.1': 'i9',
              'g5.0': 'g1',
              'g1.9': 'i0',
              o0: 'g5',
              'g5.1': 'i0',
            },
          },
          Nowhere: { gates: [] },
        },
        best: { And: 2, Or: -1, Xor: 'x', Not: 1.5 },
      }),
    )
    expect(got.circuits.And).toEqual({
      gates: [
        { id: 1, kind: 'NAND', x: 4, y: 0.5 },
        { id: 5, kind: 'NOT', x: 10, y: 0.5 },
      ],
      wires: { 'g1.0': 'i0', 'g5.0': 'g1', o0: 'g5' },
    })
    expect(Object.keys(got.circuits)).toEqual(['And'])
    expect(got.best).toEqual({ And: 2 })
    expect(check(l, got.circuits.And).solved).toBe(false) // NAND's second input is loose
    expect(readSaved('{')).toEqual({ circuits: {}, best: {} })
    expect(readSaved(null)).toEqual({ circuits: {}, best: {} })
  })
})
