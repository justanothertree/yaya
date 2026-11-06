import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  FOOD,
  HABITS,
  HABIT_IDS,
  LAYOUTS,
  NOTHING,
  PALETTES,
  PALETTE_IDS,
  SPORES,
  WALL,
  foodFor,
  seedAgents,
  type Dab,
  type Habit,
  type Layout,
  type SlimePalette,
} from './slime'
import { createSlime, type SlimeView } from './slimeEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const TOOLS = {
  food: ['🍯 Food', FOOD],
  wall: ['🧱 Wall', WALL],
  erase: ['Erase', NOTHING],
  spores: ['✨ Spores', SPORES],
} as const
type Tool = keyof typeof TOOLS
/** a cell of the trail is this many CSS pixels */
const CELL = 2
/** agents per cell: sparser than the scent they leave, or the network clots into one blob */
const DENSITY = 0.3
const STEPS = 2

/** A slime mould: lay food and it grows a network between it, routing round the walls you draw. */
export function SlimeDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [tool, setTool] = useState<Tool>('food')
  const [layout, setLayout] = useState<Layout>('cities')
  const [habit, setHabit] = useState<Habit>('web')
  const [palette, setPalette] = useState<SlimePalette>('gold')
  const now = useRef({ tool, habit, palette, layout })
  now.current = { tool, habit, palette, layout }
  const runningRef = useRef(running)
  runningRef.current = running

  const viewRef = useRef<SlimeView | null>(null)
  const grid = useRef<[number, number]>([2, 2])
  const fingers = useRef(new Map<number, readonly [number, number]>())
  const clock = useRef(0)
  const redraw = useRef<() => void>(() => {})

  const start = (id: Layout) => {
    setLayout(id)
    const v = viewRef.current
    if (!v) return
    const [w, h] = grid.current
    v.load(seedAgents(Math.round(w * h * DENSITY), w, h, Math.random), foodFor(id, w, h), w, h)
    redraw.current()
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'f') setTool('food')
    else if (k === 'w') setTool('wall')
    else if (k === 'e') setTool('erase')
    else if (k === 's') setTool('spores')
    else if (k === 'h') setHabit((h) => HABIT_IDS[(HABIT_IDS.indexOf(h) + 1) % HABIT_IDS.length])
    else if (/^[1-3]$/.test(k)) start((Object.keys(LAYOUTS) as Layout[])[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toCell = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const [w, h] = grid.current
    return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h] as const
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Slime">
      <LabStage
        label="A slime mould growing glowing networks between pieces of food"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const v = await createSlime(device, context, format)
          viewRef.current = v
          const fit = () => {
            const w = Math.max(32, Math.round((canvas.clientWidth || canvas.width) / CELL))
            const h = Math.max(32, Math.round((canvas.clientHeight || canvas.height) / CELL))
            grid.current = [w, h]
            v.load(
              seedAgents(Math.round(w * h * DENSITY), w, h, Math.random),
              foodFor(now.current.layout, w, h),
              w,
              h,
            )
          }
          fit()
          const draw = (steps: number) => {
            const n = now.current
            const kind = TOOLS[n.tool][1]
            const r = n.tool === 'spores' ? 6 : n.tool === 'food' ? 5 : 3
            const dabs: Dab[] = [...fingers.current.values()].map(([x, y]) => ({ x, y, r, kind }))
            v.frame({ dabs, steps, habit: n.habit, palette: n.palette, time: clock.current })
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
              v.destroy()
              viewRef.current = null
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
          <div className="lab-group" role="group" aria-label="Tool">
            {(Object.keys(TOOLS) as Tool[]).map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={tool === t}
                onClick={() => setTool(t)}
              >
                {TOOLS[t][0]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Start from">
            {(Object.keys(LAYOUTS) as Layout[]).map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={layout === l}
                onClick={() => start(l)}
              >
                {LAYOUTS[l]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Habit">
            {HABIT_IDS.map((h) => (
              <button
                key={h}
                className="btn btn-ghost"
                aria-pressed={habit === h}
                onClick={() => setHabit(h)}
              >
                {HABITS[h].name}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Colour">
            {PALETTE_IDS.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={palette === p}
                onClick={() => {
                  setPalette(p)
                  redraw.current()
                }}
              >
                {PALETTES[p]}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Lay food and the mould finds it, joining it up with the shortest ways it can; draw walls
          and it routes round them; blow spores to start it somewhere new. Nobody draws the network:
          tens of thousands of agents each smell ahead, turn towards the strongest scent, and leave
          a little of their own.
          {!touchOnly() &&
            ' Keys: F food, W wall, E erase, S spores, H habit, 1–3 start again, Space pauses.'}
        </p>
      )}
    </div>
  )
}
