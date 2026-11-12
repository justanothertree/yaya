import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { daySeed } from './bricks'
import {
  LAMPS_KEY,
  LOOKS,
  PATTERNS,
  SIZES,
  dark,
  keepBest,
  make,
  press,
  readSaved,
  reach,
  solve,
  type Pattern,
  type Saved,
  type Size,
} from './lamps'
import { dayNumber } from './daily'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(LAMPS_KEY))
  } catch {
    return readSaved(null)
  }
}
const LOOK_NAMES: Record<Saved['look'], string> = {
  bulbs: 'Bulbs',
  lanterns: 'Lanterns',
  neon: 'Neon',
}
const PATTERN_NAMES: Record<Pattern, string> = { plus: '✚ Beside', cross: '✖ Corners' }
const seedFor = (size: number, pattern: Pattern) =>
  (daySeed(new Date()) ^ (size * 7919) ^ (pattern === 'cross' ? 0x2545f491 : 0)) >>> 0

export function LampsDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [seed, setSeed] = useState(() => seedFor(saved.size, saved.pattern))
  const n = saved.size
  const pattern = saved.pattern
  const daily = seed === seedFor(n, pattern)
  const fresh = useMemo(() => make(n, pattern, seed), [n, pattern, seed])
  const par = useMemo(() => solve(fresh, n, pattern)!.length, [fresh, n, pattern])
  const [lit, setLit] = useState<boolean[]>(fresh)
  const [history, setHistory] = useState<boolean[][]>([])
  const [presses, setPresses] = useState(0)
  const [hints, setHints] = useState(0)
  const [hint, setHint] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [line, setLine] = useState(
    'Press a lamp and it switches, and so do the ones beside it. Switch them all off.',
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    try {
      localStorage.setItem(LAMPS_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  // a fresh board whenever the size, pattern or seed changes
  useEffect(() => {
    setLit(fresh)
    setHistory([])
    setPresses(0)
    setHints(0)
    setHint(null)
    setDone(false)
    setCursor(0)
  }, [fresh])

  const today = dayNumber()
  const best = saved.bests.find((b) => b.day === today && b.size === n && b.pattern === pattern)
  const on = lit.filter(Boolean).length

  const tap = (i: number) => {
    if (done) return
    const next = press(lit, n, i, pattern)
    setHistory((h) => [...h.slice(-300), lit])
    setLit(next)
    setHint(null)
    const count = presses + 1
    setPresses(count)
    if (dark(next)) {
      setDone(true)
      setSaved((s) => ({
        ...s,
        solvedCount: s.solvedCount + 1,
        bests: daily
          ? keepBest(s.bests, { day: today, size: n, pattern, presses: count, par }, today)
          : s.bests,
      }))
      setLine(
        `🎉 All dark in ${count} presses${count === par ? ' — that is par, the fewest there are!' : `; par is ${par}.`}${hints ? ` (${hints} hint${hints === 1 ? '' : 's'})` : ''}`,
      )
    } else setLine(`${next.filter(Boolean).length} lamps still lit.`)
  }
  const undo = () => {
    const last = history[history.length - 1]
    if (!last || done) return
    setLit(last)
    setHistory((h) => h.slice(0, -1))
    setPresses((p) => p + 1)
    setHint(null)
    setLine('Taken back — it still counts as a press.')
  }
  const askHint = () => {
    if (done) return
    const s = solve(lit, n, pattern)
    if (!s || !s.length) return
    // the press nearest the top-left of the shortest way from here, so the hint reads in order
    setHint(s[0])
    setHints((h) => h + 1)
    setCursor(s[0])
    refs.current[s[0]]?.focus()
    setLine(`From here it can be done in ${s.length}. Try the marked lamp.`)
  }
  const restart = () => {
    setLit(fresh)
    setHistory([])
    setPresses(0)
    setHints(0)
    setHint(null)
    setDone(false)
    setLine('The same board again, from the start.')
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const r = Math.floor(cursor / n)
    const c = cursor % n
    let next = -1
    if (e.key === 'ArrowLeft') next = r * n + Math.max(0, c - 1)
    else if (e.key === 'ArrowRight') next = r * n + Math.min(n - 1, c + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, r - 1) * n + c
    else if (e.key === 'ArrowDown') next = Math.min(n - 1, r + 1) * n + c
    else if (e.key === 'h' || e.key === 'H') askHint()
    else if (e.key === 'u' || e.key === 'U') undo()
    else return
    e.preventDefault()
    e.stopPropagation()
    if (next >= 0) {
      setCursor(next)
      refs.current[next]?.focus()
    }
  }
  const switched = new Set(reach(n, cursor, pattern))

  return (
    <div className={`lab-keys lp-room is-${saved.look}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Board size">
          {SIZES.map((s) => (
            <button
              key={s}
              className="btn btn-ghost"
              aria-pressed={n === s}
              onClick={() => {
                setSaved((x) => ({ ...x, size: s as Size }))
                setSeed(seedFor(s, pattern))
              }}
            >
              {s}×{s}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="Which lamps a press switches">
          {PATTERNS.map((p) => (
            <button
              key={p}
              className="btn btn-ghost"
              aria-pressed={pattern === p}
              onClick={() => {
                setSaved((x) => ({ ...x, pattern: p }))
                setSeed(seedFor(n, p))
              }}
            >
              {PATTERN_NAMES[p]}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="Which board">
          <button
            className="btn btn-ghost"
            aria-pressed={daily}
            onClick={() => setSeed(seedFor(n, pattern))}
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
        <div className="dice-score is-up">
          <span>Presses</span>
          <strong>{presses}</strong>
          <span className="muted">par {par}</span>
        </div>
        <div className="dice-score">
          <span>Lit</span>
          <strong>{on}</strong>
          <span className="muted">
            {hints ? `${hints} hint${hints === 1 ? '' : 's'}` : 'no hints'}
          </span>
        </div>
        <div className="dice-score">
          <span>Today’s best</span>
          <strong>{best ? best.presses : '—'}</strong>
          <span className="muted">{daily ? 'today’s board' : 'a random board'}</span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className={`lp-board${done ? ' is-done' : ''}`}
        style={{ ['--lp-n' as string]: n }}
        role="group"
        aria-label={`The lamps, ${n} by ${n}. Arrow keys move, Enter or Space presses, H is a hint, U undoes.`}
        onKeyDown={onKey}
      >
        {lit.map((v, i) => (
          <button
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            className={[
              'lp-lamp',
              v ? 'is-on' : '',
              hint === i ? 'is-hint' : '',
              i !== cursor && switched.has(i) ? 'is-near' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            tabIndex={i === cursor ? 0 : -1}
            aria-label={`Row ${Math.floor(i / n) + 1}, column ${(i % n) + 1}: ${v ? 'lit' : 'dark'}${hint === i ? ', the hint' : ''}`}
            aria-pressed={v}
            onFocus={() => setCursor(i)}
            onClick={() => {
              setCursor(i)
              tap(i)
            }}
          >
            <span aria-hidden />
          </button>
        ))}
      </div>
      <div className="lab-controls">
        <button className="btn btn-ghost" onClick={undo} disabled={!history.length || done}>
          ↶ Undo
        </button>
        <button className="btn btn-ghost" onClick={askHint} disabled={done}>
          💡 Hint
        </button>
        <button className="btn btn-ghost" onClick={restart}>
          ↺ Start this board again
        </button>
      </div>

      <p className="sun-reading">
        <span className="muted">Boards cleared: {saved.solvedCount}</span>
      </p>
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Lamps</h3>
          <div className="lab-controls" role="group" aria-label="Which lamps">
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
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Press a lamp and it switches — on to off, off to on — and so do its neighbours: the four
        beside it, or with Corners the four on its diagonals. Switch every lamp off. Par is the
        fewest presses that can do it, worked out exactly; pressing a lamp twice undoes it, so no
        lamp ever needs pressing more than once. Today’s board is the same for everyone. Keys:
        arrows move, Enter or Space presses, H is a hint, U undoes.
      </p>
    </div>
  )
}
