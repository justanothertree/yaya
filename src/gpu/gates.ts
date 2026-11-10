/**
 * The Lab's logic gates: each level asks for a circuit — a NOT, an AND, an adder — built from NAND
 * and from the gates earlier levels had you build. Switches on the left, lamps on the right, gates
 * between, and a truth table that says, for every way the switches can be set, what the lamps
 * should show and what yours do.
 *
 * ⚠️ A WIRE IS KEYED BY WHERE IT ENDS. An input pin takes one wire and an output may feed many, so
 * `wires[to] = from` cannot hold two wires into one pin, and replacing a wire is assignment. Keys:
 * `i2` switch 2, `g5` gate 5's output, `g5.1` gate 5's second input, `o0` lamp 0.
 *
 * Pure, so all of it can be asked a question without a browser.
 */

export type Kind = 'NAND' | 'NOT' | 'AND' | 'OR' | 'XOR'

export const KINDS: Record<Kind, { inputs: number; f: (a: number, b: number) => number }> = {
  NAND: { inputs: 2, f: (a, b) => 1 - (a & b) },
  NOT: { inputs: 1, f: (a) => 1 - a },
  AND: { inputs: 2, f: (a, b) => a & b },
  OR: { inputs: 2, f: (a, b) => a | b },
  XOR: { inputs: 2, f: (a, b) => a ^ b },
}
const KIND_NAMES = Object.keys(KINDS) as Kind[]

export type Gate = { id: number; kind: Kind; x: number; y: number }
export type Circuit = { gates: Gate[]; wires: Record<string, string> }

export type Level = {
  name: string
  inputs: string[]
  outputs: string[]
  /** what the lamps should show for one setting of the switches, in order */
  want: (ins: number[]) => number[]
  /** the gates on offer: NAND, and each one built in a level before */
  palette: Kind[]
  /** the fewest gates found for it — a target, not a proof */
  par: number
  hint: string
}

const bits = (n: number, k: number) => Array.from({ length: k }, (_, i) => (n >> (k - 1 - i)) & 1)

export const LEVELS: Level[] = [
  {
    name: 'Not',
    inputs: ['A'],
    outputs: ['Out'],
    want: ([a]) => [1 - a],
    palette: ['NAND'],
    par: 1,
    hint: 'A NAND is 0 only when both its inputs are 1. What if both inputs are the same wire?',
  },
  {
    name: 'And',
    inputs: ['A', 'B'],
    outputs: ['Out'],
    want: ([a, b]) => [a & b],
    palette: ['NAND', 'NOT'],
    par: 2,
    hint: 'NAND is "not and". Undo the "not".',
  },
  {
    name: 'Or',
    inputs: ['A', 'B'],
    outputs: ['Out'],
    want: ([a, b]) => [a | b],
    palette: ['NAND', 'NOT', 'AND'],
    par: 3,
    hint: 'A NAND of two flipped inputs is 1 when either input is 1.',
  },
  {
    name: 'Xor',
    inputs: ['A', 'B'],
    outputs: ['Out'],
    want: ([a, b]) => [a ^ b],
    palette: ['NAND', 'NOT', 'AND', 'OR'],
    par: 3,
    hint: 'One or the other, but not both: "or" and "not and" at once.',
  },
  {
    name: 'Half adder',
    inputs: ['A', 'B'],
    outputs: ['Sum', 'Carry'],
    want: ([a, b]) => [a ^ b, a & b],
    palette: ['NAND', 'NOT', 'AND', 'OR', 'XOR'],
    par: 2,
    hint: 'Add two bits: 1 + 1 is 10 in binary — a sum of 0 and a carry of 1.',
  },
  {
    name: 'Odd one out',
    inputs: ['A', 'B', 'C'],
    outputs: ['Odd'],
    want: ([a, b, c]) => [a ^ b ^ c],
    palette: ['NAND', 'NOT', 'AND', 'OR', 'XOR'],
    par: 2,
    hint: 'Lit when an odd number of switches are on. XOR is "odd" for two.',
  },
  {
    name: 'Full adder',
    inputs: ['A', 'B', 'Carry in'],
    outputs: ['Sum', 'Carry'],
    want: ([a, b, c]) => [a ^ b ^ c, (a & b) | (c & (a ^ b))],
    palette: ['NAND', 'NOT', 'AND', 'OR', 'XOR'],
    par: 5,
    hint: 'Two half adders: add A and B, then add the carry in. Either half can carry.',
  },
  {
    name: 'Chooser',
    inputs: ['Pick', 'A', 'B'],
    outputs: ['Out'],
    want: ([s, a, b]) => [s ? b : a],
    palette: ['NAND', 'NOT', 'AND', 'OR', 'XOR'],
    par: 4,
    hint: 'Out is A when Pick is 0 and B when Pick is 1. Let Pick open one gate and close the other.',
  },
  {
    name: 'Majority',
    inputs: ['A', 'B', 'C'],
    outputs: ['Most'],
    want: ([a, b, c]) => [a + b + c >= 2 ? 1 : 0],
    palette: ['NAND', 'NOT', 'AND', 'OR', 'XOR'],
    par: 4,
    hint: 'Two of three: A and B both on, or C on with at least one of A and B.',
  },
  {
    name: 'Same?',
    inputs: ['A1', 'A0', 'B1', 'B0'],
    outputs: ['Equal'],
    want: ([a1, a0, b1, b0]) => [a1 === b1 && a0 === b0 ? 1 : 0],
    palette: ['NAND', 'NOT', 'AND', 'OR', 'XOR'],
    par: 4,
    hint: 'Two two-bit numbers are equal when no bit differs. XOR says where a bit differs.',
  },
  {
    name: 'Two-bit adder',
    inputs: ['A1', 'A0', 'B1', 'B0'],
    outputs: ['Carry', 'S1', 'S0'],
    want: ([a1, a0, b1, b0]) => {
      const n = a1 * 2 + a0 + b1 * 2 + b0
      return bits(n, 3)
    },
    palette: ['NAND', 'NOT', 'AND', 'OR', 'XOR'],
    par: 7,
    hint: 'A half adder for the low bits, and a full adder for the high bits with its carry.',
  },
]

/* ------------------------------------------------------------------------------- the board */

/** the board, in grid units: switches down the left edge, lamps down the right */
export const BOARD = { w: 22, h: 12 }
export const GATE = { w: 2, h: 2 }
/** a switch or a lamp: a labelled box at the board's edge, its pin just inside */
export const IO = { w: 2.6, h: 1.3, inset: 0.15 }
export const MAX_GATES = 20

export const spread = (k: number, n: number) => ((k + 0.5) * BOARD.h) / n

/** where a key's pin sits on the board */
export function pinAt(level: Level, c: Circuit, key: string): [number, number] | null {
  const m = /^([iog])(\d+)(?:\.(\d))?$/.exec(key)
  if (!m) return null
  const n = Number(m[2])
  if (m[1] === 'i')
    return n < level.inputs.length ? [IO.w + 0.45, spread(n, level.inputs.length)] : null
  if (m[1] === 'o') return n < level.outputs.length ? [BOARD.w - IO.w - 0.45, spread(n, level.outputs.length)] : null // prettier-ignore
  const g = c.gates.find((x) => x.id === n)
  if (!g) return null
  if (m[3] === undefined) return [g.x + GATE.w + 0.3, g.y + GATE.h / 2]
  const k = Number(m[3])
  const ins = KINDS[g.kind].inputs
  if (k >= ins) return null
  return [g.x - 0.3, g.y + ((k + 1) * GATE.h) / (ins + 1)]
}

/** every pin that can START a wire, then every pin that can END one */
export function sources(level: Level, c: Circuit): string[] {
  return [...level.inputs.map((_, i) => `i${i}`), ...c.gates.map((g) => `g${g.id}`)]
}
export function sinks(level: Level, c: Circuit): string[] {
  return [
    ...c.gates.flatMap((g) =>
      Array.from({ length: KINDS[g.kind].inputs }, (_, k) => `g${g.id}.${k}`),
    ),
    ...level.outputs.map((_, i) => `o${i}`),
  ]
}

/** the nearest pin to a board point within reach, of the kind asked for */
export function nearestPin(
  level: Level,
  c: Circuit,
  p: [number, number],
  of: 'source' | 'sink' | 'any',
  reach = 0.6,
): string | null {
  const keys =
    of === 'source' ? sources(level, c) : of === 'sink' ? sinks(level, c) : [...sources(level, c), ...sinks(level, c)] // prettier-ignore
  let best: string | null = null
  let bd = reach
  for (const k of keys) {
    const q = pinAt(level, c, k)
    if (!q) continue
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (d < bd) {
      bd = d
      best = k
    }
  }
  return best
}

export function gateAt(c: Circuit, p: [number, number]): Gate | null {
  for (let i = c.gates.length - 1; i >= 0; i--) {
    const g = c.gates[i]
    if (p[0] >= g.x && p[0] <= g.x + GATE.w && p[1] >= g.y && p[1] <= g.y + GATE.h) return g
  }
  return null
}

/** gates may sit anywhere between the switches and the lamps, on whole units, not on each other */
const LEFT = 4
const RIGHT = BOARD.w - 4 - GATE.w
const fits = (c: Circuit, x: number, y: number, skip?: number) =>
  x >= LEFT &&
  x <= RIGHT &&
  y >= 0 &&
  y <= BOARD.h - GATE.h &&
  c.gates.every(
    (g) => g.id === skip || Math.abs(g.x - x) >= GATE.w + 1 || Math.abs(g.y - y) >= GATE.h + 0.5,
  )

/** a new gate at the first free place, scanning from the left; null when the board is full */
export function place(c: Circuit, kind: Kind): Circuit | null {
  if (c.gates.length >= MAX_GATES) return null
  const id = c.gates.reduce((m, g) => Math.max(m, g.id), 0) + 1
  for (let x = LEFT; x <= RIGHT; x += GATE.w + 1)
    for (let y = 0.5; y <= BOARD.h - GATE.h; y += GATE.h + 0.5)
      if (fits(c, x, y)) return { ...c, gates: [...c.gates, { id, kind, x, y }] }
  return null
}

/** a gate dragged to a point: snapped to the half unit, and left where it was if it would land
 *  off the board or on another gate */
export function move(c: Circuit, id: number, to: [number, number]): Circuit {
  const x = Math.round(to[0] * 2) / 2
  const y = Math.round(to[1] * 2) / 2
  if (!fits(c, x, y, id)) return c
  return { ...c, gates: c.gates.map((g) => (g.id === id ? { ...g, x, y } : g)) }
}

/** a gate taken away, and every wire into or out of it */
export function remove(c: Circuit, id: number): Circuit {
  const wires: Record<string, string> = {}
  for (const [to, from] of Object.entries(c.wires))
    if (from !== `g${id}` && !to.startsWith(`g${id}.`)) wires[to] = from
  return { gates: c.gates.filter((g) => g.id !== id), wires }
}

/** the gate a pin key belongs to, or null for a switch or a lamp */
const gateOf = (key: string) => {
  const m = /^g(\d+)/.exec(key)
  return m ? Number(m[1]) : null
}

/** would wiring `from` into `to` make a signal go round in a circle — a gate feeding itself? */
export function loops(c: Circuit, from: string, to: string): boolean {
  const target = gateOf(to)
  const start = gateOf(from)
  if (target === null || start === null) return false
  // does `start` depend on `target` already? walk back from start through the wires
  const seen = new Set<number>()
  const stack = [start]
  while (stack.length) {
    const g = stack.pop()!
    if (g === target) return true
    if (seen.has(g)) continue
    seen.add(g)
    for (const [k, f] of Object.entries(c.wires)) {
      if (gateOf(k) !== g || k === `g${g}`) continue
      const up = gateOf(f)
      if (up !== null) stack.push(up)
    }
  }
  return false
}

/** a wire: refused (null) when either end is not a pin of its kind, or it would make a loop */
export function connect(level: Level, c: Circuit, from: string, to: string): Circuit | null {
  if (!sources(level, c).includes(from) || !sinks(level, c).includes(to)) return null
  if (loops(c, from, to)) return null
  return { ...c, wires: { ...c.wires, [to]: from } }
}

export function disconnect(c: Circuit, to: string): Circuit {
  const wires = { ...c.wires }
  delete wires[to]
  return { ...c, wires }
}

/* ---------------------------------------------------------------------------- what it does */

/**
 * Every pin's value for one setting of the switches. An input with no wire reads 0 — and is
 * reported, so the page can say so rather than let a missing wire pass for a deliberate 0.
 */
export function evaluate(level: Level, c: Circuit, ins: number[]) {
  const memo = new Map<number, number>()
  const byId = new Map(c.gates.map((g) => [g.id, g]))
  const value = (key: string | undefined, depth = 0): number => {
    if (!key || depth > 64) return 0
    if (key[0] === 'i') return ins[Number(key.slice(1))] ?? 0
    const id = Number(key.slice(1))
    const known = memo.get(id)
    if (known !== undefined) return known
    const g = byId.get(id)
    if (!g) return 0
    const k = KINDS[g.kind]
    const a = value(c.wires[`g${id}.0`], depth + 1)
    const b = k.inputs > 1 ? value(c.wires[`g${id}.1`], depth + 1) : 0
    const v = k.f(a, b)
    memo.set(id, v)
    return v
  }
  const outputs = level.outputs.map((_, i) => value(c.wires[`o${i}`]))
  const pins: Record<string, number> = {}
  for (const k of sources(level, c)) pins[k] = value(k)
  const loose = sinks(level, c).filter((k) => c.wires[k] === undefined)
  return { outputs, pins, loose }
}

export type Row = { ins: number[]; want: number[]; got: number[]; ok: boolean }

/** the whole truth table: every setting of the switches, in counting order */
export function check(level: Level, c: Circuit): { rows: Row[]; solved: boolean; loose: string[] } {
  const n = level.inputs.length
  const rows: Row[] = []
  for (let r = 0; r < 1 << n; r++) {
    const ins = bits(r, n)
    const want = level.want(ins)
    const { outputs: got } = evaluate(level, c, ins)
    rows.push({ ins, want, got, ok: got.every((v, i) => v === want[i]) })
  }
  const loose = evaluate(level, c, bits(0, n)).loose
  const lampsWired = level.outputs.every((_, i) => c.wires[`o${i}`] !== undefined)
  return { rows, solved: lampsWired && rows.every((r) => r.ok), loose }
}

/** three stars at par, two within two gates of it, one for any working circuit */
export const stars = (level: Level, gates: number) =>
  gates <= level.par ? 3 : gates <= level.par + 2 ? 2 : 1

/** the gates that actually reach a lamp — a spare gate left lying about does not count against you */
export function used(c: Circuit, level: Level): number {
  const seen = new Set<number>()
  const stack = level.outputs.map((_, i) => c.wires[`o${i}`]).filter(Boolean) as string[]
  while (stack.length) {
    const k = stack.pop()!
    const id = gateOf(k)
    if (id === null || seen.has(id)) continue
    seen.add(id)
    for (let p = 0; p < 2; p++) {
      const f = c.wires[`g${id}.${p}`]
      if (f) stack.push(f)
    }
  }
  return seen.size
}

/** what to call a gate in words: "NAND 2" — its kind and its place among gates of that kind */
export function nameOf(c: Circuit, id: number): string {
  const g = c.gates.find((x) => x.id === id)
  if (!g) return '?'
  const same = c.gates.filter((x) => x.kind === g.kind)
  return `${g.kind} ${same.indexOf(g) + 1}`
}

/** what to call any pin in words */
export function pinName(level: Level, c: Circuit, key: string): string {
  if (key[0] === 'i') return `switch ${level.inputs[Number(key.slice(1))]}`
  if (key[0] === 'o') return `lamp ${level.outputs[Number(key.slice(1))]}`
  const id = gateOf(key)!
  const m = /\.(\d)$/.exec(key)
  return m ? `${nameOf(c, id)} input ${Number(m[1]) + 1}` : nameOf(c, id)
}

/* -------------------------------------------------------------------------- what is kept */

export const GATES_KEY = 'lab_gates_v1'
export type Saved = {
  /** each level's circuit as it was left */
  circuits: Record<string, Circuit>
  /** each solved level's fewest gates */
  best: Record<string, number>
}
export const EMPTY_SAVED: Saved = { circuits: {}, best: {} }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** one circuit read back for a level: gates of known kinds on the board, wires between pins that
 *  exist, no loops — anything else is dropped, and only that */
export function readCircuit(level: Level, raw: unknown): Circuit {
  const out: Circuit = { gates: [], wires: {} }
  if (!isRecord(raw)) return out
  if (Array.isArray(raw.gates))
    for (const g of raw.gates) {
      if (out.gates.length >= MAX_GATES || !isRecord(g)) continue
      const { id, kind, x, y } = g
      if (!Number.isInteger(id) || (id as number) < 1) continue
      if (typeof kind !== 'string' || !KIND_NAMES.includes(kind as Kind)) continue
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if (out.gates.some((o) => o.id === id)) continue
      const placed = move({ ...out, gates: [...out.gates, { id: id as number, kind: kind as Kind, x: -99, y: -99 }] }, id as number, [x as number, y as number]) // prettier-ignore
      // a gate whose place is taken or off the board is dropped rather than moved somewhere else
      if (placed.gates.find((o) => o.id === id)!.x !== -99) out.gates = placed.gates
    }
  if (isRecord(raw.wires))
    for (const [to, from] of Object.entries(raw.wires)) {
      if (typeof from !== 'string') continue
      const next = connect(level, out, from, to)
      if (next) out.wires = next.wires
    }
  return out
}

export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return { circuits: {}, best: {} }
  }
  const saved: Saved = { circuits: {}, best: {} }
  if (!isRecord(v)) return saved
  for (const l of LEVELS) {
    if (isRecord(v.circuits) && v.circuits[l.name] !== undefined)
      saved.circuits[l.name] = readCircuit(l, v.circuits[l.name])
    const b = isRecord(v.best) ? v.best[l.name] : undefined
    if (Number.isInteger(b) && (b as number) >= 0 && (b as number) <= MAX_GATES)
      saved.best[l.name] = b as number
  }
  return saved
}

/* ------------------------------------------------------------------------------ the stage */

/** the board fitted into the stage: pixels per unit and where the board's corner sits */
export function fitBoard(stage: [number, number]) {
  const s = Math.min(stage[0] / (BOARD.w + 0.5), stage[1] / (BOARD.h + 0.5))
  return { s, ox: (stage[0] - BOARD.w * s) / 2, oy: (stage[1] - BOARD.h * s) / 2 }
}
export const toBoard = (f: ReturnType<typeof fitBoard>, p: [number, number]): [number, number] => [
  (p[0] - f.ox) / f.s,
  (p[1] - f.oy) / f.s,
]

/** shapes for the shader, three vec4s each: (type, x, y, a), (b, c, d, value), (label, flags, 0, 0)
 *  type 0 a wire segment from (x,y) to (b,c), half-width a; 1 a gate box at (x,y) sized (a,b),
 *  inverted output if c; 2 a pin, radius a; 3 a switch or a lamp at (x,y) sized (a,b) */
export const MAX_SHAPES = 2048
export const FLOATS_PER_SHAPE = 12

/** points along a wire from one pin to another: a gentle S, flat at both ends */
export function curve(a: [number, number], b: [number, number], n = 14): [number, number][] {
  const dx = Math.max(1, Math.abs(b[0] - a[0]) * 0.5)
  const c1: [number, number] = [a[0] + dx, a[1]]
  const c2: [number, number] = [b[0] - dx, b[1]]
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const u = 1 - t
    return [
      u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
      u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1],
    ]
  })
}

/** the words the shader can draw: the gate kinds, then this level's switches and lamps */
export const labelsFor = (level: Level) => [...KIND_NAMES, ...level.inputs, ...level.outputs]

export type Look = {
  selected: number | null
  /** a wire being drawn: from a pin to wherever the pointer is */
  dragging: { from: string; to: [number, number] } | null
  /** the pin a wire would land on if let go now, or the one picked first by a tap */
  target: string | null
  /** per lamp: does it show what this row wants */
  wrong: boolean[]
}

/** everything to draw, as FLOATS_PER_SHAPE floats a shape (see MAX_SHAPES above) */
export function shapes(level: Level, c: Circuit, ins: number[], look: Look) {
  const out = new Float32Array(MAX_SHAPES * FLOATS_PER_SHAPE)
  let n = 0
  const put = (a: number[], b: number[], d: number[]) => {
    if (n >= MAX_SHAPES) return
    out.set([...a, ...b, ...d], n * FLOATS_PER_SHAPE)
    n++
  }
  const { pins } = evaluate(level, c, ins)
  const wire = (from: [number, number], to: [number, number], v: number, flags = 0) => {
    const pts = curve(from, to)
    for (let i = 0; i < pts.length - 1; i++)
      put([0, pts[i][0], pts[i][1], 0.09], [pts[i + 1][0], pts[i + 1][1], i / (pts.length - 1), v], [0, flags, 0, 0]) // prettier-ignore
  }
  for (const [to, from] of Object.entries(c.wires)) {
    const a = pinAt(level, c, from)
    const b = pinAt(level, c, to)
    if (a && b) wire(a, b, pins[from] ?? 0)
  }
  if (look.dragging) {
    const a = pinAt(level, c, look.dragging.from)
    if (a) wire(a, look.dragging.to, pins[look.dragging.from] ?? 0, 1)
  }
  const label = (s: string) => labelsFor(level).indexOf(s)
  for (const g of c.gates)
    put(
      [1, g.x, g.y, GATE.w],
      [GATE.h, g.kind === 'NAND' || g.kind === 'NOT' ? 1 : 0, 0, pins[`g${g.id}`] ?? 0],
      [label(g.kind), look.selected === g.id ? 1 : 0, 0, 0],
    )
  level.inputs.forEach((name, i) => {
    const y = spread(i, level.inputs.length)
    put([3, IO.inset, y - IO.h / 2, IO.w], [IO.h, 0, 0, ins[i] ?? 0], [label(name), 0, 0, 0])
  })
  level.outputs.forEach((name, i) => {
    const y = spread(i, level.outputs.length)
    const v = pins[c.wires[`o${i}`] ?? ''] ?? 0
    put([3, BOARD.w - IO.inset - IO.w, y - IO.h / 2, IO.w], [IO.h, 1, 0, v], [label(name), look.wrong[i] ? 1 : 0, 0, 0]) // prettier-ignore
  })
  for (const k of [...sources(level, c), ...sinks(level, c)]) {
    const p = pinAt(level, c, k)
    if (!p) continue
    const isSink = k.includes('.') || k[0] === 'o'
    const v = isSink ? (pins[c.wires[k] ?? ''] ?? 0) : (pins[k] ?? 0)
    const loose = isSink && c.wires[k] === undefined
    put([2, p[0], p[1], 0.22], [0, 0, 0, v], [0, (loose ? 1 : 0) | (look.target === k ? 2 : 0), 0, 0]) // prettier-ignore
  }
  return { data: out, count: n }
}
