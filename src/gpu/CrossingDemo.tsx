import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  COURSES,
  CROSSING_KEY,
  HULL,
  lampOf,
  mapSize,
  rocksNear,
  rowsFor,
  sail,
  setOff,
  toWorld,
  type Helm,
  type V2,
  type Voyage,
} from './crossing'
import { createCrossing, type CrossingView } from './crossingEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** how many units of the channel the stage's height shows */
const SPAN = 18
/** how fast the keeper's keys swing the beam and change its width, a second */
const SWING = 1.8
const WIDEN = 0.8

type Best = Record<string, number>
const load = (): { course: number; best: Best } => {
  try {
    const v = JSON.parse(localStorage.getItem(CROSSING_KEY) ?? 'null') as {
      course?: unknown
      best?: Record<string, unknown>
    } | null
    const course =
      typeof v?.course === 'number' &&
      Number.isInteger(v.course) &&
      v.course >= 0 &&
      v.course < COURSES.length
        ? v.course
        : 0
    const best: Best = {}
    for (const c of COURSES) {
      const t = v?.best?.[c.name]
      if (typeof t === 'number' && Number.isFinite(t) && t > 0) best[c.name] = t
    }
    return { course, best }
  } catch {
    return { course: 0, best: {} }
  }
}

type Keys = Helm & { beamLeft: boolean; beamRight: boolean; narrower: boolean; wider: boolean }
const NO_KEYS: Keys = {
  left: false,
  right: false,
  faster: false,
  slower: false,
  beamLeft: false,
  beamRight: false,
  narrower: false,
  wider: false,
}
/** the pilot's keys, then the keeper's: two people can share one keyboard */
const KEYMAP: Record<string, keyof Keys> = {
  a: 'left',
  d: 'right',
  w: 'faster',
  s: 'slower',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'faster',
  arrowdown: 'slower',
  j: 'beamLeft',
  l: 'beamRight',
  i: 'narrower',
  k: 'wider',
}

export function CrossingDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(load()).current
  const [live, setLive] = useState(false)
  const [courseIx, setCourseIx] = useState(saved.course)
  const course = COURSES[courseIx]
  const [best, setBest] = useState<Best>(saved.best)
  const [sound, setSound] = useState(true)
  const [width, setWidth] = useState(0.35)
  const [shown, setShown] = useState({ time: 0, hull: HULL, bells: 0, done: false, wrecked: false })
  const [sailing, setSailing] = useState(false)
  const voyage = useRef<Voyage>(setOff(course))
  const keys = useRef<Keys>({ ...NO_KEYS })
  /** the beam: an angle off the bow, or aimed at the world point under the keeper's pointer */
  const aim = useRef<{ off: number; pointer: V2 | null }>({ off: 0, pointer: null })
  const widthNow = useRef(width)
  widthNow.current = width
  /** the keeper's fingers on the water: while one is down the beam follows it */
  const fingers = useRef(new Set<number>())
  const engine = useRef<CrossingView | null>(null)
  const fresh = useRef(true)
  const voices = useRef(new Map<string, number>())
  const now = useRef({ course, sailing, sound })
  now.current = { course, sailing, sound }

  useEffect(() => {
    try {
      localStorage.setItem(CROSSING_KEY, JSON.stringify({ course: courseIx, best }))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [courseIx, best])

  /* sound stops when the toy goes: every note still ringing is let go and no timer outlives it */
  useEffect(
    () => () => {
      for (const [id, t] of voices.current) {
        window.clearTimeout(t)
        noteOff(id)
      }
      voices.current.clear()
    },
    [],
  )
  const play = (instrument: 'bell' | 'pluck', midi: number, ms: number, delay = 0) => {
    if (!now.current.sound) return
    const id = `crossing-${midi}-${performance.now()}-${delay}`
    voices.current.set(
      id,
      window.setTimeout(() => {
        noteOn(id, instrument, midi)
        voices.current.set(
          id,
          window.setTimeout(() => {
            noteOff(id)
            voices.current.delete(id)
          }, ms),
        )
      }, delay),
    )
  }

  const restart = (ix = courseIx) => {
    voyage.current = setOff(COURSES[ix])
    aim.current = { off: 0, pointer: null }
    fresh.current = true
    setCourseIx(ix)
    setSailing(false)
    setShown({ time: 0, hull: HULL, bells: 0, done: false, wrecked: false })
  }
  const castOff = () => {
    const v = voyage.current
    if (v.done || v.wrecked) restart()
    setSailing(true)
    if (!running) setRunning(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const what = KEYMAP[k]
    if (what) {
      keys.current[what] = down
      if (what.startsWith('beam')) aim.current.pointer = null
      // the pilot's first touch of the helm casts off
      const helm = what === 'left' || what === 'right' || what === 'faster' || what === 'slower'
      const v = voyage.current
      if (down && helm && !now.current.sailing && !v.done && !v.wrecked) castOff()
    } else if (!down) return
    else if (k === ' ' || k === 'enter') {
      if (now.current.sailing) setSailing(false)
      else castOff()
    } else if (k === 'r') restart()
    else return
    e.preventDefault()
  }

  const pad = (what: keyof Keys) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* a pointer the browser no longer tracks */
      }
      keys.current[what] = true
      if (!now.current.sailing) castOff()
    },
    onPointerUp: () => (keys.current[what] = false),
    onPointerCancel: () => (keys.current[what] = false),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  })

  /** the keeper's pointer: where on the stage, in CSS pixels, so the beam follows it as the camera moves */
  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    aim.current.pointer = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }

  const kept = best[course.name]
  const s = shown
  const status = s.done
    ? `⚓ Home in ${s.time.toFixed(1)} s with ${s.hull} of ${HULL} hull${s.bells ? `, ${s.bells} bells rung` : ''}.`
    : s.wrecked
      ? '💥 Wrecked on the rocks. Try again — the keeper has to look where the pilot is going.'
      : `${'♥'.repeat(s.hull)}${'♡'.repeat(HULL - s.hull)} · ${s.time.toFixed(1)} s · 🔔 ${s.bells}/${course.buoys.length}`
  return (
    <div
      className="lab-keys"
      tabIndex={0}
      onKeyDown={(e) => onKey(e, true)}
      onKeyUp={(e) => onKey(e, false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) keys.current = { ...NO_KEYS }
      }}
      aria-label="Night crossing"
    >
      <LabStage
        label="A small boat crossing a dark channel full of rocks, lit only by its own searchlight"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const v = await createCrossing(device, context, format, canvas)
          engine.current = v
          fresh.current = true
          let t = 0
          let rockAt = -1e9
          let beamWidth = widthNow.current
          return {
            frame: (dt: number) => {
              const c = now.current.course
              const vo = voyage.current
              const kk = keys.current
              if (fresh.current) {
                fresh.current = false
                v.start(mapSize(c))
                rockAt = -1e9
              }
              t += dt
              if (now.current.sailing && dt > 0) {
                const step = Math.min(dt, 0.05)
                sail(vo, c, kk, step)
                for (const ev of vo.events) {
                  if (ev === 'bell') play('bell', 79, 700)
                  else if (ev === 'hit') play('pluck', 38, 400)
                  else if (ev === 'home')
                    [0, 4, 7, 12].forEach((k, i) => play('bell', 72 + k, 500, i * 140))
                }
                if (
                  vo.events.length ||
                  Math.floor(vo.time * 10) !== Math.floor((vo.time - step) * 10)
                ) {
                  setShown({
                    time: vo.time,
                    hull: vo.hull,
                    bells: vo.rung.filter(Boolean).length,
                    done: vo.done,
                    wrecked: vo.wrecked,
                  })
                  if (vo.done) {
                    setSailing(false)
                    setBest((b) =>
                      b[c.name] && b[c.name] <= vo.time
                        ? b
                        : { ...b, [c.name]: +vo.time.toFixed(1) },
                    )
                  }
                  if (vo.wrecked) setSailing(false)
                }
              }
              const b = vo.boat
              // the keeper's keys swing the beam and change its width
              aim.current.off += ((kk.beamLeft ? 1 : 0) - (kk.beamRight ? 1 : 0)) * SWING * dt
              if (kk.narrower || kk.wider) {
                beamWidth = Math.max(
                  0,
                  Math.min(
                    1,
                    beamWidth + ((kk.wider ? 1 : 0) - (kk.narrower ? 1 : 0)) * WIDEN * dt,
                  ),
                )
                setWidth(beamWidth)
              } else beamWidth = widthNow.current
              const cam: V2 = [6, b.y + SPAN * 0.22]
              const lamp = lampOf(b)
              let angle = b.heading + aim.current.off
              const ptr = aim.current.pointer
              if (ptr) {
                const w = toWorld([canvas.width, canvas.height], cam, SPAN, [
                  ptr[0] * canvas.width,
                  ptr[1] * canvas.height,
                ])
                angle = Math.atan2(w[1] - lamp[1], w[0] - lamp[0])
                aim.current.off = angle - b.heading
              }
              // the rocks near the boat, sent again only when it has moved on a little
              if (Math.abs(b.y - rockAt) > 2) {
                rockAt = b.y
                v.rocks(rocksNear(c, b.y))
              }
              v.buoys(c.buoys.map((at, k) => ({ at, rung: vo.rung[k] })))
              v.frame({
                map: mapSize(c),
                cam,
                span: SPAN,
                beam: { at: lamp, angle, width: beamWidth },
                boat: b,
                shaken: vo.shaken,
                rows: rowsFor(c, b.y),
                time: t,
                length: c.length,
                dt: Math.max(dt, 1e-3),
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return point(e)
          fingers.current.add(e.pointerId)
          point(e)
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse' || fingers.current.has(e.pointerId)) point(e)
        }}
        onPointerUp={(e) => {
          // a finger lifted leaves the beam where it was, turning with the bow from now on
          if (fingers.current.delete(e.pointerId)) aim.current.pointer = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <span className="lab-score" aria-live="polite">
            {status}
          </span>
          <button className="btn" onClick={() => (sailing ? setSailing(false) : castOff())}>
            {sailing ? '⏸ Heave to' : s.done || s.wrecked ? '⛵ Again' : '⛵ Cast off'}
          </button>
          <label className="studio-pick">
            <span className="muted">Crossing</span>
            <select value={courseIx} onChange={(e) => restart(Number(e.target.value))}>
              {COURSES.map((c, k) => (
                <option key={c.name} value={k}>
                  {c.name}
                  {best[c.name] ? ` ✓ ${best[c.name]} s` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((v) => !v)}
          >
            {sound ? '🔔 Sound' : '🔕 Muted'}
          </button>
        </div>
      )}
      {live && (
        <div className="lab-controls crossing-helm" role="group" aria-label="The pilot’s helm">
          <button className="btn pinball-pad" {...pad('left')}>
            ◀ Port
          </button>
          <button className="btn pinball-pad" {...pad('faster')}>
            ⏫ Full ahead
          </button>
          <button className="btn pinball-pad" {...pad('slower')}>
            ⏬ Slow
          </button>
          <button className="btn pinball-pad" {...pad('right')}>
            Starboard ▶
          </button>
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <label className="appearance-slider lab-flow">
            <span className="muted">Beam</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={width}
              aria-label="The beam: narrow and far, or wide and near"
              onChange={(e) => setWidth(Number(e.target.value))}
            />
            <span className="appearance-slider-val">
              {width < 0.34 ? 'far' : width > 0.66 ? 'wide' : 'even'}
            </span>
          </label>
        </div>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {kept && <>Your best here: {kept} s. </>}
          Two jobs. The <strong>pilot</strong> steers — ←/→ or A/D, ↑/W full ahead, ↓/S slow, or the
          helm buttons. The <strong>keeper</strong> aims the searchlight — with the mouse, a finger
          on the water, or J/L — and sets the beam: narrow reaches far, wide sees round you (I/K, or
          the slider). Only what the beam lights can be seen, and a rock stays dimly remembered for
          a moment after. Ring the buoys on the way; three knocks and the boat is lost. Space casts
          off or heaves to, R starts again. One person can do both: a hand on the keys, a hand on
          the mouse.
        </p>
      )}
    </div>
  )
}
