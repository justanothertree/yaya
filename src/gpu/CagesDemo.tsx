import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { daySeed } from './bricks'
import {
  CAGES_KEY,
  LOOKS,
  SIZES,
  cageOf,
  keepBest,
  labelText,
  make,
  mistakes,
  readSaved,
  solved,
  type Puzzle,
  type Saved,
  type Size,
} from './cages'
import { clock, dayNumber } from './daily'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(CAGES_KEY))
  } catch {
    return readSaved(null)
  }
}
const LOOK_NAMES: Record<Saved['look'], string> = { paper: 'Paper', slate: 'Slate', sun: 'Sunny' }
const OP_WORDS: Record<string, string> = {
  '+': 'add to',
  '−': 'differ by',
  '×': 'multiply to',
  '÷': 'divide to',
  '=': 'is',
}
/** seconds added for each hint */
const PENALTY = 30
const seedFor = (size: number) => (daySeed(new Date()) ^ (size * 7919)) >>> 0
const blank = (n: number) => new Array<number>(n * n).fill(0)

export function CagesDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [seed, setSeed] = useState(() => seedFor(saved.size))
  const daily = seed === seedFor(saved.size)
  const p: Puzzle = useMemo(() => make(saved.size, seed), [saved.size, seed])
  const n = p.n
  /**
   * The numbers and notes, kept with the puzzle they belong to. A new size renders once before the
   * effect below can reset anything, and a grid of the old size read against the new puzzle's cages
   * crashed the whole Lab: 4×4 after 5×5 asked for the cage of a sixteenth cell that has none
   */
  const [play, setPlay] = useState(() => ({ p, grid: blank(n), notes: blank(n) }))
  const { grid, notes } = play.p === p ? play : { grid: blank(n), notes: blank(n) }
  const change = (f: (s: { grid: number[]; notes: number[] }) => Partial<typeof play>) =>
    setPlay((s) => {
      const base = s.p === p ? s : { p, grid: blank(n), notes: blank(n) }
      return { ...base, ...f(base) }
    })
  const setGrid = (g: number[]) => change(() => ({ grid: g }))
  const setNotes = (f: number[] | ((x: number[]) => number[])) =>
    change((s) => ({ notes: typeof f === 'function' ? f(s.notes) : f }))
  const [history, setHistory] = useState<{ grid: number[]; notes: number[] }[]>([])
  const [sel, setSel] = useState(0)
  const [pencil, setPencil] = useState(false)
  const [started, setStarted] = useState<number | null>(null)
  const [ended, setEnded] = useState<number | null>(null)
  const [extra, setExtra] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [line, setLine] = useState(
    'Fill each row and column with every number once, so each cage makes its target.',
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    try {
      localStorage.setItem(CAGES_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  // a fresh grid whenever the puzzle changes
  useEffect(() => {
    setPlay({ p, grid: blank(p.n), notes: blank(p.n) })
    setHistory([])
    setSel(0)
    setStarted(null)
    setEnded(null)
    setExtra(0)
  }, [p])
  useEffect(() => {
    if (started === null || ended !== null) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [started, ended])

  const done = ended !== null
  const secs = started === null ? 0 : Math.floor(((ended ?? now) - started) / 1000) + extra
  const today = dayNumber()
  const best = saved.bests.find((b) => b.day === today && b.size === saved.size)
  const bad = saved.clashes ? mistakes(p, grid) : new Set<number>()
  const owner = useMemo(() => Array.from({ length: n * n }, (_, i) => cageOf(p, i)), [p, n])

  /** solved: the time, with every hint's seconds — `added` for one given in this same moment */
  const finish = (start: number, added = 0) => {
    const end = Date.now()
    setEnded(end)
    setNow(end)
    const total = Math.max(1, Math.floor((end - start) / 1000) + extra + added)
    setSaved((s) => ({
      ...s,
      solvedCount: s.solvedCount + 1,
      bests: daily
        ? keepBest(s.bests, { day: today, size: s.size, seconds: total }, today)
        : s.bests,
    }))
    setLine(
      `🏆 Solved in ${clock(total)}${daily && (!best || total < best.seconds) ? ' — your best on today’s board!' : '.'}`,
    )
  }

  const write = (d: number, asNote = pencil) => {
    if (done) return
    const start = started ?? Date.now()
    if (started === null) setStarted(start)
    setHistory((h) => [...h.slice(-200), { grid, notes }])
    if (asNote && d) {
      setNotes((x) => x.map((m, i) => (i === sel ? m ^ (1 << (d - 1)) : m)))
      return
    }
    const next = grid.map((v, i) => (i === sel ? (v === d ? 0 : d) : v))
    // a number written clears it from the notes along its row and column
    setNotes((x) =>
      x.map((m, i) =>
        i === sel
          ? 0
          : d && (Math.floor(i / n) === Math.floor(sel / n) || i % n === sel % n)
            ? m & ~(1 << (d - 1))
            : m,
      ),
    )
    setGrid(next)
    if (solved(p, next)) finish(start)
    else if (next.every(Boolean)) setLine('Every square is full, but something is not right yet.')
  }
  const undo = () => {
    const last = history[history.length - 1]
    if (!last || done) return
    setGrid(last.grid)
    setNotes(last.notes)
    setHistory((h) => h.slice(0, -1))
  }
  const askHint = () => {
    if (done) return
    if (started === null) setStarted(Date.now())
    setExtra((e) => e + PENALTY)
    const wrong = grid.map((v, i) => (v && v !== p.answer[i] ? i : -1)).filter((i) => i >= 0)
    if (wrong.length) {
      setSel(wrong[0])
      refs.current[wrong[0]]?.focus()
      setLine(
        `${wrong.length === 1 ? 'One number is' : `${wrong.length} numbers are`} wrong — the first is selected. (+${PENALTY} s)`,
      )
      return
    }
    // the empty cell in the smallest unfinished cage, which is the easiest to see once shown
    const open = p.cages
      .filter((c) => c.cells.some((i) => !grid[i]))
      .sort((a, b) => a.cells.length - b.cells.length)[0]
    const cell = open?.cells.find((i) => !grid[i])
    if (cell === undefined) return
    setHistory((h) => [...h.slice(-200), { grid, notes }])
    const next = grid.map((v, i) => (i === cell ? p.answer[i] : v))
    setGrid(next)
    setSel(cell)
    setLine(`${p.answer[cell]} goes here. (+${PENALTY} s)`)
    if (solved(p, next)) finish(started ?? Date.now(), PENALTY)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }
    if (d[e.key]) {
      e.preventDefault()
      e.stopPropagation()
      const r = Math.max(0, Math.min(n - 1, Math.floor(sel / n) + d[e.key][0]))
      const c = Math.max(0, Math.min(n - 1, (sel % n) + d[e.key][1]))
      setSel(r * n + c)
      refs.current[r * n + c]?.focus()
      return
    }
    const k =
      e.code.startsWith('Digit') || e.code.startsWith('Numpad') ? Number(e.code.slice(-1)) : NaN
    if (k >= 1 && k <= n) {
      e.preventDefault()
      write(k, e.shiftKey || pencil)
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') write(0)
    else if (e.key === 'n' || e.key === 'N') setPencil((x) => !x)
    else if (e.key === 'h' || e.key === 'H') askHint()
    else if (e.key === 'u' || e.key === 'U') undo()
  }

  const describe = (i: number) => {
    const c = p.cages[owner[i]]
    const first = c.cells[0] === i
    const where = `Row ${Math.floor(i / n) + 1}, column ${(i % n) + 1}`
    const what = grid[i] ? String(grid[i]) : 'empty'
    const cage =
      c.cells.length === 1
        ? `a cage of its own: ${c.target}`
        : `in a cage of ${c.cells.length} that ${OP_WORDS[c.op]} ${c.target}`
    const marks = notes[i]
      ? `, notes ${Array.from({ length: n }, (_, k) => k + 1)
          .filter((k) => notes[i] & (1 << (k - 1)))
          .join(' ')}`
      : ''
    return `${where}: ${what}, ${first || c.cells.length === 1 ? cage : `in the ${c.target}${c.op} cage`}${marks}${bad.has(i) ? ', clashes' : ''}`
  }

  return (
    <div className={`lab-keys ck-room is-${saved.look}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Size">
          {SIZES.map((s) => (
            <button
              key={s}
              className="btn btn-ghost"
              aria-pressed={saved.size === s}
              onClick={() => {
                setSaved((x) => ({ ...x, size: s as Size }))
                setSeed(seedFor(s))
              }}
            >
              {s}×{s}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="Which board">
          <button
            className="btn btn-ghost"
            aria-pressed={daily}
            onClick={() => setSeed(seedFor(saved.size))}
          >
            Today’s
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setSeed((Math.random() * 2 ** 31) >>> 0)}
          >
            ⟳ New board
          </button>
        </div>
      </div>
      <div className="dice-scores">
        <div className="dice-score">
          <span>Time</span>
          <strong>{clock(secs)}</strong>
          <span className="muted">
            {extra ? `${extra / PENALTY} hint${extra === PENALTY ? '' : 's'}` : 'no hints'}
          </span>
        </div>
        <div className="dice-score">
          <span>Today’s best</span>
          <strong>{best ? clock(best.seconds) : '—'}</strong>
          <span className="muted">
            {saved.size}×{saved.size}
          </span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className={`ck-grid${done ? ' is-done' : ''}`}
        style={{ ['--ck-n' as string]: n }}
        role="group"
        aria-label="The puzzle. Arrow keys move, a number writes it, Shift with a number writes a note, N switches to notes, Backspace clears, H is a hint, U undoes."
        onKeyDown={onKey}
      >
        {grid.map((v, i) => {
          const c = p.cages[owner[i]]
          const r = Math.floor(i / n)
          const col = i % n
          const edge = (j: number, ok: boolean) => !ok || owner[j] !== owner[i]
          return (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={[
                'ck-cell',
                edge(i - n, r > 0) ? 'b-t' : '',
                edge(i + n, r < n - 1) ? 'b-b' : '',
                edge(i - 1, col > 0) ? 'b-l' : '',
                edge(i + 1, col < n - 1) ? 'b-r' : '',
                i === sel ? 'is-sel' : '',
                owner[i] === owner[sel] && i !== sel ? 'is-cage' : '',
                bad.has(i) ? 'is-bad' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              tabIndex={i === sel ? 0 : -1}
              aria-label={describe(i)}
              onFocus={() => setSel(i)}
              onClick={() => setSel(i)}
            >
              {c.cells[0] === i && <span className="ck-label">{labelText(c)}</span>}
              {v ? (
                <span className="ck-v">{v}</span>
              ) : notes[i] ? (
                <span className="ck-notes" aria-hidden>
                  {Array.from({ length: n }, (_, k) => (
                    <span key={k}>{notes[i] & (1 << k) ? k + 1 : ''}</span>
                  ))}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <div className="ck-pad" style={{ ['--ck-n' as string]: n }} role="group" aria-label="Numbers">
        {Array.from({ length: n }, (_, k) => (
          <button
            key={k}
            className="btn btn-ghost ck-key"
            onClick={() => write(k + 1)}
            disabled={done}
          >
            {k + 1}
          </button>
        ))}
      </div>
      <div className="lab-controls">
        <button
          className="btn btn-ghost"
          aria-pressed={pencil}
          onClick={() => setPencil((x) => !x)}
        >
          ✎ Notes
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => write(0)}
          disabled={done || (!grid[sel] && !notes[sel])}
        >
          ⌫ Clear
        </button>
        <button className="btn btn-ghost" onClick={undo} disabled={!history.length || done}>
          ↶ Undo
        </button>
        <button className="btn btn-ghost" onClick={askHint} disabled={done}>
          💡 Hint
        </button>
      </div>

      <p className="sun-reading">
        <span className="muted">Boards solved: {saved.solvedCount}</span>
      </p>
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Grid</h3>
          <div className="lab-controls" role="group" aria-label="Look">
            {LOOKS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.look === l}
                onClick={() => setSaved((s) => ({ ...s, look: l }))}
              >
                {LOOK_NAMES[l]}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.clashes}
              onClick={() => setSaved((s) => ({ ...s, clashes: !s.clashes }))}
            >
              Show clashes
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Each row and each column holds every number from 1 up to the grid’s size, once. The numbers
        in each outlined cage make the target in its corner: 12× multiply to 12, 7+ add to 7, 2−
        differ by 2, 3÷ divide to 3 in either order, and a lone number is simply given. A number may
        repeat inside a cage, as long as not in one row or column. Every board has exactly one
        answer. Today’s board is the same for everyone. Keys: arrows move, numbers write, Shift and
        a number writes a note, N for notes, Backspace, H, U.
      </p>
    </div>
  )
}
