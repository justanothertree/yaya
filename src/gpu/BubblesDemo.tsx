import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { sharedCtx } from '../audio/context'
import { noteOff, noteOn } from '../audio/synth'
import { touchOnly } from '../ui/pointerKind'
import {
  MAX_BUBBLES,
  MAX_R,
  blow,
  flingOf,
  hit,
  popNote,
  stepBubbles,
  type Bubble,
} from './bubbles'
import { createBubbles } from './bubblesEngine'
import { LabStage } from './LabStage'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** Soap bubbles: hold a finger down to blow one, let go to send it off, tap one to pop it. */
export function BubblesDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [sound, setSound] = useState(true)
  const soundRef = useRef(sound)
  soundRef.current = sound
  const runningRef = useRef(running)
  runningRef.current = running

  const list = useRef<Bubble[]>([])
  const size = useRef<[number, number]>([1, 1])
  /** each finger: the bubble it is blowing (by seed), and where it has been lately, for the throw */
  const fingers = useRef(
    new Map<number, { seed: number; trail: { x: number; y: number; t: number }[] }>(),
  )
  const seeds = useRef(1)
  const clock = useRef(0)
  const pops = useRef(0)
  const redraw = useRef<() => void>(() => {})

  /** a burst sounds — small bubbles high, big ones low */
  const chime = (b: Bubble) => {
    if (!soundRef.current) return
    const id = `lab-bubble-${pops.current++}`
    const at = sharedCtx().currentTime
    noteOn(id, 'kalimba', popNote(b.r), at)
    noteOff(id, at + 1.2)
  }
  /** a bubble bursts: the film tears */
  const pop = (i: number) => {
    const b = list.current[i]
    if (!b || b.popping) return
    b.popping = 1e-6
    b.held = false
    chime(b)
  }
  const blowSome = () => {
    const [w, h] = size.current
    for (let k = 0; k < 6 && list.current.length < MAX_BUBBLES; k++) {
      const b = blow(w * (0.15 + 0.7 * Math.random()), h * 0.85, seeds.current++)
      b.held = false
      b.r = 20 + Math.random() * (Math.min(w, h) * 0.12)
      b.vx = (Math.random() - 0.5) * 120
      b.vy = -60 - Math.random() * 120
      list.current.push(b)
    }
    if (!runningRef.current) setRunning(true)
  }
  const popAll = () => list.current.forEach((_, i) => pop(i))

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'b') blowSome()
    else if (k === 'p') popAll()
    else if (k === 's') setSound((s) => !s)
    else return
    e.preventDefault()
  }

  const toCanvas = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = e.currentTarget.width / r.width
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, t: performance.now() }
  }
  const held = (id: number) => {
    const f = fingers.current.get(id)
    return f ? list.current.find((b) => b.seed === f.seed && b.held) : undefined
  }
  const release = (id: number) => {
    const f = fingers.current.get(id)
    const b = held(id)
    fingers.current.delete(id)
    if (!b || !f) return
    b.held = false
    const [vx, vy] = flingOf(f.trail)
    b.vx = vx
    b.vy = vy
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Bubbles">
      <LabStage
        label="Soap bubbles with swirling rainbow films, blown, floating and popping"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const view = await createBubbles(device, context, format, canvas)
          size.current = [canvas.width, canvas.height]
          /* it opens with a few bubbles already in the air, so it is never an empty dusk */
          if (!list.current.length) blowSome()
          const draw = () => view.draw(list.current, clock.current)
          redraw.current = () => {
            if (!runningRef.current) draw()
          }
          return {
            frame: (dt) => {
              size.current = [canvas.width, canvas.height]
              if (dt > 0) {
                clock.current += dt
                const before = new Set(list.current.filter((b) => !b.popping).map((b) => b.seed))
                list.current = stepBubbles(list.current, dt, canvas.width, canvas.height)
                /* a film that drained to nothing burst by itself: it sounds as well */
                for (const b of list.current) if (b.popping > 0 && before.has(b.seed)) chime(b)
                /* a bubble blown as big as it gets comes away from the wand by itself */
                for (const [id] of fingers.current) {
                  const b = held(id)
                  if (b && b.r >= MAX_R) release(id)
                }
              }
              draw()
            },
            resize: () => {
              size.current = [canvas.width, canvas.height]
            },
            destroy: () => {
              view.destroy()
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const p = toCanvas(e)
          const i = hit(list.current, p.x, p.y)
          if (i >= 0) {
            /* a tap on a bubble pops it */
            pop(i)
            redraw.current()
            return
          }
          if (list.current.length >= MAX_BUBBLES) return
          const b = blow(p.x, p.y, seeds.current++)
          list.current.push(b)
          fingers.current.set(e.pointerId, { seed: b.seed, trail: [p] })
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const f = fingers.current.get(e.pointerId)
          if (!f) return
          const p = toCanvas(e)
          /* the last tenth of a second of where the finger went: that is the throw */
          f.trail = [...f.trail, p].filter((q) => p.t - q.t < 100)
          const b = held(e.pointerId)
          if (b) {
            b.x = p.x
            b.y = p.y
          }
        }}
        onPointerUp={(e) => release(e.pointerId)}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" onClick={blowSome}>
            ✨ Blow some
          </button>
          <button className="btn btn-ghost" onClick={popAll}>
            💥 Pop them all
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((s) => !s)}
          >
            {sound ? '🔔 Sound on' : '🔕 Sound off'}
          </button>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Hold a finger down to blow a bubble — the longer, the bigger — and let go to send it off
          the way you were moving. Tap one to pop it. The colours are the light itself, reflecting
          off both sides of a soap film a few hundred nanometres thick; as it drains thinner the
          colours sweep through, and just before it bursts it turns clear and dark.
          {!touchOnly() && ' Keys: B blow some, P pop them all, S sound, Space pauses.'}
        </p>
      )}
    </div>
  )
}
