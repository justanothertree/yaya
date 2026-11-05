import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { DOODLE_SECONDS, SYMMETRIES, doodle, toCentred } from './kaleido'
import { createKaleido, type Kaleido, type KaleidoInput } from './kaleidoEngine'
import { PALETTES, PALETTE_IDS, type Palette } from './palettes'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Point = readonly [number, number]

/** brush radius in centred units — a fraction of the screen's height */
const BRUSHES = { Fine: 0.006, Medium: 0.012, Bold: 0.024 } as const
type Brush = keyof typeof BRUSHES

/** where a pen was last drawn to, where it is now, and whether a press is still owed its dot */
type Pen = { last: Point; now: Point; dab: boolean; colourT: number }

/** the doodle that draws itself is one more pen, with this id */
const DOODLE = -1

/** Draw, and everything you draw is mirrored round the middle — a kaleidoscope you paint in. */
export function KaleidoDemo({ running, setRunning, onAdapter }: Props) {
  const kalRef = useRef<Kaleido | null>(null)
  const [live, setLive] = useState(false)
  const [n, setN] = useState<number>(8)
  const [mirror, setMirror] = useState(true)
  const [palette, setPalette] = useState<Palette>('rainbow')
  const [brush, setBrush] = useState<Brush>('Medium')
  const [fade, setFade] = useState(0.35)
  const runningRef = useRef(running)
  runningRef.current = running

  const input = useRef<KaleidoInput>({
    stroke: null,
    color: [1, 1, 1],
    radius: BRUSHES.Medium,
    keep: Math.exp(-0.35),
    n: 8,
    mirror: true,
  })
  const i = input.current
  i.n = n
  i.mirror = mirror
  i.radius = BRUSHES[brush]
  i.keep = fade === 0 ? 1 : Math.exp(-fade)
  const paletteRef = useRef(palette)
  paletteRef.current = palette

  /**
   * ⚠️ ONE PEN PER FINGER, the lesson Fluid learned: with a single "last point" a second finger
   * drew a line across the gap to the first. Each pen has where it was last drawn to and where it
   * is now; frames take the pens in turn, so two fingers draw two strokes.
   */
  const pens = useRef(new Map<number, Pen>())
  const doodling = useRef<{ t: number; seed: number } | null>(null)

  /** hand the next pen with something to draw to this frame */
  const nextStroke = () => {
    for (const [id, pen] of pens.current) {
      if (pen.last === pen.now && !pen.dab) continue
      /* to the back of the queue, so the next frame serves the next pen */
      pens.current.delete(id)
      pens.current.set(id, { ...pen, last: pen.now, dab: false })
      i.stroke = { a: pen.last, b: pen.now }
      i.color = PALETTES[paletteRef.current].at(
        id === DOODLE ? pen.colourT : performance.now() / 1000,
      )
      return
    }
  }

  /* a still kaleidoscope does not draw itself, so a stroke while paused must */
  const drawNow = () => {
    if (runningRef.current) return
    nextStroke()
    kalRef.current?.frame(0, i)
  }

  const startDoodle = () => {
    doodling.current = { t: 0, seed: Math.floor(Math.random() * 1000) }
    pens.current.delete(DOODLE)
    if (!runningRef.current) setRunning(true)
  }

  const at = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect()
    return toCentred(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
  }

  const cycleN = () =>
    setN((v) => SYMMETRIES[(SYMMETRIES.findIndex((s) => s === v) + 1) % SYMMETRIES.length])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 's') cycleN()
    else if (k === 'm') setMirror((v) => !v)
    else if (k === 'c') kalRef.current?.clear()
    else if (k === 'd') startDoodle()
    else if (/^[1-4]$/.test(k)) setPalette(PALETTE_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Kaleidoscope">
      <LabStage
        label="A kaleidoscope: whatever is drawn is repeated and mirrored around the middle"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const kal = await createKaleido(device, context, format, canvas)
          kalRef.current = kal
          startDoodle()
          return {
            frame: (dt) => {
              /* the doodle is a pen that moves itself */
              const d = doodling.current
              if (d && dt > 0) {
                const from = pens.current.get(DOODLE)?.now ?? doodle(0, d.seed)
                d.t = Math.min(DOODLE_SECONDS, d.t + dt)
                pens.current.set(DOODLE, {
                  last: from,
                  now: doodle(d.t, d.seed),
                  dab: false,
                  colourT: d.t * 2,
                })
                if (d.t >= DOODLE_SECONDS) doodling.current = null
              }
              nextStroke()
              kal.frame(dt, i)
            },
            resize: () => kal.resize(),
            destroy: () => {
              kal.destroy()
              kalRef.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const p = at(e)
          /* a tap is a dab: a stroke from the point to itself */
          pens.current.set(e.pointerId, { last: p, now: p, dab: true, colourT: 0 })
          drawNow()
        }}
        onPointerMove={(e) => {
          const pen = pens.current.get(e.pointerId)
          if (!pen) return
          pens.current.set(e.pointerId, { ...pen, now: at(e) })
          drawNow()
        }}
        onPointerUp={(e) => {
          pens.current.delete(e.pointerId)
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" onClick={startDoodle}>
            ✨ Doodle
          </button>
          <button className="btn btn-ghost" onClick={() => kalRef.current?.clear()}>
            Clear
          </button>
          <div className="lab-group" role="group" aria-label="Symmetry">
            {SYMMETRIES.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={n === s}
                onClick={() => setN(s)}
              >
                {s}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={mirror}
              onClick={() => setMirror((v) => !v)}
            >
              Mirror
            </button>
          </div>
          <div className="lab-group" role="group" aria-label="Colour">
            {PALETTE_IDS.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={palette === p}
                onClick={() => setPalette(p)}
              >
                {PALETTES[p].name}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Brush">
            {(Object.keys(BRUSHES) as Brush[]).map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={brush === b}
                onClick={() => setBrush(b)}
              >
                {b}
              </button>
            ))}
          </div>
          <label className="appearance-slider lab-flow">
            <span className="muted">Fade</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={fade}
              onChange={(e) => setFade(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{fade === 0 ? 'keep' : fade.toFixed(2)}</span>
          </label>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Draw anywhere and it repeats {n} ways{mirror ? ', mirrored' : ''} round the middle — tap
          for a dot, or let ✨ Doodle draw one for you. Fade at 0 keeps everything.
          {!touchOnly() &&
            ' Keys, once it has focus: Space pauses, S changes the symmetry, M mirrors, D doodles, C clears, 1–4 pick a colour.'}
        </p>
      )}
    </div>
  )
}
