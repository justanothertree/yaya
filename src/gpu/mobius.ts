/**
 * The arithmetic of the Lab's Möbius golf: golf on a square whose edges are glued together. Each
 * pair of opposite edges is a WALL (the ball bounces), a WRAP (out of one side, in at the other, the
 * same way up — a cylinder; both pairs, a torus) or a TWIST (in at the other side upside down — a
 * Möbius band; with the other pair wrapped, a Klein bottle). Which space a hole is played in is the
 * player's choice, and it is most of the puzzle: a hole you cannot reach in a room is one shot away
 * round the back of a cylinder, or mirrored across a Möbius band.
 *
 * ⚠️ THE GPU DRAWS THE COVER; THE RULES ARE HERE. The shader paints the room's neighbouring copies all
 * round it, flipped where a twist flips them, so a ball's path that bends at every edge in the room is
 * a straight line through the copies. Which copy a point is in and how it folds back into the room is
 * `fold` here, line for line, and mobius.test.ts holds it to the ball's own crossings.
 */

export type V2 = [number, number]
/** the side of the square course, in metres */
export const S = 10
export const BALL_R = 0.18
export const HOLE_R = 0.32
/** faster than this over the hole and the ball runs across it */
export const CAPTURE = 5.5
/** the green slows a rolling ball by this much a second, m/s² */
export const ROLL = 2.2
/** how much of its speed a ball keeps off a wall */
export const BOUNCE = 0.78
export const MAX_SPEED = 14
/** physics steps a second, and the longest a shot may roll */
export const HZ = 240
export const MAX_ROLL = 20
/** walls are capsules this thick either side of their line */
export const WALL_R = 0.12

export type Glue = 'wall' | 'wrap' | 'twist'
/** a space: how the left and right edges are glued (x), and how the top and bottom are (y) */
export type Space = { x: Glue; y: Glue }

export const SPACES = {
  room: { name: 'Room', x: 'wall', y: 'wall' },
  cylinder: { name: 'Cylinder', x: 'wrap', y: 'wall' },
  mobius: { name: 'Möbius band', x: 'twist', y: 'wall' },
  torus: { name: 'Torus', x: 'wrap', y: 'wrap' },
  klein: { name: 'Klein bottle', x: 'twist', y: 'wrap' },
} as const satisfies Record<string, Space & { name: string }>
export type SpaceId = keyof typeof SPACES
export const SPACE_IDS = Object.keys(SPACES) as SpaceId[]

export type Ball = {
  x: number
  y: number
  vx: number
  vy: number
  /** 1 once the ball has been through an odd number of twists: it is its own mirror image */
  flipped: number
}

/**
 * The ball across an edge, if it has gone over one that is glued: back in at the other side, upside
 * down across a twist. A wall edge is not crossed here — `stepBall` bounces off it first.
 */
export function cross(b: Ball, sp: Space) {
  if (sp.x !== 'wall' && (b.x >= S || b.x < 0)) {
    b.x += b.x >= S ? -S : S
    if (sp.x === 'twist') {
      b.y = S - b.y
      b.vy = -b.vy
      b.flipped ^= 1
    }
  }
  if (sp.y !== 'wall' && (b.y >= S || b.y < 0)) {
    b.y += b.y >= S ? -S : S
    if (sp.y === 'twist') {
      b.x = S - b.x
      b.vx = -b.vx
      b.flipped ^= 1
    }
  }
}

/**
 * A point of the cover — the plane of the room's copies — folded back into the room: which copy it is
 * in (i across, j up), and where in the room that is. Null where there is no copy, beyond a wall
 * edge. The shader's `fold`, line for line: the copy one step across a twist is the room upside down.
 */
export function fold(p: V2, sp: Space): { at: V2; i: number; j: number; flipped: number } | null {
  const i = Math.floor(p[0] / S)
  const j = Math.floor(p[1] / S)
  if ((sp.x === 'wall' && i !== 0) || (sp.y === 'wall' && j !== 0)) return null
  let x = p[0] - i * S
  let y = p[1] - j * S
  let flipped = 0
  if (sp.x === 'twist' && i % 2 !== 0) {
    y = S - y
    flipped ^= 1
  }
  if (sp.y === 'twist' && j % 2 !== 0) {
    x = S - x
    flipped ^= 1
  }
  return { at: [x, y], i, j, flipped }
}

/** a wall: a segment, thickened by WALL_R */
export type Wall = [number, number, number, number]

export type Hole = {
  name: string
  hint: string
  tee: V2
  cup: V2
  walls: Wall[]
  /** the spaces this hole may be played in, and par */
  spaces: SpaceId[]
  par: number
}

/** the nearest point of a segment to p */
function nearest(w: Wall, x: number, y: number): V2 {
  const dx = w[2] - w[0]
  const dy = w[3] - w[1]
  const t = Math.max(0, Math.min(1, ((x - w[0]) * dx + (y - w[1]) * dy) / (dx * dx + dy * dy || 1)))
  return [w[0] + dx * t, w[1] + dy * t]
}

/**
 * One physics step: roll on (slowing by ROLL), bounce off walls and wall edges, cross glued edges,
 * and drop into the cup if slow enough over it. Returns 'in' when it drops, 'stopped' when it comes to
 * rest, otherwise null.
 */
export function stepBall(b: Ball, h: Hole, sp: Space, dt = 1 / HZ): 'in' | 'stopped' | null {
  const speed = Math.hypot(b.vx, b.vy)
  if (speed < 0.03) {
    b.vx = 0
    b.vy = 0
    return 'stopped'
  }
  const k = Math.max(0, speed - ROLL * dt) / speed
  b.vx *= k
  b.vy *= k
  b.x += b.vx * dt
  b.y += b.vy * dt
  // the edges that are walls
  if (sp.x === 'wall') {
    if (b.x < BALL_R) {
      b.x = BALL_R
      b.vx = Math.abs(b.vx) * BOUNCE
    } else if (b.x > S - BALL_R) {
      b.x = S - BALL_R
      b.vx = -Math.abs(b.vx) * BOUNCE
    }
  }
  if (sp.y === 'wall') {
    if (b.y < BALL_R) {
      b.y = BALL_R
      b.vy = Math.abs(b.vy) * BOUNCE
    } else if (b.y > S - BALL_R) {
      b.y = S - BALL_R
      b.vy = -Math.abs(b.vy) * BOUNCE
    }
  }
  cross(b, sp)
  for (const w of h.walls) {
    const [nx, ny] = nearest(w, b.x, b.y)
    const dx = b.x - nx
    const dy = b.y - ny
    const d = Math.hypot(dx, dy)
    const lo = BALL_R + WALL_R
    if (d < lo && d > 1e-9) {
      const ux = dx / d
      const uy = dy / d
      b.x = nx + ux * lo
      b.y = ny + uy * lo
      const vn = b.vx * ux + b.vy * uy
      if (vn < 0) {
        b.vx -= (1 + BOUNCE) * vn * ux
        b.vy -= (1 + BOUNCE) * vn * uy
      }
    }
  }
  if (Math.hypot(b.x - h.cup[0], b.y - h.cup[1]) < HOLE_R && Math.hypot(b.vx, b.vy) < CAPTURE)
    return 'in'
  return null
}

/** a shot: an angle (radians, 0 along +x, counter-clockwise with y up) and a power 0..1 */
export type Shot = { angle: number; power: number }
export const launch = (at: V2, s: Shot): Ball => ({
  x: at[0],
  y: at[1],
  vx: Math.cos(s.angle) * s.power * MAX_SPEED,
  vy: Math.sin(s.angle) * s.power * MAX_SPEED,
  flipped: 0,
})

/** a whole shot from `at`, run to rest or to the cup: where it ended, and the path it took */
export function roll(h: Hole, sp: Space, at: V2, s: Shot, every = 6) {
  const b = launch(at, s)
  const path: V2[] = [[b.x, b.y]]
  let end: 'in' | 'stopped' = 'stopped'
  for (let k = 0; k < MAX_ROLL * HZ; k++) {
    const r = stepBall(b, h, sp)
    if (k % every === 0) path.push([b.x, b.y])
    if (r) {
      end = r
      break
    }
  }
  path.push([b.x, b.y])
  return { ball: b, end, path }
}

const CROSS: Wall[] = [
  [0, 5, 10, 5],
  [5, 0, 5, 10],
]
const deg = (d: number) => (d * Math.PI) / 180

/** the course, easiest first: each designed by search, with an ace the tests replay */
export const HOLES: Hole[] = [
  {
    name: 'Round the back',
    hint: 'A wall right across the room. But glue its left edge to its right and the room is a cylinder: out of one side, in at the other.',
    tee: [2, 5],
    cup: [8, 5],
    walls: [[5, 0, 5, 10]],
    spaces: ['room', 'cylinder'],
    par: 2,
  },
  {
    name: 'Upside down',
    hint: 'Four rooms in one. Through a cylinder’s edge you come back at the same height; through a Möbius band’s, upside down.',
    tee: [2, 2.5],
    cup: [7.5, 7.5],
    walls: CROSS,
    spaces: ['cylinder', 'mobius'],
    par: 2,
  },
  {
    name: 'Two doors',
    hint: 'On a torus both pairs of edges are glued: off the bottom is onto the top. Some holes need two doors.',
    tee: [2.5, 2.5],
    cup: [7.5, 7.5],
    walls: CROSS,
    spaces: ['cylinder', 'torus'],
    par: 2,
  },
  {
    name: 'The bottle',
    hint: 'A Klein bottle: a Möbius band’s twisted sides, and a torus’s top and bottom. The band alone cannot get there.',
    tee: [2.5, 2.5],
    cup: [7.5, 2.5],
    walls: CROSS,
    spaces: ['mobius', 'klein'],
    par: 2,
  },
  {
    name: 'Lanes',
    hint: 'Three lanes and a fence. More than one space will do; which gives you the easiest ace?',
    tee: [2, 1.65],
    cup: [8, 8.35],
    walls: [
      [0, 3.33, 10, 3.33],
      [0, 6.67, 10, 6.67],
      [5, 6.67, 5, 10],
    ],
    spaces: ['cylinder', 'mobius', 'torus'],
    par: 2,
  },
  {
    name: 'Pocket',
    hint: 'Every space is open. The cup’s pocket faces the edge — from which side of the world can a ball arrive going into it?',
    tee: [2, 2],
    cup: [8.5, 8.6],
    walls: [
      [7.5, 7.6, 9.5, 7.6],
      [7.5, 7.6, 7.5, 9.5],
      [9.5, 7.6, 9.5, 9.5],
      [3, 6, 6, 6],
      [6, 1, 6, 4.5],
    ],
    spaces: ['room', 'cylinder', 'mobius', 'torus', 'klein'],
    par: 3,
  },
]

/** an ace for each hole, in the same order: for the tests, and for 💡 when somebody is stuck */
export const ACES: { space: SpaceId; shot: Shot }[] = [
  { space: 'cylinder', shot: { angle: deg(0), power: 0.58 } },
  { space: 'mobius', shot: { angle: deg(0), power: 0.58 } },
  { space: 'torus', shot: { angle: deg(32), power: 0.78 } },
  { space: 'klein', shot: { angle: deg(32), power: 0.78 } },
  { space: 'mobius', shot: { angle: deg(0), power: 0.96 } },
  { space: 'torus', shot: { angle: deg(13), power: 0.96 } },
]

/* ---------------------------------------------------------------- for the GPU ---------------- */

export const MAX_WALLS = 16
export const MAX_PATH = 256
/** how a glue is told to the shader */
export const GLUE_CODE: Record<Glue, number> = { wall: 0, wrap: 1, twist: 2 }

/** Hand-packed to match `struct Course` — mobius.test.ts lays the struct out from the shader. */
export const COURSE = {
  size: 0,
  glue: 8,
  ball: 16,
  cup: 32,
  aim: 40,
  view: 48,
  walls: 56,
  path: 60,
  time: 64,
  flipped: 68,
  bytes: 80,
} as const

export type CourseFrame = {
  w: number
  h: number
  space: Space
  ball: Ball
  /** the ball's spin, for drawing it turning: radians */
  spin: number
  cup: V2
  /** the aim's direction scaled by power, or [0, 0] when not aiming */
  aim: V2
  /** where the camera looks, in cover coordinates, and how many metres the stage's shorter side shows */
  view: V2
  span: number
  walls: number
  path: number
  time: number
}

export function packCourse(f: CourseFrame, into = new ArrayBuffer(COURSE.bytes)) {
  const u = new Uint32Array(into)
  const fl = new Float32Array(into)
  u.set([f.w, f.h, GLUE_CODE[f.space.x], GLUE_CODE[f.space.y]], 0)
  fl.set([f.ball.x, f.ball.y, f.spin, f.span], COURSE.ball / 4)
  fl.set([...f.cup, ...f.aim, ...f.view], COURSE.cup / 4)
  u[COURSE.walls / 4] = Math.min(f.walls, MAX_WALLS)
  u[COURSE.path / 4] = Math.min(f.path, MAX_PATH)
  fl[COURSE.time / 4] = f.time
  u[COURSE.flipped / 4] = f.ball.flipped
  return into
}

/**
 * Where a point of a stage `size` big is in the cover: the camera looks at `view`, the shorter side
 * shows `span` metres, y up. The shader's `to_cover`, line for line.
 */
export function toCover(size: V2, view: V2, span: number, p: V2): V2 {
  const k = span / Math.min(size[0], size[1])
  return [view[0] + (p[0] - size[0] / 2) * k, view[1] - (p[1] - size[1] / 2) * k]
}

/** the first `metres` of a shot's path, for the dotted guide while aiming — not the whole shot */
export function guide(h: Hole, sp: Space, at: V2, s: Shot, metres = 3.5): V2[] {
  const b = launch(at, s)
  const out: V2[] = [[b.x, b.y]]
  let gone = 0
  for (let k = 0; k < MAX_ROLL * HZ && gone < metres; k++) {
    const px = b.x
    const py = b.y
    const r = stepBall(b, h, sp)
    const d = Math.hypot(b.x - px, b.y - py)
    gone += d < S / 2 ? d : 0
    if (k % 4 === 0) out.push([b.x, b.y])
    if (r) break
  }
  out.push([b.x, b.y])
  return out.slice(0, MAX_PATH)
}

export const MOBIUS_KEY = 'lab_mobius_v1'

/** fewest strokes kept per hole, by name, with the space it was played in */
export type Best = Record<string, { strokes: number; space: SpaceId }>
/**
 * What Möbius golf keeps: the hole it was on and the fewest strokes per hole. Moved here unchanged
 * from MobiusDemo so the Lab's share card (src/lab/shares/arcade.ts) reads it the toy's own way.
 */
export function readSaved(text: string | null): { hole: number; best: Best } {
  try {
    const v = JSON.parse(text ?? 'null') as {
      hole?: unknown
      best?: Record<string, { strokes?: unknown; space?: unknown }>
    } | null
    const hole =
      typeof v?.hole === 'number' &&
      Number.isInteger(v.hole) &&
      v.hole >= 0 &&
      v.hole < HOLES.length
        ? v.hole
        : 0
    const best: Best = {}
    for (const h of HOLES) {
      const b = v?.best?.[h.name]
      if (b && Number.isInteger(b.strokes) && typeof b.space === 'string' && b.space in SPACES)
        best[h.name] = { strokes: b.strokes as number, space: b.space as SpaceId }
    }
    return { hole, best }
  } catch {
    return { hole: 0, best: {} }
  }
}
