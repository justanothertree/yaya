import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  DRAFTS,
  NOTES,
  flipAt,
  layoutFor,
  longestFloat,
  spotAt,
  thread,
  tie,
  treadle,
  type Draft,
  type DraftId,
  type RGB,
} from './loom'
import { createLoom, type LoomView } from './loomEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const DRAFT_IDS = Object.keys(DRAFTS) as DraftId[]
/** floats longer than this many threads are marked by 🔍 Long floats */
const LONG = 3
/** other colourways, each a set of four the draft's colours are swapped for in order */
const COLOURWAYS: (readonly RGB[] | null)[] = [
  null,
  [
    [0.85, 0.55, 0.2],
    [0.35, 0.16, 0.1],
    [0.55, 0.62, 0.3],
    [0.95, 0.85, 0.6],
  ],
  [
    [0.9, 0.95, 0.96],
    [0.1, 0.35, 0.5],
    [0.2, 0.6, 0.62],
    [0.95, 0.6, 0.45],
  ],
  [
    [0.92, 0.92, 0.9],
    [0.12, 0.12, 0.13],
    [0.5, 0.5, 0.52],
    [0.75, 0.75, 0.74],
  ],
]
const COLOURWAY_NAMES = ['its own', 'autumn', 'sea', 'greys']

/**
 * A loom you set up like a weaver: thread the warp, tie up the treadles, write the treadling — or
 * tap the cloth itself — and watch it weave, pick by pick, each treadle a note.
 */
export function LoomDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [draftId, setDraftId] = useState<DraftId>('rosepath')
  const [colourway, setColourway] = useState(0)
  const [floats, setFloats] = useState(false)
  const [speed, setSpeed] = useState(3)
  const [zoom, setZoom] = useState(11)
  const [sound, setSound] = useState(true)
  const [longest, setLongest] = useState(() => longestFloat(DRAFTS.rosepath.draft))
  const now = useRef({ floats, speed, zoom, sound, running })
  now.current = { floats, speed, zoom, sound, running }

  const engine = useRef<LoomView | null>(null)
  const draft = useRef<Draft>(DRAFTS.rosepath.draft)
  /** picks woven so far: it opens on a length of cloth already woven, and ⚠️ is a modest number
     because the shader gets it as an f32 — at a billion, a pick's fraction is below its precision */
  const woven = useRef(400)
  const scale = useRef(1)
  const redraw = useRef<() => void>(() => {})
  /** the last place a drag set, so a drag across the strip draws a line rather than a dot */
  const last = useRef<string | null>(null)

  const colours = (d: Draft, way: number): Draft => {
    const swap = COLOURWAYS[way]
    return swap ? { ...d, colours: d.colours.map((_, k) => swap[k % swap.length]) } : d
  }
  const set = (d: Draft) => {
    draft.current = d
    engine.current?.draft(colours(d, colourwayRef.current))
    setLongest(longestFloat(d))
    redraw.current()
  }
  const colourwayRef = useRef(colourway)
  colourwayRef.current = colourway

  const choose = (id: DraftId) => {
    setDraftId(id)
    /* the cloth already on the loom is shown in the new draft at once — a draft button that left
       bare warp for ten seconds would read as one that did nothing; ↺ Weave again starts bare */
    set(DRAFTS[id].draft)
  }
  const recolour = (way: number) => {
    setColourway(way)
    colourwayRef.current = way
    set(draft.current)
  }

  const pluck = (t: number, ms = 300) => {
    if (!now.current.sound) return
    const id = `loom-${t}-${performance.now()}`
    noteOn(id, 'kalimba', NOTES[t])
    window.setTimeout(() => noteOff(id), ms)
  }

  /* the picture's layout in canvas px, as the shader works it out */
  const geometry = (canvas: HTMLCanvasElement) => {
    const cell = Math.max(4, Math.round(now.current.zoom * scale.current))
    const { rows } = layoutFor(canvas.width, canvas.height, cell)
    const w = Math.floor(woven.current)
    return { cell, rows, first: Math.max(0, w - rows + 1) }
  }

  const touch = (e: PointerEvent<HTMLCanvasElement>, down: boolean) => {
    const canvas = e.currentTarget
    const r = canvas.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * canvas.width
    const y = ((e.clientY - r.top) / r.height) * canvas.height
    const { cell, first } = geometry(canvas)
    const s = spotAt(x, y, canvas.width, canvas.height, cell)
    const key = JSON.stringify(s)
    if (!down && key === last.current) return
    last.current = key
    const d = draft.current
    if (s.at === 'cloth' && down) {
      set(flipAt(d, first + s.row, s.col))
      pluck(d.treadling[(first + s.row) % d.treadling.length], 150)
    } else if (s.at === 'threading') set(thread(d, s.col, s.shaft))
    else if (s.at === 'tieup' && down) set(tie(d, s.treadle, s.shaft))
    else if (s.at === 'treadling') {
      set(treadle(d, first + s.row, s.treadle))
      pluck(s.treadle, 150)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (/^[1-6]$/.test(k)) choose(DRAFT_IDS[Number(k) - 1])
    else if (k === 'c') recolour((colourway + 1) % COLOURWAYS.length)
    else if (k === 'f') setFloats((v) => !v)
    else if (k === 'u') {
      woven.current = 0
      if (!running) setRunning(true)
    } else if (k === '-' || k === '=' || k === '+')
      setZoom((z) => Math.max(5, Math.min(20, z + (k === '-' ? -1 : 1))))
    else if (k === 'm') setSound((v) => !v)
    else return
    redraw.current()
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Loom">
      <LabStage
        label="A weaving draft on squared paper beside the cloth it weaves, pick by pick"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createLoom(device, context, format, canvas)
          engine.current = v
          v.draft(colours(draft.current, colourwayRef.current))
          let t = 0
          const draw = (dt: number) => {
            scale.current = canvas.width / Math.max(1, canvas.clientWidth || canvas.width)
            const before = Math.floor(woven.current)
            woven.current += dt * now.current.speed
            const after = Math.floor(woven.current)
            /* a note for each new pick, its treadle's — at most a couple a frame */
            if (dt > 0 && after > before && after - before < 3) {
              const d = draft.current
              pluck(d.treadling[before % d.treadling.length])
            }
            t += dt
            const { cell, first } = geometry(canvas)
            v.frame({
              cell,
              woven: woven.current,
              first,
              floats: now.current.floats ? LONG : 0,
              light: [Math.cos(t * 0.25) * 0.6, -0.55],
            })
          }
          redraw.current = () => {
            /* `make` runs once, so `running` is read from the ref, never from here */
            if (!now.current.running) draw(0)
          }
          return {
            frame: draw,
            destroy: () => {
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          last.current = null
          touch(e, true)
        }}
        onPointerMove={(e) => {
          if (e.buttons) touch(e, false)
        }}
        onPointerUp={() => {
          last.current = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Weave'}
          </button>
          <div className="lab-group" role="group" aria-label="Draft">
            {DRAFT_IDS.map((id) => (
              <button
                key={id}
                className="btn btn-ghost"
                aria-pressed={draftId === id}
                title={DRAFTS[id].line}
                onClick={() => choose(id)}
              >
                {DRAFTS[id].name}
              </button>
            ))}
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => recolour((colourway + 1) % COLOURWAYS.length)}
          >
            🎨 Colours: {COLOURWAY_NAMES[colourway]}
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={floats}
            onClick={() => setFloats((v) => !v)}
          >
            🔍 Long floats
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              woven.current = 0
              if (!running) setRunning(true)
            }}
          >
            ↺ Weave again
          </button>
          <label className="appearance-slider lab-flow">
            <span className="muted">Speed</span>
            <input
              type="range"
              min={0.5}
              max={12}
              step={0.5}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{speed}/s</span>
          </label>
          <label className="appearance-slider lab-flow">
            <span className="muted">Size</span>
            <input
              type="range"
              min={5}
              max={20}
              step={1}
              value={zoom}
              onChange={(e) => {
                setZoom(Number(e.target.value))
                redraw.current()
              }}
            />
            <span className="appearance-slider-val">
              {zoom < 9 ? 'fine' : zoom < 15 ? 'mid' : 'bold'}
            </span>
          </label>
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((v) => !v)}
          >
            {sound ? '🔔 Sound on' : '🔕 Sound off'}
          </button>
        </div>
      )}

      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {DRAFTS[draftId].name}: {DRAFTS[draftId].line}. Longest float {longest} thread
          {longest === 1 ? '' : 's'}
          {floats && longest > LONG ? ` — marked in red where longer than ${LONG}` : ''}. The
          squares along the top say which shaft each warp thread goes through (draw across them to
          rethread), the corner which shafts each treadle lifts (tap to tie or untie), and the
          column on the right which treadle each pick presses (draw down it to change the tune —
          each treadle is a note). Tap the cloth itself and every crossing that shares that shaft
          and treadle flips with it. Every pixel of cloth works out its own crossing from the draft,
          and its neighbours', to bend each thread where it dives under.
          {!touchOnly() &&
            ' Keys, once it has focus: Space weaves or stops, 1–6 draft, C colours, F floats, U weave again, − + thread size, M sound.'}
        </p>
      )}
    </div>
  )
}
