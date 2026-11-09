/**
 * The physics and rules of the Lab's bridge builder: joints and members, a cart driven across, and
 * what breaks. Pure, so bridge.test.ts can drive a cart over a bridge without a GPU.
 *
 * ⚠️ XPBD, NOT PLAIN VERLET, BECAUSE A MEMBER HAS TO KNOW ITS FORCE. Position-based constraints
 * pull joints together but say nothing about how hard; "this beam breaks above 9 kN" needs a
 * number in newtons. XPBD's Lagrange multiplier is exactly that: each step solves for λ, and λ/h² is
 * the force the member carries. So strength is a real figure, and the colours on screen are those
 * forces divided by it. Small steps with one iteration each (Macklin's "small steps") keep it
 * stiff without a hundred iterations a frame.
 */

export type V2 = [number, number]
export type Kind = 'road' | 'wood' | 'steel'

export const MATERIALS: Record<
  Kind,
  {
    label: string
    strength: number
    kgPerM: number
    costPerM: number
    colour: [number, number, number]
  }
> = {
  road: { label: 'Road', strength: 14000, kgPerM: 30, costPerM: 150, colour: [0.25, 0.22, 0.2] },
  wood: { label: 'Timber', strength: 9000, kgPerM: 15, costPerM: 100, colour: [0.72, 0.52, 0.3] },
  steel: { label: 'Steel', strength: 26000, kgPerM: 35, costPerM: 280, colour: [0.6, 0.65, 0.72] },
}

/** a member no longer than this — longer would be too easy and look like nothing on screen */
export const MAX_LENGTH = 4.5
export const GRAVITY = 9.81
/** the joints themselves weigh something, so a member's ends are never massless */
const JOINT_KG = 5
const COMPLIANCE = 1e-9

export type Joint = { x: number; y: number; fixed: boolean }
export type Member = { a: number; b: number; kind: Kind }
export type Design = { joints: Joint[]; members: Member[] }

export type Level = {
  name: string
  hint: string
  /** the gap: the cliffs end at x = 0 and x = span, both at road height y = 0 */
  span: number
  anchors: V2[]
  budget: number
  cart: number // kg
  kinds: Kind[]
  /** how far below the road the water is */
  water: number
}

export const LEVELS: Level[] = [
  {
    name: 'A short hop',
    hint: 'Lay road across, then brace it from the anchors below with timber triangles.',
    span: 6,
    anchors: [
      [0, 0],
      [6, 0],
      [0, -2],
      [6, -2],
    ],
    budget: 3600,
    cart: 400,
    kinds: ['road', 'wood'],
    water: 5,
  },
  {
    name: 'Ten metres',
    hint: 'A row of triangles — a truss — turns a sagging road into a stiff beam.',
    span: 10,
    anchors: [
      [0, 0],
      [10, 0],
      [0, -3],
      [10, -3],
    ],
    budget: 6500,
    cart: 400,
    kinds: ['road', 'wood'],
    water: 5,
  },
  {
    name: 'Nothing below',
    hint: 'No anchors under the road this time: the truss has to go above it.',
    span: 8,
    anchors: [
      [0, 0],
      [8, 0],
    ],
    budget: 5000,
    cart: 400,
    kinds: ['road', 'wood'],
    water: 5,
  },
  {
    name: 'The pier',
    hint: 'A pier stands in the middle. Two short bridges are easier than one long one.',
    span: 14,
    anchors: [
      [0, 0],
      [14, 0],
      [7, -3],
    ],
    budget: 9500,
    cart: 400,
    kinds: ['road', 'wood'],
    water: 5,
  },
  {
    name: 'A heavy load',
    hint: 'A cart twice the weight. Steel is stronger and dearer — use it where the red is.',
    span: 10,
    anchors: [
      [0, 0],
      [10, 0],
      [0, -3],
      [10, -3],
    ],
    budget: 12000,
    cart: 900,
    kinds: ['road', 'wood', 'steel'],
    water: 5,
  },
  {
    name: 'The long way over',
    hint: 'Fourteen metres with nothing in the middle. Its own weight is half the battle.',
    span: 14,
    anchors: [
      [0, 0],
      [14, 0],
      [0, -3],
      [14, -3],
    ],
    budget: 19500,
    cart: 400,
    kinds: ['road', 'wood', 'steel'],
    water: 5,
  },
]

export const length = (d: Design, m: Member) =>
  Math.hypot(d.joints[m.a].x - d.joints[m.b].x, d.joints[m.a].y - d.joints[m.b].y)

export const cost = (d: Design) =>
  Math.round(d.members.reduce((c, m) => c + length(d, m) * MATERIALS[m.kind].costPerM, 0))

/** a fresh design: the level's anchors, and nothing else */
export const start = (l: Level): Design => ({
  joints: l.anchors.map(([x, y]) => ({ x, y, fixed: true })),
  members: [],
})

/** where a joint may go: on the 1 m grid, over the gap or the cliff tops, not inside the rock */
export function canJoint(l: Level, x: number, y: number) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false
  if (x < -2 || x > l.span + 2 || y < -l.water + 1 || y > 6) return false
  // the cliffs are rock below the road: x ≤ 0 or x ≥ span, y < 0 — except where an anchor is
  if ((x < 0 || x > l.span) && y < 0) return false
  if ((x === 0 || x === l.span) && y < 0) return l.anchors.some(([ax, ay]) => ax === x && ay === y)
  return true
}

/** the joint at a point, adding one if the point is a legal place for it; −1 if not */
export function jointAt(l: Level, d: Design, x: number, y: number, add: boolean): number {
  const i = d.joints.findIndex((j) => j.x === x && j.y === y)
  if (i >= 0 || !add) return i
  if (!canJoint(l, x, y)) return -1
  // a joint off the gap, on a cliff top, is ground: fixed
  const ground = (x <= 0 || x >= l.span) && y === 0
  d.joints.push({ x, y, fixed: ground })
  return d.joints.length - 1
}

export type Refusal = 'same' | 'long' | 'exists' | 'kind' | null

/** add a member between two joints (by index), or say why not */
export function addMember(l: Level, d: Design, a: number, b: number, kind: Kind): Refusal {
  if (a === b) return 'same'
  if (!l.kinds.includes(kind)) return 'kind'
  const len = Math.hypot(d.joints[a].x - d.joints[b].x, d.joints[a].y - d.joints[b].y)
  if (len > MAX_LENGTH + 1e-9) return 'long'
  if (d.members.some((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a))) return 'exists'
  d.members.push({ a, b, kind })
  return null
}

/** take a member out, and any free joint it leaves with nothing attached */
export function removeMember(d: Design, i: number) {
  d.members.splice(i, 1)
  for (let j = d.joints.length - 1; j >= 0; j--) {
    if (d.joints[j].fixed) continue
    if (d.members.some((m) => m.a === j || m.b === j)) continue
    d.joints.splice(j, 1)
    for (const m of d.members) {
      if (m.a > j) m.a--
      if (m.b > j) m.b--
    }
  }
}

/* ---------------------------------------------------------------- the test drive -------------- */

export type Sim = {
  level: Level
  design: Design
  p: V2[]
  prev: V2[]
  w: number[] // inverse mass, 0 for fixed
  rest: number[]
  broken: boolean[]
  /** the force each member carried last step, newtons: + pulled, − pushed */
  force: number[]
  cart: { x: number; y: number; v: number; on: number | null }
  t: number
  outcome: 'driving' | 'across' | 'fell' | 'stuck'
}

export const SPEED = 2.5 // m/s
export const STEPS = 30 // substeps per frame
export const FRAME = 1 / 60
/** constraint passes per substep: enough that a chain of members is as stiff as its material */
export const ITERS = 6

export function simulate(level: Level, design: Design): Sim {
  const n = design.joints.length
  const mass = new Array(n).fill(JOINT_KG)
  design.members.forEach((m) => {
    const half = (length(design, m) * MATERIALS[m.kind].kgPerM) / 2
    mass[m.a] += half
    mass[m.b] += half
  })
  return {
    level,
    design,
    p: design.joints.map((j) => [j.x, j.y]),
    prev: design.joints.map((j) => [j.x, j.y]),
    w: design.joints.map((j, i) => (j.fixed ? 0 : 1 / mass[i])),
    rest: design.members.map((m) => length(design, m)),
    broken: design.members.map(() => false),
    force: design.members.map(() => 0),
    cart: { x: -3, y: 0, v: SPEED, on: null },
    t: 0,
    outcome: 'driving',
  }
}

/** the road member under x, and how far along it (0 at a, 1 at b), from where the joints are now */
function roadUnder(s: Sim, x: number): { i: number; t: number; y: number } | null {
  let best: { i: number; t: number; y: number } | null = null
  s.design.members.forEach((m, i) => {
    if (m.kind !== 'road' || s.broken[i]) return
    const [ax, ay] = s.p[m.a]
    const [bx, by] = s.p[m.b]
    const lo = Math.min(ax, bx)
    const hi = Math.max(ax, bx)
    if (x < lo - 1e-6 || x > hi + 1e-6 || hi - lo < 1e-6) return
    const t = (x - ax) / (bx - ax)
    const y = ay + (by - ay) * t
    // where two road members overlap at x, the higher is the one the wheels are on
    if (!best || y > best.y) best = { i, t, y }
  })
  return best
}

/** one frame: STEPS small XPBD steps, the cart moved along whatever road is under it */
export function step(s: Sim, frame = FRAME) {
  if (s.outcome !== 'driving') return
  const h = frame / STEPS
  const alpha = COMPLIANCE / (h * h)
  const { level } = s
  for (let k = 0; k < STEPS; k++) {
    // the cart: on the cliff tops it rolls on rock; over the gap it needs a road
    const c = s.cart
    c.x += c.v * h
    let load: { i: number; t: number } | null = null
    if (c.x <= 0 || c.x >= level.span) {
      c.y = 0
      c.on = null
    } else {
      const r = roadUnder(s, c.x)
      if (!r) {
        s.outcome = 'fell'
        return
      }
      c.y = r.y
      c.on = r.i
      load = r
    }
    // integrate: gravity, and the cart's weight on the two joints of the road it is on
    for (let i = 0; i < s.p.length; i++) {
      if (s.w[i] === 0) continue
      const [x, y] = s.p[i]
      const vx = (x - s.prev[i][0]) * 0.9995
      const vy = (y - s.prev[i][1]) * 0.9995
      s.prev[i] = [x, y]
      s.p[i] = [x + vx, y + vy - GRAVITY * h * h]
    }
    if (load) {
      const m = s.design.members[load.i]
      const f = level.cart * GRAVITY * h * h
      if (s.w[m.a]) s.p[m.a][1] -= f * (1 - load.t) * s.w[m.a]
      if (s.w[m.b]) s.p[m.b][1] -= f * load.t * s.w[m.b]
    }
    // the members: a few XPBD passes, the force taken from the multiplier summed over them
    s.force.fill(0)
    for (let it = 0; it < ITERS; it++)
      s.design.members.forEach((m, i) => {
        if (s.broken[i]) return
        const wa = s.w[m.a]
        const wb = s.w[m.b]
        const W = wa + wb
        if (W === 0) return
        const [ax, ay] = s.p[m.a]
        const [bx, by] = s.p[m.b]
        const dx = bx - ax
        const dy = by - ay
        const len = Math.hypot(dx, dy) || 1e-9
        const C = len - s.rest[i]
        const lambda = -C / (W + alpha)
        const nx = dx / len
        const ny = dy / len
        s.p[m.a] = [ax - nx * lambda * wa, ay - ny * lambda * wa]
        s.p[m.b] = [bx + nx * lambda * wb, by + ny * lambda * wb]
        // λ/h² is the force: stretched (C > 0) is tension, which we call positive
        s.force[i] += -lambda / (h * h)
      })
    s.design.members.forEach((m, i) => {
      if (!s.broken[i] && Math.abs(s.force[i]) > MATERIALS[m.kind].strength) s.broken[i] = true
    })
  }
  s.t += frame
  if (s.cart.x > level.span + 1.5) s.outcome = 'across'
  else if (s.p.some(([, y]) => y < -level.water)) {
    // a joint in the water is a bridge that has come down, whether or not the cart has noticed
    if (s.cart.x > 0) s.outcome = 'fell'
  } else if (s.t > 30) s.outcome = 'stuck'
}

/** drive it to the end: the outcome, and the hardest any member worked as a share of its strength */
export function testDrive(level: Level, design: Design, most = 30) {
  const s = simulate(level, design)
  let worst = 0
  while (s.outcome === 'driving' && s.t < most) {
    step(s)
    s.design.members.forEach((m, i) => {
      if (!s.broken[i]) worst = Math.max(worst, Math.abs(s.force[i]) / MATERIALS[m.kind].strength)
    })
  }
  return { outcome: s.outcome, worst, broken: s.broken.filter(Boolean).length, sim: s }
}

/* ---------------------------------------------------------------- reference bridges ----------- */

/**
 * A Warren truss over a gap, as a builder would draw it: road joints every `panel` metres, a chord
 * `rise` above (or below, negative) at the half-panels, diagonals between, and posts to any anchor
 * directly under an end. It exists so a test can drive over every level: a level nobody can cross
 * is a bug, and one crossed by a flat road is not a puzzle.
 */
export function warren(l: Level, rise: number, diag: Kind, chord: Kind, panel = 2): Design {
  const d = start(l)
  const deck: number[] = []
  for (let x = 0; x <= l.span; x += panel) deck.push(jointAt(l, d, x, 0, true))
  for (let i = 0; i + 1 < deck.length; i++) addMember(l, d, deck[i], deck[i + 1], 'road')
  const chordJoints: number[] = []
  for (let x = panel / 2; x < l.span; x += panel) {
    const j = jointAt(l, d, x, rise, true)
    if (j < 0) continue
    chordJoints.push(j)
    const left = deck[Math.round((x - panel / 2) / panel)]
    const right = deck[Math.round((x + panel / 2) / panel)]
    addMember(l, d, left, j, diag)
    addMember(l, d, j, right, diag)
  }
  for (let i = 0; i + 1 < chordJoints.length; i++)
    addMember(l, d, chordJoints[i], chordJoints[i + 1], chord)
  // anchors below the road: tie the nearest chord joint to each
  for (const [ax, ay] of l.anchors) {
    if (ay >= 0 || rise >= 0) continue
    const a = jointAt(l, d, ax, ay, false)
    const near = chordJoints.reduce(
      (best, j) =>
        Math.hypot(d.joints[j].x - ax, d.joints[j].y - ay) <
        Math.hypot(d.joints[best].x - ax, d.joints[best].y - ay)
          ? j
          : best,
      chordJoints[0],
    )
    if (a >= 0 && near !== undefined) addMember(l, d, a, near, chord)
  }
  return d
}

/** one bridge known to cross each level within its budget — what 💡 shows, and what the tests drive */
export const REFERENCE: { rise: number; diag: Kind; chord: Kind }[] = [
  { rise: 2, diag: 'wood', chord: 'wood' },
  { rise: -2, diag: 'wood', chord: 'wood' },
  { rise: 2, diag: 'wood', chord: 'wood' },
  { rise: -3, diag: 'wood', chord: 'wood' },
  { rise: 2, diag: 'steel', chord: 'steel' },
  { rise: 3, diag: 'steel', chord: 'steel' },
]
export const reference = (k: number) =>
  warren(LEVELS[k], REFERENCE[k].rise, REFERENCE[k].diag, REFERENCE[k].chord)

/** a flat road and nothing else: what every level must refuse to call a bridge */
export function flatRoad(l: Level): Design {
  const d = start(l)
  let prev = jointAt(l, d, 0, 0, true)
  for (let x = 2; x <= l.span; x += 2) {
    const j = jointAt(l, d, Math.min(x, l.span), 0, true)
    addMember(l, d, prev, j, 'road')
    prev = j
  }
  return d
}

/* ---------------------------------------------------------------- kept in this browser -------- */

export const BRIDGE_KEY = 'lab_bridge_v1'

export type Saved = {
  level: number
  /** each level's design, by name */
  designs: Record<string, Design>
  /** the cheapest crossing of each level, by name */
  best: Record<string, number>
}

/** a design read back, or null: the level's anchors first and unchanged, every joint somewhere a
 *  joint may go, every member a kind the level has, no longer than MAX_LENGTH, and not twice */
export function readDesign(l: Level, raw: unknown): Design | null {
  const v = raw as Design
  if (!v || !Array.isArray(v.joints) || !Array.isArray(v.members)) return null
  if (v.joints.length > 200 || v.members.length > 400) return null
  const d = start(l)
  for (let i = 0; i < l.anchors.length; i++) {
    const j = v.joints[i]
    if (!j || j.x !== l.anchors[i][0] || j.y !== l.anchors[i][1]) return null
  }
  for (const j of v.joints.slice(l.anchors.length)) {
    if (!j || typeof j.x !== 'number' || typeof j.y !== 'number') return null
    if (d.joints.some((k) => k.x === j.x && k.y === j.y)) return null
    if (jointAt(l, d, j.x, j.y, true) < 0) return null
  }
  for (const m of v.members) {
    if (!m || !Number.isInteger(m.a) || !Number.isInteger(m.b)) return null
    if (m.a < 0 || m.b < 0 || m.a >= d.joints.length || m.b >= d.joints.length) return null
    if (addMember(l, d, m.a, m.b, m.kind) !== null) return null
  }
  return d
}

export function readSaved(text: string | null): Saved {
  const out: Saved = { level: 0, designs: {}, best: {} }
  try {
    const v = JSON.parse(text ?? 'null') as Record<string, unknown> | null
    if (!v || typeof v !== 'object') return out
    if (
      typeof v.level === 'number' &&
      Number.isInteger(v.level) &&
      v.level >= 0 &&
      v.level < LEVELS.length
    )
      out.level = v.level
    for (const l of LEVELS) {
      const d = readDesign(l, (v.designs as Record<string, unknown> | undefined)?.[l.name])
      if (d) out.designs[l.name] = d
      const b = (v.best as Record<string, unknown> | undefined)?.[l.name]
      if (typeof b === 'number' && Number.isInteger(b) && b > 0 && b <= l.budget)
        out.best[l.name] = b
    }
    return out
  } catch {
    return out
  }
}

/* ---------------------------------------------------------------- the view and the GPU -------- */

/** the scene's extent in metres: the gap, a bit of each cliff, the water and some sky */
export function extent(l: Level) {
  return { x0: -3, x1: l.span + 3, y0: -l.water - 1, y1: 6.5 }
}

export function fitScene(l: Level, stage: [number, number]) {
  const e = extent(l)
  const s = Math.min(stage[0] / (e.x1 - e.x0), stage[1] / (e.y1 - e.y0))
  // metres to pixels: x right, y up — so the y offset is from the top
  const ox = (stage[0] - (e.x1 - e.x0) * s) / 2 - e.x0 * s
  const oy = (stage[1] - (e.y1 - e.y0) * s) / 2 + e.y1 * s
  return { s, ox, oy }
}

export const toWorld = (f: ReturnType<typeof fitScene>, p: V2): V2 => [
  (p[0] - f.ox) / f.s,
  (f.oy - p[1]) / f.s,
]

export const MAX_MEMBERS = 256

/** each member as (ax, ay, bx, by) then (r, g, b, state): state 0 normal, 1 broken, 2 selected,
 *  plus 4 for road,
 *  and the colour already strained toward red by how hard it is working */
export function packMembers(
  d: Design,
  p: readonly V2[],
  load: readonly number[] | null,
  broken: readonly boolean[] | null,
  selected: number,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.min(d.members.length, MAX_MEMBERS) * 8)
  d.members.slice(0, MAX_MEMBERS).forEach((m, i) => {
    const base = MATERIALS[m.kind].colour
    const k = load ? Math.min(1, load[i]) : 0
    // green when easy, through yellow, to red at its limit
    const strain: [number, number, number] =
      k < 0.5 ? [k * 2, 0.85, 0.2] : [1, 0.85 * (2 - k * 2), 0.15]
    const c = load ? base.map((v, j) => v * 0.35 + strain[j] * 0.65) : base
    out.set(
      [
        p[m.a][0],
        p[m.a][1],
        p[m.b][0],
        p[m.b][1],
        c[0],
        c[1],
        c[2],
        (broken?.[i] ? 1 : i === selected ? 2 : 0) + (m.kind === 'road' ? 4 : 0),
      ],
      i * 8,
    )
  })
  return out
}
