import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { daySeed } from './bricks'
import {
  E,
  LOOKS,
  N,
  PIPES_KEY,
  S,
  SIZES,
  W,
  keepBest,
  make,
  par,
  reached,
  readSaved,
  rotate,
  solved,
  type Board,
  type Saved,
  type Size,
} from './pipes'
import { clock, dayNumber } from './daily'
import { useKept } from './kept'

const LOOK_NAMES: Record<Saved['look'], string> = { water: 'Water', lava: 'Lava', neon: 'Neon' }
/** a day as a count of days, so "the last fortnight" can be worked out */
const seedFor = (size: number, wrap: boolean) =>
  (daySeed(new Date()) ^ (size * 7919) ^ (wrap ? 0x5bd1e995 : 0)) >>> 0
const SIDE_WORDS: [number, string][] = [
  [N, 'up'],
  [E, 'right'],
  [S, 'down'],
  [W, 'left'],
]
const describe = (t: number) =>
  SIDE_WORDS.filter(([s]) => t & s)
    .map(([, w]) => w)
    .join(' and ')

/** a tile's pipes, drawn as arms from the middle to each open side */
function Pipe({ t }: { t: number }) {
  const arm = (s: number, d: string) => (t & s ? <path d={d} /> : null)
  return (
    <svg viewBox="0 0 40 40" aria-hidden className="pp-pipe">
      {arm(N, 'M20 20 V0')}
      {arm(E, 'M20 20 H40')}
      {arm(S, 'M20 20 V40')}
      {arm(W, 'M20 20 H0')}
      <circle cx="20" cy="20" r={[N, E, S, W].filter((s) => t & s).length === 1 ? 7 : 4.5} />
    </svg>
  )
}

export function PipesDemo() {
  const [saved, setSaved] = useKept(PIPES_KEY, readSaved)
  const [seed, setSeed] = useState(() => seedFor(saved.size, saved.wrap))
  const daily = seed === seedFor(saved.size, saved.wrap)
  const fresh = useMemo(() => make(seed, saved.size, saved.wrap), [seed, saved.size, saved.wrap])
  const [board, setBoard] = useState<Board>(fresh)
  /** how many quarter turns each tile has been given, for the turning animation */
  const [spins, setSpins] = useState<number[]>(() => fresh.tiles.map(() => 0))
  const [locked, setLocked] = useState<Set<number>>(new Set())
  const [lockMode, setLockMode] = useState(false)
  const [turns, setTurns] = useState(0)
  const [started, setStarted] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [done, setDone] = useState<number | null>(null)
  const [cursor, setCursor] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  // a new board whenever the seed, size or wrapping changes
  useEffect(() => {
    setBoard(fresh)
    setSpins(fresh.tiles.map(() => 0))
    setLocked(new Set())
    setTurns(0)
    setStarted(null)
    setDone(null)
    setCursor(fresh.source)
  }, [fresh])
  // the clock, while a board is being worked on
  useEffect(() => {
    if (started === null || done !== null) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [started, done])

  const wet = reached(board)
  const p = useMemo(() => par(fresh), [fresh])
  const seconds = started === null ? 0 : Math.floor(((done ?? now) - started) / 1000)
  const today = dayNumber()
  const best = saved.bests.find(
    (b) => b.day === today && b.size === saved.size && b.wrap === saved.wrap,
  )

  const spin = (i: number, k: number) => {
    if (done !== null) return
    if (lockMode) {
      setLocked((l) => {
        const n = new Set(l)
        if (n.has(i)) n.delete(i)
        else n.add(i)
        return n
      })
      return
    }
    if (locked.has(i)) return
    const next = rotate(board, i, k)
    setBoard(next)
    setSpins((s) => s.map((x, j) => (j === i ? x + k : x)))
    setTurns((t) => t + 1)
    const start = started ?? Date.now()
    if (started === null) setStarted(start)
    if (solved(next)) {
      const end = Date.now()
      setDone(end)
      setNow(end)
      const secs = Math.max(1, Math.floor((end - start) / 1000))
      setSaved((s) => ({
        ...s,
        solvedCount: s.solvedCount + 1,
        bests: daily
          ? keepBest(
              s.bests,
              { day: today, size: s.size, wrap: s.wrap, seconds: secs, turns: turns + 1 },
              today,
            )
          : s.bests,
      }))
    }
  }

  const n = board.n
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const x = cursor % n
    const y = Math.floor(cursor / n)
    let next = -1
    if (e.key === 'ArrowLeft') next = y * n + Math.max(0, x - 1)
    else if (e.key === 'ArrowRight') next = y * n + Math.min(n - 1, x + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, y - 1) * n + x
    else if (e.key === 'ArrowDown') next = Math.min(n - 1, y + 1) * n + x
    else if (e.key === 'Enter' || e.key === ' ') spin(cursor, e.shiftKey ? -1 : 1)
    else if (e.key === 'l' || e.key === 'L') {
      setLocked((l) => {
        const s = new Set(l)
        if (s.has(cursor)) s.delete(cursor)
        else s.add(cursor)
        return s
      })
    } else return
    e.preventDefault()
    e.stopPropagation()
    if (next >= 0) {
      setCursor(next)
      refs.current[next]?.focus()
    }
  }

  const line =
    done !== null
      ? `🎉 Flowing everywhere in ${clock(seconds)}, with ${turns} turns — par is ${p}.${daily && best && best.seconds === seconds && best.turns === turns ? ' Your best today.' : ''}`
      : started === null
        ? `Turn the tiles until water from the source reaches every one, with no pipe open to nothing. Par is ${p} turns.`
        : `${wet.size} of ${n * n} tiles have water.`

  return (
    <div className={`lab-keys pp-room is-${saved.look}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Board size">
          {SIZES.map((s) => (
            <button
              key={s}
              className="btn btn-ghost"
              aria-pressed={saved.size === s}
              onClick={() => {
                setSaved((x) => ({ ...x, size: s as Size }))
                setSeed(seedFor(s, saved.wrap))
              }}
            >
              {s}×{s}
            </button>
          ))}
        </div>
        <button
          className="btn btn-ghost"
          aria-pressed={saved.wrap}
          onClick={() => {
            setSaved((x) => ({ ...x, wrap: !x.wrap }))
            setSeed(seedFor(saved.size, !saved.wrap))
          }}
        >
          Edges wrap round
        </button>
        <div className="lab-group" role="group" aria-label="Which board">
          <button
            className="btn btn-ghost"
            aria-pressed={daily}
            onClick={() => setSeed(seedFor(saved.size, saved.wrap))}
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
          <strong>{clock(seconds)}</strong>
          <span className="muted">{daily ? 'today’s board' : 'a random board'}</span>
        </div>
        <div className="dice-score">
          <span>Turns</span>
          <strong>{turns}</strong>
          <span className="muted">par {p}</span>
        </div>
        <div className="dice-score">
          <span>Today’s best</span>
          <strong>{best ? clock(best.seconds) : '—'}</strong>
          <span className="muted">{best ? `${best.turns} turns` : 'not yet'}</span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="pp-fit">
        <div
          className={`pp-board${done !== null ? ' is-done' : ''}${saved.wrap ? ' is-wrap' : ''}`}
          style={{ ['--pp-n' as string]: n }}
          role="group"
          aria-label={`The board, ${n} by ${n}. Arrow keys move, Enter or Space turns a tile clockwise and Shift turns it back, L locks it.`}
          onKeyDown={onKey}
        >
          {board.tiles.map((t, i) => (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={[
                'pp-tile',
                wet.has(i) ? 'is-wet' : '',
                i === board.source ? 'is-source' : '',
                locked.has(i) ? 'is-locked' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              tabIndex={i === cursor ? 0 : -1}
              aria-label={`Row ${Math.floor(i / n) + 1}, column ${(i % n) + 1}: pipe ${describe(t)}${i === board.source ? ', the source' : ''}${wet.has(i) ? ', has water' : ''}${locked.has(i) ? ', locked' : ''}`}
              onFocus={() => setCursor(i)}
              onClick={() => {
                setCursor(i)
                spin(i, 1)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                spin(i, -1)
              }}
            >
              <span className="pp-turn" style={{ transform: `rotate(${spins[i] * 90}deg)` }}>
                <Pipe t={fresh.tiles[i]} />
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="lab-controls">
        <button
          className="btn btn-ghost"
          aria-pressed={lockMode}
          onClick={() => setLockMode((m) => !m)}
        >
          🔒 Tap to lock
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            setBoard(fresh)
            setSpins(fresh.tiles.map(() => 0))
            setLocked(new Set())
            setTurns(0)
            setStarted(null)
            setDone(null)
          }}
        >
          ↺ Start this board again
        </button>
      </div>

      <p className="sun-reading">
        <span className="muted">Boards finished: {saved.solvedCount}</span>
      </p>
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Look</h3>
          <div className="lab-controls" role="group" aria-label="What flows">
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
        Every tile has been turned out of true. Turn them — a tap or click turns a tile clockwise, a
        right-click turns it back — until water from the source in the middle reaches every tile,
        with no pipe left open to nothing. The pipes were laid as one tree, so a finished board has
        no loops; any way of doing it counts. Par is the fewest turns it can be done in. Lock a tile
        you are sure of with 🔒 or the L key, so a stray tap cannot turn it. With edges wrapping
        round, a pipe off one side comes in at the other. Today’s board is the same for everyone;
        your best time on it is kept.
      </p>
    </div>
  )
}
