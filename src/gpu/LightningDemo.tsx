import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { sharedCtx } from '../audio/context'
import { volume } from '../audio/mixer'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { SHAPES, gridFor, type Shape } from './lightning'
import { createLightning, type LightningView } from './lightningEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Cell = readonly [number, number]
const SHAPE_IDS = Object.keys(SHAPES) as Shape[]
/** a bolt that has not found the ground after this many cells gives up and fades */
const GIVE_UP = 4000
const MAX_RODS = 6

/**
 * Thunder, made rather than played: a crack of filtered noise, then a long low rumble that rolls
 * as it fades — louder and longer for a nearer, brighter strike. Through the site's shared audio
 * context, at the instrument channel's volume.
 */
function thunder() {
  const ctx = sharedCtx()
  void ctx.resume()
  const at = ctx.currentTime + 0.12
  const seconds = 3.6
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  /* brown-ish noise: each sample a little of a new random one, so the rumble is deep */
  let last = 0
  for (let i = 0; i < data.length; i++) {
    last = last * 0.97 + (Math.random() * 2 - 1) * 0.3
    data[i] = last
  }
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const low = ctx.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.setValueAtTime(1800, at)
  low.frequency.exponentialRampToValueAtTime(140, at + 0.5)
  low.frequency.exponentialRampToValueAtTime(70, at + seconds)
  const gain = ctx.createGain()
  const loud = 1.4 * volume('instrument')
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(loud, at + 0.015)
  gain.gain.exponentialRampToValueAtTime(loud * 0.35, at + 0.3)
  /* the roll: it swells again a few times as it dies away */
  for (let k = 1; k <= 4; k++) {
    const t = at + 0.3 + k * 0.55 + Math.random() * 0.2
    gain.gain.linearRampToValueAtTime(loud * (0.45 - k * 0.08), t)
  }
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds)
  source.connect(low).connect(gain).connect(ctx.destination)
  source.start(at)
  source.stop(at + seconds)
}

/**
 * A night sky that lightning strikes. Tap to call a bolt; plant lightning rods and watch the
 * leader find them; turn the storm on and it strikes by itself.
 */
export function LightningDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [shape, setShape] = useState<Shape>('forked')
  const [storm, setStorm] = useState(false)
  const [sound, setSound] = useState(true)
  const [rodCount, setRodCount] = useState(0)
  const now = useRef({ shape, storm, sound })
  now.current = { shape, storm, sound }

  const engine = useRef<LightningView | null>(null)
  const grid = useRef<Cell>([192, 128])
  const rods = useRef<Cell[]>([])
  /** the bolt's life: growing → flash → fading → idle */
  const bolt = useRef({ phase: 'idle' as 'idle' | 'growing' | 'flash' | 'fading', t: 0, wait: 1 })
  const redraw = useRef<() => void>(() => {})

  const rodCells = () =>
    rods.current.flatMap(([x, y]) => {
      /* a rod is a mast from where it was planted down to the ground */
      const cells: Cell[] = []
      for (let yy = y; yy < grid.current[1] - 1; yy++) cells.push([x, yy])
      return cells
    })

  const strike = () => {
    engine.current?.reset(grid.current, rodCells())
    bolt.current = { phase: 'growing', t: 0, wait: 0 }
    if (!running) setRunning(true)
  }

  const clearRods = () => {
    rods.current = []
    setRodCount(0)
  }

  /* the storm's first bolt comes at once */
  useEffect(() => {
    if (storm && bolt.current.phase === 'idle') bolt.current.wait = 0.2
  }, [storm])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ' || k === 'enter') strike()
    else if (k === 's') setStorm((s) => !s)
    else if (k === 'c') clearRods()
    else if (/^[1-3]$/.test(k)) setShape(SHAPE_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toCell = (e: PointerEvent<HTMLCanvasElement>): Cell => {
    const r = e.currentTarget.getBoundingClientRect()
    const [gw, gh] = grid.current
    return [
      Math.min(gw - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * gw))),
      Math.min(gh - 2, Math.max(4, Math.floor(((e.clientY - r.top) / r.height) * gh))),
    ]
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Lightning">
      <LabStage
        label="A night sky with lightning branching down from the clouds to the ground"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const v = await createLightning(device, context, format)
          engine.current = v
          grid.current = gridFor(
            canvas.clientWidth || canvas.width,
            canvas.clientHeight || canvas.height,
          )
          v.reset(grid.current, rodCells())
          bolt.current = { phase: 'growing', t: 0, wait: 0 }
          let alive = true
          const draw = (dt: number) => {
            const b = bolt.current
            b.t += dt
            let flash = 0
            let fade = 1
            let steps = 0
            if (b.phase === 'growing') {
              steps = dt > 0 ? SHAPES[now.current.shape][2] : 0
              void v.status().then((s) => {
                if (!alive || !s || bolt.current !== b || b.phase !== 'growing') return
                if (s.arrived) {
                  b.phase = 'flash'
                  b.t = 0
                  if (now.current.sound) thunder()
                } else if (s.steps > GIVE_UP) {
                  b.phase = 'fading'
                  b.t = 0
                }
              })
            } else if (b.phase === 'flash') {
              /* the return stroke, and the re-strikes down the same channel that make it flicker */
              flash = Math.max(
                Math.exp(-b.t / 0.08),
                0.7 * Math.exp(-Math.max(0, b.t - 0.18) / 0.06) * (b.t > 0.18 ? 1 : 0),
              )
              if (b.t > 0.6) {
                b.phase = 'fading'
                b.t = 0
              }
            } else if (b.phase === 'fading') {
              fade = Math.max(0, 1 - b.t / 1.4)
              if (fade === 0) {
                b.phase = 'idle'
                b.t = 0
                b.wait = 1 + Math.random() * 3
              }
            } else {
              fade = 0
              if (now.current.storm && b.t > b.wait) strike()
            }
            v.frame(
              {
                w: canvas.width,
                h: canvas.height,
                grid: grid.current,
                eta: SHAPES[now.current.shape][1],
                flash,
                fade,
                rods: rods.current.length,
              },
              steps,
            )
          }
          redraw.current = () => draw(0)
          return {
            frame: draw,
            resize: () => {
              grid.current = gridFor(
                canvas.clientWidth || canvas.width,
                canvas.clientHeight || canvas.height,
              )
              rods.current = []
              setRodCount(0)
              strike()
            },
            destroy: () => {
              alive = false
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          /* a tap plants a lightning rod there — a mast down to the ground — and calls a bolt */
          if (rods.current.length >= MAX_RODS) rods.current.shift()
          rods.current.push(toCell(e))
          setRodCount(rods.current.length)
          strike()
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={strike}>
            ⚡ Strike
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={storm}
            onClick={() => {
              setStorm((s) => !s)
              if (!running) setRunning(true)
            }}
          >
            ⛈ Storm
          </button>
          <div className="lab-group" role="group" aria-label="Shape of the bolt">
            {SHAPE_IDS.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={shape === s}
                onClick={() => setShape(s)}
              >
                {SHAPES[s][0]}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={clearRods} disabled={rodCount === 0}>
            Clear rods
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((s) => !s)}
          >
            {sound ? '🔊 Thunder' : '🔇 Thunder'}
          </button>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Tap the sky to plant a lightning rod there and call a bolt: the leader feels its way down
          from the cloud, branching, and when one branch touches the ground or a rod the path it
          took blazes — the return stroke — and the thunder follows. Nothing is drawn: the air holds
          an electric field, worked out afresh on the GPU after every step, and each step the next
          piece of air to break down is picked at random, more likely where the field is strongest.
          Wild branches everywhere; Straight runs for the ground.
          {!touchOnly() &&
            ' Keys, once it has focus: Space strikes, S storm, C clear rods, 1–3 shape.'}
        </p>
      )}
    </div>
  )
}
