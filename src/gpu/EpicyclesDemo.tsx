import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { LabStage } from './LabStage'
import {
  EPICYCLES_KEY,
  MAX_ARMS,
  MAX_KEPT,
  PRESETS,
  SAMPLES,
  chain,
  fewest,
  lines,
  packArms,
  pen,
  readKept,
  resample,
  series,
  size,
  toDrawing,
  toKept,
  worst,
  type Kept,
  type V2,
} from './epicycles'
import { createEpicycles, type EpicyclesView } from './epicyclesEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** seconds for one trip round the drawing at 1× */
const LOOP = 8
/** points of the redrawn curve the trail is cut from */
const CURVE = 512
const SPEEDS = [0.5, 1, 2] as const

const readStore = () => {
  try {
    return readKept(localStorage.getItem(EPICYCLES_KEY))
  } catch {
    return []
  }
}
const pct = (x: number) =>
  x < 0.001 ? '0%' : x < 0.01 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`

export function EpicyclesDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [kept, setKept] = useState<Kept[]>(readStore)
  const [source, setSource] = useState<{ name: string; points: V2[]; own: boolean }>({
    name: PRESETS[0].name,
    points: PRESETS[0].points,
    own: false,
  })
  const pts = useMemo(() => resample(source.points, SAMPLES), [source])
  const terms = useMemo(() => series(pts), [pts])
  const most = Math.min(terms.length - 1, MAX_ARMS)
  const [arms, setArms] = useState(12)
  const k = Math.min(arms, most)
  const [speed, setSpeed] = useState(1)
  const [showDrawing, setShowDrawing] = useState(true)
  const [showCircles, setShowCircles] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const strays = useMemo(() => worst(pts, terms, k), [pts, terms, k])

  // the redrawn curve, once per drawing and arm count — the trail each frame is a slice of it
  const curve = useMemo(
    () => Array.from({ length: CURVE }, (_, i) => pen(terms, k, i / CURVE)),
    [terms, k],
  )
  const engine = useRef<EpicyclesView | null>(null)
  const t = useRef(0)
  const stroke = useRef<V2[] | null>(null)
  const now = useRef({ pts, terms, k, curve, speed, showDrawing, showCircles })
  now.current = { pts, terms, k, curve, speed, showDrawing, showCircles }

  useEffect(() => {
    try {
      localStorage.setItem(EPICYCLES_KEY, JSON.stringify(kept))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [kept])

  const use = (name: string, points: V2[], own: boolean) => {
    setSource({ name, points, own })
    t.current = 0
    setNote(null)
  }

  const keep = () => {
    if (!source.own) return
    if (kept.length >= MAX_KEPT)
      return setNote(`That is ${MAX_KEPT} drawings kept, the most: remove one to keep another.`)
    const name = `Drawing ${kept.length + 1}`
    setKept([...kept, toKept(name, source.points)])
    setSource({ ...source, name, own: false })
    setNote(`Kept as “${name}”, in this browser only.`)
  }

  const look = () => {
    const n = Math.min(fewest(pts, terms), most)
    setArms(n)
    setNote(`${n} ${n === 1 ? 'arm redraws' : 'arms redraw'} it within 1% of its size everywhere.`)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const key = e.key
    if (key === 'ArrowRight' || key === '+' || key === '=') setArms((a) => Math.min(most, a + 1))
    else if (key === 'ArrowLeft' || key === '-') setArms((a) => Math.max(1, a - 1))
    else if (key.toLowerCase() === 'f') look()
    else return
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Epicycles">
      <LabStage
        label={`${source.name}, redrawn by ${k} rotating ${k === 1 ? 'arm' : 'arms'}: it strays at most ${pct(strays)} of its size from the drawing.`}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createEpicycles(device, context, format, canvas)
          engine.current = v
          return {
            frame: (dt: number) => {
              const n = now.current
              t.current = (t.current + (dt * n.speed) / LOOP) % 1
              const out: number[] = []
              const s = stroke.current
              if (s) {
                // drawing a new one: only the stroke so far
                out.push(...lines(s, [0.9, 0.85, 0.5], 1.5, false))
                v.frame(new Float32Array(out), new Float32Array(0))
                return
              }
              if (n.showDrawing) out.push(...lines(n.pts, [0.18, 0.2, 0.3], 1, true))
              // the trail: what the pen has drawn so far this time round
              const upto = Math.max(1, Math.floor(t.current * CURVE))
              out.push(...lines(n.curve.slice(0, upto + 1), [1.0, 0.75, 0.3], 1.6, false))
              const joints = chain(n.terms, n.k, t.current)
              if (n.showCircles) out.push(...lines(joints, [0.55, 0.65, 0.9], 0.8, false))
              // the pen itself: a short bright dash at the tip
              const tip = joints[joints.length - 1]
              out.push(...lines([tip, [tip[0] + 1e-4, tip[1]]], [1, 0.9, 0.6], 3, false))
              const rings = n.showCircles ? packArms(joints) : new Float32Array(0)
              // the small circles fade: at a hundred arms they would otherwise be a grey smudge
              for (let i = 0; i < rings.length / 4; i++)
                rings[i * 4 + 3] = Math.max(0.25, 0.9 - i * 0.02)
              v.frame(new Float32Array(out), rings)
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const c = e.currentTarget
          const r = c.getBoundingClientRect()
          stroke.current = [toDrawing([r.width, r.height], [e.clientX - r.left, e.clientY - r.top])]
          setNote(null)
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const s = stroke.current
          if (!s) return
          const c = e.currentTarget
          const r = c.getBoundingClientRect()
          const p = toDrawing([r.width, r.height], [e.clientX - r.left, e.clientY - r.top])
          const last = s[s.length - 1]
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.008 && s.length < 2000) s.push(p)
        }}
        onPointerUp={() => {
          const s = stroke.current
          stroke.current = null
          if (!s) return
          if (s.length < 8 || size(s) < 0.15)
            return setNote(
              'Draw a shape with one stroke — bigger than a dot. It is closed for you.',
            )
          use('Your drawing', s, true)
        }}
      />

      {live && (
        <div className="lab-controls">
          <label className="studio-pick">
            <span className="muted">Drawing</span>
            <select
              value={source.own ? 'own' : source.name}
              onChange={(e) => {
                const p = PRESETS.find((q) => q.name === e.target.value)
                if (p) return use(p.name, p.points, false)
                const d = kept.find((q) => q.name === e.target.value)
                if (d) use(d.name, d.points, false)
              }}
            >
              {source.own && <option value="own">Your drawing</option>}
              {PRESETS.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
              {kept.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="studio-pick epi-arms">
            <span className="muted">
              {k} {k === 1 ? 'arm' : 'arms'}
            </span>
            <input
              type="range"
              min={1}
              max={most}
              value={k}
              aria-valuetext={`${k} arms; strays at most ${pct(strays)}`}
              onChange={(e) => setArms(Number(e.target.value))}
            />
          </label>
          <span className="lab-score" aria-live="polite">
            strays at most {pct(strays)}
          </span>
          <button className="btn" onClick={look}>
            🎯 Fewest that look right
          </button>
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <button
            className="btn btn-ghost"
            aria-label={`Speed: ${speed} times`}
            onClick={() =>
              setSpeed(
                (v) => SPEEDS[(SPEEDS.indexOf(v as (typeof SPEEDS)[number]) + 1) % SPEEDS.length],
              )
            }
          >
            ⏩ {speed}×
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={showDrawing}
            onClick={() => setShowDrawing((v) => !v)}
          >
            ✏️ Your outline
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={showCircles}
            onClick={() => setShowCircles((v) => !v)}
          >
            ◯ Circles
          </button>
          {source.own && (
            <button className="btn btn-ghost" onClick={keep}>
              ⭐ Keep this drawing
            </button>
          )}
          {!source.own && kept.some((d) => d.name === source.name) && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setKept(kept.filter((d) => d.name !== source.name))
                use(PRESETS[0].name, PRESETS[0].points, false)
                setNote('Removed from this browser.')
              }}
            >
              ✕ Forget this drawing
            </button>
          )}
        </div>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <strong>{note} </strong>}
          Draw any shape on the stage in one stroke and it is redrawn by a chain of turning arms,
          each spinning a whole number of times a loop — its Fourier series. Slide to use more of
          them: a circle needs one, a heart a handful, a square’s corners dozens. Keys: ← → arms, F
          fewest.
        </p>
      )}
    </div>
  )
}
