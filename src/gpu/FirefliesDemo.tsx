import { useRef, useState, type KeyboardEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { createEar } from './ear'
import {
  COUNTS,
  FADE,
  MOODS,
  TOUCH_CEILING,
  beatFor,
  seedFlies,
  tempoOf,
  type Mood,
} from './fireflies'
import { createFireflies, type FirefliesView } from './firefliesEngine'
import { LabStage } from './LabStage'
import { countLabel } from './swarm'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const MOOD_IDS = Object.keys(MOODS) as Mood[]
/** how often the "in step" figure is read back from the GPU, seconds */
const READ_EVERY = 0.4
/** a rhythm nobody has tapped or played for this long is let go, seconds */
const LET_GO = 5

/** A night meadow of fireflies falling into flashing together. Tap a rhythm and they follow it. */
export function FirefliesDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const offered = COUNTS.filter((n) => !touchOnly() || n <= TOUCH_CEILING)
  const [count, setCount] = useState<number>(offered.includes(4096) ? 4096 : offered[0])
  const [mood, setMood] = useState<Mood>('social')
  const [listen, setListen] = useState(false)
  const [inStep, setInStep] = useState<{ near: number; all: number } | null>(null)
  /** the beat they are following, and whose: a tapped one wins over the music's */
  const [follow, setFollow] = useState<{ bpm: number; whose: 'yours' | 'music' } | null>(null)
  const now = useRef({ mood, listen, count })
  now.current = { mood, listen, count }

  const viewRef = useRef<FirefliesView | null>(null)
  const tap = useRef<[number, number, number]>([0.5, 0.5, 0])
  const taps = useRef<number[]>([])
  /** the tapped rhythm, while it lasts, and how many taps into it we are */
  const tapped = useRef<{ bpm: number; count: number } | null>(null)
  const quiet = useRef(0)
  const redraw = useRef<() => void>(() => {})

  const scatter = (n = now.current.count) => {
    viewRef.current?.load(seedFlies(n, Math.random))
    redraw.current()
  }

  /**
   * A tap at (u, v) of the meadow: the fireflies round it flash with you, and once three taps make
   * a rhythm the whole meadow takes up its pace. Taps past the folding (`beatFor`) only count every
   * `every`th one, as beats do, so a quick rhythm does not pull them both ways.
   */
  const tapAt = (u: number, v: number) => {
    const t = performance.now()
    taps.current = [...taps.current.filter((s) => t - s < LET_GO * 1000), t].slice(-5)
    const bpm = tempoOf(taps.current)
    const count = bpm === null ? 0 : (tapped.current?.count ?? 0) + 1
    tapped.current = bpm === null ? null : { bpm, count }
    if (bpm === null || count % beatFor(bpm).every === 0) tap.current = [u, v, 1]
    if (bpm !== null) setFollow({ bpm, whose: 'yours' })
    /* a rhythm nobody is tapping any more is let go, and stops being shown */
    window.clearTimeout(quiet.current)
    quiet.current = window.setTimeout(() => {
      tapped.current = null
      setFollow(null)
    }, LET_GO * 1000)
    if (!running) setRunning(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'enter' || k === 'b') tapAt(0.5, 0.6)
    else if (k === 's') scatter()
    else if (k === 'l') setListen((v) => !v)
    else if (/^[1-3]$/.test(k)) setMood(MOOD_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Fireflies">
      <LabStage
        label="A meadow at night full of fireflies, flashing together more and more"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const v = await createFireflies(
            device,
            context,
            format,
            seedFlies(now.current.count, Math.random),
          )
          viewRef.current = v
          const ear = createEar()
          let kick = 0
          let time = 0
          /* the music's beat: when the last few landed, the tempo they make, and a count of them */
          let heard: number[] = []
          let heardBpm: number | null = null
          let hits = 0
          let sinceRead = READ_EVERY
          let shownBpm: number | null = null
          let alive = true
          const draw = (dt: number) => {
            if (now.current.listen && ear.hear(dt).hit) {
              heard = [...heard.filter((t) => time - t < LET_GO), time].slice(-5)
              heardBpm = tempoOf(heard.map((t) => t * 1000)) ?? heardBpm
              hits++
              if (hits % (heardBpm ? beatFor(heardBpm).every : 1) === 0) kick = 1
            }
            if (!now.current.listen || time - (heard.at(-1) ?? -Infinity) > LET_GO) heardBpm = null
            const bpm = tapped.current?.bpm ?? heardBpm
            if (!tapped.current) {
              const shown = heardBpm === null ? null : Math.round(heardBpm)
              if (shown !== shownBpm) {
                shownBpm = shown
                setFollow(shown === null ? null : { bpm: shown, whose: 'music' })
              }
            }
            v.frame({
              w: canvas.width,
              h: canvas.height,
              count: v.count,
              dt,
              time,
              mood: now.current.mood,
              kick,
              tap: tap.current,
              beat: bpm === null ? 0 : beatFor(bpm).pace,
            })
            /* faded AFTER the frame, so the frame a tap lands in feels all of it */
            const fade = Math.exp(-dt / FADE)
            tap.current[2] *= fade
            kick *= fade
          }
          redraw.current = () => draw(0)
          return {
            frame: (dt) => {
              /* a long frame (a tab coming back) must not swing every clock round at once */
              const step = Math.min(dt, 1 / 20)
              time += step
              draw(step)
              sinceRead += dt
              if (sinceRead >= READ_EVERY) {
                sinceRead = 0
                void v.order().then((r) => {
                  if (alive && r !== null) setInStep(r)
                })
              }
            },
            destroy: () => {
              alive = false
              v.destroy()
              viewRef.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          tapAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" onClick={() => scatter()}>
            ↺ Out of step
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={listen}
            onClick={() => {
              setListen((l) => !l)
              if (!listen && !running) setRunning(true)
            }}
          >
            🎵 Listen
          </button>
          <div className="lab-group" role="group" aria-label="How much they follow each other">
            {MOOD_IDS.map((m) => (
              <button
                key={m}
                className="btn btn-ghost"
                aria-pressed={mood === m}
                onClick={() => setMood(m)}
              >
                {MOODS[m][0]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="How many fireflies">
            {offered.map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={count === n}
                onClick={() => {
                  setCount(n)
                  scatter(n)
                }}
              >
                {countLabel(n)}
              </button>
            ))}
          </div>
          <span className="muted" aria-live="off">
            {inStep === null
              ? 'In step: …'
              : `In step: ${Math.round(inStep.near * 100)}% nearby, ${Math.round(inStep.all * 100)}% across`}
            {follow !== null &&
              ` · following ${follow.whose === 'yours' ? 'your' : 'the music’s'} beat, ${Math.round(follow.bpm)}/min`}
          </span>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Every firefly keeps its own time and nudges it towards the flashes it sees nearby; past a
          certain pull the whole meadow falls into step by itself, as real fireflies do. Shy ones
          barely listen to each other; a Crowd locks together in seconds — sometimes into a wave
          that sweeps the meadow, every patch in step with its neighbours and the whole never at
          once. Tap and the ones round your finger flash with you; tap a steady rhythm and the whole
          meadow takes it up. With 🎵 Listen on they take up the beat of whatever this site is
          playing instead — start a song in Music and come back.
          {!touchOnly() &&
            ' Keys, once it has focus: Space pauses, Enter or B taps, S scatters, L listens, 1–3 mood.'}
        </p>
      )}
    </div>
  )
}
