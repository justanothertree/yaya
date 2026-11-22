import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  ANGLES,
  BEST_TILT,
  CHALLENGES,
  SKIP_KEY,
  SPEEDS,
  WOBBLE,
  aim,
  describe,
  fly,
  judge,
  readSaved,
  wobble,
  type Course,
  type Flight,
} from './skip'
import { createSkip, type SkipView } from './skipEngine'
import { useKept } from './kept'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const FREE = 'free'
const OPEN: Course = { shore: 60 }

export function SkipDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [saved, setSaved] = useKept(SKIP_KEY, readSaved)
  const [pick, setPick] = useState<string>(FREE)
  const [pull, setPull] = useState(0.6)
  const [angle, setAngle] = useState(0)
  const [said, setSaid] = useState<string | null>(null)
  const [sound, setSound] = useState(true)
  /** a stone in the air: a press now is ignored, and the button says why */
  const [flying, setFlying] = useState(false)
  const challenge = CHALLENGES.find((c) => c.id === pick) ?? null
  const course = challenge?.course ?? OPEN

  // what the frame loop reads, without re-making the stage
  const clock = useRef(0)
  /* ⚠️ THE WOBBLE KEEPS REAL TIME, not frame time. A person times the release against their own
     sense of a second; a stuttering GPU or a throttled tab would otherwise freeze the stone in the
     hand while their timing ran on. The replay of a flight is the frame clock's business. */
  const seconds = () => performance.now() / 1000
  const hold = useRef<number | null>(null)
  const flight = useRef<{ f: Flight; at: number; heard: number } | null>(null)
  const gauge = useRef<HTMLSpanElement | null>(null)
  const now = useRef({ pull, angle, course, sound, buoy: 0 })
  now.current = {
    pull,
    angle,
    course,
    sound,
    buoy: challenge?.goal.kind === 'reach' ? challenge.goal.x : 0,
  }
  const notes = useRef<number[]>([])
  useEffect(
    () => () => {
      for (const t of notes.current) window.clearTimeout(t)
      for (let i = 0; i < 40; i++) noteOff(`skip-${i}`)
    },
    [],
  )

  /** the stone leaves the hand: the tilt is wherever the wobble had got to */
  const release = () => {
    if (hold.current === null) return
    const tilt = wobble(seconds() - hold.current)
    hold.current = null
    const t = { ...aim(now.current.pull, now.current.angle), tilt }
    flight.current = { f: fly(t, now.current.course), at: clock.current, heard: 0 }
    setSaid(null)
    setFlying(true)
    if (!running) setRunning(true)
  }
  const grab = () => {
    if (flight.current && !landed.current) return // one stone at a time
    flight.current = null
    landed.current = false
    hold.current = seconds()
    setSaid(null)
    if (!running) setRunning(true)
  }
  const landed = useRef(false)

  /** a flight has ended: say what happened, mark a challenge done, keep the bests */
  const finish = (f: Flight) => {
    setFlying(false)
    const c = CHALLENGES.find((x) => x.id === pick) ?? null
    const ok = c ? judge(c, f) : null
    setSaid(`${describe(f)}${c ? (ok ? ` ✓ ${c.name} — done.` : ` Not yet: ${c.hint}`) : ''}`)
    setSaved((s) => ({
      best: Math.max(s.best, f.skips),
      furthest: Math.max(s.furthest, Math.round(f.distance * 10) / 10),
      done: ok && c && !s.done.includes(c.id) ? [...s.done, c.id] : s.done,
    }))
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  /* ── aiming by dragging back on the stage, like a catapult */
  const drag = useRef<{ x: number; y: number; size: number } | null>(null)
  const onDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    const r = e.currentTarget.getBoundingClientRect()
    drag.current = { x: e.clientX, y: e.clientY, size: 0.45 * Math.min(r.width, r.height) }
    grab()
  }
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || hold.current === null) return
    const dx = d.x - e.clientX
    const dy = e.clientY - d.y
    if (Math.hypot(dx, dy) < 8) return // a tap keeps the sliders' aim
    setPull(Math.min(1, Math.hypot(dx, dy) / d.size))
    if (dx > 0)
      setAngle(
        Math.round(
          Math.max(ANGLES.min, Math.min(ANGLES.max, (Math.atan2(dy, dx) * 180) / Math.PI)),
        ),
      )
  }
  const onUp = (e: PointerEvent<HTMLElement>) => {
    drag.current = null
    // a cancelled press (the browser took the gesture) drops the stone rather than throwing it
    if (e.type === 'pointercancel') hold.current = null
    else release()
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>, up = false) => {
    if (e.altKey || e.metaKey || e.ctrlKey) return
    const isThrow = e.key === ' ' || e.key === 'Enter'
    if (isThrow && (e.target === e.currentTarget || (e.target as HTMLElement).dataset.hold)) {
      if (up) release()
      else if (!e.repeat) grab()
    } else if (!up && e.target === e.currentTarget) {
      const step = e.shiftKey ? 5 : 1
      if (e.key === 'ArrowRight') setPull((p) => Math.min(1, p + 0.05 * step))
      else if (e.key === 'ArrowLeft') setPull((p) => Math.max(0, p - 0.05 * step))
      else if (e.key === 'ArrowUp') setAngle((a) => Math.min(ANGLES.max, a + step))
      else if (e.key === 'ArrowDown') setAngle((a) => Math.max(ANGLES.min, a - step))
      else return
    } else return
    e.preventDefault()
  }

  const shown = aim(pull, angle)
  const label = said
    ? `Skipping stones: ${said}`
    : `Skipping stones. Power ${shown.speed.toFixed(0)} metres a second, aimed ${shown.angle}°. Hold, then let go when the stone in your hand is nearly flat.`

  return (
    <div
      className="lab-keys skip-room"
      tabIndex={0}
      onKeyDown={(e) => onKey(e)}
      onKeyUp={(e) => onKey(e, true)}
      aria-label="Skipping stones"
    >
      <LabStage
        label={label}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v: SkipView = await createSkip(device, context, format, canvas)
          return {
            frame: (dt: number) => {
              clock.current += dt
              const t = clock.current
              const n = now.current
              const fl = flight.current
              let stone: { x: number; y: number; tilt: number } | null = null
              let touches: { x: number; t: number }[] = []
              if (fl) {
                const age = t - fl.at
                const i = Math.min(fl.f.path.length - 1, Math.floor(age * 60))
                const [x, y, tilt] = fl.f.path[i]
                stone = { x, y, tilt }
                touches = fl.f.touches
                  .filter((h) => h.t <= age)
                  .map((h) => ({ x: h.x, t: fl.at + h.t }))
                // a note for every skip, a little higher each time
                while (fl.heard < touches.length) {
                  const k = fl.heard++
                  if (n.sound && fl.f.touches[k].after > 0) {
                    const id = `skip-${k % 40}`
                    noteOn(id, 'bell', 76 + Math.min(k, 16))
                    notes.current.push(window.setTimeout(() => noteOff(id), 140))
                  }
                }
                if (i === fl.f.path.length - 1 && !landed.current) {
                  landed.current = true
                  finishRef.current(fl.f)
                }
                // the stone sinks out of sight a moment after it goes in
                if (landed.current && fl.f.end === 'sank' && age > fl.f.time + 0.4) stone = null
              }
              const tilt = hold.current === null ? 0 : wobble(seconds() - hold.current)
              if (gauge.current) gauge.current.style.transform = `rotate(${-tilt}deg)`
              const wide = canvas.width / v.scale()
              const camera = stone ? Math.max(-2, stone.x - wide * 0.3) : -2
              const a = aim(n.pull, n.angle)
              v.frame({
                time: t,
                camera,
                stone,
                aim:
                  !fl || landed.current ? { ...a, tilt: hold.current === null ? 12 : tilt } : null,
                course: n.course,
                buoy: n.buoy || null,
                touches,
              })
            },
            destroy: () => v.destroy(),
          }
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      />

      {live && (
        <>
          <div className="lab-controls">
            <label className="studio-pick">
              <span className="sr-only">Challenge</span>
              <select
                value={pick}
                onChange={(e) => {
                  setPick(e.target.value)
                  flight.current = null
                  setFlying(false)
                  setSaid(null)
                }}
              >
                <option value={FREE}>Free throw</option>
                {CHALLENGES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {saved.done.includes(c.id) ? '✓ ' : ''}
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn"
              data-hold="1"
              onPointerDown={(e) => {
                e.preventDefault()
                grab()
              }}
              onPointerUp={release}
              onPointerLeave={() => hold.current !== null && release()}
              aria-keyshortcuts="Space"
            >
              {flying ? '🪨 In the air…' : '🤚 Hold, let go to throw'}
            </button>
            <span className="skip-gauge" aria-hidden="true">
              <span className="skip-gauge-good" />
              <span className="skip-gauge-needle" ref={gauge} />
            </span>
            <button
              className="btn btn-ghost"
              aria-pressed={sound}
              onClick={() => setSound((s) => !s)}
            >
              {sound ? '🔊 Sound' : '🔇 Sound'}
            </button>
          </div>
          <div className="sun-sliders">
            <label>
              <span>Power {shown.speed.toFixed(0)} m/s</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={pull}
                onChange={(e) => setPull(Number(e.target.value))}
              />
            </label>
            <label>
              <span>Aim {shown.angle}°</span>
              <input
                type="range"
                min={ANGLES.min}
                max={ANGLES.max}
                step={1}
                value={angle}
                onChange={(e) => setAngle(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="sun-reading" aria-live="polite">
            {said ? (
              <strong>{said}</strong>
            ) : challenge ? (
              <>
                <strong>{challenge.name}.</strong> {challenge.hint}
              </>
            ) : (
              'Throw as many skips as you can.'
            )}{' '}
            <span className="muted">
              Best {saved.best} skips · furthest {saved.furthest} m · {saved.done.length} of{' '}
              {CHALLENGES.length} challenges
            </span>
          </p>
          <p className="muted lab-hint">
            Drag back on the water and let go — further back throws harder, and the direction aims
            it. The stone in your hand wobbles flat and steep every {WOBBLE} s: let go when it is
            tilted about {BEST_TILT}° (the green band) and it skips best. Or set power and aim with
            the sliders and hold the button or Space. Keys: ← → power, ↑ ↓ aim. A toy model after
            Clanet, Hersen &amp; Bocquet (2004), who found the 20° tilt; the rest is tuned, and the
            stone is drawn twice life size. Power runs {SPEEDS.min}–{SPEEDS.max} m/s.
          </p>
        </>
      )}
    </div>
  )
}
