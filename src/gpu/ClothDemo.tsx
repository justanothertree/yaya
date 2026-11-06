import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import {
  FABRICS,
  FABRIC_IDS,
  FINGERS,
  toWorld,
  type Fabric,
  type Finger,
  type Pins,
  type Tool,
} from './cloth'
import { createCloth, type ClothSim } from './clothEngine'
import { LabStage } from './LabStage'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const HANGINGS: Record<Pins, string> = { curtain: 'Curtain', pegs: 'On a line' }
const WIND = 0.7

/** A cloth to handle: grab it and pull, tear it, cut it, throw it. */
export function ClothDemo({ running, setRunning, onAdapter }: Props) {
  const simRef = useRef<ClothSim | null>(null)
  const [live, setLive] = useState(false)
  const [tool, setTool] = useState<Tool>('grab')
  const [pins, setPins] = useState<Pins>('curtain')
  const [wind, setWind] = useState(true)
  const [fabric, setFabric] = useState<Fabric>('silk')
  const input = useRef({ tool, wind: WIND, fabric })
  input.current = { tool, wind: wind ? WIND : 0, fabric }
  const pinsRef = useRef(pins)
  pinsRef.current = pins

  /** each finger, by its pointer: a slot the shader knows it by, and where it is and was */
  const fingers = useRef(new Map<number, Finger & { slot: number }>())

  const hang = (p: Pins) => {
    setPins(p)
    simRef.current?.hang(p)
    if (!running) setRunning(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'g') setTool('grab')
    else if (k === 'x') setTool('cut')
    else if (k === 'w') setWind((w) => !w)
    else if (k === 'h') hang(pinsRef.current === 'curtain' ? 'pegs' : 'curtain')
    else if (k === 'n') hang(pinsRef.current)
    else if (/^[1-4]$/.test(k)) setFabric(FABRIC_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return toWorld(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Cloth">
      <LabStage
        label="A hanging cloth that can be grabbed, pulled, torn and cut"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const sim = await createCloth(
            device,
            context,
            format,
            canvas,
            touchOnly(),
            pinsRef.current,
          )
          simRef.current = sim
          return {
            frame: (dt) => {
              const held = [...fingers.current.values()]
              const list: Finger[] = Array.from({ length: FINGERS }, (_, i) => {
                const f = held.find((h) => h.slot === i)
                return f ?? { at: [0, 0], was: [0, 0], down: false, pressed: false }
              })
              sim.frame(dt, { ...input.current, fingers: list })
              /* a frame that moved has seen every press and every stroke: start the next from here */
              if (dt > 0)
                for (const [id, f] of fingers.current)
                  if (f.down) fingers.current.set(id, { ...f, was: f.at, pressed: false })
                  else fingers.current.delete(id)
            },
            resize: () => sim.resize(),
            destroy: () => {
              sim.destroy()
              simRef.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const taken = new Set([...fingers.current.values()].map((f) => f.slot))
          const slot = [0, 1, 2, 3].find((s) => !taken.has(s))
          if (slot === undefined) return
          const at = point(e)
          fingers.current.set(e.pointerId, { slot, at, was: at, down: true, pressed: true })
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const f = fingers.current.get(e.pointerId)
          if (f?.down) fingers.current.set(e.pointerId, { ...f, at: point(e) })
        }}
        onPointerUp={(e) => {
          const f = fingers.current.get(e.pointerId)
          /* kept for one more frame, lifted, so the shader sees it let go */
          if (f) fingers.current.set(e.pointerId, { ...f, down: false })
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" onClick={() => hang(pins)}>
            🧵 New cloth
          </button>
          <div className="lab-group" role="group" aria-label="Tool">
            <button
              className="btn btn-ghost"
              aria-pressed={tool === 'grab'}
              onClick={() => setTool('grab')}
            >
              ✋ Grab
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={tool === 'cut'}
              onClick={() => setTool('cut')}
            >
              ✂️ Cut
            </button>
          </div>
          <div className="lab-group" role="group" aria-label="How it hangs">
            {(Object.keys(HANGINGS) as Pins[]).map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={pins === p}
                onClick={() => hang(p)}
              >
                {HANGINGS[p]}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" aria-pressed={wind} onClick={() => setWind((w) => !w)}>
            🌬 Breeze
          </button>
          <div className="lab-group" role="group" aria-label="Fabric">
            {FABRIC_IDS.map((f) => (
              <button
                key={f}
                className="btn btn-ghost"
                aria-pressed={fabric === f}
                onClick={() => setFabric(f)}
              >
                {FABRICS[f]}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          {tool === 'grab'
            ? 'Grab the cloth and pull — pull hard enough and it tears; let go mid-swing and it flies.'
            : 'Draw across the cloth to cut it; a piece cut free falls to the floor.'}{' '}
          {touchOnly()
            ? 'Several fingers can hold it at once.'
            : 'Keys, once it has focus: G grab, X cut, H hang it the other way, N new cloth, W breeze, 1–4 fabric.'}
        </p>
      )}
    </div>
  )
}
