/**
 * Bonsai: grow a little tree a season at a time, cut it back and wire its branches into the shape
 * you want, set it in a pot of your choosing, and send it to somebody. Pure, so bonsai.test.ts can
 * grow, prune and replay trees without a page; BonsaiDemo draws it on a 2D canvas.
 *
 * ⚠️ A TREE IS ITS SEED AND WHAT YOU DID TO IT, AND IT REPLAYS EXACTLY. Every random choice a
 * branch makes — whether it forks, how far it leans — comes from a source seeded by that branch's
 * own id and the season, never from one stream shared by the whole tree. So cutting one branch
 * does not change how another grows (short of the MAX_BRANCHES ceiling, where a cut makes room), and
 * a link that carries the seed and the list of cuts and bends rebuilds the very tree you made.
 */

export type Branch = {
  /** a path from the trunk: '' is the trunk, '0' its first child, '0.1' that branch's second */
  id: string
  parent: string | null
  /** direction relative to its parent, in radians, and how long it is */
  angle: number
  length: number
  /** the season it sprouted in */
  born: number
}
export type Tree = { seed: number; seasons: number; branches: Map<string, Branch> }
export type Op =
  | { kind: 'grow' }
  | { kind: 'cut'; id: string }
  | { kind: 'wire'; id: string; angle: number }

export const MAX_SEASONS = 24
/** the shortest and longest a branch grows in a season, in tree units (the trunk starts at 1) */
const STEP = 0.32

function rng(seed: number, id: string, season: number) {
  let h = (seed ^ Math.imul(season + 1, 0x9e3779b1)) >>> 0
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0
  let s = h || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}

export function sprout(seed: number): Tree {
  return {
    seed,
    seasons: 0,
    branches: new Map([['', { id: '', parent: null, angle: 0, length: 1, born: 0 }]]),
  }
}

const childrenOf = (t: Tree, id: string) => [...t.branches.values()].filter((b) => b.parent === id)
const depthOf = (id: string) => (id === '' ? 0 : id.split('.').length)

/** how many steps from the trunk a branch can be, and how many branches a tree can hold */
export const MAX_DEPTH = 12
export const MAX_BRANCHES = 400

/**
 * One season's growth. Every branch lengthens a little, less the higher it is. Every tip either
 * forks — into two most often, three now and then — reaches on with one shoot, or rests, so a tree gets
 * both length and ramification. A tip you cut back to becomes a tip again, and buds the next
 * season, which is how pruning makes a tree denser. Bounded by MAX_DEPTH and MAX_BRANCHES: a full
 * tree only thickens until something is cut.
 */
export function grow(t: Tree): Tree {
  if (t.seasons >= MAX_SEASONS) return t
  const season = t.seasons + 1
  const branches = new Map(t.branches)
  for (const b of t.branches.values()) {
    const r = rng(t.seed, b.id, season)
    const d = depthOf(b.id)
    branches.set(b.id, { ...b, length: b.length + STEP * 0.25 * r() * (1 / (1 + d)) })
    if (childrenOf(t, b.id).length || d >= MAX_DEPTH) continue
    // an old tip sometimes rests a season; a young one mostly reaches on, and forks a third of the time
    if (b.id !== '' && r() < 0.2) continue
    const fork = b.id === '' || r() < 0.32
    const n = !fork ? 1 : r() < 0.2 ? 3 : 2
    if (branches.size + n > MAX_BRANCHES) continue
    const spread = 0.3 + r() * 0.45
    for (let k = 0; k < n; k++) {
      const id = b.id === '' ? String(k) : `${b.id}.${k}`
      const lean = n === 1 ? (r() - 0.5) * 0.5 : (k / (n - 1) - 0.5) * 2 * spread
      branches.set(id, {
        id,
        parent: b.id,
        angle: lean + (r() - 0.5) * 0.25,
        length: STEP * Math.max(0.45, 1.5 - d * 0.1) * (0.7 + r() * 0.5),
        born: season,
      })
    }
  }
  return { ...t, seasons: season, branches }
}

/** cut a branch: it and everything that grew from it go */
export function cut(t: Tree, id: string): Tree {
  if (id === '' || !t.branches.has(id)) return t
  const branches = new Map(t.branches)
  for (const k of t.branches.keys()) if (k === id || k.startsWith(id + '.')) branches.delete(k)
  return { ...t, branches }
}

/** wiring bends a branch to a new angle against its parent, within what a branch will take */
export const BEND = 1.2
export function wire(t: Tree, id: string, angle: number): Tree {
  const b = t.branches.get(id)
  if (!b || id === '') return t
  const branches = new Map(t.branches)
  branches.set(id, { ...b, angle: Math.max(-BEND, Math.min(BEND, angle)) })
  return { ...t, branches }
}

export function apply(t: Tree, op: Op): Tree {
  return op.kind === 'grow' ? grow(t) : op.kind === 'cut' ? cut(t, op.id) : wire(t, op.id, op.angle)
}
export const replay = (seed: number, ops: readonly Op[]) => ops.reduce(apply, sprout(seed))

/* ---------------------------------------------------------------------------- shape */

export type Segment = {
  id: string
  x0: number
  y0: number
  x1: number
  y1: number
  width: number
  tip: boolean
  depth: number
  born: number
}
/**
 * Where every branch is drawn: from its parent's end, at its parent's direction plus its own
 * angle, as thick as the number of tips it feeds (the way real wood thickens). Tree units, y up.
 */
export function shape(t: Tree): Segment[] {
  const tips = new Map<string, number>()
  const count = (id: string): number => {
    const kids = childrenOf(t, id)
    const n = kids.length ? kids.reduce((s, k) => s + count(k.id), 0) : 1
    tips.set(id, n)
    return n
  }
  count('')
  const out: Segment[] = []
  const walk = (id: string, x: number, y: number, dir: number) => {
    const b = t.branches.get(id)!
    const a = dir + b.angle
    const x1 = x + Math.sin(a) * b.length
    const y1 = y + Math.cos(a) * b.length
    const kids = childrenOf(t, id)
    out.push({
      id,
      x0: x,
      y0: y,
      x1,
      y1,
      width: 0.06 * Math.sqrt(tips.get(id)!) + 0.014,
      tip: !kids.length,
      depth: depthOf(id),
      born: b.born,
    })
    for (const k of kids) walk(k.id, x1, y1, a)
  }
  walk('', 0, 0, 0)
  return out
}

/** the branch nearest a point (tree units), if one passes within `reach` */
export function nearest(
  segs: readonly Segment[],
  x: number,
  y: number,
  reach = 0.12,
): string | null {
  let best: string | null = null
  let bd = reach
  for (const s of segs) {
    if (s.id === '') continue
    const dx = s.x1 - s.x0
    const dy = s.y1 - s.y0
    const L = dx * dx + dy * dy || 1
    const k = Math.max(0, Math.min(1, ((x - s.x0) * dx + (y - s.y0) * dy) / L))
    const d = Math.hypot(x - (s.x0 + k * dx), y - (s.y0 + k * dy))
    if (d < bd) {
      bd = d
      best = s.id
    }
  }
  return best
}

/* ---------------------------------------------------------------------------- dressing it */

export const POTS = ['oval', 'rectangle', 'round', 'cascade'] as const
export const GLAZES = ['#7a3e2b', '#2f4f6f', '#3e6b48', '#d9d2c5', '#1f1f24', '#b35c1e'] as const
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
/** what grows on it: broad leaves that turn and fall, evergreen needle pads, or spring blossom */
export const LEAVES = ['maple', 'pine', 'blossom'] as const
export type Dress = {
  pot: (typeof POTS)[number]
  glaze: number
  season: (typeof SEASONS)[number]
  leaf: (typeof LEAVES)[number]
  moss: boolean
  stones: boolean
}
export const DEFAULT_DRESS: Dress = {
  pot: 'oval',
  glaze: 0,
  season: 'summer',
  leaf: 'maple',
  moss: true,
  stones: false,
}

/* ---------------------------------------------------------------------------- sharing */

/**
 * A tree as a short string: the seed, the dress, then each operation — a grow is one byte, a cut is
 * the branch's path, a wire is the path and an angle in a byte. Paths are digits 0–2 joined by dots,
 * so each step of a path packs into two bits.
 */
export function encode(seed: number, ops: readonly Op[], dress: Dress): string {
  const out: number[] = [
    1,
    (seed >>> 24) & 255,
    (seed >>> 16) & 255,
    (seed >>> 8) & 255,
    seed & 255,
  ]
  out.push(
    POTS.indexOf(dress.pot) |
      (SEASONS.indexOf(dress.season) << 2) |
      (dress.moss ? 16 : 0) |
      (dress.stones ? 32 : 0) |
      (LEAVES.indexOf(dress.leaf) << 6),
    dress.glaze,
  )
  const path = (id: string) => {
    const steps = id.split('.').map(Number)
    out.push(steps.length)
    for (let i = 0; i < steps.length; i += 4) {
      let byte = 0
      for (let j = 0; j < 4; j++) byte |= (steps[i + j] ?? 0) << (j * 2)
      out.push(byte)
    }
  }
  for (const op of ops) {
    if (op.kind === 'grow') out.push(0)
    else if (op.kind === 'cut') {
      out.push(1)
      path(op.id)
    } else {
      out.push(2)
      path(op.id)
      out.push(Math.round(((op.angle + BEND) / (2 * BEND)) * 255))
    }
  }
  let bin = ''
  for (const b of out) bin += String.fromCharCode(b & 255)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decode(code: string): { seed: number; ops: Op[]; dress: Dress } | null {
  if (!/^[A-Za-z0-9_-]{8,6000}$/.test(code)) return null
  let b: Uint8Array
  try {
    b = Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
  if (b[0] !== 1 || b.length < 7) return null
  const seed = ((b[1] << 24) | (b[2] << 16) | (b[3] << 8) | b[4]) >>> 0
  const f = b[5]
  if ((f & 3) >= POTS.length || f >> 6 >= LEAVES.length || b[6] >= GLAZES.length) return null
  const dress: Dress = {
    pot: POTS[f & 3],
    season: SEASONS[(f >> 2) & 3],
    leaf: LEAVES[f >> 6],
    moss: !!(f & 16),
    stones: !!(f & 32),
    glaze: b[6],
  }
  const ops: Op[] = []
  let i = 7
  const path = (): string | null => {
    const n = b[i++]
    if (!n || n > MAX_DEPTH) return null
    const steps: number[] = []
    for (let k = 0; k < Math.ceil(n / 4); k++) {
      const byte = b[i++]
      if (byte === undefined) return null
      for (let j = 0; j < 4 && steps.length < n; j++) steps.push((byte >> (j * 2)) & 3)
    }
    if (steps.some((s) => s > 2)) return null
    return steps.join('.')
  }
  let grows = 0
  while (i < b.length) {
    const kind = b[i++]
    if (kind === 0) {
      if (++grows > MAX_SEASONS) return null
      ops.push({ kind: 'grow' })
    } else if (kind === 1 || kind === 2) {
      const id = path()
      if (id === null) return null
      if (kind === 1) ops.push({ kind: 'cut', id })
      else {
        const a = b[i++]
        if (a === undefined) return null
        ops.push({ kind: 'wire', id, angle: (a / 255) * 2 * BEND - BEND })
      }
    } else return null
    if (ops.length > 600) return null
  }
  return { seed, ops, dress }
}

/** a wire angle as a link stores it, so a tree you made and the one a friend gets are the same */
export const settleAngle = (a: number) =>
  (Math.round(((Math.max(-BEND, Math.min(BEND, a)) + BEND) / (2 * BEND)) * 255) / 255) * 2 * BEND -
  BEND

/* ---------------------------------------------------------------------------- what is kept */

export const BONSAI_KEY = 'lab_bonsai_v1'
export const MAX_KEPT = 12
export type Saved = { current: string; kept: { name: string; code: string }[] }
export const EMPTY: Saved = { current: '', kept: [] }
export function readSaved(text: string | null): Saved {
  const out: Saved = { current: '', kept: [] }
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return out
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  if (typeof o.current === 'string' && decode(o.current)) out.current = o.current
  if (Array.isArray(o.kept))
    out.kept = o.kept
      .filter(
        (x): x is { name: string; code: string } =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as { name?: unknown }).name === 'string' &&
          typeof (x as { code?: unknown }).code === 'string' &&
          decode((x as { code: string }).code) !== null,
      )
      .map((x) => ({ name: x.name.slice(0, 30), code: x.code }))
      .slice(0, MAX_KEPT)
  return out
}
