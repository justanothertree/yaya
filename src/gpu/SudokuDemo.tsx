import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { here } from '../lab/links'
import { daySeed } from './bricks'
import {
  LEVELS,
  PENALTY,
  SUDOKU_KEY,
  THEMES,
  boxOf,
  clashes,
  colOf,
  hint,
  make,
  readSaved,
  rowOf,
  type Grid,
  type Level,
  type Saved,
} from './sudoku'

type Mode = 'today' | 'practice'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(SUDOKU_KEY))
  } catch {
    return readSaved(null)
  }
}
const LEVEL_NAMES: Record<Level, string> = { gentle: 'Gentle', steady: 'Steady', tricky: 'Tricky' }
const THEME_NAMES: Record<Saved['theme'], string> = { paper: 'Paper', night: 'Night', mint: 'Mint' }
const NEEDS = ['', 'only singles', 'pointing and pairs', 'hidden pairs and X-wings']
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function Clock({ from, to, extra }: { from: number | null; to: number | null; extra: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (from === null || to !== null) return
    const t = window.setInterval(() => tick((n) => n + 1), 500)
    return () => window.clearInterval(t)
  }, [from, to])
  const s = from === null ? 0 : Math.floor(((to ?? performance.now()) - from) / 1000)
  return <strong>{fmt(s + extra)}</strong>
}

type Puzzle = { puzzle: Grid; answer: Grid; level: number }
const todayPuzzle = () => make('steady', daySeed(new Date()))

export function SudokuDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>('today')
  const [p, setP] = useState<Puzzle>(todayPuzzle)
  const [cells, setCells] = useState<Grid>(() => p.puzzle.slice())
  const [notes, setNotes] = useState<number[]>(() => Array(81).fill(0))
  const [history, setHistory] = useState<{ cells: Grid; notes: number[] }[]>([])
  const [sel, setSel] = useState(40)
  const [pencil, setPencil] = useState(false)
  const [wrong, setWrong] = useState<Set<number>>(new Set())
  const [extra, setExtra] = useState(0)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [line, setLine] = useState(
    "Today's puzzle — the same for everyone today. Pick a cell, then a digit.",
  )
  const [share, setShare] = useState('')
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    try {
      localStorage.setItem(SUDOKU_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const fresh = (m: Mode = mode, level: Level = saved.level) => {
    const next = m === 'today' ? todayPuzzle() : make(level, (Math.random() * 2 ** 31) | 0)
    setMode(m)
    setP(next)
    setCells(next.puzzle.slice())
    setNotes(Array(81).fill(0))
    setHistory([])
    setWrong(new Set())
    setExtra(0)
    setFrom(null)
    setTo(null)
    setShare('')
    setLine(
      m === 'today'
        ? "Today's puzzle — the same for everyone today."
        : `A ${LEVEL_NAMES[level].toLowerCase()} puzzle: it needs ${NEEDS[next.level]}.`,
    )
  }

  const given = (i: number) => p.puzzle[i] !== 0
  const remember = () => setHistory((h) => [...h.slice(-200), { cells, notes }])
  const done = to !== null
  const write = (d: number, asNote = pencil) => {
    if (done || given(sel)) return
    const t0 = from ?? performance.now()
    if (from === null) setFrom(t0)
    remember()
    if (asNote && d) {
      setNotes((n) => n.map((m, i) => (i === sel ? m ^ (1 << (d - 1)) : m)))
      return
    }
    const next = cells.map((x, i) => (i === sel ? (x === d ? 0 : d) : x))
    // a digit written clears that digit from the notes around it
    setNotes((n) =>
      n.map((m, i) =>
        i === sel
          ? 0
          : d && (rowOf(i) === rowOf(sel) || colOf(i) === colOf(sel) || boxOf(i) === boxOf(sel))
            ? m & ~(1 << (d - 1))
            : m,
      ),
    )
    setCells(next)
    setWrong((w) => {
      const n = new Set(w)
      n.delete(sel)
      return n
    })
    if (next.every((x, i) => x === p.answer[i])) {
      const end = performance.now()
      setTo(end)
      const secs = Math.floor((end - t0) / 1000) + extra
      const level = mode === 'today' ? 'steady' : saved.level
      const prev = saved.best[level]
      const day = daySeed(new Date())
      setSaved((s) => ({
        ...s,
        solved: s.solved + 1,
        best: { ...s.best, [level]: Math.min(s.best[level] ?? Infinity, secs) },
        today:
          mode === 'today'
            ? {
                day,
                seconds: s.today && s.today.day === day ? Math.min(s.today.seconds, secs) : secs,
              }
            : s.today,
      }))
      setLine(
        `🏆 Solved in ${fmt(secs)}${prev === undefined || secs < prev ? ' — your best at this level!' : `. Your best is ${fmt(prev)}.`}`,
      )
      if (mode === 'today')
        setShare(`I solved today's Sudoku in ${fmt(secs)}. Your go:\n${here()}#lab?demo=sudoku`)
    } else if (next.every(Boolean)) setLine('Every cell is full, but something is not right yet.')
  }
  const undo = () => {
    const last = history[history.length - 1]
    if (!last || done) return
    setCells(last.cells)
    setNotes(last.notes)
    setHistory((h) => h.slice(0, -1))
  }
  const askHint = () => {
    if (done) return
    // a wrong digit first: no reasoning can be trusted on top of one
    const bad = cells.map((d, i) => (d && d !== p.answer[i] ? i : -1)).filter((i) => i >= 0)
    setExtra((e) => e + PENALTY)
    if (bad.length) {
      setWrong(new Set(bad))
      setLine(
        `${bad.length === 1 ? 'One digit is' : `${bad.length} digits are`} wrong — marked in red. (+${PENALTY} s)`,
      )
      return
    }
    const h = hint(cells)
    if (!h) return
    remember()
    setCells((c) => c.map((x, i) => (i === h.cell ? h.digit : x)))
    setSel(h.cell)
    setLine(`${h.digit} here: ${h.why}. (+${PENALTY} s)`)
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
      const r = Math.max(0, Math.min(8, rowOf(sel) + d[e.key][0]))
      const c = Math.max(0, Math.min(8, colOf(sel) + d[e.key][1]))
      setSel(r * 9 + c)
      refs.current[r * 9 + c]?.focus()
      return
    }
    const k =
      e.code.startsWith('Digit') || e.code.startsWith('Numpad') ? Number(e.code.slice(-1)) : NaN
    if (k >= 1 && k <= 9) {
      e.preventDefault()
      // Shift and a digit pencils it in, whichever mode the pad is in
      write(k, e.shiftKey || pencil)
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') write(0)
    else if (e.key === 'n' || e.key === 'N') setPencil((x) => !x)
    else if (e.key === 'h' || e.key === 'H') askHint()
    else if (e.key === 'u' || e.key === 'U') undo()
  }

  const bad = saved.clashes ? clashes(cells) : new Set<number>()
  const left = (d: number) => 9 - cells.filter((x) => x === d).length
  const day = daySeed(new Date())
  const best =
    mode === 'today'
      ? saved.today && saved.today.day === day
        ? saved.today.seconds
        : undefined
      : saved.best[saved.level]
  const selDigit = cells[sel]

  return (
    <div className={`lab-keys su-room is-${saved.theme}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Which puzzle">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'today'}
            onClick={() => fresh('today')}
          >
            Today's puzzle
          </button>
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={mode === 'practice' && saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                fresh('practice', l)
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
      </div>
      <div className="dice-scores su-hud">
        <div className="dice-score">
          <span>Time</span>
          <Clock from={from} to={to} extra={extra} />
        </div>
        <div className="dice-score">
          <span>To fill</span>
          <strong>{cells.filter((x) => !x).length}</strong>
          <span className="muted">needs {NEEDS[p.level]}</span>
        </div>
        <div className="dice-score">
          <span>{mode === 'today' ? 'Best today' : 'Best here'}</span>
          <strong>{best !== undefined ? fmt(best) : '—'}</strong>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="su-grid"
        role="grid"
        aria-label="The puzzle. Arrow keys move, digits write, Shift with a digit writes a note, N switches to notes, Backspace clears, H is a hint, U undoes."
        onKeyDown={onKey}
      >
        {cells.map((d, i) => {
          const near = rowOf(i) === rowOf(sel) || colOf(i) === colOf(sel) || boxOf(i) === boxOf(sel)
          return (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              role="gridcell"
              className={[
                'su-cell',
                given(i) ? 'is-given' : '',
                i === sel ? 'is-sel' : near ? 'is-near' : '',
                d && d === selDigit && i !== sel ? 'is-same' : '',
                bad.has(i) || wrong.has(i) ? 'is-bad' : '',
                colOf(i) % 3 === 2 && colOf(i) < 8 ? 'edge-r' : '',
                rowOf(i) % 3 === 2 && rowOf(i) < 8 ? 'edge-b' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              tabIndex={i === sel ? 0 : -1}
              aria-label={`Row ${rowOf(i) + 1}, column ${colOf(i) + 1}: ${d ? `${d}${given(i) ? ', given' : ''}` : 'empty'}${notes[i] ? `, notes ${[1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => notes[i] & (1 << (n - 1))).join(' ')}` : ''}${bad.has(i) || wrong.has(i) ? ', wrong' : ''}`}
              onFocus={() => setSel(i)}
              onClick={() => setSel(i)}
            >
              {d ? (
                <span aria-hidden>{d}</span>
              ) : notes[i] ? (
                <span className="su-notes" aria-hidden>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <span key={n}>{notes[i] & (1 << (n - 1)) ? n : ''}</span>
                  ))}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <div className="su-pad" role="group" aria-label="Digits">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button
            key={d}
            className="btn btn-ghost su-key"
            onClick={() => write(d)}
            disabled={done}
            aria-label={`${pencil ? 'Note' : 'Write'} ${d}, ${left(d)} still to place`}
          >
            {d}
            <span className="su-left" aria-hidden>
              {left(d) || '✓'}
            </span>
          </button>
        ))}
      </div>
      <div className="lab-controls">
        <button
          className="btn btn-ghost"
          aria-pressed={pencil}
          onClick={() => setPencil((x) => !x)}
        >
          ✏️ Notes
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => write(0)}
          disabled={done || given(sel) || (!cells[sel] && !notes[sel])}
        >
          ⌫ Erase
        </button>
        <button className="btn btn-ghost" onClick={undo} disabled={!history.length || done}>
          ↶ Undo
        </button>
        <button className="btn btn-ghost" onClick={askHint} disabled={done}>
          💡 Hint (+{PENALTY} s)
        </button>
      </div>
      {share && <CopyLink text={share} label="🔗 Copy my time" />}
      <p className="sun-reading">
        <span className="muted">
          Solved {saved.solved}
          {LEVELS.filter((l) => saved.best[l] !== undefined)
            .map((l) => ` · ${l} ${fmt(saved.best[l]!)}`)
            .join('')}
        </span>
      </p>
      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Grid</h3>
          <div className="lab-controls" role="group" aria-label="Look">
            {THEMES.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={saved.theme === t}
                onClick={() => setSaved((s) => ({ ...s, theme: t }))}
              >
                {THEME_NAMES[t]}
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
        Fill the grid so every row, every column and every box of nine holds 1 to 9 once each. Every
        puzzle has exactly one answer, and each is graded by what it takes: Gentle needs only
        singles, Steady also needs digits pointing out of a box and matching pairs, and Tricky aims
        for hidden pairs and X-wings. Notes let you pencil in what a cell could be. A hint costs
        thirty seconds: it points out a wrong digit if there is one, and otherwise fills a cell and
        says why. Today's puzzle is the same for everyone. Keys: arrows, digits, Shift and a digit
        for a note, N for notes, Backspace, H, U.
      </p>
    </div>
  )
}
