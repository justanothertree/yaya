import { useRef, useState, type KeyboardEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { touchOnly } from '../ui/pointerKind'
import { INKS, RATIOS, pendulumsFor, semitones, type Pendulums, type RatioId } from './harmonograph'
import { createHarmonograph, type HarmonographView } from './harmonographEngine'
import { LabStage } from './LabStage'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const RATIO_IDS = Object.keys(RATIOS) as RatioId[]
/** the pen's time between samples, seconds: short enough that a segment is under a pixel or so */
const SEG = 0.0015
/** how much faster than real time the pen moves, so a whole figure draws in about fifteen seconds */
const SPEEDS = { steady: ['Steady', 5], quick: ['Quick', 18] } as const
type Speed = keyof typeof SPEEDS
const SPEED_IDS = Object.keys(SPEEDS) as Speed[]
/** the swing's fade, a second of pen time */
const FADE = 0.035

/**
 * A harmonograph: flick the paper to swing the pendulums, and the pen draws their figure as they
 * slow. Choose the ratio they swing in — each one an interval you can hear — and nudge it off true
 * to make the figure turn.
 */
export function HarmonographDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [ratio, setRatio] = useState<RatioId>('fifth')
  const [detune, setDetune] = useState(0.006)
  const [speed, setSpeed] = useState<Speed>('steady')
  const [sound, setSound] = useState(true)
  const now = useRef({ ratio, detune, speed, sound })
  now.current = { ratio, detune, speed, sound }

  const engine = useRef<HarmonographView | null>(null)
  /** the drawing in progress: its pendulums, how far along the pen is, and its ink */
  const drawing = useRef<{ p: Pendulums; t: number; ink: number } | null>(null)
  const inks = useRef(0)
  const press = useRef<{ x: number; y: number } | null>(null)
  const notes = useRef(0)

  const play = (r: RatioId) => {
    if (!now.current.sound) return
    for (const midi of [57, 57 + semitones(r)]) {
      const id = `harmonograph-${notes.current++}`
      noteOn(id, 'vibes', midi)
      window.setTimeout(() => noteOff(id), 900)
    }
  }

  /** a new drawing over whatever is on the paper, from a flick (fractions of the canvas) */
  const swing = (flick: readonly [number, number], r = now.current.ratio) => {
    drawing.current = {
      p: pendulumsFor(r, now.current.detune, FADE, flick),
      t: 0,
      ink: INKS[inks.current++ % INKS.length],
    }
    play(r)
    if (!running) setRunning(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ' || k === 'enter') swing([0.7, 0.4 * (Math.random() - 0.5)])
    else if (k === 'c') engine.current?.clear()
    else if (/^[1-5]$/.test(k)) setRatio(RATIO_IDS[Number(k) - 1])
    else if (k === 's') setSpeed((s) => (s === 'steady' ? 'quick' : 'steady'))
    else return
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Harmonograph">
      <LabStage
        label="A pen on swinging pendulums drawing a looping figure that spirals inwards"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const v = await createHarmonograph(device, context, format, canvas)
          engine.current = v
          if (!drawing.current) swing([0.8, 0.35])
          const draw = (dt: number) => {
            const d = drawing.current
            let segments = 0
            let first = 0
            if (d && dt > 0) {
              /* stop once the swing has died to almost nothing */
              const left = Math.exp(-FADE * 0.9 * d.t)
              if (left > 0.03) {
                const advance = SPEEDS[now.current.speed][1] * Math.min(dt, 1 / 20)
                segments = Math.ceil(advance / SEG)
                first = d.t
                d.t += segments * SEG
              }
            }
            v.frame({
              first,
              dt: SEG,
              segments,
              colour: d?.ink ?? 0,
              pendulums: d?.p ?? pendulumsFor('unison', 0, 1, [0, 0]),
            })
          }
          return {
            frame: draw,
            resize: () => {
              v.paper([canvas.width, canvas.height])
              if (drawing.current) drawing.current.t = 0
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          press.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const p = press.current
          press.current = null
          if (!p) return
          const r = e.currentTarget.getBoundingClientRect()
          const s = Math.min(r.width, r.height)
          const flick: [number, number] = [(e.clientX - p.x) / s, (e.clientY - p.y) / s]
          /* a tap with no flick swings it gently, a different way each time */
          swing(
            Math.hypot(...flick) < 0.03
              ? [0.5 * Math.cos(inks.current), 0.5 * Math.sin(inks.current)]
              : flick,
          )
        }}
      />

      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="The pendulums' ratio">
            {RATIO_IDS.map((id) => (
              <button
                key={id}
                className="btn btn-ghost"
                aria-pressed={ratio === id}
                onClick={() => {
                  setRatio(id)
                  swing([0.8, 0.3], id)
                }}
              >
                {RATIOS[id].name}
              </button>
            ))}
          </div>
          <label className="appearance-slider lab-flow">
            <span className="muted">Detune</span>
            <input
              type="range"
              min={0}
              max={0.03}
              step={0.001}
              value={detune}
              onChange={(e) => setDetune(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{(detune * 100).toFixed(1)}%</span>
          </label>
          <div className="lab-group" role="group" aria-label="How fast it draws">
            {SPEED_IDS.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
              >
                {SPEEDS[s][0]}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={() => engine.current?.clear()}>
            ✕ Clean paper
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((s) => !s)}
          >
            {sound ? '🔊 Sound on' : '🔇 Sound off'}
          </button>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Flick the paper to swing the pendulums — the harder and which way you flick decide the
          swing — and the pen draws their figure as they slow, each new drawing in a new ink over
          the last. The ratio is how the pendulums' speeds compare, and each one is a musical
          interval you hear as it starts: 2:3 a fifth, 1:2 an octave. Detune puts them a little off
          true, and the figure turns as it fades. Every frame the GPU gives each piece of the pen's
          path its own thread to ink in.
          {!touchOnly() && ' Keys, once it has focus: Space swings, 1–5 ratio, S speed, C clean.'}
        </p>
      )}
    </div>
  )
}
