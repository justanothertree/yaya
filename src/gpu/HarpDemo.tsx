import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { sharedCtx } from '../audio/context'
import { noteOff, noteOn } from '../audio/synth'
import { touchOnly } from '../ui/pointerKind'
import {
  INSTRUMENT_IDS,
  TUNINGS,
  crossings,
  layout,
  nearest,
  phrase,
  tune,
  type HarpString,
  type HarpVoice,
  type Pluck,
  type Tuning,
} from './harp'
import { createHarp } from './harpEngine'
import { LabStage } from './LabStage'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Pt = readonly [number, number]
const VOICES: Record<HarpVoice, string> = {
  harp: 'Harp',
  koto: 'Koto',
  pluck: 'Pluck',
  kalimba: 'Kalimba',
}
/** the lowest string: C3 */
const ROOT = 48
/** a note's ring before it is let go — longer than any of these voices takes to die away */
const RING = 3
/** keys across the keyboard, a string each, low to high */
const KEYS = 'zxcvbnm,./asdfghjkl;'

/** A harp of light: strum across the strings with as many fingers as you like, and it plays. */
export function HarpDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [voice, setVoice] = useState<HarpVoice>('harp')
  const [tuning, setTuning] = useState<Tuning>('penta')
  const [auto, setAuto] = useState(false)
  const count = touchOnly() ? 12 : 16
  const now = useRef({ voice, tuning, auto })
  now.current = { voice, tuning, auto }
  const runningRef = useRef(running)
  runningRef.current = running

  const strings = useRef<HarpString[]>([])
  const plucks = useRef<Pluck[]>([])
  const clock = useRef(0)
  /** each finger: where it is, when, and the string it pressed on — which its stroke must not
      sound a second time as it leaves it */
  const fingers = useRef(new Map<number, { at: Pt; t: number; pressed: number }>())
  const playing = useRef<{ t: number; i: number }[]>([])
  const seed = useRef(1)
  const plucked = useRef(0)
  const redraw = useRef<() => void>(() => {})

  /** sound string i and set it swinging; `delay` seconds from now, so a stroke rolls */
  const pluck = (i: number, where: number, amp: number, delay = 0) => {
    const s = strings.current[i]
    if (!s) return
    plucks.current[i] = { at: clock.current + delay, where, amp }
    const id = `lab-harp-${plucked.current++}`
    const at = sharedCtx().currentTime + delay
    noteOn(id, now.current.voice, s.midi, at)
    noteOff(id, at + RING)
    if (!runningRef.current) setRunning(true)
  }

  /* a new tuning retunes the strings in place */
  useEffect(() => {
    const midis = tune(tuning, ROOT, count)
    strings.current = strings.current.map((s, i) => ({ ...s, midi: midis[i] }))
    redraw.current()
  }, [tuning, count])
  useEffect(() => {
    if (!auto) playing.current = []
  }, [auto])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget || e.repeat) return
    const k = e.key.toLowerCase()
    const at = KEYS.indexOf(k)
    if (at >= 0 && at < strings.current.length) pluck(at, 0.3 + Math.random() * 0.4, 0.8)
    else if (k === ' ') setRunning((r) => !r)
    else if (k === 'p') setAuto((a) => !a)
    else if (/^[1-3]$/.test(k)) setTuning((Object.keys(TUNINGS) as Tuning[])[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toCanvas = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = e.currentTarget.width / r.width
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Harp">
      <LabStage
        label="A harp of glowing strings that sound and swing when strummed"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const view = await createHarp(device, context, format, canvas)
          let size = [0, 0]
          const draw = () => {
            if (size[0] !== canvas.width || size[1] !== canvas.height) {
              size = [canvas.width, canvas.height]
              strings.current = layout(
                tune(now.current.tuning, ROOT, count),
                canvas.width,
                canvas.height,
              )
            }
            const dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width)
            view.draw({
              strings: strings.current,
              plucks: plucks.current,
              time: clock.current,
              width: 7 * dpr,
            })
          }
          redraw.current = () => {
            if (!runningRef.current) draw()
          }
          return {
            frame: (dt) => {
              if (dt > 0) {
                clock.current += dt
                /* ✨ Play: pluck whatever the phrase says is due, and write the next when it ends */
                if (now.current.auto) {
                  if (!playing.current.length) {
                    playing.current = phrase(strings.current.length, seed.current++).map((p) => ({
                      ...p,
                      t: p.t + clock.current + 0.6,
                    }))
                  }
                  while (playing.current.length && playing.current[0].t <= clock.current) {
                    const p = playing.current.shift()!
                    pluck(p.i, 0.25 + 0.5 * Math.random(), 0.55 + 0.35 * Math.random())
                  }
                }
              }
              draw()
            },
            destroy: () => {
              view.destroy()
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const at = toCanvas(e)
          const k = e.currentTarget.width / e.currentTarget.getBoundingClientRect().width
          /* a press right on a string plucks it, as a finger hooking it would — at once, since an
             instrument may not wait to see whether a press becomes a stroke */
          const hit = nearest(strings.current, at[0], at[1], 14 * k)
          if (hit) pluck(hit.i, hit.where, 0.7 * (Math.random() < 0.5 ? -1 : 1))
          fingers.current.set(e.pointerId, { at, t: performance.now(), pressed: hit?.i ?? -1 })
        }}
        onPointerMove={(e) => {
          const f = fingers.current.get(e.pointerId)
          if (!f) return
          const at = toCanvas(e)
          const t = performance.now()
          const ms = Math.max(1, t - f.t)
          const k = e.currentTarget.width / e.currentTarget.getBoundingClientRect().width
          /* how hard: the finger's speed, in CSS pixels a millisecond; which way: the way it went */
          const speed = Math.hypot(at[0] - f.at[0], at[1] - f.at[1]) / k / ms
          const amp = Math.min(1, 0.3 + speed * 0.35) * Math.sign(at[0] - f.at[0])
          /* each string this stroke crossed, sounded as far into the stroke as it was crossed —
             except the one it was pressed on, the first time it leaves it: a press 8px beside a
             string and a stroke away across it sounded that string twice */
          let pressed = f.pressed
          for (const c of crossings(strings.current, f.at, at)) {
            if (c.i === pressed) {
              pressed = -1
              continue
            }
            pluck(c.i, c.where, amp, (c.t * Math.min(ms, 40)) / 1000)
          }
          fingers.current.set(e.pointerId, { at, t, pressed })
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
          <button className="btn btn-ghost" aria-pressed={auto} onClick={() => setAuto((a) => !a)}>
            ✨ Play by itself
          </button>
          <div className="lab-group" role="group" aria-label="Voice">
            {INSTRUMENT_IDS.map((v) => (
              <button
                key={v}
                className="btn btn-ghost"
                aria-pressed={voice === v}
                onClick={() => setVoice(v)}
              >
                {VOICES[v]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Tuning">
            {(Object.keys(TUNINGS) as Tuning[]).map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={tuning === t}
                onClick={() => setTuning(t)}
              >
                {TUNINGS[t]}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Strum across the strings — with as many fingers as you like — or tap one. Pluck near the
          middle for a round tone and near the end for a bright one: you can see the difference in
          how the string swings, because what you see is the same sum of waves a real string makes.
          It plays through the site&rsquo;s instrument, so the volume is the Instrument&rsquo;s.
          {!touchOnly() &&
            ' Keys: Z to / and A to ; play the strings low to high, P plays by itself, 1–3 tunings.'}
        </p>
      )}
    </div>
  )
}
