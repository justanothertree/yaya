import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { COLOURS, COLOUR_IDS, TOOLS, gridFor, roseWindow, type ColourId, type Tool } from './glass'
import { createGlass, type GlassDab, type GlassView } from './glassEngine'
import { LabStage } from './LabStage'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type V2 = [number, number]
const TOOL_IDS = Object.keys(TOOLS) as Tool[]
/** how much of the canvas, from the bottom, is the floor */
const FLOOR = 0.35
type Orientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }
const canTilt = () => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window

/**
 * A stained-glass window you make: draw lead, tap panes to glaze them, and move the sun to throw
 * the window's colours across the floor.
 */
export function GlassDemo({ running, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [tool, setTool] = useState<Tool>('fill')
  const [colour, setColour] = useState<ColourId>('ruby')
  const [tilting, setTilting] = useState(false)
  const [tiltRefused, setTiltRefused] = useState(false)
  const now = useRef({ tool, colour })
  now.current = { tool, colour }

  const engine = useRef<GlassView | null>(null)
  const grid = useRef<V2>([320, 160])
  const sun = useRef<V2>([0.25, 0.6])
  const dabs = useRef<GlassDab[]>([])
  const tap = useRef<V2 | null>(null)
  const finger = useRef<V2 | null>(null)
  const redraw = useRef<() => void>(() => {})

  const load = (empty: boolean) => {
    const v = engine.current
    if (!v) return
    const [w, h] = grid.current
    if (empty) v.load([w, h], new Uint8Array(w * h), [])
    else {
      const rose = roseWindow(w, h)
      v.load(
        [w, h],
        rose.lead,
        rose.glazed.map(([x, y, k]) => [x, y, COLOURS[COLOUR_IDS[k]].rgb] as const),
      )
    }
    redraw.current()
  }

  /* tilting the phone moves the sun: across as you lean it, higher as you tip it back */
  useEffect(() => {
    if (!tilting) return
    let base: { beta: number; gamma: number; sun: V2 } | null = null
    const on = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return
      base ??= { beta: e.beta, gamma: e.gamma, sun: sun.current }
      sun.current = [
        Math.max(-1, Math.min(1, base.sun[0] + (e.gamma - base.gamma) / 40)),
        Math.max(0.05, Math.min(1, base.sun[1] - (e.beta - base.beta) / 50)),
      ]
      redraw.current()
    }
    window.addEventListener('deviceorientation', on)
    return () => window.removeEventListener('deviceorientation', on)
  }, [tilting])

  const toggleTilt = async () => {
    if (tilting) return setTilting(false)
    const O = DeviceOrientationEvent as Orientation
    const answer = O.requestPermission
      ? await O.requestPermission().catch(() => 'denied')
      : 'granted'
    setTiltRefused(answer !== 'granted')
    if (answer === 'granted') setTilting(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const s = sun.current
    if (k === 'arrowleft' || k === 'arrowright')
      sun.current = [Math.max(-1, Math.min(1, s[0] + (k === 'arrowleft' ? -0.1 : 0.1))), s[1]]
    else if (k === 'arrowup' || k === 'arrowdown')
      sun.current = [s[0], Math.max(0.05, Math.min(1, s[1] + (k === 'arrowup' ? 0.1 : -0.1)))]
    else if (k === 'r') load(false)
    else if (k === 'n') load(true)
    else if (/^[1-4]$/.test(k)) setTool(TOOL_IDS[Number(k) - 1])
    else if (k === 'c')
      setColour((c) => COLOUR_IDS[(COLOUR_IDS.indexOf(c) + 1) % COLOUR_IDS.length])
    else return
    redraw.current()
    e.preventDefault()
  }

  /** a pointer on the window, in cells — or null on the floor */
  const toCell = (e: PointerEvent<HTMLCanvasElement>): V2 | null => {
    const r = e.currentTarget.getBoundingClientRect()
    const u = (e.clientX - r.left) / r.width
    const v = (e.clientY - r.top) / r.height
    if (v >= 1 - FLOOR) return null
    return [u * grid.current[0], (v / (1 - FLOOR)) * grid.current[1]]
  }
  const sunFrom = (e: PointerEvent<HTMLCanvasElement>): V2 => {
    const r = e.currentTarget.getBoundingClientRect()
    const u = (e.clientX - r.left) / r.width
    const v = (e.clientY - r.top) / r.height
    return [
      Math.max(-1, Math.min(1, (u - 0.5) * 2.2)),
      Math.max(0.05, Math.min(1, 1 - v / (1 - FLOOR))),
    ]
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Stained glass">
      <LabStage
        label="A stained-glass window throwing coloured light across a stone floor"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const v = await createGlass(device, context, format)
          engine.current = v
          const fit = () => {
            const w = canvas.clientWidth || canvas.width
            const h = canvas.clientHeight || canvas.height
            grid.current = gridFor(w, h * (1 - FLOOR))
          }
          fit()
          load(false)
          const draw = () => {
            const t = tap.current
            v.frame(
              {
                w: canvas.width,
                h: canvas.height,
                grid: grid.current,
                sun: sun.current,
                brush: 1.6,
                floor: FLOOR,
              },
              dabs.current,
              t ? { at: t, colour: COLOURS[now.current.colour].rgb } : null,
            )
            dabs.current = dabs.current.slice(64)
            tap.current = null
          }
          redraw.current = draw
          return {
            frame: draw,
            resize: () => {
              fit()
              load(false)
            },
            destroy: () => {
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const t = now.current.tool
          if (t === 'sun') sun.current = sunFrom(e)
          const at = toCell(e)
          finger.current = at
          if (at && t === 'fill') tap.current = at
          if (at && (t === 'lead' || t === 'erase'))
            dabs.current.push({ x: at[0], y: at[1], lay: t === 'lead' })
          redraw.current()
        }}
        onPointerMove={(e) => {
          const t = now.current.tool
          if (!finger.current && t !== 'sun') return
          if (t === 'sun' && e.buttons) {
            sun.current = sunFrom(e)
            redraw.current()
            return
          }
          const at = toCell(e)
          const from = finger.current
          if (!at || !from || (t !== 'lead' && t !== 'erase')) return
          const steps = Math.max(1, Math.ceil(Math.hypot(at[0] - from[0], at[1] - from[1]) * 2))
          for (let k = 1; k <= steps; k++)
            dabs.current.push({
              x: from[0] + ((at[0] - from[0]) * k) / steps,
              y: from[1] + ((at[1] - from[1]) * k) / steps,
              lay: t === 'lead',
            })
          finger.current = at
          redraw.current()
        }}
        onPointerUp={() => {
          finger.current = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="What a finger does">
            {TOOL_IDS.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={tool === t}
                onClick={() => setTool(t)}
              >
                {TOOLS[t]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Glass colour">
            {COLOUR_IDS.map((c) => {
              const [r, g, b] = COLOURS[c].rgb.map((x) => Math.round(x * 255))
              return (
                <button
                  key={c}
                  className="btn btn-ghost"
                  aria-pressed={colour === c}
                  onClick={() => {
                    setColour(c)
                    setTool('fill')
                  }}
                  style={{ boxShadow: `inset 0 -5px 0 rgb(${r} ${g} ${b})` }}
                >
                  {COLOURS[c].name}
                </button>
              )
            })}
          </div>
          {touchOnly() && canTilt() && (
            <button
              className="btn btn-ghost"
              aria-pressed={tilting}
              onClick={() => void toggleTilt()}
            >
              📱 Tilt the sun
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => load(false)}>
            ✿ Rose window
          </button>
          <button className="btn btn-ghost" onClick={() => load(true)}>
            ▢ Empty frame
          </button>
          {tiltRefused && (
            <span className="muted">Tilt isn’t allowed here — drag with ☀️ Sun instead.</span>
          )}
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Draw lead across the window with ✏️ Lead, choose a colour and tap a pane to glaze it — the
          whole pane fills, whatever shape your lead made it, and nothing beyond it. Move the sun
          (☀️ Sun, {touchOnly() && canTilt() ? '📱 Tilt the sun, ' : ''}or the arrow keys) and the
          window's colours slide across the floor. Each pane is found on the GPU: every cell of
          glass passes the smallest name it has seen to its neighbours until the lead stops it.
          {!touchOnly() &&
            ' Keys, once it has focus: arrows move the sun, 1–4 tool, C colour, R rose, N empty.'}
        </p>
      )}
    </div>
  )
}
