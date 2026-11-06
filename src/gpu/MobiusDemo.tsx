import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  ACES,
  BALL_R,
  HOLES,
  HZ,
  MAX_PATH,
  MOBIUS_KEY,
  S,
  SPACES,
  guide,
  launch,
  stepBall,
  type Ball,
  type Shot,
  type SpaceId,
  type V2,
} from './mobius'
import { createMobius, type MobiusView } from './mobiusEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Best = Record<string, { strokes: number; space: SpaceId }>
type Phase = 'aim' | 'rolling' | 'in'

const load = (): { hole: number; best: Best } => {
  try {
    const v = JSON.parse(localStorage.getItem(MOBIUS_KEY) ?? 'null') as {
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

/** how many metres the stage's shorter side shows: the course and a ring of its copies, or more */
const SPAN = { near: S * 1.6, wide: S * 3.4 }

export function MobiusDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(load()).current
  const [live, setLive] = useState(false)
  const [holeIx, setHoleIx] = useState(saved.hole)
  const hole = HOLES[holeIx]
  const [space, setSpace] = useState<SpaceId>(hole.spaces[0])
  const [strokes, setStrokes] = useState(0)
  const [phase, setPhase] = useState<Phase>('aim')
  const [shot, setShot] = useState<Shot>({ angle: 0, power: 0.5 })
  const [aiming, setAiming] = useState(false)
  const [best, setBest] = useState<Best>(saved.best)
  const [wide, setWide] = useState(false)
  const [sound, setSound] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const ball = useRef<Ball>(launch(hole.tee, { angle: 0, power: 0 }))
  const trail = useRef<V2[]>([])
  const spin = useRef(0)
  const shownAce = useRef(false)
  const engine = useRef<MobiusView | null>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const voices = useRef(new Map<string, number>())
  const now = useRef({ hole, space, phase, shot, aiming, wide, sound, strokes, running })
  now.current = { hole, space, phase, shot, aiming, wide, sound, strokes, running }
  /** the GPU's walls or path need writing again */
  const dirty = useRef({ walls: true, path: true })

  useEffect(() => {
    try {
      localStorage.setItem(MOBIUS_KEY, JSON.stringify({ hole: holeIx, best }))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [holeIx, best])

  /* sound stops when the toy goes: every note still ringing is let go and no timer outlives it */
  useEffect(
    () => () => {
      for (const [id, t] of voices.current) {
        window.clearTimeout(t)
        noteOff(id)
      }
      voices.current.clear()
    },
    [],
  )
  const play = (instrument: 'pluck' | 'bell', midi: number, ms: number, delay = 0) => {
    if (!now.current.sound) return
    const id = `mobius-${midi}-${performance.now()}-${delay}`
    voices.current.set(
      id,
      window.setTimeout(() => {
        noteOn(id, instrument, midi)
        voices.current.set(
          id,
          window.setTimeout(() => {
            noteOff(id)
            voices.current.delete(id)
          }, ms),
        )
      }, delay),
    )
  }

  /** the hole from the tee, in a space */
  const start = (ix: number, sp: SpaceId) => {
    const h = HOLES[ix]
    ball.current = launch(h.tee, { angle: 0, power: 0 })
    trail.current = []
    spin.current = 0
    shownAce.current = false
    dirty.current = { walls: true, path: true }
    setHoleIx(ix)
    setSpace(sp)
    setStrokes(0)
    setPhase('aim')
    setNote(null)
  }

  const hit = (s: Shot) => {
    const { phase: ph } = now.current
    if (ph !== 'aim' || s.power < 0.03) return
    const b = ball.current
    const v = launch([b.x, b.y], s)
    b.vx = v.vx
    b.vy = v.vy
    trail.current = [[b.x, b.y]]
    dirty.current.path = true
    setStrokes((n) => n + 1)
    setPhase('rolling')
    setAiming(false)
    setNote(null)
    play('pluck', 60 + Math.round(s.power * 12), 200)
    if (!now.current.running) setRunning(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const turn = (e.shiftKey ? 10 : 1) * (Math.PI / 180)
    if (k === 'arrowleft') setShot((s) => ({ ...s, angle: s.angle + turn }))
    else if (k === 'arrowright') setShot((s) => ({ ...s, angle: s.angle - turn }))
    else if (k === 'arrowup') setShot((s) => ({ ...s, power: Math.min(1, s.power + 0.02) }))
    else if (k === 'arrowdown') setShot((s) => ({ ...s, power: Math.max(0.02, s.power - 0.02) }))
    else if (k === ' ' || k === 'enter') hit(shot)
    else if (k === 'r') start(holeIx, space)
    else if (k === 'w') setWide((v) => !v)
    else if (/^[1-5]$/.test(k) && hole.spaces[+k - 1]) start(holeIx, hole.spaces[+k - 1])
    else return
    if (k.startsWith('arrow')) setAiming(true)
    e.preventDefault()
  }

  const kept = best[hole.name]
  const status =
    phase === 'in'
      ? strokes === 1
        ? `⛳ An ace! In one, in the ${SPACES[space].name.toLowerCase()}.`
        : `⛳ In ${strokes} (par ${hole.par}).`
      : `Hole ${holeIx + 1} of ${HOLES.length} · par ${hole.par} · stroke ${strokes + (phase === 'aim' ? 1 : 0)}`

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Möbius golf">
      <LabStage
        label="A golf green whose edges are glued together, drawn with copies of itself all round, so a ball rolling out of one edge rolls on into the next copy"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createMobius(device, context, format, canvas)
          engine.current = v
          dirty.current = { walls: true, path: true }
          let acc = 0
          let t = 0
          let lastGuide = ''
          return {
            frame: (dt: number) => {
              const n = now.current
              const sp = SPACES[n.space]
              const b = ball.current
              t += dt
              if (dirty.current.walls) {
                dirty.current.walls = false
                v.walls(n.hole.walls)
              }
              if (n.phase === 'rolling' && dt > 0) {
                acc = Math.min(acc + dt, 0.1)
                let end: 'in' | 'stopped' | null = null
                while (acc >= 1 / HZ && !end) {
                  acc -= 1 / HZ
                  const px = b.x
                  const py = b.y
                  end = stepBall(b, n.hole, sp)
                  const d = Math.hypot(b.x - px, b.y - py)
                  if (d < S / 2) spin.current += d / BALL_R
                  const last = trail.current[trail.current.length - 1]
                  if (!last || Math.hypot(b.x - last[0], b.y - last[1]) > 0.15) {
                    trail.current.push([b.x, b.y])
                    if (trail.current.length > MAX_PATH) trail.current.shift()
                    dirty.current.path = true
                  }
                }
                if (end === 'in') {
                  setPhase('in')
                  ;[0, 4, 7, 12].forEach((k, i) => play('bell', 72 + k, 400, i * 110))
                  const strokesNow = n.strokes
                  if (!shownAce.current)
                    setBest((bb) => {
                      const was = bb[n.hole.name]
                      if (was && was.strokes <= strokesNow) return bb
                      return { ...bb, [n.hole.name]: { strokes: strokesNow, space: n.space } }
                    })
                } else if (end === 'stopped') setPhase('aim')
              } else acc = 0
              // while aiming, the first few metres of the shot as a dotted guide
              const aimingNow = n.phase === 'aim' && n.aiming
              if (aimingNow) {
                const key = `${n.shot.angle.toFixed(4)}:${n.shot.power.toFixed(3)}:${b.x}:${b.y}:${n.space}`
                if (key !== lastGuide) {
                  lastGuide = key
                  v.path(guide(n.hole, sp, [b.x, b.y], n.shot))
                }
              } else if (dirty.current.path || lastGuide) {
                lastGuide = ''
                dirty.current.path = false
                v.path(trail.current)
              }
              v.frame({
                space: sp,
                ball: b,
                spin: spin.current,
                cup: n.hole.cup,
                aim: aimingNow
                  ? [Math.cos(n.shot.angle) * n.shot.power, Math.sin(n.shot.angle) * n.shot.power]
                  : [0, 0],
                view: [S / 2, S / 2],
                span: n.wide ? SPAN.wide : SPAN.near,
                time: t,
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          if (phase !== 'aim') return
          drag.current = { x: e.clientX, y: e.clientY, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          // pull back to aim: the shot goes the other way from the drag, as hard as it is long
          const r = e.currentTarget.getBoundingClientRect()
          const dx = e.clientX - d.x
          const dy = e.clientY - d.y
          const len = Math.hypot(dx, dy)
          if (len < 6) return
          d.moved = true
          setShot({
            angle: Math.atan2(dy, -dx),
            power: Math.min(1, len / (0.32 * Math.min(r.width, r.height))),
          })
          setAiming(true)
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          /* a tap that never pulled back is not a shot */
          if (d?.moved) hit(now.current.shot)
        }}
      />

      {live && (
        <div className="lab-controls">
          <span className="lab-score" aria-live="polite">
            {status}
          </span>
          {phase === 'in' && holeIx < HOLES.length - 1 && (
            <button className="btn" onClick={() => start(holeIx + 1, HOLES[holeIx + 1].spaces[0])}>
              ⏭ Next hole
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => start(holeIx, space)}>
            ⏮ From the tee
          </button>
          <label className="studio-pick">
            <span className="muted">Hole</span>
            <select
              value={holeIx}
              onChange={(e) =>
                start(Number(e.target.value), HOLES[Number(e.target.value)].spaces[0])
              }
            >
              {HOLES.map((h, k) => (
                <option key={h.name} value={k}>
                  {k + 1}. {h.name}
                  {best[h.name] ? ` ✓ ${best[h.name].strokes}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="The space this hole is played in">
            {hole.spaces.map((id) => (
              <button
                key={id}
                className="btn btn-ghost"
                aria-pressed={space === id}
                onClick={() => start(holeIx, id)}
              >
                {SPACES[id].name}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" aria-pressed={wide} onClick={() => setWide((v) => !v)}>
            🔭 Wider
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              const a = ACES[holeIx]
              start(holeIx, a.space)
              shownAce.current = true
              setShot(a.shot)
              setAiming(true)
              setNote(
                'There is the ace, aimed: press ⛳ Shoot or Space. (A hole played this way is not kept as a best.)',
              )
            }}
          >
            💡 Show the ace
          </button>
          {phase === 'aim' && aiming && (
            <button className="btn" onClick={() => hit(shot)}>
              ⛳ Shoot ({Math.round(shot.power * 100)}%)
            </button>
          )}
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((v) => !v)}
          >
            {sound ? '🔔 Sound' : '🔕 Muted'}
          </button>
        </div>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <strong>{note} </strong>}
          {kept && (
            <>
              Your best here: {kept.strokes} in the {SPACES[kept.space].name.toLowerCase()}.{' '}
            </>
          )}
          {hole.hint} Pull back anywhere and let go to shoot (or ←/→ aim, ↑/↓ strength, Space
          shoots). Choosing a space starts the hole again in it; the copies round the course show
          where each edge leads. R from the tee, W wider, 1–{hole.spaces.length} the spaces.
        </p>
      )}
    </div>
  )
}
