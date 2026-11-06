/**
 * The arithmetic of the Lab's waterworks: a puzzle of getting water into a cup, where the water can
 * be routed with walls you draw, frozen into ice that holds still, and boiled into steam that rises
 * over what the water cannot — and comes back as rain where something cold catches it.
 *
 * ⚠️ THE WATER IS A FLIP FLUID ON THE GPU, AND THIS FILE IS THE RULES IT IS HELD TO. A few
 * thousand particles carry the water; each step they are added onto a grid (atomics), the grid's
 * velocities are made divergence-free by a pressure solve, and the particles take the change back.
 * That is the GPU's, and waterworks.test.ts cannot run it — the GPU probe asks it instead: does it
 * keep every drop, settle level, leak through nothing, and come out without divergence. What lives
 * here is everything that decides a PUZZLE: the levels, how heat moves a drop between water, ice
 * and steam (the shader's own thresholds, tested), the ink you have to draw with, and whether the
 * cup is full.
 */

export type V2 = [number, number]

/** the tank, in cells; y runs DOWN, as on the screen */
export const NX = 160
export const NY = 100
/** most drops a level can hold */
export const MAX_DROPS = 12288
/** how many water drops in the cup fill it */
export const FILL = 400

export const STATE = { none: 0, water: 1, ice: 2, steam: 3 } as const
/** what each cell of the mask is */
export const SOLID = { open: 0, rock: 1, drawn: 2 } as const

/** degrees C: water freezes below FREEZE and ice melts above MELT; boils above BOIL, steam condenses below CONDENSE */
export const FREEZE = -1
export const MELT = 2
export const BOIL = 100
export const CONDENSE = 92
/** the room: everything drifts toward it */
export const ROOM = 20

/**
 * One drop's temperature after `dt` seconds near a source holding `target` with `strength` per
 * second (0 where nothing heats it), and the room pulling gently everywhere — the shader's `warm`.
 */
export function warm(t: number, target: number, strength: number, dt: number) {
  const toRoom = 0.05
  const k = strength + toRoom
  const goal = (target * strength + ROOM * toRoom) / k
  return goal + (t - goal) * Math.exp(-k * dt)
}

/**
 * A drop's temperature after a step: `warm`, except that steam with nothing near it keeps its heat.
 * ⚠️ A GAME RULE, NOT PHYSICS: real steam cools in a room, and here it cooled enough on its way
 * across the ceiling to fall back as rain over the kettle — most of a level's water went round and
 * round on the hot side, and the cup got 14 drops in 23 seconds. Steam now turns back to water only
 * where something cold is.
 */
export function heatStep(state: number, t: number, target: number, strength: number, dt: number) {
  if (state === STATE.steam && strength === 0) return t
  return warm(t, target, strength, dt)
}

/** a drop's next state at temperature `t` — with the gaps between the thresholds as hysteresis */
export function phase(state: number, t: number): number {
  if (state === STATE.water) {
    if (t < FREEZE) return STATE.ice
    if (t > BOIL) return STATE.steam
  } else if (state === STATE.ice) {
    if (t > MELT) return STATE.water
  } else if (state === STATE.steam) {
    if (t < CONDENSE) return STATE.water
  }
  return state
}

/* ---------------------------------------------------------------- levels --------------------- */

/** a rectangle of cells: x, y (top left), w, h */
export type Rect = [number, number, number, number]
export type Tool = 'wall' | 'erase' | 'heat' | 'cool'
export type Level = {
  id: string
  name: string
  hint: string
  rock: Rect[]
  /** where the water comes from, how many drops, and how fast */
  source: { at: V2; drops: number; perFrame: number }
  /** water that starts frozen, as ice */
  ice?: Rect[]
  cup: Rect
  /** fixtures that hold a temperature, always on */
  plates?: { rect: Rect; target: number }[]
  tools: Tool[]
  /** how many cells of wall you may draw */
  ink: number
}

/** a cup: a floor and two walls around `inner` (the space that counts), each wall `t` thick */
const cupWalls = ([x, y, w, h]: Rect, t = 2): Rect[] => [
  [x - t, y, t, h + t],
  [x + w, y, t, h + t],
  [x - t, y + h, w + 2 * t, t],
]
const FRAME: Rect[] = [
  [0, 0, NX, 2],
  [0, NY - 2, NX, 2],
  [0, 0, 2, NY],
  [NX - 2, 0, 2, NY],
]

export const LEVELS: Level[] = [
  {
    id: 'pour',
    name: 'Fill the cup',
    hint: 'The water runs along the floor and past the cup. Draw a chute from the tap into it.',
    rock: [...FRAME, ...cupWalls([118, 70, 24, 26])],
    source: { at: [60, 12], drops: 3000, perFrame: 8 },
    cup: [118, 70, 24, 26],
    tools: ['wall', 'erase'],
    ink: 300,
  },
  {
    id: 'bridge',
    name: 'Ice bridge',
    hint: 'The stream runs off the ledge and down the shaft. Hold the cold just inside the top of the shaft to freeze a bridge level with the ledges, then let go and the water runs over it. Ice that ends up too high dams the stream: warm it away.',
    // two ledges with a shaft between, and the cup sunk into the far ledge
    rock: [...FRAME, [2, 50, 58, 48], [80, 50, 24, 48], [130, 50, 28, 48], [104, 64, 26, 34]],
    source: { at: [14, 40], drops: 3000, perFrame: 10 },
    cup: [104, 50, 26, 14],
    tools: ['cool', 'heat'],
    ink: 0,
  },
  {
    id: 'steam',
    name: 'Up and over',
    hint: 'A wall stands between the pool and the cup. Boil the pool: steam rises over the wall, and the cold plate turns it back to rain.',
    /* the cup sits right under the plate's near edge: steam reaches that edge first and rains
       there (measured: with the cup twenty cells further on, the rain fell short of it) */
    rock: [...FRAME, [74, 36, 6, 62], ...cupWalls([86, 70, 30, 26])],
    source: { at: [30, 20], drops: 3600, perFrame: 12 },
    cup: [86, 70, 30, 26],
    /* cool, not freezing: at −40 the steam condensed and froze on the spot, and the ice it made
       hung from the ceiling and stopped the rest — measured, 44 drops in the cup in 23 s */
    plates: [{ rect: [84, 2, 70, 4], target: 5 }],
    tools: ['heat'],
    ink: 0,
  },
  {
    id: 'melt',
    name: 'Gently',
    hint: 'The cup needs water from the ice in the hopper. Melt it — but hold the heat too long and it boils away.',
    rock: [
      ...FRAME,
      [60, 20, 4, 26],
      [96, 20, 4, 26],
      [64, 42, 12, 4],
      [84, 42, 12, 4],
      ...cupWalls([68, 74, 24, 22]),
    ],
    source: { at: [80, 10], drops: 0, perFrame: 0 },
    ice: [[64, 22, 32, 20]],
    /* the hopper is a freezer: left alone, the room thawed the ice in ten seconds and filled the
       cup with nobody touching it (measured: 2,500 drops in 900 frames) */
    plates: [{ rect: [64, 20, 32, 22], target: -20 }],
    cup: [68, 74, 24, 22],
    tools: ['heat'],
    ink: 0,
  },
  {
    id: 'play',
    name: 'Sandbox',
    hint: 'Every tool, plenty of ink, and a cup to aim for if you want one.',
    rock: [...FRAME, ...cupWalls([120, 74, 26, 22])],
    source: { at: [30, 12], drops: 9000, perFrame: 10 },
    cup: [120, 74, 26, 22],
    plates: [],
    tools: ['wall', 'erase', 'heat', 'cool'],
    ink: 2000,
  },
]

export const levelById = (id: string) => LEVELS.find((l) => l.id === id) ?? LEVELS[0]

/** the level's rock as a mask, a byte a cell */
export function rockMask(level: Level): Uint8Array {
  const m = new Uint8Array(NX * NY)
  for (const [x, y, w, h] of level.rock)
    for (let j = Math.max(0, y); j < Math.min(NY, y + h); j++)
      for (let i = Math.max(0, x); i < Math.min(NX, x + w); i++) m[j * NX + i] = SOLID.rock
  return m
}

/** the drops a level starts with: its ice, four to a cell, frozen */
export function startingIce(level: Level): number[] {
  const out: number[] = []
  for (const [x, y, w, h] of level.ice ?? [])
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++)
        for (const [dx, dy] of [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.25, 0.75],
          [0.75, 0.75],
        ])
          out.push(i + dx, j + dy, 0, 0, -10, STATE.ice, 0, 0)
  return out
}

/* ---------------------------------------------------------------- drawing walls -------------- */

/**
 * A stroke of wall from a to b, `r` cells thick, laid into the mask where it is open and while ink
 * lasts. Returns how much ink it used. Rock is never overwritten, and erasing only takes drawn wall
 * — and gives its ink back.
 */
export function paint(
  mask: Uint8Array,
  a: V2,
  b: V2,
  r: number,
  erase: boolean,
  ink: number,
): number {
  let used = 0
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2))
  for (let s = 0; s <= steps; s++) {
    const cx = a[0] + ((b[0] - a[0]) * s) / steps
    const cy = a[1] + ((b[1] - a[1]) * s) / steps
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++)
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        if (i < 0 || j < 0 || i >= NX || j >= NY) continue
        if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 > r * r) continue
        const k = j * NX + i
        if (erase) {
          if (mask[k] === SOLID.drawn) {
            mask[k] = SOLID.open
            used--
          }
        } else if (mask[k] === SOLID.open && used < ink) {
          mask[k] = SOLID.drawn
          used++
        }
      }
  }
  return used
}

/* ---------------------------------------------------------------- the goal ------------------- */

/**
 * How many WATER drops are in the cup, from the particles read back (eight floats each): ice in the
 * cup does not count until it melts, and steam is just passing through.
 */
export function inCup(drops: Float32Array, count: number, cup: Rect): number {
  const [x, y, w, h] = cup
  let n = 0
  for (let i = 0; i < count; i++) {
    const o = i * 8
    if (drops[o + 5] !== STATE.water) continue
    const px = drops[o]
    const py = drops[o + 1]
    if (px >= x && px < x + w && py >= y && py < y + h) n++
  }
  return n
}

/** where solved levels are kept */
export const SOLVED_KEY = 'lab_waterworks_v1'

/** solved level ids from storage: ⚠️ STORAGE IS INPUT, so only known ids, once each, are believed */
export function readSolved(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    const known = new Set(LEVELS.map((l) => l.id))
    return [...new Set(v.filter((x): x is string => typeof x === 'string' && known.has(x)))]
  } catch {
    return []
  }
}

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** Hand-packed to match `struct Tank` — waterworks.test.ts lays the struct out from the shader. */
export const TANK = {
  size: 0,
  grid: 8,
  count: 16,
  dt: 20,
  tool: 24,
  toolR: 28,
  toolAt: 32,
  flip: 40,
  time: 44,
  cup: 48,
  bytes: 64,
} as const

export const TOOL_CODE = { none: 0, heat: 1, cool: 2 } as const

export function packTank(
  p: {
    w: number
    h: number
    count: number
    dt: number
    tool: number
    toolAt: V2
    toolR: number
    flip: number
    time: number
    cup: Rect
  },
  into = new ArrayBuffer(TANK.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[2] = NX
  u[3] = NY
  u[TANK.count / 4] = p.count
  f[TANK.dt / 4] = p.dt
  u[TANK.tool / 4] = p.tool
  f.set(p.toolAt, TANK.toolAt / 4)
  f[TANK.toolR / 4] = p.toolR
  f[TANK.flip / 4] = p.flip
  f[TANK.time / 4] = p.time
  f.set(p.cup, TANK.cup / 4)
  return into
}

/**
 * Each cell's heat source for the shader: (target °C, strength per second), from the level's plates.
 * The player's heat or cold is added in the shader, where the finger is.
 */
export function plateField(level: Level): Float32Array<ArrayBuffer> {
  const f = new Float32Array(NX * NY * 2)
  for (const { rect, target } of level.plates ?? []) {
    const [x, y, w, h] = rect
    // a plate reaches a few cells below itself: that is where the steam meets it
    for (let j = Math.max(0, y); j < Math.min(NY, y + h + 6); j++)
      for (let i = Math.max(0, x); i < Math.min(NX, x + w); i++) {
        f[(j * NX + i) * 2] = target
        f[(j * NX + i) * 2 + 1] = 3
      }
  }
  return f
}

/** a source's next drops: a short row across the tap, falling, at room temperature */
export function pour(level: Level, from: number, n: number): number[] {
  const out: number[] = []
  const [sx, sy] = level.source.at
  for (let k = 0; k < n; k++) {
    const i = from + k
    // a fixed little pattern rather than randomness: the same level pours the same way every time
    const jitter = ((i * 7919) % 97) / 97
    out.push(sx - 2 + 4 * jitter, sy + ((i * 31) % 7) * 0.15, 0, 20, ROOM, STATE.water, 0, 0)
  }
  return out
}
