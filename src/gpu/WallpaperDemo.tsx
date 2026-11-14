import { useEffect, useMemo, useRef, useState } from 'react'
import { LabStage } from './LabStage'
import {
  BACKGROUNDS,
  CELLS,
  GROUPS,
  MAX_KEPT,
  MAX_POINTS,
  MAX_STROKES,
  QUIZ_KEY,
  SWATCHES,
  WALLPAPER_KEY,
  answered,
  difference,
  paintCell,
  touched,
  question,
  readKept,
  readQuiz,
  rgb,
  toKept,
  toPlaneFromStage,
  type Drawing,
  type Group,
  type Stroke,
  type V2,
} from './wallpaper'
import { useKept } from './kept'
import { CELL, createWallpaper, encodePng, type WallpaperView } from './wallpaperEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const WIDTHS = [
  { label: 'Fine', w: 0.02 },
  { label: 'Medium', w: 0.045 },
  { label: 'Bold', w: 0.09 },
]
const SWATCH_NAMES = ['navy', 'red', 'orange', 'teal', 'violet', 'cream']
const BG_NAMES = ['Linen', 'Night', 'Cream']
const byId = (id: string) => GROUPS.find((g) => g.id === id) as Group

const readStore = () => {
  try {
    return readKept(localStorage.getItem(WALLPAPER_KEY))
  } catch {
    return []
  }
}
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function WallpaperDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [mode, setMode] = useState<'draw' | 'quiz'>('draw')
  const [drawing, setDrawing] = useState<Drawing>({ group: 'p4m', background: 0, strokes: [] })
  const [colour, setColour] = useState(1)
  const [width, setWidth] = useState(1)
  const [showCells, setShowCells] = useState(false)
  const [kept, setKept] = useState<Drawing[]>(readStore)
  const [note, setNote] = useState<string | null>(null)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [answer, setAnswer] = useState<{ guess: string; right: boolean } | null>(null)
  const [score, setScore] = useState({ right: 0, asked: 0, run: 0 })
  const [quizKept, setQuizKept] = useKept(QUIZ_KEY, readQuiz)
  const quiz = useMemo(() => question(seed), [seed])
  const shown = mode === 'quiz' ? quiz : drawing
  const g = byId(shown.group)

  const engine = useRef<WallpaperView | null>(null)
  const cell = useRef<OffscreenCanvas | null>(null)
  const stroke = useRef<Stroke | null>(null)
  const dirty = useRef<'all' | null>('all')
  /** how many points of the stroke being drawn are already in the cell */
  const painted = useRef(0)
  const now = useRef({ shown, showCells, g })
  now.current = { shown, showCells, g }

  useEffect(() => {
    try {
      localStorage.setItem(WALLPAPER_KEY, JSON.stringify(kept))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [kept])

  // a different picture or group: the whole cell is painted again
  useEffect(() => {
    dirty.current = 'all'
    engine.current?.group(g)
  }, [shown, g])

  const ctx2d = () => {
    if (!cell.current) cell.current = new OffscreenCanvas(CELL, CELL)
    return cell.current.getContext('2d', { willReadFrequently: true })
  }

  /** send what changed in the cell to the GPU: the whole cell after a change of picture or group;
   *  while drawing, only the newest piece of the stroke, and only the box of pixels it touched —
   *  the cell is four megabytes, and a stroke is a few hundred pointer moves */
  const upload = (v: WallpaperView) => {
    const c = ctx2d()
    if (!c) return
    const n = now.current
    if (dirty.current === 'all') {
      dirty.current = null
      painted.current = stroke.current?.points.length ?? 0
      paintCell(c, CELL, n.g.lattice, [
        ...n.shown.strokes,
        ...(stroke.current ? [stroke.current] : []),
      ])
      v.cell(c.getImageData(0, 0, CELL, CELL).data)
      return
    }
    const s = stroke.current
    if (!s || s.points.length <= painted.current) return
    // the new piece starts one point back, so it joins the piece before it
    const from = Math.max(0, painted.current - 1)
    painted.current = s.points.length
    paintCell(c, CELL, n.g.lattice, [s], { from })
    const box = touched(CELL, n.g.lattice, s, from)
    if (!box) return v.cell(c.getImageData(0, 0, CELL, CELL).data)
    v.cellRect(c.getImageData(...box).data, ...box)
  }

  const change = (next: Drawing) => {
    setDrawing(next)
    setNote(null)
  }
  const pick = (id: string) => {
    change({ ...drawing, group: id })
  }
  const motif = () => {
    const q = question(Math.floor(Math.random() * 1e9))
    change({ ...drawing, strokes: [...drawing.strokes, ...q.strokes].slice(-MAX_STROKES) })
  }
  const keep = () => {
    if (!drawing.strokes.length) return
    if (kept.length >= MAX_KEPT)
      return setNote(`That is ${MAX_KEPT} kept, the most: remove one to keep another.`)
    setKept([...kept, toKept(drawing)])
    setNote('Kept in this browser.')
  }
  /** the wall as a 1024-pixel PNG: drawn offscreen by the GPU and read back. ⚠️ A readback can fail
   *  (a GPU that was taken away), and a button that silently does nothing reads as broken — so it
   *  says so */
  const save = async () => {
    const v = engine.current
    if (!v) return
    const size = 1024
    try {
      const px = await v.snapshot(size, { cells: CELLS, paper: rgb(BACKGROUNDS[shown.background]) })
      download(await encodePng(px, size), `wallpaper-${shown.group}.png`)
      setNote(`Saved a ${size} × ${size} picture.`)
    } catch {
      setNote('The picture could not be made — the GPU did not answer. Try again in a moment.')
    }
  }

  const guess = (id: string) => {
    if (answer) return
    const right = id === quiz.group
    setAnswer({ guess: id, right })
    const run = right ? score.run + 1 : 0
    setScore((s) => ({ right: s.right + (right ? 1 : 0), asked: s.asked + 1, run }))
    setQuizKept((q) => answered(q, right, run))
  }
  const next = () => {
    setSeed(Math.floor(Math.random() * 1e9))
    setAnswer(null)
  }

  const truth = byId(quiz.group)
  return (
    <div className="lab-keys" tabIndex={-1} aria-label="Wallpaper">
      <LabStage
        label={
          mode === 'quiz'
            ? 'A repeating pattern: which of the seventeen wallpaper groups is it?'
            : `A repeating pattern in group ${g.name}: ${g.about}. ${drawing.strokes.length} strokes.`
        }
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createWallpaper(device, context, format, canvas)
          engine.current = v
          v.group(now.current.g)
          dirty.current = 'all'
          return {
            frame: () => {
              upload(v)
              const n = now.current
              v.frame({
                cells: CELLS,
                showCells: n.showCells,
                paper: rgb(BACKGROUNDS[n.shown.background]),
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          if (mode !== 'draw') return
          if (drawing.strokes.length >= MAX_STROKES)
            return setNote(
              `That is ${MAX_STROKES} strokes, the most — undo some, or keep this and clear.`,
            )
          const r = e.currentTarget.getBoundingClientRect()
          const p = toPlaneFromStage([r.width, r.height], [e.clientX - r.left, e.clientY - r.top])
          stroke.current = { colour, width: WIDTHS[width].w, points: [p] }
          painted.current = 0
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const s = stroke.current
          if (!s) return
          const r = e.currentTarget.getBoundingClientRect()
          const p: V2 = toPlaneFromStage(
            [r.width, r.height],
            [e.clientX - r.left, e.clientY - r.top],
          )
          const last = s.points[s.points.length - 1]
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.01 || s.points.length >= MAX_POINTS)
            return
          s.points.push(p)
        }}
        onPointerUp={() => {
          const s = stroke.current
          stroke.current = null
          if (!s) return
          change({ ...drawing, strokes: [...drawing.strokes, s] })
        }}
      />

      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Draw or guess">
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'draw'}
              onClick={() => {
                setMode('draw')
                setNote(null)
              }}
            >
              ✏️ Draw
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'quiz'}
              onClick={() => {
                setMode('quiz')
                setNote(null)
              }}
            >
              ❓ Which group?
            </button>
          </div>
          {mode === 'draw' && (
            <label className="studio-pick wall-pick">
              <span className="muted">Symmetry</span>
              <select value={drawing.group} onChange={(e) => pick(e.target.value)}>
                {GROUPS.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name} — {q.about}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="btn btn-ghost"
            aria-pressed={showCells}
            onClick={() => setShowCells((v) => !v)}
          >
            ▦ Cells
          </button>
        </div>
      )}
      {live && mode === 'draw' && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Ink colour">
            {SWATCHES.map((c, i) => (
              <button
                key={c}
                className="btn btn-ghost studio-swatch"
                style={{ background: c }}
                aria-pressed={colour === i}
                aria-label={SWATCH_NAMES[i]}
                onClick={() => setColour(i)}
              />
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Line width">
            {WIDTHS.map((w, i) => (
              <button
                key={w.label}
                className="btn btn-ghost"
                aria-pressed={width === i}
                onClick={() => setWidth(i)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <label className="studio-pick">
            <span className="muted">Paper</span>
            <select
              value={drawing.background}
              onChange={(e) => change({ ...drawing, background: Number(e.target.value) })}
            >
              {BG_NAMES.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {live && mode === 'draw' && (
        <div className="lab-controls">
          <button className="btn" onClick={motif}>
            🎲 Add a motif
          </button>
          <button
            className="btn btn-ghost"
            disabled={!drawing.strokes.length}
            onClick={() => change({ ...drawing, strokes: drawing.strokes.slice(0, -1) })}
          >
            ↶ Undo
          </button>
          <button
            className="btn btn-ghost"
            disabled={!drawing.strokes.length}
            onClick={() => change({ ...drawing, strokes: [] })}
          >
            🧹 Clear
          </button>
          <button className="btn btn-ghost" disabled={!drawing.strokes.length} onClick={keep}>
            ⭐ Keep
          </button>
          <button className="btn btn-ghost" onClick={() => void save()}>
            ⬇ Save as PNG
          </button>
          {kept.length > 0 && (
            <label className="studio-pick">
              <span className="muted">Kept</span>
              <select
                value=""
                onChange={(e) => {
                  const k = kept[Number(e.target.value)]
                  if (k) change(k)
                }}
              >
                <option value="">Open one…</option>
                {kept.map((k, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {k.group}, {k.strokes.length} strokes
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {live && mode === 'quiz' && (
        <div className="lab-controls wall-answers" role="group" aria-label="Your answer">
          {GROUPS.map((q) => (
            <button
              key={q.id}
              className="btn btn-ghost"
              aria-pressed={answer?.guess === q.id}
              data-right={answer && q.id === quiz.group ? true : undefined}
              disabled={!!answer}
              onClick={() => guess(q.id)}
            >
              {q.name}
            </button>
          ))}
          {answer && (
            <button className="btn" onClick={next}>
              Next pattern ›
            </button>
          )}
        </div>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {mode === 'quiz' && answer && (
            <strong>
              {answer.right
                ? `✓ Yes — ${truth.name}: ${truth.about}. `
                : `Not ${answer.guess}. ${difference(byId(answer.guess), truth)} It is ${truth.name}: ${truth.about}. `}
            </strong>
          )}
          {mode === 'quiz' && score.asked > 0 && `${score.right} of ${score.asked} right. `}
          {mode === 'quiz' &&
            quizKept.asked > score.asked &&
            `${quizKept.right} of ${quizKept.asked} in all${quizKept.bestRun > 1 ? `, best run ${quizKept.bestRun} in a row` : ''}. `}
          {note && <strong>{note} </strong>}
          {mode === 'draw'
            ? 'Draw anywhere: every stroke repeats across the wall by the group’s turns, mirrors and glides. Change the group and the same drawing becomes a different wallpaper. There are exactly seventeen ways a flat pattern can repeat — here are all of them.'
            : 'Find the smallest turn that brings the pattern back, then look for mirror lines, then glides — a mirror and a slide in one. ▦ Cells shows where one cell ends.'}
        </p>
      )}
    </div>
  )
}
