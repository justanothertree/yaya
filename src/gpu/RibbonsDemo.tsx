import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { createEar } from './ear'
import { LabStage } from './LabStage'
import { PALETTES, PALETTE_IDS, type Palette } from './palettes'
import { COUNTS, DANCES, DANCE_IDS, leadAt, orbit, type Dance } from './ribbons'
import { createRibbons, type RibbonsView } from './ribbonsEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const WIDTH = 0.07

/** each ribbon its own colour from the palette, spread round it so neighbours differ */
const coloursFor = (p: Palette) =>
  Array.from({ length: COUNTS[COUNTS.length - 1] }, (_, i) => PALETTES[p].at(i * 0.9 + 0.3))

/** Ribbons of light that dance by themselves — lead them with a finger, or let the music move them. */
export function RibbonsDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [dance, setDance] = useState<Dance>('loops')
  const [count, setCount] = useState<number>(12)
  const [palette, setPalette] = useState<Palette>('rainbow')
  const [listen, setListen] = useState(false)
  const now = useRef({ dance, count, listen })
  now.current = { dance, count, listen }
  const viewRef = useRef<RibbonsView | null>(null)

  const clock = useRef(0)
  const music = useRef({ pulse: 0, kick: 0 })
  /** the finger leading them, in pixels and the canvas's size — turned into a point each frame,
      because the camera keeps drifting and the same pixel means a new place */
  const finger = useRef<{ id: number; x: number; y: number; w: number; h: number } | null>(null)
  const pull = useRef(0)

  useEffect(() => viewRef.current?.paint(coloursFor(palette)), [palette])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'd') setDance((d) => DANCE_IDS[(DANCE_IDS.indexOf(d) + 1) % DANCE_IDS.length])
    else if (k === 'l') setListen((v) => !v)
    else if (/^[1-4]$/.test(k)) setPalette(PALETTE_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const place = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    finger.current = {
      id: e.pointerId,
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      w: r.width,
      h: r.height,
    }
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Ribbons">
      <LabStage
        label="Glowing ribbons of colour dancing through space by themselves"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const v = await createRibbons(device, context, format)
          viewRef.current = v
          v.paint(coloursFor(palette))
          const ear = createEar()
          return {
            frame: (dt) => {
              const n = now.current
              const aspect = canvas.width / Math.max(1, canvas.height)
              if (dt > 0) {
                /* listening: louder dances harder and wider, and every kick flares */
                const heard = n.listen ? ear.hear(dt) : null
                music.current = {
                  pulse: heard ? Math.min(1, heard.level * 2) : 0,
                  kick: heard?.hit ? 1 : music.current.kick * Math.exp(-dt * 5),
                }
                /* the music dances them faster as well as wider */
                clock.current += dt * (1 + music.current.pulse * 0.8)
                /* a lead eases in and out, so taking hold and letting go are both a swoop */
                pull.current += ((finger.current ? 1 : 0) - pull.current) * Math.min(1, dt * 4)
              }
              const cam = orbit(clock.current, aspect)
              const f = finger.current
              const at = f ? leadAt(cam, f.x, f.y, f.w, f.h) : [0, 0, 0]
              v.frame(dt, {
                cam,
                aspect,
                time: clock.current,
                lead: [at[0], at[1], at[2], pull.current],
                count: n.count,
                dance: n.dance,
                width: WIDTH,
                ...music.current,
              })
            },
            destroy: () => {
              v.destroy()
              viewRef.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          place(e)
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          if (finger.current?.id === e.pointerId) place(e)
        }}
        onPointerUp={(e) => {
          if (finger.current?.id === e.pointerId) finger.current = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={listen}
            onClick={() => setListen((l) => !l)}
          >
            🎵 Listen
          </button>
          <div className="lab-group" role="group" aria-label="Dance">
            {DANCE_IDS.map((d) => (
              <button
                key={d}
                className="btn btn-ghost"
                aria-pressed={dance === d}
                onClick={() => setDance(d)}
              >
                {DANCES[d]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="How many ribbons">
            {COUNTS.map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={count === n}
                onClick={() => setCount(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Colours">
            {PALETTE_IDS.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={palette === p}
                onClick={() => setPalette(p)}
              >
                {PALETTES[p].name}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          They dance by themselves — press and drag and they follow your finger, swirling round it,
          and drift back to their dance when you let go. 🎵 Listen moves them to whatever the site
          is playing.
          {!touchOnly() &&
            ' Keys, once it has focus: Space pauses, D next dance, L listen, 1–4 colours.'}
        </p>
      )}
    </div>
  )
}
