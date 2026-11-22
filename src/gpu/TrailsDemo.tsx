import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  ARENAS,
  COLOURS,
  LAYOUTS,
  LEVELS,
  SPEEDS,
  TRAILS_KEY,
  living,
  newArena,
  readSaved,
  recordRound,
  steer,
  tick,
  turnable,
  type Arena,
  type ArenaSize,
  type Dir,
  type Layout,
  type Level,
  type Saved,
  type Speed,
} from './trails'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

type Phase = 'ready' | 'play' | 'paused' | 'between' | 'over'
const ROUNDS_TO_WIN = 3

const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const SIZE_NAMES: Record<ArenaSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' }
const LAYOUT_NAMES: Record<Layout, string> = {
  open: 'Open',
  pillars: 'Pillars',
  scatter: 'Scattered',
}
const SPEED_NAMES: Record<Speed, string> = { steady: 'Steady', quick: 'Quick', frantic: 'Frantic' }
const COLOUR_NAMES = ['Cyan', 'Pink', 'Yellow', 'Green', 'Violet', 'Orange']
const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 0,
  w: 0,
  ArrowRight: 1,
  d: 1,
  ArrowDown: 2,
  s: 2,
  ArrowLeft: 3,
  a: 3,
}

/** your colour first, then the rivals' in the order of the wheel after it */
const coloursFor = (mine: number, n: number) =>
  Array.from({ length: n }, (_, k) => COLOURS[(mine + k * 2) % COLOURS.length])

type Spark = { x: number; y: number; vx: number; vy: number; life: number; colour: string }
type View = { s: number; ox: number; oy: number }

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: Arena,
  colours: string[],
  glow: boolean,
  sparks: Spark[],
  banner: string,
): View {
  const s = Math.min(w / a.w, h / a.h)
  const ox = (w - a.w * s) / 2
  const oy = (h - a.h * s) / 2
  ctx.fillStyle = '#070a14'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#0c1224'
  ctx.fillRect(ox, oy, a.w * s, a.h * s)
  // a faint floor grid every four squares
  ctx.strokeStyle = 'rgba(80, 120, 200, 0.12)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= a.w; x += 4) {
    ctx.moveTo(ox + x * s, oy)
    ctx.lineTo(ox + x * s, oy + a.h * s)
  }
  for (let y = 0; y <= a.h; y += 4) {
    ctx.moveTo(ox, oy + y * s)
    ctx.lineTo(ox + a.w * s, oy + y * s)
  }
  ctx.stroke()
  for (let i = 0; i < a.cells.length; i++) {
    const c = a.cells[i]
    if (!c) continue
    const x = ox + (i % a.w) * s
    const y = oy + Math.floor(i / a.w) * s
    if (c === 1) {
      ctx.fillStyle = '#3a4566'
      ctx.fillRect(x + 0.5, y + 0.5, s - 1, s - 1)
      continue
    }
    const k = c - 2
    ctx.fillStyle = colours[k]
    ctx.globalAlpha = a.riders[k].alive ? 0.85 : 0.35
    ctx.fillRect(x + s * 0.12, y + s * 0.12, s * 0.76, s * 0.76)
  }
  ctx.globalAlpha = 1
  a.riders.forEach((r, k) => {
    if (!r.alive) return
    if (glow) {
      ctx.shadowColor = colours[k]
      ctx.shadowBlur = s * 1.6
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(ox + r.x * s, oy + r.y * s, s, s)
    ctx.shadowBlur = 0
  })
  for (const p of sparks) {
    ctx.globalAlpha = Math.max(0, p.life)
    ctx.fillStyle = p.colour
    ctx.fillRect(ox + p.x * s, oy + p.y * s, s * 0.4, s * 0.4)
  }
  ctx.globalAlpha = 1
  if (banner) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    const bh = Math.max(44, s * 4)
    ctx.fillRect(0, h / 2 - bh / 2, w, bh)
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${Math.round(Math.max(15, Math.min(26, s * 1.6)))}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(banner, w / 2, h / 2, w - 24)
  }
  return { s, ox, oy }
}

export function TrailsDemo() {
  const [saved, setSaved] = useKept(TRAILS_KEY, readSaved)
  const [phase, setPhase] = useState<Phase>('ready')
  const [wins, setWins] = useState<number[]>(() => Array(saved.rivals + 1).fill(0))
  const [line, setLine] = useState('Tap the arena or press Space to ride.')
  const match = useRef({
    level: saved.level,
    size: saved.size,
    layout: saved.layout,
    rivals: saved.rivals,
    speed: saved.speed,
    round: 1,
  })
  const arena = useRef<Arena>(newArena(saved.size, saved.rivals + 1, saved.layout, 1))
  /** turns you have asked for and the arena has not taken yet, so two quick taps both count */
  const queue = useRef<Dir[]>([])
  const sparks = useRef<Spark[]>([])
  /** the tick you crashed on this round, for "longest ride": the round may go on without you */
  const outAt = useRef<number | null>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const savedRef = useRef(saved)
  savedRef.current = saved
  const winsRef = useRef(wins)
  winsRef.current = wins
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const view = useRef<View | null>(null)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    const hide = () => {
      if (document.hidden && phaseRef.current === 'play') setPhase('paused')
    }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])

  const newRound = (round: number) => {
    const m = match.current
    arena.current = newArena(m.size, m.rivals + 1, m.layout, round * 7 + 1)
    queue.current = []
    sparks.current = []
    outAt.current = null
    m.round = round
  }
  const newMatch = (s: Saved = saved) => {
    window.clearTimeout(timer.current)
    match.current = {
      level: s.level,
      size: s.size,
      layout: s.layout,
      rivals: s.rivals,
      speed: s.speed,
      round: 1,
    }
    newRound(1)
    setWins(Array(s.rivals + 1).fill(0))
    setPhase('ready')
    setLine('Tap the arena or press Space to ride.')
  }
  const go = () => {
    if (phase === 'over') return newMatch()
    if (phase === 'between') {
      newRound(match.current.round + 1)
      setPhase('play')
      setLine(`Round ${match.current.round} — ride!`)
      return
    }
    if (phase === 'play') {
      setPhase('paused')
      setLine('Paused.')
    } else {
      setPhase('play')
      setLine(`Round ${match.current.round} — ride!`)
    }
  }
  const change = (p: Partial<Saved>) => {
    const s = { ...saved, ...p }
    setSaved(s)
    if (phase === 'ready' || phase === 'over') newMatch(s)
  }
  const turn = (d: Dir) => {
    const q = queue.current
    const last = q.length ? q[q.length - 1] : arena.current.riders[0].dir
    if (d !== last && turnable(last, d) && q.length < 3) q.push(d)
  }
  const turnBy = (by: 1 | -1) => {
    const q = queue.current
    const last = q.length ? q[q.length - 1] : arena.current.riders[0].dir
    turn(((((last + by) % 4) + 4) % 4) as Dir)
  }

  const endRound = (a: Arena) => {
    const m = match.current
    const alive = a.riders.map((r, k) => (r.alive ? k : -1)).filter((k) => k >= 0)
    const winner = alive.length === 1 ? alive[0] : null
    const next = winsRef.current.map((w, k) => (k === winner ? w + 1 : w))
    setWins(next)
    setSaved((s) => ({
      ...s,
      record: {
        ...s.record,
        [m.level]: recordRound(s.record[m.level], winner === 0, outAt.current ?? a.ticks),
      },
    }))
    const name = (k: number) => (k === 0 ? 'You' : `Rival ${k}`)
    if (winner !== null && next[winner] >= ROUNDS_TO_WIN) {
      // set now, not on the next render: the frame loop must not end this round twice
      phaseRef.current = 'over'
      setPhase('over')
      setLine(
        winner === 0
          ? `🏆 You win the match, ${next[0]} rounds to ${Math.max(...next.slice(1))}!`
          : `${name(winner)} wins the match. Tap for another.`,
      )
    } else {
      phaseRef.current = 'between'
      setPhase('between')
      setLine(
        `${winner === null ? 'Nobody' : name(winner)} ${winner === 0 ? 'win' : 'wins'} round ${m.round}${winner === null ? ' — everyone crashed at once' : ''}. Tap or press Space for the next.`,
      )
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (KEY_DIRS[k] !== undefined) {
      e.preventDefault()
      e.stopPropagation()
      turn(KEY_DIRS[k])
    } else if (k === ' ' || k === 'Enter') {
      e.preventDefault()
      go()
    } else if (k === 'Escape' && phase === 'play') setPhase('paused')
  }
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    swipe.current = { x: e.clientX, y: e.clientY }
  }
  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const st = swipe.current
    swipe.current = null
    if (!st) return
    const dx = e.clientX - st.x
    const dy = e.clientY - st.y
    if (phaseRef.current !== 'play') {
      if (Math.hypot(dx, dy) < 20) go()
      return
    }
    if (Math.hypot(dx, dy) >= 24)
      turn((Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0) as Dir)
    else {
      // a tap: turn toward the side of the arena it landed on, relative to the way you face
      const r = e.currentTarget.getBoundingClientRect()
      turnBy(e.clientX - r.left < r.width / 2 ? -1 : 1)
    }
  }

  const m = match.current
  const record = saved.record[saved.level]
  const colours = coloursFor(saved.colour, m.rivals + 1)
  const pending =
    phase !== 'ready' &&
    phase !== 'over' &&
    (m.level !== saved.level ||
      m.size !== saved.size ||
      m.layout !== saved.layout ||
      m.rivals !== saved.rivals ||
      m.speed !== saved.speed)

  return (
    <div className="lab-keys tr-room">
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the rivals ride">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => change({ level: l })}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="Rivals">
          {([1, 2, 3] as const).map((n) => (
            <button
              key={n}
              className="btn btn-ghost"
              aria-pressed={saved.rivals === n}
              aria-label={`${n} rival${n > 1 ? 's' : ''}`}
              onClick={() => change({ rivals: n })}
            >
              {n} rival{n > 1 ? 's' : ''}
            </button>
          ))}
        </div>
        <button className="btn" onClick={go}>
          {phase === 'play'
            ? '⏸ Pause'
            : phase === 'over'
              ? '↻ New match'
              : phase === 'between'
                ? '▶ Next round'
                : '▶ Ride'}
        </button>
      </div>

      <div className="tr-scores">
        {wins.map((w, k) => (
          <div key={k} className="dice-score" style={{ borderLeft: `6px solid ${colours[k]}` }}>
            <span>{k === 0 ? 'You' : `Rival ${k}`}</span>
            <strong>
              {w} / {ROUNDS_TO_WIN}
            </strong>
          </div>
        ))}
      </div>

      <div
        className={`tr-wrap${phase === 'play' ? ' is-playing' : ''}`}
        tabIndex={0}
        role="group"
        aria-label="The arena. Arrow keys or WASD steer; Space rides and pauses."
        onKeyDown={onKey}
      >
        <CanvasStage
          className="tr-stage"
          label={`Light trails, round ${m.round}. ${wins.map((w, k) => `${k === 0 ? 'You' : `Rival ${k}`} ${w}`).join(', ')}.`}
          onPointerDown={onDown}
          onPointerUp={onUp}
          make={(ctx, c) => {
            let acc = 0
            let key = ''
            return {
              frame: (dt) => {
                const a = arena.current
                const mt = match.current
                const s = savedRef.current
                const ph = phaseRef.current
                const still = reduced()
                if (ph === 'play' && dt > 0) {
                  // once you are out, the rivals ride the round out at three times the pace
                  acc += a.riders[0].alive ? dt : dt * 3
                  const step = 1 / SPEEDS[mt.speed]
                  let n = 0
                  while (acc >= step && n < 12 && living(a) > 1) {
                    acc -= step
                    n++
                    const dirs: (Dir | null)[] = a.riders.map((r, k) =>
                      !r.alive
                        ? null
                        : k === 0
                          ? (queue.current.shift() ?? null)
                          : steer(a, k, mt.level, Math.random),
                    )
                    const out = tick(a, dirs)
                    if (out.includes(0)) outAt.current = a.ticks
                    if (!still)
                      for (const k of out) {
                        const r = a.riders[k]
                        for (let j = 0; j < 14; j++) {
                          const t = (j / 14) * Math.PI * 2
                          sparks.current.push({
                            x: r.x + 0.5,
                            y: r.y + 0.5,
                            vx: Math.cos(t) * 9,
                            vy: Math.sin(t) * 9,
                            life: 1,
                            colour: coloursFor(s.colour, a.riders.length)[k],
                          })
                        }
                      }
                  }
                  if (living(a) <= 1) {
                    acc = 0
                    endRound(a)
                  }
                }
                for (const p of sparks.current) {
                  p.x += p.vx * dt
                  p.y += p.vy * dt
                  p.life -= dt * 1.6
                }
                sparks.current = sparks.current.filter((p) => p.life > 0)
                const banner =
                  ph === 'ready'
                    ? 'Tap or press Space to ride'
                    : ph === 'paused'
                      ? 'Paused — tap or press Space'
                      : ph === 'between'
                        ? 'Round over — tap for the next'
                        : ph === 'over'
                          ? 'Match over — tap for another'
                          : ''
                const k = `${c.width}x${c.height}|${a.ticks}|${ph}|${s.colour}|${s.glow}|${sparks.current.length}`
                if (k === key) return
                key = k
                view.current = draw(
                  ctx,
                  c.width,
                  c.height,
                  a,
                  coloursFor(s.colour, a.riders.length),
                  s.glow,
                  sparks.current,
                  banner,
                )
              },
            }
          }}
        />
      </div>
      <div className="tr-pad">
        <button className="btn btn-ghost" onClick={() => turnBy(-1)} aria-label="Turn left">
          ⟲ Left
        </button>
        <button className="btn btn-ghost" onClick={() => turnBy(1)} aria-label="Turn right">
          Right ⟳
        </button>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>
      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: rounds won {record.won}, lost {record.lost}
          {record.longest > 0 && <> · longest ride {record.longest} squares</>}
        </span>
      </p>
      {pending && <p className="muted mc-note">Your changes start with the next match.</p>}

      <div className="fw-panel">
        <section aria-label="The arena">
          <h3 className="fw-h">The arena</h3>
          <div className="lab-controls" role="group" aria-label="Arena size">
            {(Object.keys(ARENAS) as ArenaSize[]).map((z) => (
              <button
                key={z}
                className="btn btn-ghost"
                aria-pressed={saved.size === z}
                onClick={() => change({ size: z })}
              >
                {SIZE_NAMES[z]}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Layout">
            {LAYOUTS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.layout === l}
                onClick={() => change({ layout: l })}
              >
                {LAYOUT_NAMES[l]}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Speed">
            {(Object.keys(SPEEDS) as Speed[]).map((sp) => (
              <button
                key={sp}
                className="btn btn-ghost"
                aria-pressed={saved.speed === sp}
                onClick={() => change({ speed: sp })}
              >
                {SPEED_NAMES[sp]}
              </button>
            ))}
          </div>
        </section>
        <section aria-label="Your rider">
          <h3 className="fw-h">Your rider</h3>
          <div className="fw-swatches" role="group" aria-label="Trail colour">
            {COLOURS.map((cl, i) => (
              <button
                key={cl}
                className="fw-swatch"
                style={{ background: cl }}
                aria-label={`${COLOUR_NAMES[i]} trail`}
                aria-pressed={saved.colour === i}
                onClick={() => setSaved((s) => ({ ...s, colour: i }))}
              />
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.glow}
              onClick={() => setSaved((s) => ({ ...s, glow: !s.glow }))}
            >
              Glow
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Every rider moves one square at a time and leaves a wall of light behind. Steer clear of the
        edge, the blocks and every trail, your own included; the last one riding wins the round, and
        three rounds win the match. Easy only dodges what is right in front of it; Fair heads for
        the most open space; Hard also weighs how much of the arena it can reach before you, and
        will cut across your path to take it. Steer with the arrow keys or WASD, swipe on the arena,
        or tap its left or right half (or the buttons) to turn that way.
      </p>
    </div>
  )
}
