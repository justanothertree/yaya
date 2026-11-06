import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { gridFor, toCell } from './life'
import { PRESETS, ratesAt, type Preset } from './rd'
import { createRD, type RDInput, type ReactionDiffusion } from './rdEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** the colourings, in the order of `ramp` in rd-draw.wgsl */
const PALETTES = ['Coral', 'Ink', 'Neon', 'Moss'] as const
/** CSS px a cell: fine enough to look organic, coarse enough that a phone keeps up */
const CELL = 2.5

/** Two chemicals reacting on a grid, growing coral, cells, worms or mazes — seed it and watch. */
export function GrowthDemo({ running, setRunning, onAdapter }: Props) {
  const rdRef = useRef<ReactionDiffusion | null>(null)
  const [live, setLive] = useState(false)
  const [preset, setPreset] = useState<Preset | 'picked'>('coral')
  const [picked, setPicked] = useState(PRESETS.coral as { feed: number; kill: number })
  const [map, setMap] = useState(false)
  const [erase, setErase] = useState(false)
  const [palette, setPalette] = useState(0)
  const [speed, setSpeed] = useState(16)
  const runningRef = useRef(running)
  runningRef.current = running
  const mapRef = useRef(map)
  mapRef.current = map

  const rates = preset === 'picked' ? picked : PRESETS[preset]
  const input = useRef<RDInput>({ feed: 0, kill: 0, map: false, palette: 0, steps: 16, dabs: [] })
  const i = input.current
  i.feed = rates.feed
  i.kill = rates.kill
  i.map = map
  i.palette = palette
  i.steps = speed
  const eraseRef = useRef(erase)
  eraseRef.current = erase
  const held = useRef(new Set<number>())

  /* a still dish does not draw itself, so a dab while paused must */
  const now = () => {
    if (!runningRef.current) rdRef.current?.frame(false, i)
  }
  const dab = (e: PointerEvent<HTMLCanvasElement>) => {
    const rd = rdRef.current
    if (!rd) return
    const r = e.currentTarget.getBoundingClientRect()
    const [x, y] = toCell(
      e.clientX - r.left,
      e.clientY - r.top,
      r.width,
      r.height,
      rd.grid.cols,
      rd.grid.rows,
    )
    i.dabs.push({ x, y, r: eraseRef.current ? 6 : 3, seed: !eraseRef.current })
    now()
  }

  const choose = (p: Preset) => {
    setPreset(p)
    setMap(false)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const presets = Object.keys(PRESETS) as Preset[]
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'm') setMap((v) => !v)
    else if (k === 'e') setErase((v) => !v)
    else if (k === 'r') rdRef.current?.reseed()
    else if (/^[1-5]$/.test(k)) choose(presets[Number(k) - 1])
    else return
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Growth">
      <LabStage
        label="Two chemicals reacting on a grid, growing into coral, dividing cells, worms or a maze"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const g = gridFor(canvas.clientWidth, canvas.clientHeight, CELL)
          const rd = await createRD(device, context, format, canvas, g.cols, g.rows)
          rdRef.current = rd
          return {
            frame: (dt) => rd.frame(dt > 0, i),
            destroy: () => {
              rd.destroy()
              rdRef.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          /* on the map, a tap is a question — what grows HERE? — and the answer becomes the dish */
          if (mapRef.current) {
            const r = e.currentTarget.getBoundingClientRect()
            setPicked(ratesAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height))
            setPreset('picked')
            setMap(false)
            rdRef.current?.reseed()
            return
          }
          held.current.add(e.pointerId)
          dab(e)
        }}
        onPointerMove={(e) => {
          if (held.current.has(e.pointerId)) dab(e)
        }}
        onPointerUp={(e) => {
          held.current.delete(e.pointerId)
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" onClick={() => rdRef.current?.reseed()}>
            🌱 Reseed
          </button>
          <button className="btn btn-ghost" aria-pressed={map} onClick={() => setMap((v) => !v)}>
            🗺 Map
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={erase}
            onClick={() => setErase((v) => !v)}
          >
            Erase
          </button>
          <div className="lab-group" role="group" aria-label="Pattern">
            {(Object.keys(PRESETS) as Preset[]).map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={!map && preset === p}
                onClick={() => choose(p)}
              >
                {PRESETS[p].name}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Colour">
            {PALETTES.map((name, k) => (
              <button
                key={name}
                className="btn btn-ghost"
                aria-pressed={palette === k}
                onClick={() => {
                  setPalette(k)
                  i.palette = k
                  now()
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <label className="appearance-slider lab-flow">
            <span className="muted">Speed</span>
            <input
              type="range"
              min={2}
              max={48}
              step={1}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{speed}×</span>
          </label>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          {map
            ? 'The map: feed rises to the right and kill rises downward, so every pattern grows somewhere on it. Tap one to grow it on its own.'
            : erase
              ? 'Drag to wipe the growth back to bare dish.'
              : 'Drag to seed it, and watch what grows.'}{' '}
          {preset === 'picked' &&
            !map &&
            `Picked from the map: feed ${picked.feed.toFixed(4)}, kill ${picked.kill.toFixed(4)}. `}
          Two chemicals, {speed} steps a frame, every cell at once.
          {!touchOnly() &&
            ' Keys, once it has focus: Space pauses, 1–5 pick a pattern, M the map, E erase, R reseed.'}
        </p>
      )}
    </div>
  )
}
