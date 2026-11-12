import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  H,
  LOOKS,
  PACES,
  ROCKS_KEY,
  ROCK_R,
  SHIP_R,
  W,
  newWorld,
  readSaved,
  step,
  type Input,
  type Saved,
  type Size,
  type World,
} from './rocks'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

type Phase = 'ready' | 'playing' | 'paused' | 'over'
type Hold = 'left' | 'right' | 'thrust' | 'fire'
const PACE_NAMES: Record<Saved['pace'], string> = { calm: 'Calm', normal: 'Normal', wild: 'Wild' }
const LOOK_NAMES: Record<Saved['look'], string> = { vector: 'Vector', neon: 'Neon', paper: 'Paper' }
type Look = { bg: string; ink: string; rock: string; shot: string; glow: boolean; fill: boolean }
const PALETTES: Record<Saved['look'], Look> = {
  vector: {
    bg: '#04070a',
    ink: '#c8ffd9',
    rock: '#c8ffd9',
    shot: '#ffffff',
    glow: false,
    fill: false,
  },
  neon: {
    bg: '#08001a',
    ink: '#3df5ff',
    rock: '#ff4fd8',
    shot: '#fff36b',
    glow: true,
    fill: false,
  },
  paper: {
    bg: '#f7f2e6',
    ink: '#2b2b2b',
    rock: '#6b5b45',
    shot: '#c2410c',
    glow: false,
    fill: true,
  },
}
/** a rock's outline: ten points round it at radii drawn from its own number, so each is its own */
function outline(shape: number): number[] {
  let s = shape || 1
  return Array.from({ length: 10 }, () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return 0.75 + (s / 0x7fffffff) * 0.35
  })
}
type Bit = { x: number; y: number; vx: number; vy: number; t: number }
const KEYS: Record<string, Hold> = {
  ArrowLeft: 'left',
  a: 'left',
  A: 'left',
  ArrowRight: 'right',
  d: 'right',
  D: 'right',
  ArrowUp: 'thrust',
  w: 'thrust',
  W: 'thrust',
  ' ': 'fire',
}

export function RocksDemo() {
  const [saved, setSaved] = useKept(ROCKS_KEY, readSaved)
  const [phase, setPhase] = useState<Phase>('ready')
  const [hud, setHud] = useState({ score: 0, lives: 3, wave: 1 })
  const [line, setLine] = useState(
    'Turn, thrust and fire: break every rock, and keep clear of them.',
  )
  const world = useRef<World>(newWorld(saved.pace, 1))
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const savedRef = useRef(saved)
  savedRef.current = saved
  const held = useRef<Record<Hold, boolean>>({
    left: false,
    right: false,
    thrust: false,
    fire: false,
  })
  /** a press of fire kept until a step has used it, so a tap shorter than a frame still fires */
  const queued = useRef(0)
  const bits = useRef<Bit[]>([])
  // a hidden tab is a paused game
  useEffect(() => {
    const away = () => {
      if (document.hidden && phaseRef.current === 'playing') setPhase('paused')
    }
    document.addEventListener('visibilitychange', away)
    return () => document.removeEventListener('visibilitychange', away)
  }, [])

  const start = (pace = saved.pace) => {
    world.current = newWorld(pace, (Math.random() * 2 ** 31) >>> 0)
    bits.current = []
    queued.current = 0
    setHud({ score: 0, lives: 3, wave: 1 })
    setPhase('playing')
    setLine('Wave 1.')
  }
  const end = (w: World) => {
    setPhase('over')
    const best = savedRef.current.best[w.pace]
    setSaved((s) => ({
      ...s,
      games: s.games + 1,
      best: { ...s.best, [w.pace]: Math.max(s.best[w.pace], w.score) },
    }))
    setLine(
      `Game over: ${w.score.toLocaleString()} points, to wave ${w.wave}${w.score > best && w.score ? ' — your best at this pace!' : '.'}`,
    )
  }
  const press = (h: Hold, down: boolean) => {
    held.current[h] = down
    if (h === 'fire' && down) queued.current = 0.25
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    const h = KEYS[e.key]
    if (h) {
      e.preventDefault()
      e.stopPropagation()
      if (down && phaseRef.current !== 'playing') {
        if (h === 'fire' && phaseRef.current !== 'paused') start()
        else if (h === 'fire') setPhase('playing')
        return
      }
      if (!(down && e.repeat)) press(h, down)
      return
    }
    if (down && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault()
      if (phaseRef.current === 'playing') setPhase('paused')
      else if (phaseRef.current === 'paused') setPhase('playing')
    }
  }
  /** a button held by a finger or a mouse: down while pressed, up when let go or slid off */
  const holdButton = (h: Hold, label: string, glyph: string) => (
    <button
      className="btn btn-ghost rk-pad"
      aria-label={label}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        e.preventDefault()
        if (phaseRef.current !== 'playing') {
          if (h !== 'fire') return
          if (phaseRef.current === 'paused') setPhase('playing')
          else start()
          return
        }
        press(h, true)
      }}
      onPointerUp={() => press(h, false)}
      onPointerLeave={() => press(h, false)}
      onPointerCancel={() => press(h, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {glyph}
    </button>
  )

  const best = saved.best[saved.pace]
  return (
    <div className={`lab-keys rk-room is-${saved.look}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Pace">
          {PACES.map((p) => (
            <button
              key={p}
              className="btn btn-ghost"
              aria-pressed={saved.pace === p}
              onClick={() => {
                setSaved((s) => ({ ...s, pace: p }))
                // a game under way starts again at the new pace; otherwise the field waits for it
                if (phase === 'playing' || phase === 'paused') start(p)
                else {
                  world.current = newWorld(p, 1)
                  setPhase('ready')
                }
              }}
            >
              {PACE_NAMES[p]}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => start()}>
          {phase === 'ready' ? '▶ Start' : '↻ New game'}
        </button>
        <button
          className="btn btn-ghost"
          disabled={phase !== 'playing' && phase !== 'paused'}
          onClick={() => setPhase(phase === 'paused' ? 'playing' : 'paused')}
        >
          {phase === 'paused' ? '▶ Go on' : '⏸ Pause'}
        </button>
      </div>
      <div className="dice-scores">
        <div className="dice-score is-up">
          <span>Score</span>
          <strong>{hud.score.toLocaleString()}</strong>
          <span className="muted">wave {hud.wave}</span>
        </div>
        <div className="dice-score">
          <span>Ships</span>
          <strong>{hud.lives}</strong>
          <span className="muted">one more every 10,000</span>
        </div>
        <div className="dice-score">
          <span>Best</span>
          <strong>{best.toLocaleString()}</strong>
          <span className="muted">{PACE_NAMES[saved.pace].toLowerCase()}</span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="rk-wrap"
        tabIndex={0}
        role="group"
        aria-label="The field. Left and right (or A and D) turn, Up (or W) thrusts, Space fires and starts, P pauses."
        onKeyDown={(e) => onKey(e, true)}
        onKeyUp={(e) => onKey(e, false)}
        onBlur={() => {
          for (const h of Object.keys(held.current) as Hold[]) held.current[h] = false
        }}
      >
        <CanvasStage
          className="rk-stage"
          label={`Rocks: ${hud.score} points, ${hud.lives} ships, wave ${hud.wave}. ${line}`}
          make={(ctx, c) => {
            const shapes = new Map<number, number[]>()
            let shown = { score: -1, lives: -1, wave: -1 }
            let lastPhase: Phase | null = null
            let lastLook = ''
            return {
              frame: (dt) => {
                const ph = phaseRef.current
                let w = world.current
                if (ph === 'playing') {
                  const fire = held.current.fire || queued.current > 0
                  const input: Input = { ...held.current, fire }
                  const r = step(w, input, dt)
                  w = r.world
                  world.current = w
                  queued.current = r.happened.fired ? 0 : Math.max(0, queued.current - dt)
                  if (!reduced())
                    for (const b of r.happened.broke)
                      for (let k = 0; k < 4 + b.size * 3; k++) {
                        const a = Math.random() * Math.PI * 2
                        const v = 1 + Math.random() * 3
                        bits.current.push({
                          x: b.x,
                          y: b.y,
                          vx: Math.cos(a) * v,
                          vy: Math.sin(a) * v,
                          t: 0,
                        })
                      }
                  if (r.happened.lost && !w.over) setLine(`Ship lost — ${w.lives} left.`)
                  if (r.happened.wave) setLine(`Wave ${w.wave}.`)
                  if (r.happened.extra) setLine('An extra ship!')
                  // only on the step that ends it: the loop may run again before the page has
                  // heard, and a second call would count the game twice
                  if (r.happened.lost && w.over) end(w)
                }
                for (const b of bits.current) {
                  b.t += dt
                  b.x += b.vx * dt
                  b.y += b.vy * dt
                }
                bits.current = bits.current.filter((b) => b.t < 0.6)
                if (w.score !== shown.score || w.lives !== shown.lives || w.wave !== shown.wave) {
                  shown = { score: w.score, lives: w.lives, wave: w.wave }
                  setHud(shown)
                }
                // a still field need not be drawn again
                const look = savedRef.current.look
                if (
                  ph !== 'playing' &&
                  ph === lastPhase &&
                  look === lastLook &&
                  !bits.current.length &&
                  dt > 0
                )
                  return
                lastPhase = ph
                lastLook = look

                const L = PALETTES[savedRef.current.look]
                const s = c.width / W
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.fillStyle = L.bg
                ctx.fillRect(0, 0, c.width, c.height)
                ctx.setTransform(s, 0, 0, s, 0, 0)
                ctx.lineWidth = 0.05
                ctx.lineJoin = 'round'
                if (L.glow) ctx.shadowBlur = 0.25 * s
                // something near an edge is drawn on the far side too, so it slides off one edge
                // and on at the other rather than vanishing
                const everywhere = (
                  x: number,
                  y: number,
                  r: number,
                  draw: (x: number, y: number) => void,
                ) => {
                  for (const ox of [0, W, -W])
                    for (const oy of [0, H, -H]) {
                      const px = x + ox
                      const py = y + oy
                      if (px + r < 0 || px - r > W || py + r < 0 || py - r > H) continue
                      draw(px, py)
                    }
                }
                ctx.strokeStyle = L.rock
                ctx.shadowColor = L.rock
                ctx.fillStyle = `${L.rock}33`
                for (const r of w.rocks) {
                  let pts = shapes.get(r.shape)
                  if (!pts) {
                    pts = outline(r.shape)
                    shapes.set(r.shape, pts)
                  }
                  const R = ROCK_R[r.size as Size]
                  everywhere(r.x, r.y, R, (x, y) => {
                    ctx.beginPath()
                    pts.forEach((k, i) => {
                      const a = r.spin + (i / pts.length) * Math.PI * 2
                      const px = x + Math.cos(a) * R * k
                      const py = y + Math.sin(a) * R * k
                      if (i) ctx.lineTo(px, py)
                      else ctx.moveTo(px, py)
                    })
                    ctx.closePath()
                    if (L.fill) ctx.fill()
                    ctx.stroke()
                  })
                }
                ctx.fillStyle = L.shot
                ctx.shadowColor = L.shot
                for (const b of w.bullets) {
                  ctx.beginPath()
                  ctx.arc(b.x, b.y, 0.07, 0, Math.PI * 2)
                  ctx.fill()
                }
                const sh = w.ship
                // a new ship blinks while it is safe — steady under reduced motion
                const blink = sh && sh.safe > 0 && !reduced() && Math.floor(sh.safe * 8) % 2 === 0
                if (sh && !blink) {
                  ctx.strokeStyle = L.ink
                  ctx.shadowColor = L.ink
                  everywhere(sh.x, sh.y, SHIP_R * 1.5, (x, y) => {
                    const p = (a: number, r: number) => [
                      x + Math.cos(sh.a + a) * r,
                      y + Math.sin(sh.a + a) * r,
                    ]
                    const [ax, ay] = p(0, SHIP_R * 1.4)
                    const [bx, by] = p(2.5, SHIP_R)
                    const [cx, cy] = p(-2.5, SHIP_R)
                    const [dx, dy] = p(Math.PI, SHIP_R * 0.45)
                    ctx.beginPath()
                    ctx.moveTo(ax, ay)
                    ctx.lineTo(bx, by)
                    ctx.lineTo(dx, dy)
                    ctx.lineTo(cx, cy)
                    ctx.closePath()
                    ctx.stroke()
                    if (
                      held.current.thrust &&
                      ph === 'playing' &&
                      (reduced() || Math.random() > 0.3)
                    ) {
                      const [fx, fy] = p(Math.PI, SHIP_R * 1.3)
                      ctx.beginPath()
                      ctx.moveTo(bx * 0.4 + dx * 0.6, by * 0.4 + dy * 0.6)
                      ctx.lineTo(fx, fy)
                      ctx.lineTo(cx * 0.4 + dx * 0.6, cy * 0.4 + dy * 0.6)
                      ctx.stroke()
                    }
                  })
                }
                ctx.fillStyle = L.rock
                for (const b of bits.current) {
                  ctx.globalAlpha = 1 - b.t / 0.6
                  ctx.fillRect(b.x - 0.04, b.y - 0.04, 0.08, 0.08)
                }
                ctx.globalAlpha = 1
                ctx.shadowBlur = 0
                if (ph !== 'playing') {
                  ctx.fillStyle = `${L.bg}aa`
                  ctx.fillRect(0, 0, W, H)
                  ctx.fillStyle = L.ink
                  ctx.textAlign = 'center'
                  ctx.textBaseline = 'middle'
                  ctx.font = '700 0.9px system-ui, sans-serif'
                  ctx.fillText(
                    ph === 'paused' ? 'Paused' : ph === 'over' ? 'Game over' : 'Rocks',
                    W / 2,
                    H / 2 - 0.6,
                  )
                  ctx.font = '0.5px system-ui, sans-serif'
                  ctx.fillText(
                    ph === 'paused' ? 'Space or ● to go on' : 'Space or ● to start',
                    W / 2,
                    H / 2 + 0.5,
                  )
                }
              },
            }
          }}
        />
      </div>
      <div className="lab-controls rk-pads" role="group" aria-label="Flying">
        {holdButton('left', 'Turn left', '⟲')}
        {holdButton('thrust', 'Thrust', '▲')}
        {holdButton('right', 'Turn right', '⟳')}
        {holdButton('fire', 'Fire', '●')}
      </div>
      <p className="sun-reading">
        <span className="muted">Games played: {saved.games}</span>
      </p>
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Look</h3>
          <div className="lab-controls" role="group" aria-label="Look">
            {LOOKS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.look === l}
                onClick={() => setSaved((s) => ({ ...s, look: l }))}
              >
                {LOOK_NAMES[l]}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Fly a ship through a field of drifting rocks: everything that leaves one edge comes back at
        the other. A big rock hit splits into two middling ones (20 points), a middling one into two
        small ones (50), and a small one is gone (100). Clear the field and a bigger wave drifts in.
        A rock that touches your ship costs one of your three; a new ship waits for the middle to
        clear and blinks while it is safe. An extra ship every 10,000. The pace sets how fast the
        rocks drift, with a best score for each. Under reduced motion there are no flying sparks,
        and the new ship does not blink — but the rocks still drift: they are the game. Keys: left
        and right turn, up thrusts, Space fires, P pauses; or hold the buttons under the field.
      </p>
    </div>
  )
}
