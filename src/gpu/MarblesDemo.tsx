import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { G, KIND, MAX_MARBLES, TOOLS, boardFor, mazeFor, startOf, type Tool } from './marbles'
import { createMarbles, type Dab, type MarblesView } from './marblesEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type V2 = [number, number]
const TOOL_IDS = Object.keys(TOOLS) as Tool[]
const BRUSH: Record<Tool, number> = { tilt: 0, wall: 2.6, hole: 4, erase: 3.5, pour: 0 }
/** marbles poured a frame while a finger holds Pour: a stream, not a heap */
const POUR_RATE = 3

/** the orientation API, with the permission request iOS (and now Chromium) has */
type Orientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }
const canTilt = () => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window

/**
 * A wooden maze full of marbles. Tilt it and they roll; draw walls, dig holes, pour more; see how
 * many you can sink.
 */
export function MarblesDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [tool, setTool] = useState<Tool>('tilt')
  const [tilting, setTilting] = useState(false)
  const [tiltRefused, setTiltRefused] = useState(false)
  const [score, setScore] = useState({ fell: 0, count: 0 })
  const now = useRef({ tool })
  now.current = { tool }

  const engine = useRef<MarblesView | null>(null)
  const board = useRef<V2>([240, 150])
  /** the board's tilt, as gravity in cells a second² */
  const gravity = useRef<V2>([0, 0])
  const finger = useRef<{ at: V2; from: V2; g0: V2 } | null>(null)
  const dabs = useRef<Dab[]>([])
  const seed = useRef(7)
  const redraw = useRef<() => void>(() => {})

  const newMaze = (next = seed.current + 1) => {
    seed.current = next
    const v = engine.current
    if (!v) return
    const [w, h] = board.current
    v.load([w, h], mazeFor(w, h, next))
    const [sx, sy] = startOf(w, h)
    /* a tray of marbles in the first room, set out in rows so none starts inside another */
    v.pour(
      Array.from(
        { length: 49 },
        (_, i): V2 => [sx - 6 + (i % 7) * 2, sy - 6 + Math.floor(i / 7) * 2],
      ),
    )
    gravity.current = [0, 0]
    setScore({ fell: 0, count: 49 })
    redraw.current()
  }

  /* tilting the phone: forward and back, side to side, from however it was held at the start */
  useEffect(() => {
    if (!tilting) return
    let base: { beta: number; gamma: number } | null = null
    const on = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return
      base ??= { beta: e.beta, gamma: e.gamma }
      const tx = Math.sin(((e.gamma - base.gamma) * Math.PI) / 180)
      const ty = Math.sin(((e.beta - base.beta) * Math.PI) / 180)
      gravity.current = [tx * G * 1.6, ty * G * 1.6]
    }
    window.addEventListener('deviceorientation', on)
    return () => window.removeEventListener('deviceorientation', on)
  }, [tilting])

  const toggleTilt = async () => {
    if (tilting) return setTilting(false)
    const O = DeviceOrientationEvent as Orientation
    const answer = O.requestPermission
      ? await O.requestPermission().catch(() => 'denied')
      : 'granted'
    setTiltRefused(answer !== 'granted')
    if (answer === 'granted') {
      setTilting(true)
      if (!running) setRunning(true)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const arrows: Record<string, V2> = {
      arrowleft: [-1, 0],
      arrowright: [1, 0],
      arrowup: [0, -1],
      arrowdown: [0, 1],
    }
    if (k in arrows) {
      const [dx, dy] = arrows[k]
      const g = gravity.current
      gravity.current = [
        Math.max(-G, Math.min(G, g[0] + dx * G * 0.25)),
        Math.max(-G, Math.min(G, g[1] + dy * G * 0.25)),
      ]
      if (!running) setRunning(true)
    } else if (k === 'l') gravity.current = [0, 0]
    else if (k === 'n') newMaze()
    else if (/^[1-5]$/.test(k)) setTool(TOOL_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toCell = (e: PointerEvent<HTMLCanvasElement>): V2 => {
    const r = e.currentTarget.getBoundingClientRect()
    return [
      ((e.clientX - r.left) / r.width) * board.current[0],
      ((e.clientY - r.top) / r.height) * board.current[1],
    ]
  }
  const brushAt = (at: V2) => {
    const t = now.current.tool
    const kind = t === 'wall' ? KIND.wall : t === 'hole' ? KIND.hole : KIND.open
    dabs.current.push({ x: at[0], y: at[1], kind })
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Marble maze">
      <LabStage
        label="A wooden maze full of coloured marbles rolling as the board tilts"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const v = await createMarbles(device, context, format)
          engine.current = v
          board.current = boardFor(
            canvas.clientWidth || canvas.width,
            canvas.clientHeight || canvas.height,
          )
          newMaze(seed.current)
          let sinceScore = 0
          let alive = true
          let lastFell = 0
          let notes = 0
          const draw = (dt: number) => {
            const f = finger.current
            if (f && now.current.tool === 'pour' && dt > 0) {
              /* a little ring round the finger, turning, so the stream does not land on itself */
              const t = performance.now() / 120
              v.pour(
                Array.from({ length: POUR_RATE }, (_, k): V2 => {
                  const a = t + (k * Math.PI * 2) / POUR_RATE
                  return [f.at[0] + Math.cos(a) * 2.4, f.at[1] + Math.sin(a) * 2.4]
                }),
              )
            }
            const r = BRUSH[now.current.tool]
            v.frame({
              w: canvas.width,
              h: canvas.height,
              gravity: gravity.current,
              dabs: dabs.current,
              radius: r,
              dt: Math.min(dt, 1 / 30),
            })
            dabs.current = dabs.current.slice(64)
            sinceScore += dt
            if (sinceScore > 0.25) {
              sinceScore = 0
              void v.score().then((s) => {
                if (!alive || !s) return
                setScore(s)
                /* a plink for every marble that has dropped in since last time, a few at most */
                for (let k = 0; k < Math.min(3, s.fell - lastFell); k++) {
                  const id = `marble-${notes++}`
                  noteOn(id, 'marimba', 72 + ((notes * 5) % 12))
                  window.setTimeout(() => noteOff(id), 200)
                }
                lastFell = s.fell
              })
            }
          }
          redraw.current = () => draw(0)
          return {
            frame: draw,
            resize: () => {
              board.current = boardFor(
                canvas.clientWidth || canvas.width,
                canvas.clientHeight || canvas.height,
              )
              newMaze(seed.current)
            },
            destroy: () => {
              alive = false
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const at = toCell(e)
          finger.current = { at, from: at, g0: gravity.current }
          if (now.current.tool !== 'tilt' && now.current.tool !== 'pour') brushAt(at)
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const f = finger.current
          if (!f) return
          const at = toCell(e)
          if (now.current.tool === 'tilt') {
            /* dragging tilts the board the way you drag: a fifth of the board's width is full tilt */
            const k = (G * 5) / board.current[0]
            gravity.current = [
              Math.max(-G, Math.min(G, f.g0[0] + (at[0] - f.from[0]) * k)),
              Math.max(-G, Math.min(G, f.g0[1] + (at[1] - f.from[1]) * k)),
            ]
          } else if (now.current.tool !== 'pour') {
            const steps = Math.max(1, Math.ceil(Math.hypot(at[0] - f.at[0], at[1] - f.at[1])))
            for (let s = 1; s <= steps; s++)
              brushAt([
                f.at[0] + ((at[0] - f.at[0]) * s) / steps,
                f.at[1] + ((at[1] - f.at[1]) * s) / steps,
              ])
          }
          f.at = at
        }}
        onPointerUp={() => {
          finger.current = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="What a finger does">
            {TOOL_IDS.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={tool === t}
                onClick={() => setTool(t)}
              >
                {TOOLS[t]}
              </button>
            ))}
          </div>
          {touchOnly() && canTilt() && (
            <button
              className="btn btn-ghost"
              aria-pressed={tilting}
              onClick={() => void toggleTilt()}
            >
              📱 Tilt
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => (gravity.current = [0, 0])}>
            ⚖️ Level
          </button>
          <button className="btn btn-ghost" onClick={() => newMaze()}>
            ↺ New maze
          </button>
          <span className="muted" aria-live="off">
            In the holes: {score.fell} of {score.count}
            {score.count >= MAX_MARBLES ? ' (the box is full)' : ''}
          </span>
          {tiltRefused && (
            <span className="muted">Tilt isn’t allowed here — drag with 🖐 Tilt instead.</span>
          )}
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Tilt the board and the marbles roll — drag with 🖐 Tilt
          {touchOnly() && canTilt() ? ', or turn on 📱 Tilt and tip the phone' : ''}, and the board
          stays where you leave it until ⚖️ Level. Draw walls, dig holes, rub either out, and pour
          in more marbles from a finger. Every marble is pushed out of the walls and out of its
          neighbours, thousands at once: the GPU sorts them into cells every step so each only has
          to look at the few beside it.
          {!touchOnly() && ' Keys, once it has focus: arrows tilt, L level, N new maze, 1–5 tool.'}
        </p>
      )}
    </div>
  )
}
