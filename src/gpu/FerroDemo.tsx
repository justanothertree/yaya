import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { readSpectrumAll } from '../audio/audioTap'
import { localMicOn, startLocalMic, stopLocalMic } from '../audio/localMic'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { MAX_MAGNETS, N, bass, ramp, type Magnet } from './ferro'
import { createFerro, type FerroView } from './ferroEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** a magnet under the dish: where it is, how strong now, and whether something still holds it */
type Held = Magnet & { held: boolean; to: [number, number] }
/** steps of the surface a frame, and each step's length */
const STEPS = 3
const DT = 0.3
/** the music's own magnet, in the middle of the dish */
const SPEAKER = 'speaker'
const SCRATCH = 16384

/**
 * A dish of ferrofluid. Press and hold under it and a magnet gathers: the black pool heaps up and
 * bristles into a field of spikes, more the longer you hold; let go and it settles flat. Fingers
 * are magnets, several at once; or let it dance to whatever is playing.
 */
export function FerroDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [most, setMost] = useState(1)
  const [dance, setDance] = useState(false)
  const [micOn, setMicOn] = useState(localMicOn)
  const [note, setNote] = useState<string | null>(null)
  const now = useRef({ most, dance, running })
  now.current = { most, dance, running }

  const engine = useRef<FerroView | null>(null)
  const magnets = useRef(new Map<string, Held>())
  /** where the keys' magnet is, in cells */
  const keyAt = useRef<[number, number]>([N / 2, N / 2])
  const redraw = useRef<() => void>(() => {})

  useEffect(
    () => () => {
      stopLocalMic()
    },
    [],
  )

  const toggleMic = async () => {
    if (localMicOn()) {
      stopLocalMic()
      setMicOn(false)
      return
    }
    const ok = await startLocalMic()
    setMicOn(ok)
    setNote(ok ? null : 'The microphone was not allowed, or there is not one.')
    if (ok) {
      setDance(true)
      if (!running) setRunning(true)
    }
  }

  const hold = (id: string, at: [number, number]) => {
    const m = magnets.current.get(id)
    if (m) {
      m.held = true
      m.to = at
      return
    }
    // a fifth finger takes the place of whichever magnet is weakest
    if (magnets.current.size >= MAX_MAGNETS) {
      const weakest = [...magnets.current.entries()].sort((a, b) => a[1].s - b[1].s)[0]
      magnets.current.delete(weakest[0])
    }
    magnets.current.set(id, { x: at[0], y: at[1], s: 0, held: true, to: at })
    if (!now.current.running) setRunning(true)
  }
  const letGo = (id: string) => {
    const m = magnets.current.get(id)
    if (m) m.held = false
  }

  const toCells = (e: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    const side = Math.min(r.width, r.height)
    return [
      ((e.clientX - r.left - (r.width - side) / 2) / side) * N,
      ((e.clientY - r.top - (r.height - side) / 2) / side) * N,
    ]
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const step: Record<string, [number, number]> = {
      arrowleft: [-12, 0],
      arrowright: [12, 0],
      arrowup: [0, -12],
      arrowdown: [0, 12],
    }
    if (k === ' ') {
      if (e.repeat) return e.preventDefault()
      if (down) hold('key', keyAt.current)
      else letGo('key')
    } else if (!down) return
    else if (k in step) {
      const [dx, dy] = step[k]
      keyAt.current = [
        Math.max(20, Math.min(N - 20, keyAt.current[0] + dx)),
        Math.max(20, Math.min(N - 20, keyAt.current[1] + dy)),
      ]
      const m = magnets.current.get('key')
      if (m) m.to = keyAt.current
    } else if (k === 'p') setRunning((r) => !r)
    else if (k === 'd') setDance((v) => !v)
    else if (k === 'c') engine.current?.calm()
    else return
    e.preventDefault()
  }

  return (
    <div
      className="lab-keys"
      tabIndex={0}
      onKeyDown={(e) => onKey(e, true)}
      onKeyUp={(e) => onKey(e, false)}
      aria-label="Ferrofluid"
    >
      <LabStage
        label="A dish of black ferrofluid that rises into a field of glossy spikes over a magnet"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const v = await createFerro(device, context, format, canvas)
          engine.current = v
          const bins = new Uint8Array(SCRATCH)
          const scratch = new Uint8Array(SCRATCH)
          let t = 0
          let beat = 0
          const draw = (dt: number) => {
            t += dt
            const ms = magnets.current
            /* the music's magnet: the bass, quick to rise and quicker to fall, so a kick drum
               stands the spikes up and the gap between knocks them down */
            if (now.current.dance) {
              const heard = readSpectrumAll(bins, scratch) ? bass(bins) : 0
              const want = Math.min(1.6, heard * 2.2) * now.current.most
              beat += (want - beat) * (1 - Math.exp(-(want > beat ? 25 : 8) * dt))
              ms.set(SPEAKER, { x: N / 2, y: N / 2, s: beat, held: true, to: [N / 2, N / 2] })
            } else ms.delete(SPEAKER)
            for (const [id, m] of ms) {
              if (id === SPEAKER) continue
              m.s = ramp(m.s, m.held, dt, now.current.most)
              // a magnet slides after the finger rather than jumping, as a real one under glass would
              const k = 1 - Math.exp(-12 * dt)
              m.x += (m.to[0] - m.x) * k
              m.y += (m.to[1] - m.y) * k
              if (!m.held && m.s < 0.01) ms.delete(id)
            }
            v.frame({
              magnets: [...ms.values()],
              steps: dt > 0 ? STEPS : 0,
              dt: DT,
              spike: [14, 3],
              light: [0.45 + Math.cos(t * 0.2) * 0.15, -0.55],
            })
          }
          redraw.current = () => {
            if (!now.current.running) draw(0)
          }
          return {
            frame: draw,
            destroy: () => {
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => hold(String(e.pointerId), toCells(e))}
        onPointerMove={(e) => {
          const m = magnets.current.get(String(e.pointerId))
          if (m?.held) m.to = toCells(e)
        }}
        /* LabStage sends a cancelled pointer here too, so a finger the browser takes still lets go */
        onPointerUp={(e) => letGo(String(e.pointerId))}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={dance}
            onClick={() => setDance((v) => !v)}
          >
            🎵 Dance to the music
          </button>
          <button className="btn btn-ghost" aria-pressed={micOn} onClick={() => void toggleMic()}>
            🎤 {micOn ? 'Mic on' : 'Mic'}
          </button>
          <label className="appearance-slider lab-flow">
            <span className="muted">Magnet</span>
            <input
              type="range"
              min={0.6}
              max={1.8}
              step={0.05}
              value={most}
              onChange={(e) => setMost(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{most < 1.25 ? 'spikes' : 'mazes'}</span>
          </label>
          <button
            className="btn btn-ghost"
            onClick={() => {
              engine.current?.calm()
              redraw.current()
            }}
          >
            Settle it
          </button>
        </div>
      )}

      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <>{note} </>}
          Press and hold on the dish: a magnet gathers underneath, the pool heaps toward it and
          bristles into spikes — more the longer you hold. Drag and the spikes follow; let go and
          they sink. Several fingers are several magnets. A stronger Magnet turns the hexagons of
          spikes into mazes, as real ferrofluid does. 🎵 Dance to the music puts a magnet under the
          middle that pulses with the bass of whatever is playing on the site (turn the mic on to
          use the room). The spikes are a pattern the surface chooses for itself: each frame the GPU
          takes the whole surface through a Fourier transform and back, three times.
          {!touchOnly() &&
            ' Keys, once it has focus: hold Space for a magnet, arrows move it, D dance, C settle, P pause.'}
        </p>
      )}
    </div>
  )
}
