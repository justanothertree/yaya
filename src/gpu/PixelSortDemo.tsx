import { useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  BY,
  LINE,
  SPANS,
  directionOf,
  paintScene,
  type By,
  type Direction,
  type Spans,
} from './pixelsort'
import { createPixelSort, type Dab, type PixelSortView } from './pixelsortEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const BY_IDS = Object.keys(BY) as By[]
const SPAN_IDS = Object.keys(SPANS) as Spans[]
/** stages of the network a frame: 55 in all, so a sort streams into place over about half a second */
const STAGES_PER_FRAME = 2
/** the brush, in photo pixels */
const BRUSH = 28

/**
 * A picture whose pixels you can sort. Swipe across it and every run of bright pixels under your
 * finger is sorted by brightness the way you swiped, so the picture melts into streaks.
 */
export function PixelSortDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [by, setBy] = useState<By>('light')
  const [spans, setSpans] = useState<Spans>('glitch')
  const [note, setNote] = useState<string | null>(null)
  const now = useRef({ by, spans })
  now.current = { by, spans }

  const engine = useRef<PixelSortView | null>(null)
  const dabs = useRef<Dab[]>([])
  const stroke = useRef<{ x0: number; y0: number; x: number; y: number } | null>(null)
  /** the picture being sorted, kept to start again from */
  const original = useRef<{ source: ImageBitmap | OffscreenCanvas; w: number; h: number } | null>(
    null,
  )
  const redraw = useRef<() => void>(() => {})

  const sortNow = (direction: Direction, all = false) => {
    const v = engine.current
    if (!v) return
    if (all) v.markAll()
    const [lo, hi] = SPANS[now.current.spans].range
    v.sort({ direction, lo, hi, by: now.current.by })
    if (!running) setRunning(true)
  }

  const startAgain = () => {
    const o = original.current
    if (!o) return
    engine.current?.load(o.source, o.w, o.h)
    redraw.current()
  }

  const choosePhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const probe = await createImageBitmap(file)
      /* fitted so its longer side is a sorting network's line, at most */
      const k = Math.min(1, LINE / Math.max(probe.width, probe.height))
      const w = Math.max(1, Math.round(probe.width * k))
      const h = Math.max(1, Math.round(probe.height * k))
      const bitmap = await createImageBitmap(file, { resizeWidth: w, resizeHeight: h })
      probe.close()
      original.current = { source: bitmap, w, h }
      startAgain()
      setNote(null)
    } catch {
      setNote('That file could not be read as a picture.')
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const arrows: Record<string, Direction> = {
      arrowright: 'right',
      arrowleft: 'left',
      arrowdown: 'down',
      arrowup: 'up',
    }
    if (k in arrows) sortNow(arrows[k], true)
    else if (k === 'o') startAgain()
    else if (/^[1-3]$/.test(k)) setBy(BY_IDS[Number(k) - 1])
    else if (k === 's') setSpans((s) => SPAN_IDS[(SPAN_IDS.indexOf(s) + 1) % SPAN_IDS.length])
    else return
    e.preventDefault()
  }

  /** a pointer's place in photo pixels, through the same fit the shader draws with */
  const toPhoto = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const [iw, ih] = engine.current?.image ?? [1, 1]
    const scale = Math.min(r.width / iw, r.height / ih)
    const ox = (r.width - iw * scale) / 2
    const oy = (r.height - ih * scale) / 2
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale, scale }
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Pixel sort">
      <LabStage
        label="A picture whose pixels melt into streaks where they are sorted"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const v = await createPixelSort(device, context, format)
          engine.current = v
          if (!original.current) {
            /* painted to the canvas's shape: a landscape letterboxed in a phone held upright is a
               strip a third of the screen tall */
            const upright = canvas.clientHeight > canvas.clientWidth
            const scene = upright ? paintScene(640, 960) : paintScene(960, 640)
            original.current = { source: scene, w: scene.width, h: scene.height }
          }
          v.load(original.current.source, original.current.w, original.current.h)
          const draw = (n: number) => {
            v.frame({ w: canvas.width, h: canvas.height, dabs: dabs.current, stages: n })
            dabs.current = []
          }
          redraw.current = () => draw(0)
          return {
            frame: (dt) => draw(dt > 0 ? STAGES_PER_FRAME : 0),
            destroy: () => {
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const p = toPhoto(e)
          stroke.current = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }
          dabs.current.push({ x: p.x, y: p.y, r: BRUSH })
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const s = stroke.current
          if (!s) return
          const p = toPhoto(e)
          /* a dab every few pixels of the way, so a quick swipe leaves no gaps */
          const steps = Math.max(1, Math.ceil(Math.hypot(e.clientX - s.x, e.clientY - s.y) / 6))
          const prev = toPhoto({
            ...e,
            clientX: s.x,
            clientY: s.y,
          } as PointerEvent<HTMLCanvasElement>)
          for (let k = 1; k <= steps; k++)
            dabs.current.push({
              x: prev.x + ((p.x - prev.x) * k) / steps,
              y: prev.y + ((p.y - prev.y) * k) / steps,
              r: BRUSH,
            })
          s.x = e.clientX
          s.y = e.clientY
        }}
        onPointerUp={() => {
          const s = stroke.current
          stroke.current = null
          if (!s) return
          /* the swipe says which way; a tap drips downwards */
          sortNow(directionOf(s.x - s.x0, s.y - s.y0) ?? 'down')
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => sortNow('down', true)}>
            ✨ Melt it all
          </button>
          <div className="lab-group" role="group" aria-label="Sort by">
            {BY_IDS.map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={by === b}
                onClick={() => setBy(b)}
              >
                {BY[b]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Which pixels are sorted">
            {SPAN_IDS.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={spans === s}
                onClick={() => setSpans(s)}
              >
                {SPANS[s].name}
              </button>
            ))}
          </div>
          <label className="btn btn-ghost">
            🖼 Your photo
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void choosePhoto(e)}
            />
          </label>
          <button className="btn btn-ghost" onClick={startAgain}>
            ↺ Start again
          </button>
          {note && <span className="muted">{note}</span>}
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Swipe across the picture and every run of pixels under your finger is sorted the way you
          swiped — brightest last — so it melts into streaks; a tap drips downwards. Only pixels in
          the chosen range are sorted — Glitch leaves the darkest and brightest where they are, so
          the picture holds together; Everything sorts every pixel. Each row is put in order by a
          sorting network on the GPU, 55 rounds of compare-and-swap, a couple a frame so you can see
          the pixels stream. Your photo never leaves this device.
          {!touchOnly() &&
            ' Keys, once it has focus: arrows melt it all that way, 1–3 sort by, S which pixels, O start again.'}
        </p>
      )}
    </div>
  )
}
