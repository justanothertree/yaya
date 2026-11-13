/**
 * Bricks: keep a ball in play with a paddle and knock out a wall of bricks for points. Pure — the
 * field, the ball, the walls, the drops and the scoring — so bricks.test.ts can play whole games
 * at any speed without a page; BricksDemo draws it and moves the paddle.
 *
 * The field is 1 unit wide and 1.4 tall, y growing downwards. Every wall comes from a seed, so
 * today's walls are the same for everybody, and a wall somebody drew travels as 80 characters.
 */

import { whole } from './kept'

export const W = 1
export const H = 1.4
export const COLS = 10
export const ROWS = 8
export const BRICK_TOP = 0.14
export const BRICK_H = 0.045
export const BRICK_W = W / COLS
export const PADDLE_Y = 1.3
export const PADDLE_H = 0.026
export const PADDLE_W = 0.19
export const BALL_R = 0.013
/** the paddle's top speed in field widths a second: quick enough for any ball, not a teleport */
export const PADDLE_SPEED = 2.6
/** the steepest a ball may leave the paddle, from straight up */
export const MAX_ANGLE = (62 * Math.PI) / 180
/** no ball may travel flatter than this, or it could cross the field for ever between walls */
const MIN_RISE = 0.3

export type Power = 'wide' | 'multi' | 'slow' | 'life'
export type Brick = { hp: number; max: number; gold: boolean; drop: Power | null }
export type Ball = { x: number; y: number; vx: number; vy: number; stuck: boolean }
export type Drop = { x: number; y: number; kind: Power }
export type Game = {
  seed: number
  /** a drawn wall, played again and again; null for walls made from the seed */
  custom: string | null
  /** which wall, from 1 */
  round: number
  bricks: (Brick | null)[]
  balls: Ball[]
  paddle: { x: number; w: number }
  lives: number
  score: number
  /** bricks broken since the ball last touched the paddle, which multiplies what each is worth */
  combo: number
  bestCombo: number
  /** paddle touches on this wall, which speed the ball a little */
  touches: number
  drops: Drop[]
  /** seconds left on each timed power */
  wide: number
  slow: number
  over: boolean
  time: number
}
export type Event =
  | { kind: 'hit'; at: number }
  | { kind: 'break'; at: number; points: number }
  | { kind: 'paddle' }
  | { kind: 'wall' }
  | { kind: 'catch'; power: Power }
  | { kind: 'lost' }
  | { kind: 'clear'; bonus: number }
  | { kind: 'over' }

/* ---------------------------------------------------------------------------- walls */

/**
 * One step of the same generator with its state kept outside it — in a game object that is copied
 * from move to move (Popper, Rocks) — giving the next state and a number in [0, 1). From the same
 * seed it gives the same numbers as `rng`.
 */
export function rngStep(s: number): [number, number] {
  s ^= s << 13
  s ^= s >>> 17
  s ^= s << 5
  s >>>= 0
  return [s || 1, s / 2 ** 32]
}
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
/** a number for a day, the same in every browser that day */
export function daySeed(d: Date) {
  let h = 2166136261
  for (const ch of `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** a brick's left, top, right and bottom, with a hairline gap between neighbours */
export function brickBox(i: number) {
  const c = i % COLS
  const r = Math.floor(i / COLS)
  const gap = 0.004
  return {
    x0: c * BRICK_W + gap,
    y0: BRICK_TOP + r * BRICK_H + gap,
    x1: (c + 1) * BRICK_W - gap,
    y1: BRICK_TOP + (r + 1) * BRICK_H - gap,
  }
}

/**
 * The strengths a seed and a round give: one of six shapes, mirrored left to right, getting
 * tougher every wall. '0' is a gap, '1'–'3' the hits a brick takes, 'g' a gold brick.
 */
export function wallPattern(seed: number, round: number): string {
  const rand = rng(seed * 31 + round * 7919)
  const shape = Math.floor(rand() * 6)
  const half = COLS / 2
  const cells: string[] = Array(ROWS * COLS).fill('0')
  const tough = Math.min(3, 1 + Math.floor((round - 1) / 2))
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < half; c++) {
      const d = half - 1 - c // 0 at the middle, 4 at the edge
      let on = false
      if (shape === 0) on = r >= 1 && r <= 6
      else if (shape === 1) on = (r + c) % 2 === 0 && r <= 6
      else if (shape === 2) on = r >= 1 && d <= r - 1
      else if (shape === 3) on = Math.abs(r - 3.5) + d * 0.9 <= 4.2
      else if (shape === 4) on = r % 2 === 1 || d === 4
      else on = rand() < 0.62 && r <= 6
      if (!on) continue
      // the top rows are the tough ones, and the wall gets tougher as the rounds go
      const hp = Math.max(1, Math.min(3, tough - Math.floor(r / 3) + (rand() < 0.15 ? 1 : 0)))
      const ch = rand() < 0.06 ? 'g' : String(hp)
      cells[r * COLS + c] = ch
      cells[r * COLS + (COLS - 1 - c)] = ch
    }
  // a wall is never thin: top it up with plain bricks along the middle rows
  for (let k = 0; cells.filter((x) => x !== '0').length < 16 && k < ROWS * COLS; k++)
    if (cells[(30 + k) % (ROWS * COLS)] === '0') cells[(30 + k) % (ROWS * COLS)] = '1'
  return cells.join('')
}

/** a drawn wall's characters, or null when they are not one */
export function readWall(text: string | null): string | null {
  if (!text || text.length !== ROWS * COLS || !/^[0-3g]+$/.test(text)) return null
  return /[1-3g]/.test(text) ? text : null
}

function build(pattern: string, seed: number, round: number): (Brick | null)[] {
  const rand = rng(seed * 131 + round * 104729 + 17)
  return [...pattern].map((ch) => {
    if (ch === '0') return null
    const gold = ch === 'g'
    const hp = gold ? 1 : Number(ch)
    // about one brick in nine carries something, and an extra life is the rarest of them
    let drop: Power | null = null
    if (rand() < 0.11) {
      const x = rand()
      drop = x < 0.06 ? 'life' : x < 0.4 ? 'wide' : x < 0.7 ? 'multi' : 'slow'
    }
    return { hp, max: hp, gold, drop }
  })
}

/* ---------------------------------------------------------------------------- the game */

export const LIVES = 3
export const MAX_LIVES = 5
export const MAX_BALLS = 6
/** a ball's speed in field widths a second, before the paddle and the round add to it */
export function ballSpeed(g: Game) {
  const base = 0.72 + 0.06 * Math.min(10, g.round - 1)
  const warm = 1 + Math.min(0.25, g.touches * 0.008)
  return base * warm * (g.slow > 0 ? 0.68 : 1)
}

const onPaddle = (g: Game): Ball => ({
  x: g.paddle.x,
  y: PADDLE_Y - BALL_R - 0.001,
  vx: 0,
  vy: 0,
  stuck: true,
})

export function newGame(seed: number, custom: string | null = null): Game {
  const g: Game = {
    seed,
    custom,
    round: 1,
    bricks: [],
    balls: [],
    paddle: { x: W / 2, w: PADDLE_W },
    lives: LIVES,
    score: 0,
    combo: 0,
    bestCombo: 0,
    touches: 0,
    drops: [],
    wide: 0,
    slow: 0,
    over: false,
    time: 0,
  }
  g.bricks = build(custom ?? wallPattern(seed, 1), seed, 1)
  g.balls = [onPaddle(g)]
  return g
}

/** send any ball waiting on the paddle up the field, leaning away from the nearer side */
export function launch(g: Game) {
  const sp = ballSpeed(g)
  for (const b of g.balls)
    if (b.stuck) {
      const lean = b.x < W / 2 ? 0.32 : -0.32
      b.vx = sp * Math.sin(lean)
      b.vy = -sp * Math.cos(lean)
      b.stuck = false
    }
}

export const bricksLeft = (g: Game) => g.bricks.filter(Boolean).length
/** what breaking a brick is worth: its toughness, gold's bonus, and the run it is part of */
export const worth = (b: Brick, combo: number) => (b.gold ? 50 : 10 * b.max) * Math.min(8, combo)

/** keep a ball's speed but never let it travel flatter than MIN_RISE of that speed */
function steady(b: Ball, sp: number) {
  const n = Math.hypot(b.vx, b.vy) || 1
  let vx = (b.vx / n) * sp
  let vy = (b.vy / n) * sp
  if (Math.abs(vy) < MIN_RISE * sp) {
    vy = Math.sign(vy || -1) * MIN_RISE * sp
    vx = Math.sign(vx || 1) * Math.sqrt(sp * sp - vy * vy)
  }
  b.vx = vx
  b.vy = vy
}

/**
 * Move everything on by `dt` seconds with the paddle heading for `target`, and say what happened.
 * The ball moves in small steps so it never passes through a brick, however fast the frame.
 */
export function advance(g: Game, dt: number, target: number): Event[] {
  const ev: Event[] = []
  if (g.over || dt <= 0) return ev
  dt = Math.min(dt, 0.05)
  g.time += dt
  g.wide = Math.max(0, g.wide - dt)
  g.slow = Math.max(0, g.slow - dt)
  g.paddle.w = g.wide > 0 ? PADDLE_W * 1.6 : PADDLE_W
  const half = g.paddle.w / 2
  const goal = Math.max(half, Math.min(W - half, target))
  const step = PADDLE_SPEED * dt
  g.paddle.x += Math.max(-step, Math.min(step, goal - g.paddle.x))
  g.paddle.x = Math.max(half, Math.min(W - half, g.paddle.x))

  const sp = ballSpeed(g)
  for (const b of g.balls) {
    if (b.stuck) {
      b.x = g.paddle.x
      b.y = PADDLE_Y - BALL_R - 0.001
      continue
    }
    steady(b, sp)
    const n = Math.max(1, Math.ceil((sp * dt) / 0.005))
    for (let k = 0; k < n; k++) {
      b.x += (b.vx * dt) / n
      b.y += (b.vy * dt) / n
      // the side walls and the ceiling
      if (b.x < BALL_R) {
        b.x = BALL_R
        b.vx = Math.abs(b.vx)
        ev.push({ kind: 'wall' })
      } else if (b.x > W - BALL_R) {
        b.x = W - BALL_R
        b.vx = -Math.abs(b.vx)
        ev.push({ kind: 'wall' })
      }
      if (b.y < BALL_R) {
        b.y = BALL_R
        b.vy = Math.abs(b.vy)
        ev.push({ kind: 'wall' })
      }
      // the paddle: where along it the ball lands decides where it goes, not how it came in
      if (
        b.vy > 0 &&
        b.y + BALL_R >= PADDLE_Y &&
        b.y - BALL_R <= PADDLE_Y + PADDLE_H &&
        Math.abs(b.x - g.paddle.x) <= g.paddle.w / 2 + BALL_R
      ) {
        const off = Math.max(-1, Math.min(1, (b.x - g.paddle.x) / (g.paddle.w / 2)))
        g.touches++
        const s2 = ballSpeed(g)
        b.vx = s2 * Math.sin(off * MAX_ANGLE)
        b.vy = -s2 * Math.cos(off * MAX_ANGLE)
        b.y = PADDLE_Y - BALL_R
        g.combo = 0
        ev.push({ kind: 'paddle' })
      }
      // a brick: the first one the ball overlaps, turned back along the side it came in by
      if (b.y - BALL_R < BRICK_TOP + ROWS * BRICK_H) hitBrick(g, b, ev)
    }
  }

  // balls past the bottom are gone; the last one gone costs a life
  const before = g.balls.length
  g.balls = g.balls.filter((b) => b.y - BALL_R <= H)
  if (before && !g.balls.length) {
    g.lives--
    g.combo = 0
    g.wide = 0
    g.slow = 0
    g.drops = []
    ev.push({ kind: 'lost' })
    if (g.lives <= 0) {
      g.over = true
      ev.push({ kind: 'over' })
      return ev
    }
    g.balls = [onPaddle(g)]
  }

  // drops fall, and the paddle catches what it touches
  for (const d of g.drops) d.y += 0.38 * dt
  g.drops = g.drops.filter((d) => {
    const caught =
      d.y + 0.02 >= PADDLE_Y &&
      d.y - 0.02 <= PADDLE_Y + PADDLE_H &&
      Math.abs(d.x - g.paddle.x) <= g.paddle.w / 2 + 0.03
    if (caught) {
      catchPower(g, d.kind)
      ev.push({ kind: 'catch', power: d.kind })
    }
    return !caught && d.y < H + 0.05
  })

  if (!bricksLeft(g)) {
    const bonus = 250 * g.round + 50 * g.lives
    g.score += bonus
    g.round++
    g.touches = 0
    g.drops = []
    g.wide = 0
    g.slow = 0
    g.combo = 0
    g.bricks = build(g.custom ?? wallPattern(g.seed, g.round), g.seed, g.round)
    g.balls = [onPaddle(g)]
    ev.push({ kind: 'clear', bonus })
  }
  return ev
}

function hitBrick(g: Game, b: Ball, ev: Event[]) {
  const r = Math.floor((b.y - BRICK_TOP) / BRICK_H)
  const c = Math.floor(b.x / BRICK_W)
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr
      const cc = c + dc
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue
      const i = rr * COLS + cc
      const brick = g.bricks[i]
      if (!brick) continue
      const box = brickBox(i)
      const nx = Math.max(box.x0, Math.min(box.x1, b.x))
      const ny = Math.max(box.y0, Math.min(box.y1, b.y))
      const ox = b.x - nx
      const oy = b.y - ny
      if (ox * ox + oy * oy > BALL_R * BALL_R) continue
      // which face: the one the ball is most outside of, or for a ball already inside, the
      // shallower way out
      const inside = ox === 0 && oy === 0
      const sideways = inside
        ? Math.min(b.x - box.x0, box.x1 - b.x) < Math.min(b.y - box.y0, box.y1 - b.y)
        : Math.abs(ox) > Math.abs(oy)
      if (sideways) {
        b.vx = b.x < (box.x0 + box.x1) / 2 ? -Math.abs(b.vx) : Math.abs(b.vx)
        b.x = b.vx < 0 ? box.x0 - BALL_R : box.x1 + BALL_R
      } else {
        b.vy = b.y < (box.y0 + box.y1) / 2 ? -Math.abs(b.vy) : Math.abs(b.vy)
        b.y = b.vy < 0 ? box.y0 - BALL_R : box.y1 + BALL_R
      }
      brick.hp--
      if (brick.hp > 0) {
        g.score += 5
        ev.push({ kind: 'hit', at: i })
      } else {
        g.combo++
        g.bestCombo = Math.max(g.bestCombo, g.combo)
        const points = worth(brick, g.combo)
        g.score += points
        g.bricks[i] = null
        if (brick.drop) {
          const box2 = brickBox(i)
          g.drops.push({ x: (box2.x0 + box2.x1) / 2, y: box2.y1, kind: brick.drop })
        }
        ev.push({ kind: 'break', at: i, points })
      }
      return
    }
}

function catchPower(g: Game, p: Power) {
  if (p === 'wide') {
    g.wide = 12
    g.paddle.w = PADDLE_W * 1.6
  } else if (p === 'slow') g.slow = 10
  else if (p === 'life') g.lives = Math.min(MAX_LIVES, g.lives + 1)
  else {
    // every ball in play becomes three, fanned apart, up to the most the field can follow
    const out = [...g.balls]
    for (const b of g.balls) {
      if (b.stuck) continue
      for (const turn of [-0.35, 0.35]) {
        if (out.length >= MAX_BALLS) break
        const c = Math.cos(turn)
        const s = Math.sin(turn)
        const nb = {
          x: b.x,
          y: b.y,
          vx: b.vx * c - b.vy * s,
          vy: b.vx * s + b.vy * c,
          stuck: false,
        }
        // a fan from a steep ball can come out flat, and a flat ball is one that never comes back
        steady(nb, Math.hypot(b.vx, b.vy))
        out.push(nb)
      }
    }
    g.balls = out
  }
}

/* ---------------------------------------------------------------------------- what is kept */

export const BRICKS_KEY = 'lab_bricks_v1'
export const PALETTES = ['candy', 'neon', 'earth'] as const
export const PADDLES = ['#ff5d8f', '#21d4fd', '#ffd34d', '#8dffb0', '#c08cff'] as const
export type Saved = {
  palette: (typeof PALETTES)[number]
  /** an index into PADDLES */
  paddle: number
  /** a fading tail behind the ball */
  trail: boolean
  sound: boolean
  /** the best score ever, the best on today's walls and which day that was */
  best: number
  today: { day: number; best: number } | null
  /** the furthest wall reached */
  furthest: number
  /** the wall being drawn, kept between visits, and the best score on it */
  drawn: string
  drawnBest: number
}
export const BLANK_WALL = '0'.repeat(ROWS * COLS)
export const EMPTY: Saved = {
  palette: 'candy',
  paddle: 0,
  trail: true,
  sound: true,
  best: 0,
  today: null,
  furthest: 0,
  drawn: BLANK_WALL,
  drawnBest: 0,
}
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const t = o.today as Record<string, unknown> | null
  const drawn = typeof o.drawn === 'string' && /^[0-3g]{80}$/.test(o.drawn) ? o.drawn : BLANK_WALL
  return {
    palette: PALETTES.includes(o.palette as Saved['palette'])
      ? (o.palette as Saved['palette'])
      : EMPTY.palette,
    paddle: whole(o.paddle, PADDLES.length),
    trail: typeof o.trail === 'boolean' ? o.trail : EMPTY.trail,
    sound: typeof o.sound === 'boolean' ? o.sound : EMPTY.sound,
    best: whole(o.best, 1e9),
    today:
      t && typeof t === 'object' && whole(t.day, 2 ** 32)
        ? { day: whole(t.day, 2 ** 32), best: whole(t.best, 1e9) }
        : null,
    furthest: whole(o.furthest, 1e4),
    drawn,
    drawnBest: whole(o.drawnBest, 1e9),
  }
}
