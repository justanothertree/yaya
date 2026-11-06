import { useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  MAX_HANDLES,
  MODES,
  boingNote,
  canvasToImage,
  paintFace,
  restUnder,
  springStep,
  type Handle,
  type Mode,
} from './squish'
import { createSquish, type SquishView } from './squishEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Pt = [number, number]
type Finger = { p: Pt; q: Pt; vel: Pt; t: number }
type Wobble = { p: Pt; x: Pt; v: Pt }
const MODE_IDS = Object.keys(MODES) as Mode[]
/** a tap this close to a pin (in picture pixels, at rest) takes the pin out */
const PIN_REACH = 30

/**
 * A picture made of jelly. Grab it anywhere, with as many fingers as you like, and it stretches
 * and turns between them; pin it down where it should stay; let go and it springs back, wobbling.
 */
export function SquishDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [tool, setTool] = useState<'squish' | 'pin'>('squish')
  const [mode, setMode] = useState<Mode>('rigid')
  const [sound, setSound] = useState(true)
  const [pinCount, setPinCount] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const now = useRef({ tool, mode, sound })
  now.current = { tool, mode, sound }

  const engine = useRef<SquishView | null>(null)
  const pins = useRef<Pt[]>([])
  const fingers = useRef(new Map<number, Finger>())
  const wobbles = useRef<Wobble[]>([])
  const picture = useRef<{ source: ImageBitmap | OffscreenCanvas; w: number; h: number } | null>(
    null,
  )
  const canvasSize = useRef<Pt>([1, 1])
  const redraw = useRef<() => void>(() => {})
  const notes = useRef(0)

  /** every handle as the shader takes them: pins first, then fingers, then the wobbling */
  const handles = (): Handle[] =>
    [
      ...pins.current.map((p) => ({ p, q: p })),
      ...[...fingers.current.values()].map((f) => ({ p: f.p, q: f.q })),
      ...wobbles.current.map((w) => ({ p: w.p, q: [w.p[0] + w.x[0], w.p[1] + w.x[1]] as Pt })),
    ].slice(0, MAX_HANDLES)

  const toImage = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    canvasSize.current = [r.width, r.height]
    return canvasToImage(
      e.clientX - r.left,
      e.clientY - r.top,
      [r.width, r.height],
      engine.current?.image ?? [1, 1],
    )
  }

  const boing = (stretch: number) => {
    if (!now.current.sound) return
    const id = `squish-${notes.current++}`
    noteOn(id, 'marimba', boingNote(stretch))
    window.setTimeout(() => noteOff(id), 400)
  }

  const unpin = () => {
    pins.current = []
    wobbles.current = []
    setPinCount(0)
    redraw.current()
  }

  const choosePhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const probe = await createImageBitmap(file)
      const k = Math.min(1, 1024 / Math.max(probe.width, probe.height))
      const w = Math.max(1, Math.round(probe.width * k))
      const h = Math.max(1, Math.round(probe.height * k))
      const bitmap = await createImageBitmap(file, { resizeWidth: w, resizeHeight: h })
      probe.close()
      picture.current = { source: bitmap, w, h }
      engine.current?.load(bitmap, w, h)
      unpin()
      setNote(null)
    } catch {
      setNote('That file could not be read as a picture.')
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === 'p') setTool((t) => (t === 'pin' ? 'squish' : 'pin'))
    else if (k === 'm') setMode((m) => MODE_IDS[(MODE_IDS.indexOf(m) + 1) % MODE_IDS.length])
    else if (k === 'u') unpin()
    else if (k === 'b') {
      /* a poke from the keyboard: the middle of the picture pulled down and let go */
      const [w, h] = engine.current?.image ?? [1, 1]
      wobbles.current.push({ p: [w / 2, h / 2], x: [0, h * 0.15], v: [0, 0] })
      boing(0.15)
      if (!running) setRunning(true)
    } else return
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Squish">
      <LabStage
        label="A jelly picture being stretched and pinned with fingers"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const v = await createSquish(device, context, format)
          engine.current = v
          if (!picture.current) {
            const upright = canvas.clientHeight > canvas.clientWidth
            const face = upright ? paintFace(600, 800) : paintFace(800, 600)
            picture.current = { source: face, w: face.width, h: face.height }
          }
          v.load(picture.current.source, picture.current.w, picture.current.h)
          const draw = () =>
            v.frame({
              w: canvas.width,
              h: canvas.height,
              handles: handles(),
              pins: pins.current.length,
              mode: now.current.mode,
            })
          redraw.current = draw
          return {
            frame: (dt) => {
              /* the let-go handles spring home on the exact spring, and are dropped once still */
              wobbles.current = wobbles.current
                .map((w) => {
                  const [x0, v0] = springStep(w.x[0], w.v[0], dt)
                  const [x1, v1] = springStep(w.x[1], w.v[1], dt)
                  return { p: w.p, x: [x0, x1] as Pt, v: [v0, v1] as Pt }
                })
                .filter((w) => Math.hypot(...w.x) > 0.2 || Math.hypot(...w.v) > 2)
              draw()
            },
            destroy: () => {
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const s = toImage(e)
          if (now.current.tool === 'pin') {
            const at = restUnder(s, handles(), now.current.mode)
            const near = pins.current.findIndex(
              (p) => Math.hypot(p[0] - at[0], p[1] - at[1]) < PIN_REACH,
            )
            if (near >= 0) pins.current.splice(near, 1)
            else if (pins.current.length < MAX_HANDLES - 4) pins.current.push(at)
            setPinCount(pins.current.length)
            redraw.current()
            return
          }
          /* take hold of whatever part of the jelly is under the finger, bent as it is */
          const p = restUnder(s, handles(), now.current.mode)
          fingers.current.set(e.pointerId, { p, q: s, vel: [0, 0], t: e.timeStamp })
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const f = fingers.current.get(e.pointerId)
          if (!f) return
          const s = toImage(e)
          const dt = Math.max(0.008, (e.timeStamp - f.t) / 1000)
          f.vel = [(s[0] - f.q[0]) / dt, (s[1] - f.q[1]) / dt]
          f.q = s
          f.t = e.timeStamp
        }}
        onPointerUp={(e) => {
          const f = fingers.current.get(e.pointerId)
          fingers.current.delete(e.pointerId)
          if (!f) return
          /* let go: it springs back from where it was held, as fast as the finger was moving */
          const x: Pt = [f.q[0] - f.p[0], f.q[1] - f.p[1]]
          const rested = e.timeStamp - f.t > 80
          wobbles.current.push({ p: f.p, x, v: rested ? [0, 0] : f.vel })
          const [w, h] = engine.current?.image ?? [1, 1]
          const stretch = Math.hypot(...x) / Math.hypot(w, h)
          if (stretch > 0.01) boing(stretch)
        }}
      />

      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="What a finger does">
            <button
              className="btn btn-ghost"
              aria-pressed={tool === 'squish'}
              onClick={() => setTool('squish')}
            >
              ✋ Squish
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={tool === 'pin'}
              onClick={() => setTool('pin')}
            >
              📌 Pin
            </button>
          </div>
          <div className="lab-group" role="group" aria-label="How it bends">
            {MODE_IDS.map((m) => (
              <button
                key={m}
                className="btn btn-ghost"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {MODES[m]}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={unpin} disabled={pinCount === 0}>
            ↺ Unpin all
          </button>
          <label className="btn btn-ghost">
            🖼 Your photo
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void choosePhoto(e)}
            />
          </label>
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((s) => !s)}
          >
            {sound ? '🔊 Sound on' : '🔇 Sound off'}
          </button>
          {note && <span className="muted">{note}</span>}
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Grab it anywhere and pull. Two fingers stretch and turn it between them; more, and it
          bends to all of them at once. 📌 Pin holds a spot still — tap a pin again to take it out —
          so you can pull one cheek while the other stays put. Let go and it springs back, wobbling.
          Rigid bends it like rubber, never shearing; Stretchy smears it like dough. Every point of
          the picture works out its own best move from the fingers and the pins, on the GPU, every
          frame. Your photo never leaves this device.
          {!touchOnly() &&
            ' With a mouse it is one finger; pins make that interesting. Keys, once it has focus: P pin, M bend, U unpin all, B boing.'}
        </p>
      )}
    </div>
  )
}
