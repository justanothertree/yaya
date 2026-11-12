import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { daySeed } from './bricks'
import {
  LOOKS,
  SIZES,
  TENTS_KEY,
  around,
  counts,
  hint,
  keepBest,
  make,
  readSaved,
  solved,
  touching,
  type Mark,
  type Puzzle,
  type Saved,
  type Size,
} from './tents'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(TENTS_KEY))
  } catch {
    return readSaved(null)
  }
}
const LOOK_NAMES: Record<Saved['look'], string> = { park: 'Park', beach: 'Beach', night: 'Night' }
/** seconds added for each hint */
const PENALTY = 30
const dayNumber = (d = new Date()) =>
  Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
const seedFor = (size: number) => (daySeed(new Date()) ^ (size * 104729)) >>> 0
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const MARK_WORDS = ['empty', 'a tent', 'grass']

export function TentsDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [seed, setSeed] = useState(() => seedFor(saved.size))
  const daily = seed === seedFor(saved.size)
  const p: Puzzle = useMemo(() => make(saved.size, seed), [saved.size, seed])
  const n = p.n
  /** the marks, kept with the field they belong to so a new field never reads old ones */
  const [play, setPlay] = useState<{ p: Puzzle; marks: Mark[] }>(() => ({
    p,
    marks: new Array<Mark>(n * n).fill(0),
  }))
  const marks = play.p === p ? play.marks : new Array<Mark>(n * n).fill(0)
  const [history, setHistory] = useState<Mark[][]>([])
  const [sel, setSel] = useState(0)
  const [started, setStarted] = useState<number | null>(null)
  const [ended, setEnded] = useState<number | null>(null)
  const [extra, setExtra] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [line, setLine] = useState(
    'Pitch a tent beside each tree — above, below, left or right — with no two tents touching, even at a corner.',
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    try {
      localStorage.setItem(TENTS_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  // everything else fresh whenever the field changes
  useEffect(() => {
    setPlay({ p, marks: new Array<Mark>(p.n * p.n).fill(0) })
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
  const bad = saved.clashes ? touching(p, marks) : new Set<number>()
  const tally = counts(p, marks)

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
      `🏕️ Every tree has its tent — ${clock(total)}${daily && (!best || total < best.seconds) ? ', your best on today’s field!' : '.'}`,
    )
  }
  const put = (i: number, m: Mark, added = 0) => {
    if (done || p.trees.has(i)) return
    const start = started ?? Date.now()
    if (started === null) setStarted(start)
    setHistory((h) => [...h.slice(-300), marks])
    const next = [...marks]
    next[i] = m
    // a tent puts grass on the empty cells round it, where no other tent can go
    if (m === 1 && saved.autoGrass)
      for (const a of around(n, i)) if (!next[a] && !p.trees.has(a)) next[a] = 2
    setPlay({ p, marks: next })
    if (solved(p, next)) finish(start, added)
  }
  const cycle = (i: number) => put(i, ((marks[i] + 1) % 3) as Mark)
  const undo = () => {
    const last = history[history.length - 1]
    if (!last || done) return
    setPlay({ p, marks: last })
    setHistory((h) => h.slice(0, -1))
  }
  const askHint = () => {
    if (done) return
    const i = hint(p, marks)
    if (i < 0) return
    setExtra((e) => e + PENALTY)
    const wrong = marks[i] === 1
    setSel(i)
    refs.current[i]?.focus()
    put(i, wrong ? 2 : 1, PENALTY)
    setLine(wrong ? `No tent goes there. (+${PENALTY} s)` : `A tent goes here. (+${PENALTY} s)`)
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
    const k = e.key.toLowerCase()
    if (k === 't') put(sel, 1)
    else if (k === 'g') put(sel, 2)
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') put(sel, 0)
    else if (k === 'h') askHint()
    else if (k === 'u') undo()
    else return
    e.preventDefault()
  }

  const clue = (have: number, want: number) =>
    ['tn-clue', have === want ? 'is-done' : '', saved.clashes && have > want ? 'is-over' : '']
      .filter(Boolean)
      .join(' ')
  return (
    <div className={`lab-keys tn-room is-${saved.look}`}>
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
        <div className="lab-group" role="group" aria-label="Which field">
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
            ⟳ New field
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
          <span>Tents</span>
          <strong>
            {tally.rows.reduce((a, b) => a + b, 0)} / {p.trees.size}
          </strong>
          <span className="muted">one for each tree</span>
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
        className={`tn-grid${done ? ' is-done' : ''}`}
        style={{ ['--tn-n' as string]: n }}
        role="group"
        aria-label="The field. Arrow keys move; Space or Enter changes a square from empty to tent to grass; T a tent, G grass, Backspace clears, H a hint, U undoes."
        onKeyDown={onKey}
      >
        {Array.from({ length: n }, (_, r) => (
          <div key={r} className="tn-row">
            {Array.from({ length: n }, (_, c) => {
              const i = r * n + c
              const tree = p.trees.has(i)
              const m = marks[i]
              return (
                <button
                  key={i}
                  ref={(el) => {
                    refs.current[i] = el
                  }}
                  className={[
                    'tn-cell',
                    tree ? 'is-tree' : m === 1 ? 'is-tent' : m === 2 ? 'is-grass' : '',
                    i === sel ? 'is-sel' : '',
                    bad.has(i) ? 'is-bad' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  tabIndex={i === sel ? 0 : -1}
                  aria-label={`Row ${r + 1}, column ${c + 1}: ${tree ? 'a tree' : MARK_WORDS[m]}${bad.has(i) ? ', touching another tent' : ''}`}
                  onFocus={() => setSel(i)}
                  onClick={() => {
                    setSel(i)
                    if (!tree) cycle(i)
                  }}
                >
                  <span aria-hidden>{tree ? '🌳' : m === 1 ? '⛺' : ''}</span>
                </button>
              )
            })}
            <span className={clue(tally.rows[r], p.rows[r])}>
              <span aria-hidden>{p.rows[r]}</span>
              <span className="sr-only">
                Row {r + 1}: {p.rows[r]} tents, {tally.rows[r]} pitched
              </span>
            </span>
          </div>
        ))}
        <div className="tn-row tn-cols">
          {p.cols.map((v, c) => (
            <span key={c} className={clue(tally.cols[c], v)}>
              <span aria-hidden>{v}</span>
              <span className="sr-only">
                Column {c + 1}: {v} tents, {tally.cols[c]} pitched
              </span>
            </span>
          ))}
          <span aria-hidden />
        </div>
      </div>
      <div className="lab-controls">
        <button className="btn btn-ghost" onClick={undo} disabled={!history.length || done}>
          ↶ Undo
        </button>
        <button className="btn btn-ghost" onClick={askHint} disabled={done}>
          💡 Hint
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (done || !marks.some(Boolean)) return
            setHistory((h) => [...h.slice(-300), marks])
            setPlay({ p, marks: new Array<Mark>(n * n).fill(0) })
            setLine('The field cleared.')
          }}
          disabled={done || !marks.some(Boolean)}
        >
          ⌫ Clear
        </button>
      </div>

      <p className="sun-reading">
        <span className="muted">Fields solved: {saved.solvedCount}</span>
      </p>
      <div className="fw-panel">
        <section aria-label="Look and help">
          <h3 className="fw-h">Field</h3>
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
            <button
              className="btn btn-ghost"
              aria-pressed={saved.autoGrass}
              onClick={() => setSaved((s) => ({ ...s, autoGrass: !s.autoGrass }))}
            >
              Grass round tents
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Every tree needs a tent of its own, on one of its four sides — directly above, below, left
        or right — and no two tents may touch, not even at a corner. The number at the end of each
        row and under each column is how many tents it holds. Tap a square to pitch a tent, again to
        mark it grass (sure there is no tent), and again to clear it; grass is only a note for
        yourself. Every field has exactly one answer, and today’s is the same for everyone. Grass
        round tents marks the squares a new tent rules out. Keys: arrows move, Space cycles, T, G,
        Backspace, H for a hint (+30 s), U to undo.
      </p>
    </div>
  )
}
