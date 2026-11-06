import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { isTap } from './fluid'
import {
  DIVE_DOUBLING,
  DIVE_FLOOR,
  HOME,
  PALETTES,
  PALETTE_IDS,
  depthLabel,
  diveTarget,
  pan,
  pinch,
  zoomAt,
  type FractalPalette,
  type View,
} from './fractal'
import { createFractal } from './fractalEngine'
import { LabStage } from './LabStage'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Pt = readonly [number, number]

/** The Mandelbrot set and its Julia sets, to pinch into far past where a GPU's numbers give out. */
export function FractalDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [palette, setPalette] = useState<FractalPalette>('ember')
  const [julia, setJulia] = useState<readonly [number, number] | null>(null)
  const [morph, setMorph] = useState(false)
  const [diving, setDiving] = useState(false)
  const [depth, setDepth] = useState('×1')
  const state = useRef({ palette, julia, morph, diving })
  state.current = { palette, julia, morph, diving }
  const runningRef = useRef(running)
  runningRef.current = running

  const size = useRef<{ w: number; h: number }>({ w: 1, h: 1 })
  const view = useRef<View | null>(null)
  const home = useRef<View>({ cx: -0.6, cy: 0, scale: 0.01 })
  const clock = useRef({ time: 0, cycle: 0, target: null as Pt | null, nextTarget: 0 })
  const redraw = useRef<() => void>(() => {})
  const wrap = useRef<HTMLDivElement | null>(null)
  const fingers = useRef(new Map<number, { at: Pt; t0: number; from: Pt }>())
  const lastTap = useRef({ t: 0, at: [0, 0] as Pt })
  /** when the view last moved by hand: it counts as moving for a moment after, so a wheel's ticks stay light */
  const touched = useRef(0)

  const settle = useRef(0)
  const show = (v: View) => {
    view.current = v
    touched.current = performance.now()
    setDepth(depthLabel(home.current.scale / v.scale))
    redraw.current()
    /* a still picture drawn roughly while the hand moved gets its full detail once the hand stops —
       the running loop does that by itself; a paused one has to be asked */
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => redraw.current(), 250)
  }
  const goHome = () => {
    setDiving(false)
    const { w, h } = size.current
    home.current = julia ? { cx: 0, cy: 0, scale: 3.4 / Math.min(w, h) } : HOME(w, h)
    show(home.current)
  }
  const toJulia = () => {
    const { w, h } = size.current
    setDiving(false)
    if (julia) {
      setJulia(null)
      setMorph(false)
      home.current = HOME(w, h)
      show(home.current)
      return
    }
    /* the Julia set for the point you were looking at: the two are one map read two ways */
    const v = view.current ?? HOME(w, h)
    setJulia([v.cx, v.cy])
    home.current = { cx: 0, cy: 0, scale: 3.4 / Math.min(w, h) }
    show(home.current)
  }
  const dive = () => {
    if (diving) return setDiving(false)
    clock.current.nextTarget = 0
    setDiving(true)
    if (!running) setRunning(true)
  }
  useEffect(() => redraw.current(), [palette, julia])

  /* a wheel zooms where the pointer is; it must be able to refuse the page's own scroll */
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const c = el.querySelector('canvas')
      if (!c || e.target !== c || !view.current) return
      e.preventDefault()
      setDiving(false)
      const r = c.getBoundingClientRect()
      const k = c.width / r.width
      show(
        zoomAt(
          view.current,
          (e.clientX - r.left) * k,
          (e.clientY - r.top) * k,
          Math.exp(-e.deltaY * 0.002),
          c.width,
          c.height,
        ),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [live])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget || !view.current) return
    const k = e.key.toLowerCase()
    const { w, h } = size.current
    const step = Math.min(w, h) * 0.1
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'arrowleft') show(pan(view.current, step, 0))
    else if (k === 'arrowright') show(pan(view.current, -step, 0))
    else if (k === 'arrowup') show(pan(view.current, 0, step))
    else if (k === 'arrowdown') show(pan(view.current, 0, -step))
    else if (k === '+' || k === '=') show(zoomAt(view.current, w / 2, h / 2, 1.5, w, h))
    else if (k === '-') show(zoomAt(view.current, w / 2, h / 2, 1 / 1.5, w, h))
    else if (k === 'd') dive()
    else if (k === 'j') toJulia()
    else if (k === 'm' && julia) setMorph((m) => !m)
    else if (k === 'h') goHome()
    else if (/^[1-4]$/.test(k)) setPalette(PALETTE_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toCanvas = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = e.currentTarget.width / r.width
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]
  }

  return (
    <div ref={wrap} className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Fractal">
      <LabStage
        label="The Mandelbrot set, to pinch, drag and zoom into"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const fr = await createFractal(device, context, format, canvas)
          const draw = () => {
            const s = state.current
            const c = clock.current
            const { w, h } = { w: canvas.width, h: canvas.height }
            if (w !== size.current.w || h !== size.current.h || !view.current) {
              /* a new shape of canvas: keep what is in the middle, at the same width of plane */
              const old = view.current
              const was = size.current.w
              size.current = { w, h }
              home.current = s.julia ? { cx: 0, cy: 0, scale: 3.4 / Math.min(w, h) } : HOME(w, h)
              view.current = old ? { ...old, scale: (old.scale * was) / w } : home.current
            }
            /* morph: the Julia set's c wanders a small circle round where it was chosen */
            const jc =
              s.julia && s.morph
                ? ([
                    s.julia[0] + 0.012 * Math.cos(c.time * 0.5),
                    s.julia[1] + 0.012 * Math.sin(c.time * 0.7),
                  ] as const)
                : s.julia
            const moving =
              s.diving || fingers.current.size > 0 || performance.now() - touched.current < 200
            fr.frame({
              moving,
              view: view.current,
              julia: jc,
              palette: s.palette,
              time: c.time,
              cycle: c.cycle,
            })
          }
          /* a still picture is only drawn when something changes it */
          redraw.current = () => {
            if (!runningRef.current) draw()
          }
          return {
            frame: (dt) => {
              const c = clock.current
              const s = state.current
              if (dt > 0) {
                c.time += dt
                c.cycle += dt * 0.06
                if (s.diving && view.current) {
                  const { w, h } = size.current
                  /* a dive picks its own way down: every so often it looks for the edge again */
                  if (c.time >= c.nextTarget) {
                    c.target = diveTarget(view.current, w, h, s.julia)
                    c.nextTarget = c.time + 0.8
                  }
                  const v = view.current
                  const ease = 1 - Math.exp(-dt * 2.5)
                  const t = c.target ?? [v.cx, v.cy]
                  const next = {
                    cx: v.cx + (t[0] - v.cx) * ease,
                    cy: v.cy + (t[1] - v.cy) * ease,
                    scale: v.scale * Math.pow(2, -dt / DIVE_DOUBLING),
                  }
                  if (next.scale * Math.min(w, h) < DIVE_FLOOR) setDiving(false)
                  else {
                    view.current = next
                    setDepth(depthLabel(home.current.scale / next.scale))
                  }
                }
              }
              draw()
            },
            destroy: () => {
              fr.destroy()
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          setDiving(false)
          const p = toCanvas(e)
          fingers.current.set(e.pointerId, { at: p, from: p, t0: performance.now() })
        }}
        onPointerMove={(e) => {
          const f = fingers.current.get(e.pointerId)
          if (!f || !view.current) return
          const p = toCanvas(e)
          const { w, h } = size.current
          const others = [...fingers.current.entries()].filter(([id]) => id !== e.pointerId)
          if (others.length === 0) show(pan(view.current, p[0] - f.at[0], p[1] - f.at[1]))
          else {
            /* two fingers: this one moved, the other held still this event */
            const o = others[0][1].at
            show(pinch(view.current, f.at, o, p, o, w, h))
          }
          fingers.current.set(e.pointerId, { ...f, at: p })
        }}
        onPointerUp={(e) => {
          const f = fingers.current.get(e.pointerId)
          fingers.current.delete(e.pointerId)
          if (!f || !view.current) return
          const moved = Math.hypot(f.at[0] - f.from[0], f.at[1] - f.from[1])
          const now = performance.now()
          if (!isTap(moved, now - f.t0)) return
          /* a second tap close by, soon after the first: zoom in there */
          const last = lastTap.current
          if (now - last.t < 350 && Math.hypot(f.at[0] - last.at[0], f.at[1] - last.at[1]) < 40) {
            const { w, h } = size.current
            show(zoomAt(view.current, f.at[0], f.at[1], 2, w, h))
            lastTap.current = { t: 0, at: [0, 0] }
          } else lastTap.current = { t: now, at: f.at }
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <span className="lab-score" aria-label="How far in">
            {depth}
          </span>
          <button className="btn btn-ghost" aria-pressed={diving} onClick={dive}>
            {diving ? '⏹ Stop' : '✨ Dive'}
          </button>
          <button className="btn btn-ghost" onClick={goHome}>
            ⟲ All of it
          </button>
          <button className="btn btn-ghost" aria-pressed={!!julia} onClick={toJulia}>
            {julia ? '↩ Mandelbrot' : '◎ Julia from here'}
          </button>
          {julia && (
            <button
              className="btn btn-ghost"
              aria-pressed={morph}
              onClick={() => setMorph((m) => !m)}
            >
              〰 Morph
            </button>
          )}
          <div className="lab-group" role="group" aria-label="Colours">
            {PALETTE_IDS.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={palette === p}
                onClick={() => setPalette(p)}
              >
                {PALETTES[p]}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          {touchOnly()
            ? 'Drag to move, pinch to zoom, double-tap to zoom in. '
            : 'Drag to move, scroll to zoom, double-click to zoom in. '}
          ✨ Dive finds its own way down, always to the edge of the set where the detail is. ◎ Julia
          from here shows the Julia set of the point in the middle — every point of one map is a
          whole picture in the other. It keeps its detail a hundred million times deeper than the
          GPU&rsquo;s own numbers can reach, by working out one point exactly and every pixel as a
          difference from it.
          {!touchOnly() &&
            ' Keys: arrows move, + and − zoom, D dive, J Julia, M morph, H all of it, 1–4 colours.'}
        </p>
      )}
    </div>
  )
}
