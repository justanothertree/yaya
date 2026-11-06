import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  FILL,
  LEVELS,
  NX,
  NY,
  SOLVED_KEY,
  TOOL_CODE,
  levelById,
  paint,
  plateField,
  pour,
  readSolved,
  rockMask,
  startingIce,
  type Level,
  type Tool,
  type V2,
} from './waterworks'
import { createWaterworks, type WaterworksView } from './waterworksEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const TOOLS: Record<Tool, string> = {
  wall: '✏️ Wall',
  erase: '🧽 Erase',
  heat: '🔥 Heat',
  cool: '❄️ Cool',
}
/** a wall stroke's half-width, and a lamp's reach, in cells */
const PEN = 1.6
const LAMP = 11
/** substeps of the fluid a frame */
const STEPS = 2

const loadSolved = () => {
  try {
    return readSolved(localStorage.getItem(SOLVED_KEY))
  } catch {
    return []
  }
}

/**
 * A water puzzle: get the water into the cup. Draw walls to route it, freeze it into ice that holds
 * still, boil it into steam that rises over what water cannot — a level at a time.
 */
export function WaterworksDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [levelId, setLevelId] = useState(LEVELS[0].id)
  const [tool, setTool] = useState<Tool>(LEVELS[0].tools[0])
  const [inkLeft, setInkLeft] = useState(LEVELS[0].ink)
  const [cup, setCup] = useState(0)
  const [solved, setSolved] = useState(loadSolved)
  const level = levelById(levelId)
  const now = useRef({ tool, running, level })
  now.current = { tool, running, level }

  const engine = useRef<WaterworksView | null>(null)
  const mask = useRef<Uint8Array>(rockMask(LEVELS[0]))
  const poured = useRef(0)
  const slots = useRef(0)
  const ink = useRef(LEVELS[0].ink)
  const finger = useRef<{ at: V2; down: boolean } | null>(null)
  const redraw = useRef<() => void>(() => {})
  const done = useRef(false)
  /** bumped on every restart, so a count read back from the tank before it cannot win the new one */
  const generation = useRef(0)

  const start = (l: Level) => {
    mask.current = rockMask(l)
    const ice = startingIce(l)
    engine.current?.load(mask.current, plateField(l), ice)
    slots.current = ice.length / 8
    poured.current = 0
    ink.current = l.ink
    done.current = false
    generation.current++
    setInkLeft(l.ink)
    setCup(0)
    redraw.current()
  }
  const choose = (id: string) => {
    const l = levelById(id)
    setLevelId(l.id)
    setTool(l.tools[0])
    now.current.level = l
    start(l)
    if (!now.current.running) setRunning(true)
  }
  const win = (id: string) => {
    setSolved((s) => {
      if (s.includes(id)) return s
      const next = [...s, id]
      try {
        localStorage.setItem(SOLVED_KEY, JSON.stringify(next))
      } catch {
        /* private mode: solved for this visit */
      }
      return next
    })
  }

  /** a pointer on the tank, in cells, as the shader fits it to the canvas */
  const toCells = (e: PointerEvent<HTMLCanvasElement>): V2 => {
    const r = e.currentTarget.getBoundingClientRect()
    const s = Math.min(r.width / NX, r.height / NY)
    const ox = (r.width - NX * s) / 2
    const oy = (r.height - NY * s) / 2
    return [(e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s]
  }
  const stroke = (a: V2, b: V2) => {
    const t = now.current.tool
    if (t !== 'wall' && t !== 'erase') return
    const used = paint(mask.current, a, b, PEN, t === 'erase', ink.current)
    if (used === 0) return
    ink.current -= used
    setInkLeft(ink.current)
    engine.current?.mask(mask.current)
    redraw.current()
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const tools = now.current.level.tools
    if (/^[1-4]$/.test(k) && tools[Number(k) - 1]) setTool(tools[Number(k) - 1])
    else if (k === 'r') start(now.current.level)
    else if (k === 'n') choose(LEVELS[(LEVELS.indexOf(now.current.level) + 1) % LEVELS.length].id)
    else if (k === ' ') setRunning((r) => !r)
    else return
    e.preventDefault()
  }

  const full = cup >= FILL
  const at = LEVELS.indexOf(level)
  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Waterworks">
      <LabStage
        label="A tank of water with rock, a tap and a cup, where water can be routed, frozen and boiled"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const v = await createWaterworks(device, context, format, canvas)
          engine.current = v
          start(now.current.level)
          let t = 0
          let frames = 0
          const draw = (dt: number) => {
            const l = now.current.level
            const moving = dt > 0
            if (moving && poured.current < l.source.drops) {
              const n = Math.min(l.source.perFrame, l.source.drops - poured.current)
              v.add(slots.current, pour(l, poured.current, n))
              poured.current += n
              slots.current += n
            }
            t += dt
            const f = finger.current
            const t2 = now.current.tool
            const heatTool = f?.down && (t2 === 'heat' || t2 === 'cool')
            v.frame(
              {
                count: slots.current,
                tool: heatTool ? (t2 === 'heat' ? TOOL_CODE.heat : TOOL_CODE.cool) : TOOL_CODE.none,
                toolAt: f?.at ?? [0, 0],
                toolR: LAMP,
                cup: l.cup,
                time: t,
              },
              moving ? STEPS : 0,
            )
            /* the cup is counted on the GPU every frame and read back a few times a second */
            if (++frames % 12 === 0) {
              const asked = generation.current
              void v.cup().then((n) => {
                if (n === null || engine.current !== v || generation.current !== asked) return
                setCup(n)
                if (n >= FILL && !done.current) {
                  done.current = true
                  win(l.id)
                }
              })
            }
          }
          redraw.current = () => {
            if (!now.current.running) draw(0)
          }
          return {
            frame: draw,
            resize: () => v.resize(),
            destroy: () => {
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const at = toCells(e)
          finger.current = { at, down: true }
          stroke(at, at)
        }}
        onPointerMove={(e) => {
          const at = toCells(e)
          const f = finger.current
          if (f?.down) stroke(f.at, at)
          finger.current = { at, down: !!f?.down }
        }}
        onPointerUp={() => {
          finger.current = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <div className="lab-group" role="group" aria-label="Level">
            {LEVELS.map((l, i) => (
              <button
                key={l.id}
                className="btn btn-ghost"
                aria-pressed={levelId === l.id}
                onClick={() => choose(l.id)}
              >
                {i + 1}. {l.name}
                {solved.includes(l.id) ? ' ✓' : ''}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="What a finger does">
            {level.tools.map((t) => (
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
          <button className="btn btn-ghost" onClick={() => start(level)}>
            ↺ Restart
          </button>
          <span className="lab-score" aria-live="polite">
            💧 {Math.min(cup, FILL)}/{FILL}
            {level.ink > 0 ? ` · ink ${inkLeft}` : ''}
          </span>
        </div>
      )}

      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {full ? (
            <>
              <strong>The cup is full!</strong>{' '}
              {at + 1 < LEVELS.length ? (
                <button className="btn btn-ghost" onClick={() => choose(LEVELS[at + 1].id)}>
                  Next: {LEVELS[at + 1].name} →
                </button>
              ) : (
                'That was the last one — the Sandbox is yours.'
              )}{' '}
            </>
          ) : (
            <>
              <strong>{level.name}.</strong> {level.hint}{' '}
            </>
          )}
          Fill the cup to the red line with water — ice in it does not count until it melts, and
          steam is only passing through. ✏️ Wall draws (while the ink lasts), 🧽 Erase takes your
          walls back, 🔥 Heat and ❄️ Cool work where your finger is held. The water is a FLIP fluid
          on the GPU: thousands of drops, a pressure solve a step, and each drop's own temperature.
          {!touchOnly() &&
            ' Keys, once it has focus: 1–4 tool, R restart, N next level, Space pause.'}
        </p>
      )}
    </div>
  )
}
