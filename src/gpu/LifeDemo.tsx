import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { CELL_SIZES, PATTERNS, gridFor, toCell, type CellSize, type PatternId } from './life'
import { createLife, type Life, type LifeInput } from './lifeEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** Conway's Game of Life: a board of cells, each generation computed for every cell at once. */
export function LifeDemo({ running, setRunning, onAdapter }: Props) {
  const lifeRef = useRef<Life | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const gridRef = useRef({ cols: 0, rows: 0 })
  /** the same board, as state, for the sentence that names its size */
  const [grid, setGridShown] = useState({ cols: 0, rows: 0 })
  const showGrid = (g: { cols: number; rows: number }) => {
    gridRef.current = g
    setGridShown(g)
  }
  const [live, setLive] = useState(false)
  const [size, setSize] = useState<CellSize>('medium')
  const [speed, setSpeed] = useState(15)
  const [erase, setErase] = useState(false)
  /** a pattern to drop where you tap, or null to draw and erase by hand */
  const [stamp, setStamp] = useState<PatternId | null>(null)
  const stampRef = useRef(stamp)
  stampRef.current = stamp
  const sizeRef = useRef(size)
  sizeRef.current = size
  const runningRef = useRef(running)
  runningRef.current = running

  const input = useRef<LifeInput>({ brush: null, erase: false, speed: 15 })
  input.current.speed = speed
  input.current.erase = erase

  /** the board for the canvas as it is now, at the chosen cell size */
  const fitGrid = (canvas: HTMLCanvasElement, cell: CellSize) =>
    gridFor(canvas.clientWidth, canvas.clientHeight, CELL_SIZES[cell])

  /* a still board does not draw itself, so anything that changes it must */
  const redraw = () => {
    if (!runningRef.current) lifeRef.current?.frame(0, input.current)
  }

  useEffect(() => {
    const life = lifeRef.current
    const canvas = canvasRef.current
    if (!life || !canvas) return
    const g = fitGrid(canvas, size)
    showGrid(g)
    life.setGrid(g.cols, g.rows)
    redraw()
  }, [size])

  const cellAt = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const { cols, rows } = gridRef.current
    return toCell(e.clientX - r.left, e.clientY - r.top, r.width, r.height, cols, rows)
  }
  const press = (e: PointerEvent<HTMLCanvasElement>) => {
    input.current.brush = cellAt(e)
    redraw()
  }
  /* a stamp is a tap, not a stroke: one pattern where the finger lands, and a drag does nothing
     more — dragging a glider gun across the board would lay a wall of them */
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const id = stampRef.current
    if (!id) return press(e)
    const [x, y] = cellAt(e)
    lifeRef.current?.stamp(id, x, y)
    redraw()
  }
  const patternIds = Object.keys(PATTERNS) as PatternId[]

  const act = {
    toggle: () => setRunning((r) => !r),
    step: () => {
      lifeRef.current?.stepOnce()
      redraw()
    },
    random: () => {
      lifeRef.current?.randomize()
      redraw()
    },
    clear: () => {
      lifeRef.current?.clear()
      redraw()
    },
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // a key meant for a control inside (Space on a button) is that control's
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    switch (e.key.toLowerCase()) {
      case ' ':
        act.toggle()
        break
      case 'n':
      case 'arrowright':
        act.step()
        break
      case 'r':
        act.random()
        break
      case 'c':
        act.clear()
        break
      case 'e':
        setStamp(null)
        setErase((v) => !v)
        break
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        setStamp(patternIds[Number(e.key) - 1])
        break
      default:
        return
    }
    e.preventDefault()
  }

  return (
    /* the keys work once the board has focus — a click on it gives it focus */
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Game of Life board">
      <LabStage
        label="Conway's Game of Life: a grid of glowing cells that live, die and leave trails"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          canvasRef.current = canvas
          const g = fitGrid(canvas, sizeRef.current)
          showGrid(g)
          const life = await createLife(device, context, format, canvas, g.cols, g.rows)
          lifeRef.current = life
          return {
            frame: (dt) => life.frame(dt, input.current),
            /* a new shape is a new board: stretching the old one would make the cells oblongs */
            resize: () => {
              const n = fitGrid(canvas, sizeRef.current)
              if (n.cols === gridRef.current.cols && n.rows === gridRef.current.rows) return
              showGrid(n)
              life.setGrid(n.cols, n.rows)
            },
            destroy: () => {
              life.destroy()
              lifeRef.current = null
            },
          }
        }}
        onPointerDown={down}
        onPointerMove={(e) => {
          if (input.current.brush) press(e)
        }}
        onPointerUp={() => {
          input.current.brush = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={act.toggle} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" onClick={act.step} disabled={running}>
            Step
          </button>
          <button className="btn btn-ghost" onClick={act.random}>
            🎲 Random
          </button>
          <button className="btn btn-ghost" onClick={act.clear}>
            Clear
          </button>
          <div className="lab-group" role="group" aria-label="What a press does">
            <button
              className="btn btn-ghost"
              aria-pressed={!stamp && !erase}
              onClick={() => {
                setStamp(null)
                setErase(false)
              }}
            >
              Draw
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={!stamp && erase}
              onClick={() => {
                setStamp(null)
                setErase(true)
              }}
            >
              Erase
            </button>
          </div>
          <div className="lab-group" role="group" aria-label="Pattern to stamp">
            {patternIds.map((id) => (
              <button
                key={id}
                className="btn btn-ghost"
                aria-pressed={stamp === id}
                onClick={() => setStamp(id)}
              >
                {PATTERNS[id].name}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Cell size">
            {(Object.keys(CELL_SIZES) as CellSize[]).map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={size === s}
                onClick={() => setSize(s)}
              >
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <label className="appearance-slider lab-flow">
            <span className="muted">Speed</span>
            <input
              type="range"
              min={1}
              max={60}
              step={1}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{speed}/s</span>
          </label>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          {stamp
            ? `Tap to drop a ${PATTERNS[stamp].name.toLowerCase()}.`
            : erase
              ? 'Drag to wipe cells out.'
              : 'Drag to draw living cells.'}{' '}
          {grid.cols.toLocaleString()} × {grid.rows.toLocaleString()} cells.
          {/* a phone has no keys to press, so it is not told about them */}
          {!touchOnly() &&
            ' Keys, once the board has focus: Space runs or pauses, N steps, R scatters, C clears, E switches draw and erase, 1–5 pick a pattern.'}
        </p>
      )}
    </div>
  )
}
