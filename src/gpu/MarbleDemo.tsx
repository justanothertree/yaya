import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { toCentred } from './kaleido'
import { LabStage } from './LabStage'
import {
  COMB_SHARP,
  COMB_SPACING,
  INKS,
  STYLUS_SHARP,
  recipe,
  type InkSet,
  type MarbleOp,
} from './marble'
import { createMarbling, type Marbling } from './marbleEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const TOOLS = { drop: 'Drop', stylus: 'Stylus', comb: 'Comb' } as const
type Tool = keyof typeof TOOLS
type Pt = readonly [number, number]

/** a drop's first size, and how much more ink a held finger adds each frame */
const DROP = 0.035
const GROW = 0.012

/** Ink floated on water: drop it, then pull it into patterns with a stylus or a comb. */
export function MarbleDemo({ running, setRunning, onAdapter }: Props) {
  const mbRef = useRef<Marbling | null>(null)
  const [live, setLive] = useState(false)
  const [tool, setTool] = useState<Tool>('drop')
  const [inks, setInks] = useState<InkSet>('ebru')
  const toolRef = useRef(tool)
  toolRef.current = tool
  const inksRef = useRef(inks)
  inksRef.current = inks
  const runningRef = useRef(running)
  runningRef.current = running

  /** what the next frame applies, in order — fingers and the recipe all add to it */
  const pending = useRef<MarbleOp[]>([])
  /** each finger: where it is, and for a drop, whether it is still being held in one place */
  const fingers = useRef(new Map<number, { at: Pt; color: readonly [number, number, number] }>())
  const nextInk = useRef(0)
  /** the recipe, being played: ops with the time they are due, and the clock */
  const playing = useRef<{ t: number; ops: { t: number; o: MarbleOp }[] } | null>(null)

  const ink = () => {
    const set = INKS[inksRef.current].inks
    return set[nextInk.current++ % set.length]
  }
  /* a still tray does not draw itself, so anything that changes it must */
  const flush = () => {
    if (runningRef.current) return
    mbRef.current?.frame(pending.current.splice(0))
  }
  const at = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    return toCentred(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
  }
  const marble = () => {
    const c = document.querySelector<HTMLCanvasElement>('.lab-canvas')
    const aspect = c ? c.clientWidth / Math.max(1, c.clientHeight) : 1.5
    mbRef.current?.clear()
    playing.current = { t: 0, ops: recipe(aspect, INKS[inksRef.current].inks) }
    if (!runningRef.current) setRunning(true)
  }
  const clear = () => {
    playing.current = null
    pending.current = []
    mbRef.current?.clear()
    flush()
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const sets = Object.keys(INKS) as InkSet[]
    if (k === 'd') setTool('drop')
    else if (k === 's') setTool('stylus')
    else if (k === 'c') setTool('comb')
    else if (k === 'm') marble()
    else if (k === 'x') clear()
    else if (/^[1-4]$/.test(k)) setInks(sets[Number(k) - 1])
    else return
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Marbling">
      <LabStage
        label="A tray of marbling ink: drops of colour floated on water and pulled into feathered patterns"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const mb = await createMarbling(device, context, format, canvas)
          mbRef.current = mb
          marble()
          return {
            frame: (dt) => {
              /* a held drop keeps spreading: more ink at the same spot, pushing the rest aside */
              if (toolRef.current === 'drop')
                for (const f of fingers.current.values())
                  pending.current.push({ op: 'drop', at: f.at, radius: GROW, color: f.color })
              const p = playing.current
              if (p) {
                p.t += dt
                while (p.ops.length && p.ops[0].t <= p.t) pending.current.push(p.ops.shift()!.o)
                if (!p.ops.length) playing.current = null
              }
              mb.frame(pending.current.splice(0))
            },
            resize: () => mb.resize(),
            destroy: () => {
              mb.destroy()
              mbRef.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const p = at(e)
          const color = ink()
          fingers.current.set(e.pointerId, { at: p, color })
          if (toolRef.current === 'drop')
            pending.current.push({ op: 'drop', at: p, radius: DROP, color })
          flush()
        }}
        onPointerMove={(e) => {
          const f = fingers.current.get(e.pointerId)
          if (!f) return
          const p = at(e)
          const t = toolRef.current
          if (t === 'drop') {
            /* a drop that wanders becomes a new drop where the finger went */
            if (Math.hypot(p[0] - f.at[0], p[1] - f.at[1]) > DROP)
              fingers.current.set(e.pointerId, { at: p, color: f.color })
            return
          }
          pending.current.push({
            op: 'stroke',
            from: f.at,
            to: p,
            sharp: t === 'comb' ? COMB_SHARP : STYLUS_SHARP,
            spacing: t === 'comb' ? COMB_SPACING : 0,
          })
          fingers.current.set(e.pointerId, { ...f, at: p })
          flush()
        }}
        onPointerUp={(e) => {
          fingers.current.delete(e.pointerId)
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={marble}>
            ✨ Marble
          </button>
          <button className="btn btn-ghost" onClick={clear}>
            Clean sheet
          </button>
          <div className="lab-group" role="group" aria-label="Tool">
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
          <div className="lab-group" role="group" aria-label="Inks">
            {(Object.keys(INKS) as InkSet[]).map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={inks === s}
                onClick={() => setInks(s)}
              >
                {INKS[s].name}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          {tool === 'drop'
            ? 'Tap to float a drop of ink — hold, and it keeps spreading, pushing the rest aside.'
            : tool === 'stylus'
              ? 'Drag a stylus through the ink to pull it along.'
              : 'Drag the comb across the tray — its tines reach right across, as a real one does.'}{' '}
          Ink on water keeps its area: it is pushed and pulled, never thinned away.
          {touchOnly()
            ? ' Several fingers work at once.'
            : ' Keys, once it has focus: D drop, S stylus, C comb, M marble, X clean sheet, 1–4 inks.'}
        </p>
      )}
    </div>
  )
}
