import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { LabStage } from './LabStage'
import {
  readSaved,
  type Best,
  COLOURS,
  FILE_LIMIT,
  FOLD_KEY,
  MAX_FOLDS,
  PUZZLES,
  SOLVED,
  coverage,
  flatSheet,
  fold,
  onPaper,
  match,
  readFolds,
  replay,
  snap,
  toTable,
  type Folds,
  type Sheet,
  type V2,
} from './fold'
import { createFold, type FoldView } from './foldEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Mode = 'puzzle' | 'free'
/** the table: the sheet's middle at the middle, room round it for flaps folded outward */
const VIEW: [number, number] = [0.5, 0.5]
const SPAN = 2.2

/* what the toy keeps, read by the toy's module (so the share card reads it the same way) */
const load = () => {
  try {
    return readSaved(localStorage.getItem(FOLD_KEY))
  } catch {
    return readSaved(null)
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
const onTableAt = (e: PointerEvent<HTMLCanvasElement>): V2 => {
  const r = e.currentTarget.getBoundingClientRect()
  return toTable([r.width, r.height], VIEW, SPAN, [e.clientX - r.left, e.clientY - r.top])
}

export function FoldDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(load()).current
  const [live, setLive] = useState(false)
  const [mode, setMode] = useState<Mode>('puzzle')
  const [puzzle, setPuzzle] = useState(saved.puzzle)
  const [best, setBest] = useState<Best>(saved.best)
  const [colour, setColour] = useState(saved.colour)
  /** the folds made so far; the sheet is always the flat one folded by these */
  const [folds, setFolds] = useState<Folds>([])
  const [shown, setShown] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const sheet = useRef<Sheet>(flatSheet())
  const preview = useRef<Sheet | null>(null)
  const drag = useRef<{ from: V2; to: V2 } | null>(null)
  const engine = useRef<FoldView | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const p = PUZZLES[puzzle]
  const now = useRef({ colour })
  now.current = { colour }
  const target = useRef<{ name: string; cover: Uint8Array; sheet: Sheet } | null>(null)
  if (!target.current || target.current.name !== p.name) {
    const t = replay(p.folds) as Sheet
    target.current = { name: p.name, cover: coverage(t), sheet: t }
  }

  useEffect(() => {
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify({ puzzle, best, colour }))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [puzzle, best, colour])

  /* the sheet is the flat one folded by the folds made so far: worked out as the folds change, so the
     score shown is never a fold behind; the frame loop hands it to the GPU */
  const folded = useMemo(() => {
    const s = replay(folds)
    return typeof s === 'string' ? flatSheet() : s
  }, [folds])
  sheet.current = folded
  useEffect(() => {
    engine.current?.ghost(mode === 'puzzle' ? target.current!.sheet : null)
  }, [mode, puzzle])

  const cover = useMemo(() => coverage(folded), [folded])
  const score = mode === 'puzzle' ? match(cover, target.current.cover) : 0
  const solved = mode === 'puzzle' && folds.length > 0 && score >= SOLVED && folds.length <= p.limit

  useEffect(() => {
    if (!solved || shown) return
    setBest((b) => (b[p.name] && b[p.name] <= folds.length ? b : { ...b, [p.name]: folds.length }))
  }, [solved, shown, folds.length, p.name])

  const start = (k: number, m: Mode = mode) => {
    setPuzzle(k)
    setMode(m)
    setFolds([])
    setShown(false)
    setNote(null)
  }
  const undo = () => {
    setFolds((f) => f.slice(0, -1))
    setNote(null)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === 'u' || k === 'backspace') undo()
    else if (k === 'r') setFolds([])
    else return
    e.preventDefault()
  }

  const status =
    mode === 'free'
      ? `${folds.length} ${folds.length === 1 ? 'fold' : 'folds'} · ${sheet.current.layers.length} layers`
      : solved
        ? `✨ Folded in ${folds.length} (allowed ${p.limit})`
        : `${Math.round(score * 100)}% like it · ${folds.length}/${p.limit} folds`

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Fold">
      <LabStage
        label="A square of two-coloured paper on a cutting mat; pick up a point of it and lay it down to fold"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createFold(device, context, format, canvas)
          engine.current = v
          v.sheet(sheet.current)
          v.ghost(mode === 'puzzle' ? target.current!.sheet : null)
          let showing: Sheet | null = null
          return {
            frame: () => {
              // a fold being dragged is shown as it would be; let go and it is the sheet again
              const want = preview.current ?? sheet.current
              if (want !== showing) {
                showing = want
                v.sheet(want)
              }
              v.frame({ colour: now.current.colour, view: VIEW, span: SPAN })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const at = onTableAt(e)
          if (!onPaper(sheet.current, at)) return
          const from = snap(sheet.current, at)
          drag.current = { from, to: from }
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          d.to = snap(sheet.current, onTableAt(e))
          const r = fold(sheet.current, d.from, d.to)
          preview.current = typeof r === 'string' ? null : r
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          preview.current = null
          if (!d || Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]) < 0.02) return
          if (folds.length >= MAX_FOLDS)
            return setNote(`${MAX_FOLDS} folds is as many as this paper takes.`)
          const r = fold(sheet.current, d.from, d.to)
          if (typeof r === 'string') return setNote(r)
          setFolds((f) => [...f, [d.from[0], d.from[1], d.to[0], d.to[1]]])
          setNote(
            mode === 'puzzle' && folds.length + 1 > p.limit
              ? `This one allows ${p.limit} — ↶ Undo and try fewer.`
              : null,
          )
        }}
      />

      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Puzzles or free folding">
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'puzzle'}
              onClick={() => start(puzzle, 'puzzle')}
            >
              🧩 Puzzles
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'free'}
              onClick={() => start(puzzle, 'free')}
            >
              ✋ Free fold
            </button>
          </div>
          <span className="lab-score" aria-live="polite">
            {status}
          </span>
          {mode === 'puzzle' && (
            <label className="studio-pick">
              <span className="muted">Shape</span>
              <select value={puzzle} onChange={(e) => start(Number(e.target.value))}>
                {PUZZLES.map((q, k) => (
                  <option key={q.name} value={k}>
                    {k + 1}. {q.name}
                    {best[q.name] ? ` ✓ ${best[q.name]}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <button className="btn btn-ghost" onClick={undo} disabled={!folds.length}>
            ↶ Undo
          </button>
          <button className="btn btn-ghost" onClick={() => setFolds([])} disabled={!folds.length}>
            🔄 Unfold
          </button>
          {mode === 'puzzle' && solved && puzzle < PUZZLES.length - 1 && (
            <button className="btn" onClick={() => start(puzzle + 1)}>
              ⏭ Next shape
            </button>
          )}
          {mode === 'puzzle' && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setFolds(p.folds)
                setShown(true)
                setNote('One way to fold it. (Not kept as a best.)')
              }}
            >
              💡 Show how
            </button>
          )}
          <label className="studio-pick">
            <span className="muted">Paper</span>
            <select value={colour} onChange={(e) => setColour(Number(e.target.value))}>
              {COLOURS.map((c, k) => (
                <option key={c} value={k}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {mode === 'free' && (
            <>
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  const blob = await engine.current?.print({ colour, view: VIEW, span: SPAN })
                  if (blob) download(blob, 'fold.png')
                  else setNote('The picture could not be read back from the GPU.')
                }}
              >
                ⬇ Save picture
              </button>
              <button
                className="btn btn-ghost"
                disabled={!folds.length}
                onClick={() =>
                  download(
                    new Blob([JSON.stringify({ folds, colour })], { type: 'application/json' }),
                    'folds.json',
                  )
                }
              >
                ⬇ Save folds
              </button>
              <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                ⬆ Open folds…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  const r =
                    f.size <= FILE_LIMIT
                      ? readFolds(await f.text())
                      : 'That file is too big to be folds.'
                  if (typeof r === 'string') return setNote(r)
                  setFolds(r.folds)
                  setColour(r.colour)
                  setNote(`Opened ${f.name}.`)
                }}
              />
            </>
          )}
        </div>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <strong>{note} </strong>}
          {mode === 'puzzle' ? <>{p.hint} </> : null}
          Press on the paper, drag, and let go: the point you picked up is laid where you let go,
          and everything on its side turns over on top. Corners and the grid’s twelfths pull the
          point to them. U undoes, R unfolds.
          {mode === 'puzzle'
            ? ' Match the pale shape within the folds allowed.'
            : ' Make a shape, then keep it as a picture or as its folds.'}
        </p>
      )}
    </div>
  )
}
