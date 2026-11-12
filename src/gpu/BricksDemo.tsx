import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { sharedCtx } from '../audio/context'
import { CopyLink } from '../lab/CopyLink'
import { hashParam, here } from '../lab/links'
import { CanvasStage } from './CanvasStage'
import {
  BLANK_WALL,
  BRICKS_KEY,
  COLS,
  H,
  PADDLES,
  PADDLE_H,
  PADDLE_Y,
  PALETTES,
  ROWS,
  W,
  BALL_R,
  advance,
  brickBox,
  bricksLeft,
  daySeed,
  launch,
  newGame,
  readSaved,
  readWall,
  wallPattern,
  type Event,
  type Game,
  type Power,
  type Saved,
} from './bricks'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

type Mode = 'today' | 'practice' | 'wall'
type Phase = 'play' | 'paused' | 'over'
const PALETTE_NAMES: Record<Saved['palette'], string> = {
  candy: 'Candy',
  neon: 'Neon night',
  earth: 'Clay',
}
const PADDLE_NAMES = ['Pink', 'Cyan', 'Yellow', 'Green', 'Violet']
type Look = {
  bg: string
  edge: string
  hp: [string, string, string]
  gold: string
  ball: string
  glow: boolean
  text: string
}
const LOOKS: Record<Saved['palette'], Look> = {
  candy: {
    bg: '#1b1035',
    edge: '#3a2566',
    hp: ['#ffb3c8', '#ff5d8f', '#c2185b'],
    gold: '#ffd34d',
    ball: '#ffffff',
    glow: false,
    text: '#fff',
  },
  neon: {
    bg: '#05060f',
    edge: '#1d2148',
    hp: ['#21d4fd', '#7b6cff', '#ff3d7f'],
    gold: '#ffe066',
    ball: '#f5f7ff',
    glow: true,
    text: '#fff',
  },
  earth: {
    bg: '#f3ead8',
    edge: '#cdb892',
    hp: ['#e3b27a', '#b5651d', '#7a3f12'],
    gold: '#e0b400',
    ball: '#2b2522',
    glow: false,
    text: '#2b2522',
  },
}
const POWER_LOOK: Record<Power, { mark: string; colour: string; name: string }> = {
  wide: { mark: 'W', colour: '#2fbf71', name: 'a wide paddle' },
  multi: { mark: 'M', colour: '#21a1fd', name: 'three balls' },
  slow: { mark: 'S', colour: '#f2a03d', name: 'a slower ball' },
  life: { mark: '♥', colour: '#ff4f7b', name: 'an extra life' },
}
const CELL_NAMES: Record<string, string> = {
  '0': 'empty',
  '1': 'a one-hit brick',
  '2': 'a two-hit brick',
  '3': 'a three-hit brick',
  g: 'a gold brick',
}
const NEXT_CELL: Record<string, string> = { '0': '1', '1': '2', '2': '3', '3': 'g', g: '0' }
const fmt = (n: number) => n.toLocaleString('en-GB')

/* ---------------------------------------------------------------------------- sound */
function blip(freq: number, length: number, volume: number, type: OscillatorType = 'triangle') {
  try {
    const ctx = sharedCtx()
    const at = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, at + length)
    gain.gain.setValueAtTime(volume, at)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
    osc.connect(gain).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + length + 0.02)
    // a finished voice lets go of its nodes; the shared context itself is never closed
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  } catch {
    /* no audio here: the game plays on in silence */
  }
}
function soundOf(events: Event[], combo: number) {
  const kinds = new Set(events.map((e) => e.kind))
  if (kinds.has('clear')) {
    blip(523, 0.18, 0.1, 'square')
    blip(784, 0.35, 0.08, 'triangle')
  } else if (kinds.has('lost')) blip(196, 0.4, 0.12, 'sawtooth')
  else if (kinds.has('catch')) blip(880, 0.15, 0.09, 'sine')
  // each brick in a run rings a little higher than the one before
  else if (kinds.has('break')) blip(440 * 2 ** (Math.min(12, combo) / 12), 0.08, 0.1, 'square')
  else if (kinds.has('hit')) blip(330, 0.05, 0.07, 'square')
  else if (kinds.has('paddle')) blip(262, 0.06, 0.09)
}

/* ---------------------------------------------------------------------------- drawing */
type View = { s: number; ox: number; oy: number }
function fit(w: number, h: number): View {
  const s = Math.min(w / W, h / H)
  return { s, ox: (w - W * s) / 2, oy: (h - H * s) / 2 }
}
type Pop = { i: number; t: number; colour: string }
function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  g: Game,
  look: Look,
  paddle: string,
  trails: { x: number; y: number }[][],
  pops: Pop[],
  banner: string,
): View {
  const v = fit(w, h)
  const X = (x: number) => v.ox + x * v.s
  const Y = (y: number) => v.oy + y * v.s
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = look.edge
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = look.bg
  ctx.fillRect(X(0), Y(0), W * v.s, H * v.s)

  for (let i = 0; i < ROWS * COLS; i++) {
    const b = g.bricks[i]
    if (!b) continue
    const box = brickBox(i)
    const colour = b.gold ? look.gold : look.hp[Math.min(3, b.hp) - 1]
    ctx.fillStyle = colour
    if (look.glow) {
      ctx.shadowColor = colour
      ctx.shadowBlur = v.s * 0.012
    }
    const x = X(box.x0)
    const y = Y(box.y0)
    const bw = (box.x1 - box.x0) * v.s
    const bh = (box.y1 - box.y0) * v.s
    ctx.beginPath()
    ctx.roundRect(x, y, bw, bh, Math.max(1, v.s * 0.006))
    ctx.fill()
    ctx.shadowBlur = 0
    // a light top edge, and a crack across a brick that has been hit
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.fillRect(x + 1, y + 1, bw - 2, Math.max(1, bh * 0.18))
    if (b.hp < b.max) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.lineWidth = Math.max(1, v.s * 0.0025)
      ctx.beginPath()
      ctx.moveTo(x + bw * 0.3, y)
      ctx.lineTo(x + bw * 0.45, y + bh * 0.55)
      ctx.lineTo(x + bw * 0.38, y + bh)
      ctx.stroke()
    }
    if (b.gold) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = `700 ${Math.round(bh * 0.7)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('★', x + bw / 2, y + bh / 2 + 1)
    }
  }
  // a broken brick flashes out
  for (const p of pops) {
    const box = brickBox(p.i)
    const grow = (1 - p.t) * v.s * 0.012
    ctx.globalAlpha = p.t
    ctx.fillStyle = p.colour
    ctx.fillRect(
      X(box.x0) - grow,
      Y(box.y0) - grow,
      (box.x1 - box.x0) * v.s + grow * 2,
      (box.y1 - box.y0) * v.s + grow * 2,
    )
    ctx.globalAlpha = 1
  }

  for (const d of g.drops) {
    const p = POWER_LOOK[d.kind]
    const dw = 0.07 * v.s
    const dh = 0.032 * v.s
    ctx.fillStyle = p.colour
    ctx.beginPath()
    ctx.roundRect(X(d.x) - dw / 2, Y(d.y) - dh / 2, dw, dh, dh / 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `800 ${Math.round(dh * 0.75)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(p.mark, X(d.x), Y(d.y) + 1)
  }

  ctx.fillStyle = paddle
  if (look.glow) {
    ctx.shadowColor = paddle
    ctx.shadowBlur = v.s * 0.02
  }
  ctx.beginPath()
  ctx.roundRect(
    X(g.paddle.x - g.paddle.w / 2),
    Y(PADDLE_Y),
    g.paddle.w * v.s,
    PADDLE_H * v.s,
    PADDLE_H * v.s * 0.5,
  )
  ctx.fill()
  ctx.shadowBlur = 0

  for (const t of trails)
    t.forEach((p, k) => {
      ctx.globalAlpha = ((k + 1) / (t.length + 1)) * 0.35
      ctx.fillStyle = look.ball
      ctx.beginPath()
      ctx.arc(X(p.x), Y(p.y), BALL_R * v.s * (0.5 + (k / t.length) * 0.5), 0, Math.PI * 2)
      ctx.fill()
    })
  ctx.globalAlpha = 1
  ctx.fillStyle = look.ball
  for (const b of g.balls) {
    ctx.beginPath()
    ctx.arc(X(b.x), Y(b.y), BALL_R * v.s, 0, Math.PI * 2)
    ctx.fill()
  }

  if (banner) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    const bh = Math.max(40, v.s * 0.1)
    ctx.fillRect(X(0), Y(0.92) - bh / 2, W * v.s, bh)
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${Math.round(Math.max(14, Math.min(24, v.s * 0.045)))}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(banner, X(W / 2), Y(0.92), W * v.s - 20)
  }
  return v
}

/* ---------------------------------------------------------------------------- the room */

type Hud = { score: number; round: number; lives: number; left: number; combo: number }
const hudOf = (g: Game): Hud => ({
  score: g.score,
  round: g.round,
  lives: g.lives,
  left: bricksLeft(g),
  combo: g.bestCombo,
})

export function BricksDemo() {
  const [saved, setSaved] = useKept(BRICKS_KEY, readSaved)
  const linked = useRef(readWall(hashParam('wall')))
  const [mode, setMode] = useState<Mode>(linked.current ? 'wall' : 'today')
  /** the wall played in "your wall": a linked one for this visit, or the one being drawn */
  const [wall, setWall] = useState<string>(linked.current ?? saved.drawn)
  const [phase, setPhase] = useState<Phase>('play')
  const [said, setSaid] = useState(() =>
    linked.current
      ? 'A wall from a link. Tap or press Space to serve.'
      : "Today's walls — the same for everyone today. Tap or press Space to serve.",
  )
  const [mirror, setMirror] = useState(true)
  const [cell, setCell] = useState(0)
  const [share, setShare] = useState('')
  const seedFor = (m: Mode) => (m === 'today' ? daySeed(new Date()) : (Math.random() * 2 ** 31) | 0)
  const game = useRef<Game>(newGame(seedFor(mode), mode === 'wall' && readWall(wall) ? wall : null))
  const [hud, setHud] = useState<Hud>(() => hudOf(game.current))
  const target = useRef(W / 2)
  const keys = useRef(new Set<string>())
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const savedRef = useRef(saved)
  savedRef.current = saved
  const modeRef = useRef(mode)
  modeRef.current = mode
  const view = useRef<View | null>(null)
  const cells = useRef<(HTMLButtonElement | null)[]>([])

  // a hidden tab pauses, so nobody comes back to a lost ball
  useEffect(() => {
    const hide = () => {
      if (document.hidden && phaseRef.current === 'play') setPhase('paused')
    }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])

  const fresh = (m: Mode = mode, w: string = wall) => {
    const custom = m === 'wall' ? readWall(w) : null
    game.current = newGame(seedFor(m), custom)
    target.current = W / 2
    setHud(hudOf(game.current))
    setPhase('play')
    setShare('')
    setSaid(
      m === 'today'
        ? "Today's walls — the same for everyone today. Tap or press Space to serve."
        : m === 'practice'
          ? 'Practice walls, new every game. Tap or press Space to serve.'
          : custom
            ? 'Your wall. Tap or press Space to serve.'
            : 'Draw some bricks below first.',
    )
  }
  const pickMode = (m: Mode) => {
    setMode(m)
    fresh(m)
  }

  const finish = (g: Game) => {
    const m = modeRef.current
    const s = savedRef.current
    const day = daySeed(new Date())
    const prevToday = s.today && s.today.day === day ? s.today.best : 0
    const yours = m === 'wall' && g.custom === s.drawn
    const beat =
      m === 'today'
        ? g.score > prevToday
        : m === 'wall'
          ? yours && g.score > s.drawnBest
          : g.score > s.best
    setSaved((x) => ({
      ...x,
      best: Math.max(x.best, g.score),
      furthest: Math.max(x.furthest, g.round),
      today: m === 'today' ? { day, best: Math.max(prevToday, g.score) } : x.today,
      drawnBest: yours ? Math.max(x.drawnBest, g.score) : x.drawnBest,
    }))
    setSaid(
      `Game over: ${fmt(g.score)} points, reaching wall ${g.round}, best run ${g.bestCombo}.${beat && g.score > 0 ? ' 🏆 A new best!' : ''}`,
    )
    if (m === 'today')
      setShare(
        `I scored ${fmt(g.score)} on today's Bricks walls, reaching wall ${g.round}. Beat it:\n${here()}#lab?demo=bricks`,
      )
    else if (m === 'wall' && g.custom)
      setShare(
        `I scored ${fmt(g.score)} on this Bricks wall. Your go:\n${here()}#lab?demo=bricks&wall=${g.custom}`,
      )
    setPhase('over')
  }

  const onEvents = (g: Game, ev: Event[]) => {
    for (const e of ev) {
      if (e.kind === 'clear')
        setSaid(`Wall cleared! +${fmt(e.bonus)}. Wall ${g.round} — serve when ready.`)
      else if (e.kind === 'lost' && !g.over)
        setSaid(
          `Ball lost — ${g.lives} ${g.lives === 1 ? 'life' : 'lives'} left. Serve when ready.`,
        )
      else if (e.kind === 'catch') setSaid(`Caught ${POWER_LOOK[e.power].name}.`)
    }
    if (g.over) finish(g)
  }

  const serveOrPause = () => {
    if (savedRef.current.sound) void sharedCtx().resume()
    if (phase === 'over') return fresh()
    if (mode === 'wall' && !game.current.custom) return
    if (phase === 'paused') {
      setPhase('play')
      return
    }
    if (game.current.balls.some((b) => b.stuck)) {
      launch(game.current)
      setSaid('')
    } else setPhase('paused')
  }

  const toField = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    const v = view.current
    if (!v) return null
    const r = c.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * c.width
    return (px - v.ox) / v.s
  }
  const onPointer = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== 'mouse' && e.type === 'pointermove' && e.buttons === 0) return
    const x = toField(e)
    if (x !== null) {
      keys.current.clear()
      target.current = x
    }
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(k)) {
      e.preventDefault()
      e.stopPropagation()
      if (down) keys.current.add(k)
      else keys.current.delete(k)
      return
    }
    if (!down) return
    if (k === ' ' || k === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      serveOrPause()
    } else if ((k === 'Escape' || k === 'p') && phase === 'play') setPhase('paused')
  }

  /* --- the wall drawing */
  const setDrawn = (next: string) => {
    setSaved((s) => ({ ...s, drawn: next, drawnBest: next === s.drawn ? s.drawnBest : 0 }))
    setWall(next)
  }
  const cycle = (i: number) => {
    const cs = [...wall]
    const v = NEXT_CELL[cs[i]]
    cs[i] = v
    if (mirror) cs[Math.floor(i / COLS) * COLS + (COLS - 1 - (i % COLS))] = v
    setDrawn(cs.join(''))
  }
  const onCellKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -COLS,
      ArrowDown: COLS,
    }
    if (d[e.key] === undefined) return
    e.preventDefault()
    e.stopPropagation()
    const r = Math.floor(cell / COLS)
    const c = cell % COLS
    const nr = Math.max(
      0,
      Math.min(ROWS - 1, r + (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0)),
    )
    const nc = Math.max(
      0,
      Math.min(COLS - 1, c + (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0)),
    )
    const next = nr * COLS + nc
    setCell(next)
    cells.current[next]?.focus()
  }

  const day = daySeed(new Date())
  const todayBest = saved.today && saved.today.day === day ? saved.today.best : 0
  const best =
    mode === 'today'
      ? todayBest
      : mode === 'wall'
        ? wall === saved.drawn
          ? saved.drawnBest
          : 0
        : saved.best
  const playable = mode !== 'wall' || !!readWall(wall)

  return (
    <div className="lab-keys br-room">
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Which walls">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'today'}
            onClick={() => pickMode('today')}
          >
            Today's walls
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'practice'}
            onClick={() => pickMode('practice')}
          >
            Practice
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'wall'}
            onClick={() => pickMode('wall')}
          >
            Your wall
          </button>
        </div>
        <button className="btn" onClick={serveOrPause} disabled={!playable}>
          {phase === 'over'
            ? '↻ Play again'
            : phase === 'paused'
              ? '▶ Carry on'
              : game.current.balls.some((b) => b.stuck)
                ? '▶ Serve'
                : '⏸ Pause'}
        </button>
        <button className="btn btn-ghost" onClick={() => fresh()} disabled={!playable}>
          New game
        </button>
      </div>

      <div className="dice-scores br-hud">
        <div className="dice-score">
          <span>Score</span>
          <strong>{fmt(hud.score)}</strong>
        </div>
        <div className="dice-score">
          <span>Wall</span>
          <strong>{hud.round}</strong>
          <span className="muted">{hud.left} left</span>
        </div>
        <div className="dice-score">
          <span>Lives</span>
          <strong aria-label={`${hud.lives} lives`}>
            {'♥'.repeat(Math.max(0, hud.lives)) || '—'}
          </strong>
        </div>
        <div className="dice-score">
          <span>
            {mode === 'today' ? 'Best today' : mode === 'wall' ? 'Best on it' : 'Best ever'}
          </span>
          <strong>{fmt(best)}</strong>
        </div>
      </div>

      <div
        className={`br-wrap${phase === 'play' ? ' is-playing' : ''}`}
        tabIndex={0}
        role="group"
        aria-label="The field. Move the paddle with the mouse, a finger, or the left and right arrow keys; Space serves and pauses."
        onKeyDown={(e) => onKey(e, true)}
        onKeyUp={(e) => onKey(e, false)}
        onBlur={() => keys.current.clear()}
      >
        <CanvasStage
          className="br-stage"
          label={`A wall of bricks: wall ${hud.round}, ${hud.left} bricks left, ${fmt(hud.score)} points, ${hud.lives} lives.`}
          onPointerDown={(e) => {
            onPointer(e)
            if (phaseRef.current === 'paused') setPhase('play')
            else if (phaseRef.current === 'play' && game.current.balls.some((b) => b.stuck))
              serveOrPause()
          }}
          onPointerMove={onPointer}
          make={(ctx, c) => {
            const trails: { x: number; y: number }[][] = []
            const pops: Pop[] = []
            let last = ''
            let hudKey = ''
            return {
              frame: (dt) => {
                const s = savedRef.current
                const g = game.current
                const ph = phaseRef.current
                const still = reduced()
                const look = LOOKS[s.palette]
                if (ph === 'play' && dt > 0 && (modeRef.current !== 'wall' || g.custom)) {
                  const k = keys.current
                  if (k.size) {
                    const dir =
                      (k.has('ArrowRight') || k.has('d') ? 1 : 0) -
                      (k.has('ArrowLeft') || k.has('a') ? 1 : 0)
                    target.current = g.paddle.x + dir
                  } else if (
                    target.current > g.paddle.x + 0.5 ||
                    target.current < g.paddle.x - 0.5
                  ) {
                    // a key let go leaves the paddle where it is, not running on to the wall
                    target.current = g.paddle.x
                  }
                  const ev = advance(g, dt, target.current)
                  if (ev.length) {
                    if (s.sound) soundOf(ev, g.combo)
                    if (!still)
                      for (const e of ev)
                        if (e.kind === 'break') pops.push({ i: e.at, t: 1, colour: look.gold })
                    onEvents(g, ev)
                  }
                  for (const p of pops) p.t -= dt * 4
                  while (pops.length && pops[0].t <= 0) pops.shift()
                  if (s.trail && !still) {
                    g.balls.forEach((b, i) => {
                      const t = (trails[i] ??= [])
                      t.push({ x: b.x, y: b.y })
                      if (t.length > 8) t.shift()
                    })
                    trails.length = g.balls.length
                  } else trails.length = 0
                  const hk = `${g.score}|${g.round}|${g.lives}|${bricksLeft(g)}`
                  if (hk !== hudKey) {
                    hudKey = hk
                    setHud(hudOf(g))
                  }
                }
                const stuck = g.balls.some((b) => b.stuck)
                const banner =
                  modeRef.current === 'wall' && !g.custom
                    ? 'Draw a wall below to play it'
                    : ph === 'paused'
                      ? 'Paused — tap or press Space'
                      : ph === 'over'
                        ? `Game over — ${fmt(g.score)}`
                        : stuck
                          ? g.round > 1
                            ? `Wall ${g.round} — tap or press Space`
                            : 'Tap or press Space to serve'
                          : ''
                // held still, a frame is drawn only when something in it changed
                const key = `${c.width}x${c.height}|${ph}|${s.palette}|${s.paddle}|${g.paddle.x.toFixed(4)}|${g.balls.map((b) => `${b.x.toFixed(4)},${b.y.toFixed(4)}`).join(';')}|${g.drops.length}|${bricksLeft(g)}|${g.score}|${pops.length}|${banner}`
                if (key === last) return
                last = key
                view.current = draw(
                  ctx,
                  c.width,
                  c.height,
                  g,
                  look,
                  PADDLES[s.paddle],
                  trails,
                  pops,
                  banner,
                )
              },
            }
          }}
        />
      </div>
      <p className="mc-line" aria-live="polite">
        {said || ' '}
      </p>
      {share && (
        <CopyLink
          text={share}
          label={mode === 'today' ? '🔗 Copy my score' : '🔗 Copy my score and this wall'}
        />
      )}
      <p className="sun-reading">
        <span className="muted">
          Best ever {fmt(saved.best)}
          {saved.furthest > 1 && <> · furthest wall {saved.furthest}</>}
          {todayBest > 0 && <> · best today {fmt(todayBest)}</>}
        </span>
      </p>

      {mode === 'wall' && (
        <section className="br-draw" aria-label="Draw your wall">
          <h3 className="fw-h">Draw your wall</h3>
          <p className="muted mc-note">
            Tap a space to put a brick there; tap again for a tougher one, then gold, then empty.
            {linked.current && wall === linked.current && wall !== saved.drawn
              ? ' This is the wall from your link — drawing on it makes it yours.'
              : ''}
          </p>
          <div
            className="br-grid"
            role="group"
            aria-label="The wall, ten bricks across and eight down. Arrow keys move, Enter changes a brick."
            onKeyDown={onCellKey}
          >
            {[...wall].map((ch, i) => (
              <button
                key={i}
                ref={(el) => {
                  cells.current[i] = el
                }}
                className={`br-cell is-${ch}`}
                tabIndex={i === cell ? 0 : -1}
                aria-label={`Row ${Math.floor(i / COLS) + 1}, column ${(i % COLS) + 1}: ${CELL_NAMES[ch]}`}
                onFocus={() => setCell(i)}
                onClick={() => {
                  setCell(i)
                  cycle(i)
                }}
              >
                <span aria-hidden>{ch === 'g' ? '★' : ch === '0' ? '' : ch}</span>
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button className="btn" onClick={() => fresh('wall', wall)} disabled={!readWall(wall)}>
              ▶ Play this wall
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={mirror}
              onClick={() => setMirror((m) => !m)}
            >
              Mirror both halves
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setDrawn(wallPattern(daySeed(new Date()), 1))}
            >
              Start from today's first wall
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setDrawn(BLANK_WALL)}
              disabled={wall === BLANK_WALL}
            >
              Clear
            </button>
          </div>
          {readWall(wall) && (
            <CopyLink
              text={`Try my Bricks wall:\n${here()}#lab?demo=bricks&wall=${wall}`}
              label="🔗 Copy a link to this wall"
            />
          )}
        </section>
      )}

      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Bricks and paddle</h3>
          <div className="lab-controls" role="group" aria-label="Bricks">
            {PALETTES.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={saved.palette === p}
                onClick={() => setSaved((s) => ({ ...s, palette: p }))}
              >
                {PALETTE_NAMES[p]}
              </button>
            ))}
          </div>
          <div className="fw-swatches" role="group" aria-label="Paddle colour">
            {PADDLES.map((colour, i) => (
              <button
                key={colour}
                className="fw-swatch"
                style={{ background: colour }}
                aria-pressed={saved.paddle === i}
                aria-label={`${PADDLE_NAMES[i]} paddle`}
                onClick={() => setSaved((s) => ({ ...s, paddle: i }))}
              />
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.trail}
              onClick={() => setSaved((s) => ({ ...s, trail: !s.trail }))}
            >
              Ball trail
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={saved.sound}
              onClick={() => setSaved((s) => ({ ...s, sound: !s.sound }))}
            >
              Sound
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Keep the ball in play and knock out the wall. Where the ball lands on the paddle sets where
        it goes: the middle sends it straight up, the ends send it wide. A tough brick takes two or
        three hits; gold is worth fifty. Every brick broken before the ball comes back to the paddle
        is worth more than the last, up to eight times. Catch what falls: W widens the paddle, M
        makes three balls, S slows the ball, ♥ is a life. Clear a wall for a bonus and the next one
        comes tougher and quicker. Today's walls are the same for everyone today; Practice is new
        every game; Your wall plays one you draw, and a link carries it to a friend. Keys: left and
        right arrows (or A and D) move, Space serves and pauses.
      </p>
    </div>
  )
}
