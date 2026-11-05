import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { PRESETS, TOOLS, gravityFromTilt, preset, type Dab, type Preset, type Tool } from './sand'
import { createSand, type SandBox } from './sandEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** a cell is this many CSS pixels: big enough to see a grain, small enough for a good pile */
const CELL = 3
/** steps a frame: water levels in seconds rather than minutes, sand still falls like sand */
const STEPS = 6
const ARROWS = ['↓', '←', '↑', '→']

/** iOS asks before it hands over the phone's tilt; everything else just answers */
type AskingOrientation = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

/** A box of sand and water: pour it, wall it, and turn the box over. */
export function SandDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [tool, setTool] = useState<Tool>('sand')
  const [room, setRoom] = useState<Preset>('hourglass')
  const [gravity, setGravity] = useState(0)
  const [tilt, setTilt] = useState<'off' | 'on' | 'refused' | 'silent'>('off')
  const now = useRef({ tool, gravity })
  now.current = { tool, gravity }
  const runningRef = useRef(running)
  runningRef.current = running

  const boxRef = useRef<SandBox | null>(null)
  const grid = useRef<[number, number]>([2, 2])
  const fingers = useRef(new Map<number, readonly [number, number]>())
  const clock = useRef(0)
  const redraw = useRef<() => void>(() => {})

  const load = (id: Preset) => {
    setRoom(id)
    const [w, h] = grid.current
    boxRef.current?.load(preset(id, w, h, Math.floor(Math.random() * 1e6)), w, h)
    redraw.current()
  }
  /* down is 0, left 1, up 2, right 3 — a quarter clockwise apiece, as a clock's hand goes from
     6 to 9: turning the box ANTIclockwise swings "down" from 6 o'clock to 3, which is -1 */
  const turn = (by: number) => setGravity((g) => (g + by + 4) % 4)

  /* tilt: gravity follows the phone, whichever way it is held */
  useEffect(() => {
    if (tilt !== 'on') return
    let heard = false
    const on = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return
      heard = true
      const g = gravityFromTilt(e.beta, e.gamma, screen.orientation?.angle ?? 0)
      if (g >= 0) setGravity(g)
    }
    window.addEventListener('deviceorientation', on)
    const quiet = window.setTimeout(() => heard || setTilt('silent'), 2000)
    return () => {
      window.clearTimeout(quiet)
      window.removeEventListener('deviceorientation', on)
    }
  }, [tilt])
  const toggleTilt = async () => {
    if (tilt === 'on' || tilt === 'silent') return setTilt('off')
    /* called on the class, never lifted off it — and only a 'denied' is a no: the Tunnel learned
       both (batch 3) */
    const DOE = DeviceOrientationEvent as AskingOrientation
    try {
      setTilt(
        DOE.requestPermission && (await DOE.requestPermission()) === 'denied' ? 'refused' : 'on',
      )
    } catch {
      setTilt('refused')
    }
    if (!running) setRunning(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const dirs: Record<string, number> = { arrowdown: 0, arrowleft: 1, arrowup: 2, arrowright: 3 }
    if (k in dirs) setGravity(dirs[k])
    else if (k === ' ') setRunning((r) => !r)
    else if (k === 's') setTool('sand')
    else if (k === 'w') setTool('water')
    else if (k === 'b') setTool('wall')
    else if (k === 'e') setTool('erase')
    else if (/^[1-3]$/.test(k)) load((Object.keys(PRESETS) as Preset[])[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toCell = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const [w, h] = grid.current
    return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h] as const
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Sand">
      <LabStage
        label="A box of falling sand and flowing water that can be poured, walled and turned over"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const box = await createSand(device, context, format)
          boxRef.current = box
          const fit = () => {
            const css = canvas.clientWidth || canvas.width
            const cssH = canvas.clientHeight || canvas.height
            /* even sizes: a Margolus grid is cut into 2×2 blocks */
            const w = Math.max(16, Math.floor(css / CELL / 2) * 2)
            const h = Math.max(16, Math.floor(cssH / CELL / 2) * 2)
            grid.current = [w, h]
            box.load(preset(room, w, h, 1), w, h)
          }
          fit()
          const draw = (steps: number) => {
            const tool = now.current.tool
            /* each finger pours, a little wider for water and walls than for sand */
            const r = tool === 'sand' ? 2.5 : 3.5
            const dabs: Dab[] = [...fingers.current.values()].map(([x, y]) => ({ x, y, r, tool }))
            box.frame({ dabs, steps, gravity: now.current.gravity, time: clock.current })
          }
          redraw.current = () => {
            if (!runningRef.current) draw(0)
          }
          return {
            frame: (dt) => {
              clock.current += dt
              draw(dt > 0 ? STEPS : 0)
            },
            resize: fit,
            destroy: () => {
              box.destroy()
              boxRef.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          fingers.current.set(e.pointerId, toCell(e))
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          if (fingers.current.has(e.pointerId)) fingers.current.set(e.pointerId, toCell(e))
        }}
        onPointerUp={(e) => {
          fingers.current.delete(e.pointerId)
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => turn(-1)}
            aria-label="Turn the box anticlockwise"
          >
            ⟲
          </button>
          <span className="lab-score" aria-label="Which way is down">
            {ARROWS[gravity]}
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => turn(1)}
            aria-label="Turn the box clockwise"
          >
            ⟳
          </button>
          {touchOnly() && 'DeviceOrientationEvent' in window && (
            <button className="btn btn-ghost" aria-pressed={tilt === 'on'} onClick={toggleTilt}>
              📱 Tilt
            </button>
          )}
          <div className="lab-group" role="group" aria-label="Pour">
            {(Object.keys(TOOLS) as Tool[]).map((t) => (
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
          <div className="lab-group" role="group" aria-label="Box">
            {(Object.keys(PRESETS) as Preset[]).map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={room === p}
                onClick={() => load(p)}
              >
                {PRESETS[p]}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          {tilt === 'refused'
            ? 'The phone would not share its tilt — turn the box with ⟲ and ⟳ instead. '
            : tilt === 'silent'
              ? 'No tilt is arriving from this device — turn the box with ⟲ and ⟳ instead. '
              : tilt === 'on'
                ? 'Tilt the phone and the sand goes where down is. '
                : 'Hold a finger down to pour; turn the box with ⟲ and ⟳ and everything falls the new way. '}
          Every grain is kept: the box is cut into 2×2 blocks that each only shuffle their own four
          cells, so on the GPU nothing can be lost or made twice.
          {!touchOnly() &&
            ' Keys: arrows set which way is down, S sand, W water, B wall, E erase, 1–3 boxes, Space pauses.'}
        </p>
      )}
    </div>
  )
}
