import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  CROSS,
  EMPTY_SAVED,
  FILL,
  GHOST_CROSS,
  GHOST_FILL,
  LEVELS,
  MAX_KEPT,
  NONOGRAM_KEY,
  OPEN,
  WRONG,
  better,
  cellAt,
  cellNear,
  cluesOf,
  depth,
  drag,
  fitSized,
  fromCode,
  hint,
  judge,
  keep,
  linesDone,
  marksFromText,
  marksToText,
  pack,
  press,
  readSaved,
  solved,
  toCode,
  type Clues,
  type Hint,
  type Picture,
  type Saved,
  type Stroke,
  type Verdict,
} from './nonogram'
import { createNonogram, type NonogramView } from './nonogramEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Puzzle = {
  /** a level's name, or a made picture's code — what its progress is kept under */
  id: string
  name: string
  picture: Picture
  colours: Uint32Array
  paper: number
  level: number | null
}

/** a made picture has no colours of its own: one ink, revealed on cream */
const MADE_INK = 0x3557c8
const MADE_PAPER = 0xf6efdc
const SIDES = [5, 10, 15, 20] as const
const MAX_UNDO = 200
const IDLE = 120_000

const ofLevel = (i: number): Puzzle => {
  const l = LEVELS[i]
  return { id: l.name, name: l.name, picture: l.picture, colours: l.colours, paper: l.paper, level: i } // prettier-ignore
}
const ofCode = (name: string, code: string): Puzzle | null => {
  const p = fromCode(code)
  if (!p) return null
  const colours = Uint32Array.from(p.cells, (v) => (v ? MADE_INK : MADE_PAPER))
  return { id: code.trim(), name, picture: p, colours, paper: MADE_PAPER, level: null }
}
const clock = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(NONOGRAM_KEY))
  } catch {
    return { ...EMPTY_SAVED }
  }
}

/** what the maker says about a drawing, in a sentence */
function verdictText(v: Verdict | null) {
  if (!v) return ''
  switch (v.kind) {
    case 'empty':
      return 'Draw a picture: every filled square becomes part of the puzzle.'
    case 'logic':
      return '✓ A fair puzzle: it has one answer, and it can be solved a line at a time.'
    case 'guess':
      return `One answer, but solving it a line at a time gets stuck — the ${v.stuck.length} striped squares need a guess. Change something near them to make it fair.`
    case 'many':
      return `Not fair yet: more than one picture has these numbers. The ${v.open.length} striped squares could go either way — fill or clear one of them.`
    case 'unknown':
      return 'Too intricate to check quickly. It may well be fine, but the maker cannot promise.'
  }
}

export function NonogramDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<'play' | 'make'>('play')
  const [puzzle, setPuzzle] = useState<Puzzle>(() => {
    const s = load()
    const first = LEVELS.findIndex((l) => !s.solved[l.name])
    return ofLevel(Math.max(0, first))
  })
  const [tool, setTool] = useState<typeof FILL | typeof CROSS>(FILL)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [shown, setShown] = useState<Hint | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sound, setSound] = useState(true)
  const [ver, setVer] = useState(0)
  const [removing, setRemoving] = useState(false)
  // the maker
  const [mw, setMw] = useState(10)
  const [mh, setMh] = useState(10)
  const [name, setName] = useState('')
  const [codeText, setCodeText] = useState('')
  const [verdict, setVerdict] = useState<Verdict | null>(null)

  const marks = useRef<Uint8Array>(new Uint8Array(puzzle.picture.w * puzzle.picture.h))
  const drawing = useRef<Uint8Array>(new Uint8Array(mw * mh))
  const elapsed = useRef(0)
  const hints = useRef(0)
  const solvedAt = useRef<number | null>(null)
  const time = useRef(0)
  const stroke = useRef<Stroke | null>(null)
  const undo = useRef<{ mode: 'play' | 'make'; data: Uint8Array }[]>([])
  const engine = useRef<NonogramView | null>(null)
  const timers = useRef<number[]>([])

  useEffect(() => {
    try {
      localStorage.setItem(NONOGRAM_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  // the maker's drawing comes back as it was left
  useEffect(() => {
    const d = saved.draft ? fromCode(saved.draft) : null
    if (d) {
      setMw(d.w)
      setMh(d.h)
      drawing.current = Uint8Array.from(d.cells)
      setVerdict(judge(d))
    } else setVerdict({ kind: 'empty' })
    // once, on opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t)
      for (const m of [67, 72, 76, 79]) noteOff(`nono-${m}`)
    },
    [],
  )

  const clues = useMemo(() => cluesOf(puzzle.picture), [puzzle])
  const madePicture = (): Picture => ({ w: mw, h: mh, cells: drawing.current })
  // the maker's numbers follow the drawing as it changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const madeClues = useMemo(() => cluesOf(madePicture()), [mw, mh, ver])

  /** open a puzzle where it was left — marks, clock and hints — or fresh */
  const open = (p: Puzzle) => {
    const n = p.picture.w * p.picture.h
    const prog = saved.progress[p.id]
    marks.current = marksFromText(prog?.m, n)
    elapsed.current = prog?.ms ?? 0
    hints.current = prog?.hints ?? 0
    solvedAt.current = solved(cluesOf(p.picture), p.picture.w, p.picture.h, marks.current)
      ? -99
      : null
    undo.current = undo.current.filter((u) => u.mode !== 'play')
    stroke.current = null
    lastMark.current = null
    setPuzzle(p)
    setShown(null)
    setNote(null)
    setRemoving(false)
    setCursor(null)
    setMode('play')
    setVer((v) => v + 1)
  }
  // the first puzzle's saved marks, once
  useEffect(() => {
    open(puzzle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remember = (extra?: Partial<Saved>) =>
    setSaved((s) => {
      const keepIds = new Set([
        ...LEVELS.map((l) => l.name),
        ...s.kept.map((k) => k.code),
        puzzle.id,
      ])
      const progress: Saved['progress'] = {}
      for (const [id, p] of Object.entries(s.progress)) if (keepIds.has(id)) progress[id] = p
      if (marks.current.some((m) => m !== 0))
        progress[puzzle.id] = {
          m: marksToText(marks.current),
          ms: Math.round(elapsed.current),
          hints: hints.current,
        }
      else delete progress[puzzle.id]
      return { ...s, progress, ...extra }
    })

  const chime = () => {
    if (!sound) return
    ;[67, 72, 76, 79].forEach((m, i) => {
      const id = `nono-${m}`
      timers.current.push(
        window.setTimeout(() => noteOn(id, 'bell', m), i * 110),
        window.setTimeout(() => noteOff(id), i * 110 + 900),
      )
    })
  }

  /** after any change to the marks: done yet? */
  const settle = () => {
    const p = puzzle.picture
    setVer((v) => v + 1)
    if (solvedAt.current === null && solved(clues, p.w, p.h, marks.current)) {
      solvedAt.current = time.current
      setShown(null)
      const ms = Math.round(elapsed.current)
      setSaved((s) =>
        better(s.solved[puzzle.id], ms, hints.current)
          ? { ...s, solved: { ...s.solved, [puzzle.id]: { ms, hints: hints.current } } }
          : s,
      )
      setNote(
        `✨ Solved — ${puzzle.name.toLowerCase().startsWith('untitled') ? 'your picture' : puzzle.name}! ${clock(ms)}, ${hints.current ? `${hints.current} hint${hints.current === 1 ? '' : 's'}` : 'no hints'}.`,
      )
      chime()
    } else if (solvedAt.current !== null && !solved(clues, p.w, p.h, marks.current)) {
      solvedAt.current = null // undone after solving: the reveal goes, the record stays
    }
    remember()
  }

  /** the clock: wall time between one mark and the next, a gap of more than two minutes counted
   *  as two — so stepping away does not count, and nothing depends on frames being drawn */
  const lastMark = useRef<number | null>(null)
  const tick = () => {
    const t = performance.now()
    if (lastMark.current !== null) elapsed.current += Math.min(t - lastMark.current, IDLE)
    lastMark.current = t
  }

  const snapshot = () => {
    const data = mode === 'play' ? marks.current : drawing.current
    undo.current.push({ mode, data: Uint8Array.from(data) })
    if (undo.current.length > MAX_UNDO) undo.current.shift()
  }
  const doUndo = () => {
    for (let k = undo.current.length - 1; k >= 0; k--) {
      if (undo.current[k].mode !== mode) continue
      const [u] = undo.current.splice(k, 1)
      if (mode === 'play') {
        marks.current = u.data
        setShown(null)
        settle()
      } else {
        drawing.current = u.data
        afterDraw()
      }
      return
    }
  }

  const afterDraw = () => {
    setVer((v) => v + 1)
    const p = madePicture()
    setVerdict(judge(p))
    setSaved((s) => ({ ...s, draft: p.cells.some((v) => v === 1) ? toCode(p) : null }))
  }

  /* ── pressing and dragging, on the stage or from the keyboard */
  const begin = (at: [number, number], t = tool) => {
    if (mode === 'play' && solvedAt.current !== null) return
    snapshot()
    const target = mode === 'play' ? marks.current : drawing.current
    const w = mode === 'play' ? puzzle.picture.w : mw
    // the maker only fills and clears: a cross means nothing in a drawing
    stroke.current = press(target, w, at, mode === 'play' ? t : FILL, mode === 'play')
    setShown(null)
    setVer((v) => v + 1)
    if (!running) setRunning(true)
  }
  const extend = (at: [number, number]) => {
    const s = stroke.current
    if (!s) return
    const target = mode === 'play' ? marks.current : drawing.current
    drag(target, mode === 'play' ? puzzle.picture.w : mw, s, at)
    setVer((v) => v + 1)
  }
  const end = () => {
    if (!stroke.current) return
    stroke.current = null
    if (mode === 'play') {
      tick()
      settle()
    } else afterDraw()
  }

  const w = mode === 'play' ? puzzle.picture.w : mw
  const h = mode === 'play' ? puzzle.picture.h : mh
  const c: Clues = mode === 'play' ? clues : madeClues
  /* ⚠️ THE MAKER RESERVES ROOM FOR THE MOST NUMBERS A LINE CAN HOLD. Fitted to the drawing's own
     numbers, the grid moved whenever a stroke added a run to a row — the margin widened and every
     square slid sideways under the finger, mid-drawing. In play the numbers never change. */
  const room = mode === 'play' ? depth(c) : { left: Math.ceil(w / 2), top: Math.ceil(h / 2) }
  const isSolved = mode === 'play' && solvedAt.current !== null
  const done = linesDone(c, w, h, mode === 'play' ? marks.current : new Uint8Array(w * h))

  /* ── what the GPU is given: rebuilt whenever anything it shows has changed */
  const sendBoard = (v: NonogramView) => {
    const n = w * h
    const flags = new Uint8Array(n)
    let colours: ArrayLike<number> = puzzle.colours
    let m: Uint8Array = marks.current
    if (mode === 'play') {
      if (shown?.kind === 'wrong') for (const i of shown.cells) flags[i] = WRONG
      if (shown?.kind === 'line' || shown?.kind === 'cell')
        shown.cells.forEach((i, k) => (flags[i] = shown.values[k] ? GHOST_FILL : GHOST_CROSS))
      // a filled cell that is not in the picture (another answer with the same numbers) is inked
      colours = Uint32Array.from(puzzle.colours, (col, i) =>
        puzzle.picture.cells[i] ? col : MADE_INK,
      )
    } else {
      m = Uint8Array.from(drawing.current, (d) => (d ? FILL : 0))
      if (verdict?.kind === 'many') for (const i of verdict.open) flags[i] = OPEN
      if (verdict?.kind === 'guess') for (const i of verdict.stuck) flags[i] = OPEN
      colours = new Uint32Array(n)
    }
    const d = room
    const lineFlags = mode === 'play'
      ? { rows: done.rows.map(Number), cols: done.cols.map(Number) }
      : { rows: [], cols: [] } // prettier-ignore
    v.board({
      packed: pack(w, h, c, m, flags, colours, lineFlags),
      w,
      h,
      left: d.left,
      top: d.top,
      paper: mode === 'play' ? puzzle.paper : MADE_PAPER,
    })
  }
  const now = useRef({ sendBoard, mode, cursor, shown })
  now.current = { sendBoard, mode, cursor, shown }
  useEffect(() => {
    if (engine.current) sendBoard(engine.current)
  })

  /* ── the keyboard: arrows move, Space fills, X crosses, Shift+arrows carry the last action on */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    if (arrows[k]) {
      const [dx, dy] = arrows[k]
      const from = cursor ?? [0, 0]
      const to: [number, number] = cursor
        ? [Math.max(0, Math.min(w - 1, from[0] + dx)), Math.max(0, Math.min(h - 1, from[1] + dy))]
        : [0, 0]
      setCursor(to)
      if (e.shiftKey && stroke.current) extend(to)
      else if (stroke.current) end()
    } else if ((k === ' ' || k === 'Enter') && !e.ctrlKey) {
      const at = cursor ?? [0, 0]
      setCursor(at)
      end()
      begin(at, FILL)
      if (!e.shiftKey) end()
    } else if (k.toLowerCase() === 'x' && !e.ctrlKey && mode === 'play') {
      const at = cursor ?? [0, 0]
      setCursor(at)
      end()
      begin(at, CROSS)
      if (!e.shiftKey) end()
    } else if (k.toLowerCase() === 'z' || (k.toLowerCase() === 'u' && !e.ctrlKey)) doUndo()
    else if (k.toLowerCase() === 'h' && !e.ctrlKey && mode === 'play') takeHint()
    else if (k.toLowerCase() === 't' && !e.ctrlKey && mode === 'play')
      setTool((t) => (t === FILL ? CROSS : FILL))
    else return
    e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Shift') end()
  }

  const takeHint = () => {
    if (isSolved) return
    const got = hint(clues, puzzle.picture, marks.current)
    if (got.kind === 'none') return
    tick()
    hints.current++
    setShown(got)
    if (got.kind === 'line') setCursor(null)
    remember()
    if (!running) setRunning(true)
  }

  const restart = () => {
    snapshot()
    marks.current = new Uint8Array(w * h)
    solvedAt.current = null
    elapsed.current = 0
    hints.current = 0
    lastMark.current = null
    setShown(null)
    setNote(null)
    settle()
  }

  /* ── the list of puzzles: the built-in ones, then yours, then one opened from a code */
  const kept = saved.kept
  const choose = (value: string) => {
    if (value.startsWith('L:')) open(ofLevel(Number(value.slice(2))))
    else {
      const k = kept[Number(value.slice(2))]
      const p = k && ofCode(k.name, k.code)
      if (p) open(p)
    }
  }
  const choice =
    puzzle.level !== null
      ? `L:${puzzle.level}`
      : kept.findIndex((k) => k.code === puzzle.id) >= 0
        ? `K:${kept.findIndex((k) => k.code === puzzle.id)}`
        : 'C'
  const step = (by: number) => {
    const all = [...LEVELS.map((_, i) => `L:${i}`), ...kept.map((_, i) => `K:${i}`)]
    const at = all.indexOf(choice)
    const next = all[at + by]
    if (next) choose(next)
  }

  /* ── the maker */
  const resize = (nw: number, nh: number) => {
    snapshot()
    const old = drawing.current
    const next = new Uint8Array(nw * nh)
    for (let y = 0; y < Math.min(mh, nh); y++)
      for (let x = 0; x < Math.min(mw, nw); x++) next[y * nw + x] = old[y * mw + x]
    drawing.current = next
    setMw(nw)
    setMh(nh)
    const p = { w: nw, h: nh, cells: next }
    setVerdict(judge(p))
    setSaved((s) => ({ ...s, draft: next.some((v) => v === 1) ? toCode(p) : null }))
    setVer((v) => v + 1)
  }
  const madeCode = verdict && verdict.kind !== 'empty' ? toCode(madePicture()) : ''
  const tryIt = () => {
    const p = ofCode(name.trim() || 'Untitled', madeCode)
    if (p) open(p)
  }
  const keepIt = () => {
    const next = keep(saved, name || `Untitled ${kept.length + 1}`, madeCode)
    if (!next)
      return setNote(
        kept.some((k) => k.code === madeCode)
          ? 'That picture is already one of yours.'
          : `You have kept ${MAX_KEPT}, which is all this toy holds — remove one of yours first.`,
      )
    setSaved(next)
    setNote(
      `Kept “${next.kept[next.kept.length - 1].name}” — it is in the puzzle list, under Yours.`,
    )
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(madeCode)
      setNote('Copied. Anyone can paste it here, under “Open a code”.')
    } catch {
      setNote('Could not copy — select the code in the box and copy it by hand.')
    }
  }
  const openCode = () => {
    const p = ofCode('A picture from a code', codeText)
    if (!p) return setNote('That is not a puzzle code — they look like “10x10.” and then letters.')
    setCodeText('')
    open(p)
  }
  const removeKept = () => {
    const at = kept.findIndex((k) => k.code === puzzle.id)
    if (at < 0) return
    setSaved((s) => {
      const progress = { ...s.progress }
      delete progress[puzzle.id]
      return { ...s, kept: s.kept.filter((_, i) => i !== at), progress }
    })
    open(ofLevel(0))
  }
  const editIt = () => {
    // a made picture back into the maker, to change
    snapshot()
    setMw(puzzle.picture.w)
    setMh(puzzle.picture.h)
    drawing.current = Uint8Array.from(puzzle.picture.cells)
    setName(puzzle.name)
    setVerdict(judge(puzzle.picture))
    setSaved((s) => ({ ...s, draft: toCode(puzzle.picture) }))
    setMode('make')
    setCursor(null)
    setNote(null)
  }

  /* ── words */
  const filledCount = mode === 'play' ? marks.current.filter((m) => m === FILL).length : 0
  const best = saved.solved[puzzle.id]
  const lineText = (axis: 'row' | 'col', i: number) => {
    const list = axis === 'row' ? c.rows[i] : c.cols[i]
    return list.length ? list.join(' ') : '0'
  }
  const stageLabel =
    mode === 'play'
      ? `Nonogram: ${puzzle.name}, ${w} by ${h}. ${done.rows.filter(Boolean).length} of ${h} rows and ${done.cols.filter(Boolean).length} of ${w} columns match their numbers.${
          cursor
            ? ` Cursor on row ${cursor[1] + 1} (${lineText('row', cursor[1])}), column ${cursor[0] + 1} (${lineText('col', cursor[0])}): ${['blank', 'filled', 'crossed out'][marks.current[cursor[1] * w + cursor[0]]]}.`
            : ''
        }${isSolved ? ' Solved.' : ''}`
      : `Nonogram maker, ${w} by ${h}.${cursor ? ` Cursor on row ${cursor[1] + 1}, column ${cursor[0] + 1}: ${drawing.current[cursor[1] * w + cursor[0]] ? 'filled' : 'blank'}.` : ''} ${verdictText(verdict)}`
  const hintText =
    shown?.kind === 'wrong'
      ? `${shown.cells.length === 1 ? 'One mark is' : `${shown.cells.length} marks are`} wrong — outlined in red. Undo, or change ${shown.cells.length === 1 ? 'it' : 'them'}.`
      : shown?.kind === 'line'
        ? `${shown.axis === 'row' ? 'Row' : 'Column'} ${shown.index + 1} (${lineText(shown.axis, shown.index)}) can settle ${shown.cells.length} more square${shown.cells.length === 1 ? '' : 's'} by itself, with what is already marked: try every way its numbers fit, and see what they all agree on.`
        : shown?.kind === 'cell'
          ? 'No single line can settle anything now — this one square is from the answer.'
          : null

  void ver // marks live in refs; this number changing is what re-renders the words
  return (
    <div
      className="lab-keys"
      tabIndex={0}
      onKeyDown={onKey}
      onKeyUp={onKeyUp}
      aria-label="Nonogram"
    >
      <LabStage
        label={stageLabel}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createNonogram(device, context, format, canvas)
          engine.current = v
          now.current.sendBoard(v)
          return {
            frame: (dt: number) => {
              time.current += dt
              const n = now.current
              const since = solvedAt.current === null ? -1 : time.current - solvedAt.current
              v.frame({
                time: time.current,
                since,
                cursor: n.cursor,
                hint:
                  n.mode === 'play' && n.shown?.kind === 'line'
                    ? { axis: n.shown.axis, index: n.shown.index }
                    : null,
                maker: n.mode === 'make',
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const el = e.currentTarget
          const r = el.getBoundingClientRect()
          const k = el.width / r.width
          const f = fitSized([el.width, el.height], w, h, room)
          const at = cellAt(f, w, h, [(e.clientX - r.left) * k, (e.clientY - r.top) * k])
          if (!at) return
          setCursor(at)
          begin(at)
          // the press first, the capture after: capture is a nicety that may fail
          try {
            el.setPointerCapture(e.pointerId)
          } catch {
            /* a synthetic pointer: the press has already happened */
          }
        }}
        onPointerMove={(e) => {
          if (!stroke.current) return
          const el = e.currentTarget
          const r = el.getBoundingClientRect()
          const k = el.width / r.width
          const f = fitSized([el.width, el.height], w, h, room)
          extend(cellNear(f, w, h, [(e.clientX - r.left) * k, (e.clientY - r.top) * k]))
        }}
        onPointerUp={() => end()}
      />

      {live && mode === 'play' && (
        <>
          <div className="lab-controls">
            <button className="btn btn-ghost" aria-label="Previous puzzle" onClick={() => step(-1)}>
              ‹
            </button>
            <label className="studio-pick nono-pick">
              <span className="sr-only">Puzzle</span>
              <select value={choice} onChange={(e) => choose(e.target.value)}>
                <optgroup label="Puzzles">
                  {LEVELS.map((l, i) => (
                    <option key={l.name} value={`L:${i}`}>
                      {i + 1}. {l.name} ({l.picture.w}×{l.picture.h})
                      {saved.solved[l.name] ? ' ✓' : ''}
                    </option>
                  ))}
                </optgroup>
                {kept.length > 0 && (
                  <optgroup label="Yours">
                    {kept.map((k, i) => (
                      <option key={k.code} value={`K:${i}`}>
                        {k.name}
                        {saved.solved[k.code] ? ' ✓' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {choice === 'C' && <option value="C">{puzzle.name}</option>}
              </select>
            </label>
            <button className="btn btn-ghost" aria-label="Next puzzle" onClick={() => step(1)}>
              ›
            </button>
            <div className="lab-group" role="group" aria-label="What a press does">
              <button
                className="btn btn-ghost"
                aria-pressed={tool === FILL}
                aria-keyshortcuts="Space"
                onClick={() => setTool(FILL)}
              >
                ■ Fill
              </button>
              <button
                className="btn btn-ghost"
                aria-pressed={tool === CROSS}
                aria-keyshortcuts="X"
                onClick={() => setTool(CROSS)}
              >
                ✕ Cross out
              </button>
            </div>
          </div>
          <div className="lab-controls">
            <button className="btn" onClick={takeHint} disabled={isSolved} aria-keyshortcuts="H">
              💡 Hint
            </button>
            <button
              className="btn btn-ghost"
              onClick={doUndo}
              disabled={!undo.current.some((u) => u.mode === 'play')}
              aria-keyshortcuts="Z"
            >
              ↶ Undo
            </button>
            <button
              className="btn btn-ghost"
              onClick={restart}
              disabled={!marks.current.some((m) => m)}
            >
              ↺ Start again
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setMode('make')
                setCursor(null)
                setNote(null)
              }}
            >
              ✏️ Make your own
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={sound}
              onClick={() => setSound((s) => !s)}
            >
              {sound ? '🔔 Sound' : '🔕 Muted'}
            </button>
            {puzzle.level === null &&
              kept.some((k) => k.code === puzzle.id) &&
              (removing ? (
                <>
                  <button className="btn" onClick={removeKept}>
                    Yes, remove “{puzzle.name}”
                  </button>
                  <button className="btn btn-ghost" onClick={() => setRemoving(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button className="btn btn-ghost" onClick={() => setRemoving(true)}>
                  🗑 Remove from yours
                </button>
              ))}
            {puzzle.level === null && (
              <button className="btn btn-ghost" onClick={editIt}>
                ✏️ Change this picture
              </button>
            )}
          </div>
          <p className="lab-score nono-score" aria-live="off">
            {filledCount} filled · {clock(elapsed.current)}
            {hints.current ? ` · ${hints.current} hint${hints.current === 1 ? '' : 's'}` : ''}
            {best
              ? ` · best ${clock(best.ms)}${best.hints ? `, ${best.hints} hint${best.hints === 1 ? '' : 's'}` : ''}`
              : ''}
          </p>
          <p className="muted lab-hint" aria-live="polite">
            {note && <strong>{note} </strong>}
            {isSolved && puzzle.level !== null && puzzle.level < LEVELS.length - 1 && (
              <>
                <button className="btn" onClick={() => open(ofLevel(puzzle.level! + 1))}>
                  Next puzzle ›
                </button>{' '}
              </>
            )}
            {hintText && <strong>{hintText} </strong>}
            Each number is a run of filled squares in that row or column, in order, with at least
            one blank between runs. Fill the squares that must be filled; cross out the ones that
            cannot be. Drag to mark a line at once — the drag holds to its row or column. Keys:
            arrows, Space fill, X cross, Shift+arrows carry on, H hint, Z undo.
          </p>
        </>
      )}

      {live && mode === 'make' && (
        <>
          <div className="lab-controls">
            <button className="btn" onClick={() => open(puzzle)}>
              ‹ Back to the puzzles
            </button>
            <label className="studio-pick">
              <span className="muted">Wide</span>
              <select value={mw} onChange={(e) => resize(Number(e.target.value), mh)}>
                {SIDES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="studio-pick">
              <span className="muted">High</span>
              <select value={mh} onChange={(e) => resize(mw, Number(e.target.value))}>
                {SIDES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-ghost"
              onClick={doUndo}
              disabled={!undo.current.some((u) => u.mode === 'make')}
              aria-keyshortcuts="Z"
            >
              ↶ Undo
            </button>
            <button
              className="btn btn-ghost"
              disabled={!drawing.current.some((v) => v)}
              onClick={() => {
                snapshot()
                drawing.current = new Uint8Array(mw * mh)
                afterDraw()
              }}
            >
              Clear
            </button>
          </div>
          <div className="lab-controls">
            <label className="lab-search nono-name">
              <span className="sr-only">Name</span>
              <input
                value={name}
                maxLength={30}
                placeholder="Name it"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="btn" disabled={!madeCode} onClick={tryIt}>
              ▶ Solve it
            </button>
            <button className="btn btn-ghost" disabled={!madeCode} onClick={keepIt}>
              ★ Keep ({kept.length}/{MAX_KEPT})
            </button>
            <button className="btn btn-ghost" disabled={!madeCode} onClick={copy}>
              📋 Copy code
            </button>
          </div>
          <p className="nono-verdict" aria-live="polite">
            {verdictText(verdict)}
          </p>
          {madeCode && (
            <label className="nono-code">
              <span className="muted">This picture’s code</span>
              <input readOnly value={madeCode} onFocus={(e) => e.currentTarget.select()} />
            </label>
          )}
          <div className="lab-controls">
            <label className="lab-search nono-name">
              <span className="sr-only">A puzzle code</span>
              <input
                value={codeText}
                placeholder="Open a code — 10x10.…"
                onChange={(e) => setCodeText(e.target.value.slice(0, 120))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openCode()
                }}
              />
            </label>
            <button className="btn btn-ghost" disabled={!codeText.trim()} onClick={openCode}>
              Open
            </button>
          </div>
          <p className="muted lab-hint" aria-live="polite">
            {note && <strong>{note} </strong>}
            Draw by pressing and dragging; press a filled square to clear from there. The numbers
            update as you draw. Kept pictures and the drawing stay in this browser only — share one
            by its code.
          </p>
        </>
      )}
    </div>
  )
}
