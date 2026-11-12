import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { daySeed } from './bricks'
import {
  BRIDGES_KEY,
  LOOKS,
  SIZES,
  cycle,
  edgeBetween,
  hint,
  keepBest,
  make,
  neighbour,
  readSaved,
  solved,
  tally,
  type Puzzle,
  type Saved,
  type Size,
} from './bridges'
import { clock, dayNumber } from './daily'
import { useKept } from './kept'

const LOOK_NAMES: Record<Saved['look'], string> = { sea: 'Sea', map: 'Old map', night: 'Night' }
/** seconds added for each hint */
const PENALTY = 30
const seedFor = (size: number) => (daySeed(new Date()) ^ (size * 7919)) >>> 0
const DIRS: Record<string, [number, number, string]> = {
  ArrowUp: [-1, 0, 'up'],
  ArrowDown: [1, 0, 'down'],
  ArrowLeft: [0, -1, 'left'],
  ArrowRight: [0, 1, 'right'],
}

export function BridgesDemo() {
  const [saved, setSaved] = useKept(BRIDGES_KEY, readSaved)
  const [seed, setSeed] = useState(() => seedFor(saved.size))
  const daily = seed === seedFor(saved.size)
  const p: Puzzle = useMemo(() => make(saved.size, seed), [saved.size, seed])
  const n = p.n
  /** the bridges laid, kept with the puzzle they belong to so a new puzzle never reads old ones */
  const [play, setPlay] = useState<{ p: Puzzle; laid: number[] }>(() => ({
    p,
    laid: p.edges.map(() => 0),
  }))
  const laid = play.p === p ? play.laid : p.edges.map(() => 0)
  const [history, setHistory] = useState<number[][]>([])
  /** the island the next tap joins from, if any */
  const [picked, setPicked] = useState<number | null>(null)
  const [cursor, setCursor] = useState(0)
  const [started, setStarted] = useState<number | null>(null)
  const [ended, setEnded] = useState<number | null>(null)
  const [extra, setExtra] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [line, setLine] = useState(
    'Join the islands: each needs as many bridges as its number, and all must connect. Tap an island, then a neighbour.',
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  // everything else fresh whenever the puzzle changes
  useEffect(() => {
    setPlay({ p, laid: p.edges.map(() => 0) })
    setHistory([])
    setPicked(null)
    setCursor(0)
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
  const have = tally(p, laid)

  /** solved: the time, with every hint's seconds — `added` for one given in this same moment */
  const finish = (start: number, added = 0) => {
    const end = Date.now()
    setEnded(end)
    setNow(end)
    setPicked(null)
    const total = Math.max(1, Math.floor((end - start) / 1000) + extra + added)
    setSaved((s) => ({
      ...s,
      solvedCount: s.solvedCount + 1,
      bests: daily
        ? keepBest(s.bests, { day: today, size: s.size, seconds: total }, today)
        : s.bests,
    }))
    setLine(
      `🏆 Every island joined in ${clock(total)}${daily && (!best || total < best.seconds) ? ' — your best on today’s map!' : '.'}`,
    )
  }
  const lay = (next: number[], start: number, added = 0) => {
    setHistory((h) => [...h.slice(-300), laid])
    setPlay({ p, laid: next })
    if (solved(p, next)) {
      finish(start, added)
      return true
    }
    const t = tally(p, next)
    if (t.every((x, i) => x === p.islands[i].need))
      setLine('Every number is met, but the islands are not all joined into one.')
    return false
  }
  /** one more bridge between two islands, or none after two */
  const join = (a: number, b: number) => {
    if (done) return
    const k = edgeBetween(p, a, b)
    if (k < 0) {
      setLine('Those two islands cannot see each other along a row or a column.')
      return
    }
    const next = cycle(p, laid, k)
    if (!next) {
      setLine('That bridge would cross one already laid.')
      return
    }
    const start = started ?? Date.now()
    if (started === null) setStarted(start)
    if (!lay(next, start))
      setLine(
        next[k]
          ? `${next[k] === 2 ? 'Two bridges' : 'A bridge'} from ${p.islands[a].need} to ${p.islands[b].need}.`
          : 'Bridges taken up.',
      )
  }
  const tap = (i: number) => {
    setCursor(i)
    if (done) return
    if (picked === null || picked === i) {
      setPicked(picked === i ? null : i)
      if (picked !== i) setLine('Now tap an island in line with it.')
      return
    }
    if (edgeBetween(p, picked, i) < 0) {
      // not a neighbour: start from this one instead
      setPicked(i)
      setLine('Now tap an island in line with it.')
      return
    }
    join(picked, i)
    setPicked(null)
  }
  const undo = () => {
    const last = history[history.length - 1]
    if (!last || done) return
    setPlay({ p, laid: last })
    setHistory((h) => h.slice(0, -1))
    setLine('Undone.')
  }
  const askHint = () => {
    if (done) return
    const k = hint(p, laid)
    if (k < 0) return
    const start = started ?? Date.now()
    if (started === null) setStarted(start)
    setExtra((x) => x + PENALTY)
    const next = [...laid]
    next[k] = p.answer[k]
    // a bridge in the answer's way, laid by mistake, comes up first
    for (const j of p.crossing[k]) if (next[j] > p.answer[j]) next[j] = p.answer[j]
    const e = p.edges[k]
    const was = laid[k]
    if (!lay(next, start, PENALTY))
      setLine(
        `${was > p.answer[k] ? 'Too many there: ' : ''}${p.answer[k] === 0 ? 'no bridge' : p.answer[k] === 2 ? 'two bridges' : 'one bridge'} between that ${p.islands[e.a].need} and ${p.islands[e.b].need}. (+${PENALTY} s)`,
      )
    setCursor(e.a)
    refs.current[e.a]?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = DIRS[e.key]
    if (d) {
      e.preventDefault()
      e.stopPropagation()
      const j = neighbour(p, cursor, d[0], d[1])
      if (j < 0) {
        setLine(`No island ${d[2]} from here.`)
        return
      }
      // with Shift, a bridge that way; without, just move there
      if (e.shiftKey) join(cursor, j)
      else {
        setCursor(j)
        refs.current[j]?.focus()
      }
      return
    }
    if (e.key === 'h' || e.key === 'H') askHint()
    else if (e.key === 'u' || e.key === 'U') undo()
    else if (e.key === 'Escape') setPicked(null)
  }

  const describe = (i: number) => {
    const s = p.islands[i]
    const ways = (['up', 'down', 'left', 'right'] as const)
      .map((w) => {
        const [dr, dc] = Object.values(DIRS).find((x) => x[2] === w)!
        const j = neighbour(p, i, dr, dc)
        const k = j < 0 ? -1 : edgeBetween(p, i, j)
        return k >= 0 && laid[k] ? `${laid[k]} ${w}` : ''
      })
      .filter(Boolean)
    return `Island ${s.need}, row ${s.r + 1}, column ${s.c + 1}: ${have[i]} of ${s.need} bridges${ways.length ? ` (${ways.join(', ')})` : ''}${have[i] > s.need ? ', too many' : have[i] === s.need ? ', complete' : ''}${picked === i ? ', picked' : ''}`
  }
  const centre = (i: number) => [p.islands[i].c + 0.5, p.islands[i].r + 0.5]
  const reach = picked === null ? [] : p.edges.filter((e) => e.a === picked || e.b === picked)

  return (
    <div className={`lab-keys ib-room is-${saved.look}`}>
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
        <div className="lab-group" role="group" aria-label="Which map">
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
            ⟳ New map
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
        className={`ib-sea${done ? ' is-done' : ''}`}
        style={{ ['--ib-n' as string]: n }}
        role="group"
        aria-label="The islands. Arrow keys move between islands in line, Shift and an arrow lays a bridge that way (a third time takes them up), Enter picks an island to join by tapping another, H is a hint, U undoes."
        onKeyDown={onKey}
      >
        <svg className="ib-bridges" viewBox={`0 0 ${n} ${n}`} aria-hidden>
          {reach.map((e) => {
            const [x1, y1] = centre(e.a)
            const [x2, y2] = centre(e.b)
            return (
              <line key={`r${e.a}-${e.b}`} className="ib-reach" x1={x1} y1={y1} x2={x2} y2={y2} />
            )
          })}
          {p.edges.map((e, k) => {
            if (!laid[k]) return null
            const [x1, y1] = centre(e.a)
            const [x2, y2] = centre(e.b)
            const off = laid[k] === 2 ? [-0.11, 0.11] : [0]
            return off.map((o) => (
              <line
                key={`${k}${o}`}
                className="ib-bridge"
                x1={e.across ? x1 : x1 + o}
                y1={e.across ? y1 + o : y1}
                x2={e.across ? x2 : x2 + o}
                y2={e.across ? y2 + o : y2}
              />
            ))
          })}
        </svg>
        {p.islands.map((s, i) => (
          <button
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            className={[
              'ib-isle',
              have[i] === s.need ? 'is-full' : '',
              saved.clashes && have[i] > s.need ? 'is-over' : '',
              picked === i ? 'is-picked' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ gridRow: s.r + 1, gridColumn: s.c + 1 }}
            tabIndex={i === cursor ? 0 : -1}
            aria-label={describe(i)}
            onFocus={() => setCursor(i)}
            onClick={() => tap(i)}
          >
            {s.need}
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
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (done || !laid.some(Boolean)) return
            setHistory((h) => [...h.slice(-300), laid])
            setPlay({ p, laid: p.edges.map(() => 0) })
            setPicked(null)
            setLine('Every bridge taken up.')
          }}
          disabled={done || !laid.some(Boolean)}
        >
          ⌫ Clear
        </button>
      </div>

      <p className="sun-reading">
        <span className="muted">Maps solved: {saved.solvedCount}</span>
      </p>
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Map</h3>
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
              Show too many
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Each island’s number is how many bridges it needs. Bridges run straight across or down
        between islands that can see each other, never through another island or across another
        bridge, and at most two join any pair. When every island has its number and they are all
        joined into one, the map is done — and every map has exactly one answer. Tap an island and
        then a neighbour to lay a bridge; again for two, and a third time takes them up. Today’s map
        is the same for everyone. Keys: arrows move between islands, Shift and an arrow lays a
        bridge, H a hint (+30 s), U undoes.
      </p>
    </div>
  )
}
