import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import {
  FLEETS,
  LEVELS,
  SEA_KEY,
  SIZES,
  THEMES,
  aim,
  allSunk,
  blankSeen,
  fire,
  fits,
  randomFleet,
  readSaved,
  recordBattle,
  shipCells,
  type Fleet,
  type FleetName,
  type Level,
  type Saved,
  type Seen,
  type Shot,
} from './seabattle'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

type Phase = 'setup' | 'battle' | 'over'

const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const FLEET_NAMES: Record<FleetName, string> = {
  classic: 'Classic (5 ships)',
  quick: 'Quick (4 ships)',
  swarm: 'Swarm (7 small ships)',
}
const THEME_NAMES: Record<Saved['theme'], string> = {
  navy: 'Navy',
  tropic: 'Tropic',
  arctic: 'Arctic',
}
const SHIP_NAMES: Record<number, string> = {
  5: 'Carrier',
  4: 'Battleship',
  3: 'Cruiser',
  2: 'Destroyer',
  1: 'Patrol boat',
}
const ROWS = 'ABCDEFGHIJ'
const where = (n: number, i: number) => `${ROWS[Math.floor(i / n)]}${(i % n) + 1}`

type Battle = {
  n: number
  sizes: readonly number[]
  apart: boolean
  again: boolean
  level: Level
  mine: Fleet
  theirs: Fleet
  /** what you have seen of their sea, and what the computer has seen of yours */
  myView: Seen
  theirView: Seen
  turn: 'you' | 'cpu'
  shots: number
  hits: number
  /** the last square each side shot at, for marking it */
  lastMine: number | null
  lastTheirs: number | null
}
const fresh = (s: Saved, rand = Math.random): Battle => {
  const sizes = FLEETS[s.fleet]
  return {
    n: s.size,
    sizes,
    apart: s.apart,
    again: s.again,
    level: s.level,
    mine: randomFleet(s.size, sizes, s.apart, rand),
    theirs: randomFleet(s.size, sizes, s.apart, rand),
    myView: blankSeen(s.size),
    theirView: blankSeen(s.size),
    turn: 'you',
    shots: 0,
    hits: 0,
    lastMine: null,
    lastTheirs: null,
  }
}

/** one sea as a grid of squares; only the one under the cursor is in the tab order */
function Sea({
  b,
  fleet,
  view,
  showShips,
  label,
  onPick,
  canPick,
  lit,
  last,
  cursor,
  setCursor,
  onKey,
  splash,
}: {
  b: Battle
  fleet: Fleet
  view: Seen
  showShips: boolean
  label: string
  onPick: (i: number) => void
  canPick: (i: number) => boolean
  lit?: number[]
  last: number | null
  cursor: number
  setCursor: (i: number) => void
  onKey?: (e: KeyboardEvent<HTMLDivElement>) => void
  splash: boolean
}) {
  const { n } = b
  const shipAt = new Map<number, number>()
  for (const s of fleet) for (const c of s.cells) shipAt.set(c, s.id)
  const sunk = new Set(view.sunk.flatMap((s) => s.cells))
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const d: Record<string, number> = { ArrowUp: -n, ArrowDown: n, ArrowLeft: -1, ArrowRight: 1 }
    if (d[e.key] !== undefined) {
      e.preventDefault()
      e.stopPropagation()
      const next = cursor + d[e.key]
      const sameRow = Math.floor(next / n) === Math.floor(cursor / n)
      if (next < 0 || next >= n * n || (Math.abs(d[e.key]) === 1 && !sameRow)) return
      setCursor(next)
      refs.current[next]?.focus()
      return
    }
    onKey?.(e)
  }
  return (
    <div
      className="sb-sea"
      role="grid"
      aria-label={label}
      style={{ '--n': n } as CSSProperties}
      onKeyDown={move}
    >
      <div role="row" className="sb-row sb-head" aria-hidden>
        <span />
        {Array.from({ length: n }, (_, c) => (
          <span key={c}>{c + 1}</span>
        ))}
      </div>
      {Array.from({ length: n }, (_, r) => (
        <div role="row" className="sb-row" key={r}>
          <span className="sb-rowname" aria-hidden>
            {ROWS[r]}
          </span>
          {Array.from({ length: n }, (_, c) => {
            const i = r * n + c
            const mark = view.marks[i]
            const ship = shipAt.has(i) && (showShips || sunk.has(i))
            const state = sunk.has(i)
              ? 'sunk'
              : mark === 2
                ? 'hit'
                : mark === 1
                  ? 'miss'
                  : 'unknown'
            const cls = `sb-cell${ship ? ' is-ship' : ''} is-${state}${lit?.includes(i) ? ' is-lit' : ''}${last === i ? ' is-last' : ''}${last === i && splash ? ' is-splash' : ''}`
            return (
              <div role="gridcell" key={c} className="sb-gridcell">
                <button
                  ref={(el) => {
                    refs.current[i] = el
                  }}
                  className={cls}
                  tabIndex={i === cursor ? 0 : -1}
                  aria-label={`${where(n, i)}, ${showShips && shipAt.has(i) && state === 'unknown' ? 'your ship' : state === 'unknown' ? 'not shot at' : state}`}
                  aria-disabled={!canPick(i)}
                  onClick={() => {
                    setCursor(i)
                    if (canPick(i)) onPick(i)
                  }}
                  onFocus={() => setCursor(i)}
                >
                  <span aria-hidden>
                    {state === 'miss' ? '•' : state === 'hit' ? '✕' : state === 'sunk' ? '✕' : ''}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function SeaBattleDemo() {
  const [saved, setSaved] = useKept(SEA_KEY, readSaved)
  const [phase, setPhase] = useState<Phase>('setup')
  const [b, setB] = useState<Battle>(() => fresh(saved))
  const [picked, setPicked] = useState(0)
  const [across, setAcross] = useState(true)
  const [line, setLine] = useState('Lay out your fleet — or shuffle it — then start the battle.')
  const [cursors, setCursors] = useState({ mine: 0, theirs: 0 })
  const timer = useRef(0)
  const firstMove = useRef<'you' | 'cpu'>('you')
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const restart = (s: Saved = saved) => {
    window.clearTimeout(timer.current)
    setB(fresh(s))
    setPhase('setup')
    setPicked(0)
    setLine('Lay out your fleet — or shuffle it — then start the battle.')
  }
  const change = (p: Partial<Saved>) => {
    const s = { ...saved, ...p }
    setSaved(s)
    if (
      phase !== 'battle' &&
      (p.size || p.fleet || p.apart !== undefined || p.level || p.again !== undefined)
    )
      restart(s)
  }

  const say = (who: string, at: number, shot: Shot, size?: number) =>
    shot === 'miss'
      ? `${who} ${where(b.n, at)} — a miss.`
      : shot === 'hit'
        ? `${who} ${where(b.n, at)} — a hit!`
        : `${who} ${where(b.n, at)} — ${size ? `the ${SHIP_NAMES[size].toLowerCase()} is` : 'a ship is'} sunk!`

  const finish = (won: boolean, bt: Battle) => {
    setPhase('over')
    setSaved((s) => ({
      ...s,
      record: { ...s.record, [bt.level]: recordBattle(s.record[bt.level], won, bt.shots) },
    }))
    setLine(
      won
        ? `🏆 Their whole fleet is sunk — in ${bt.shots} shots, ${Math.round((100 * bt.hits) / bt.shots)}% on target.`
        : 'Your fleet is sunk. Their ships are shown where they were hiding.',
    )
  }

  const cpuShoots = (bt: Battle) => {
    const at = aim(bt.theirView, bt.sizes, bt.apart, bt.level, Math.random)
    const shot = fire(bt.mine, bt.theirView, at)
    bt.lastMine = at
    const sunkSize =
      shot === 'sunk' ? bt.theirView.sunk[bt.theirView.sunk.length - 1].size : undefined
    if (allSunk(bt.mine, bt.theirView)) {
      setB({ ...bt })
      finish(false, bt)
      return
    }
    const again = shot !== 'miss' && bt.again
    bt.turn = again ? 'cpu' : 'you'
    setB({ ...bt })
    setLine(
      `${say('They fire at', at, shot, sunkSize)} ${again ? 'They fire again…' : 'Your shot.'}`,
    )
    if (again) timer.current = window.setTimeout(() => cpuShoots(bt), 700)
  }

  const shoot = (at: number) => {
    if (phase !== 'battle' || b.turn !== 'you' || b.myView.marks[at]) return
    const bt = { ...b }
    const shot = fire(bt.theirs, bt.myView, at)
    bt.shots++
    if (shot !== 'miss') bt.hits++
    bt.lastTheirs = at
    const sunkSize = shot === 'sunk' ? bt.myView.sunk[bt.myView.sunk.length - 1].size : undefined
    if (allSunk(bt.theirs, bt.myView)) {
      setB(bt)
      finish(true, bt)
      return
    }
    const again = shot !== 'miss' && bt.again
    bt.turn = again ? 'you' : 'cpu'
    setB(bt)
    setLine(
      `${say('You fire at', at, shot, sunkSize)} ${again ? 'Fire again.' : 'They are aiming…'}`,
    )
    if (!again) timer.current = window.setTimeout(() => cpuShoots(bt), 800)
  }

  const begin = () => {
    const bt = { ...b, turn: firstMove.current }
    setB(bt)
    setPhase('battle')
    setLine(
      firstMove.current === 'you'
        ? 'Fire at their sea — pick a square.'
        : 'They fire first this time…',
    )
    if (firstMove.current === 'cpu') timer.current = window.setTimeout(() => cpuShoots(bt), 900)
    firstMove.current = firstMove.current === 'you' ? 'cpu' : 'you'
  }

  /** setup: move the picked ship so it starts at `at` */
  const placeAt = (at: number) => {
    const ship = b.mine[picked]
    const cells = shipCells(b.n, at, ship.size, across)
    if (!cells || !fits(b.n, b.mine, cells, b.apart, ship.id)) {
      setLine(`The ${SHIP_NAMES[ship.size].toLowerCase()} does not fit there.`)
      return
    }
    const mine = b.mine.map((s) => (s.id === ship.id ? { ...s, cells } : s))
    setB({ ...b, mine })
    setLine(`${SHIP_NAMES[ship.size]} moved to ${where(b.n, at)}.`)
    setPicked((p) => (p + 1) % b.mine.length)
  }
  const setupKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Enter and Space reach the square's own button; R turns the picked ship
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault()
      setAcross((a) => !a)
    }
  }

  const record = saved.record[saved.level]
  const pending =
    phase === 'battle' &&
    (b.n !== saved.size ||
      b.level !== saved.level ||
      b.sizes !== FLEETS[saved.fleet] ||
      b.apart !== saved.apart ||
      b.again !== saved.again)
  const shipLit = phase === 'setup' ? b.mine[picked]?.cells : undefined
  const afloat = (fleet: Fleet, view: Seen) => fleet.length - view.sunk.length

  return (
    <div className={`lab-keys sb-room is-${saved.theme}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer plays">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => change({ level: l })}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        {phase === 'setup' ? (
          <>
            <button
              className="btn btn-ghost"
              onClick={() => setB({ ...b, mine: randomFleet(b.n, b.sizes, b.apart, Math.random) })}
            >
              🎲 Shuffle my fleet
            </button>
            <button className="btn" onClick={begin}>
              ⚓ Start the battle
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={() => restart()}>
            ↻ New battle
          </button>
        )}
      </div>

      <div className="dice-scores">
        <div className={`dice-score${phase === 'battle' && b.turn === 'you' ? ' is-up' : ''}`}>
          <span>You · {afloat(b.mine, b.theirView)} ships afloat</span>
          <strong>
            {b.shots} shots{b.shots ? ` · ${Math.round((100 * b.hits) / b.shots)}% hit` : ''}
          </strong>
        </div>
        <div className={`dice-score${phase === 'battle' && b.turn === 'cpu' ? ' is-up' : ''}`}>
          <span>The computer · {afloat(b.theirs, b.myView)} ships afloat</span>
          <strong>{b.theirView.marks.filter(Boolean).length} shots</strong>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className={`sb-seas${phase === 'setup' ? ' is-setup' : ''}`}>
        {phase !== 'setup' && (
          <section className="sb-theirs" aria-label="Their sea">
            <h3 className="fw-h">Their sea</h3>
            <Sea
              b={b}
              fleet={b.theirs}
              view={b.myView}
              showShips={phase === 'over'}
              label="Their sea: arrow keys move, Enter fires"
              onPick={shoot}
              canPick={(i) => phase === 'battle' && b.turn === 'you' && !b.myView.marks[i]}
              last={b.lastTheirs}
              cursor={cursors.theirs}
              setCursor={(i) => setCursors((c) => ({ ...c, theirs: i }))}
              splash={!reduced()}
            />
          </section>
        )}
        <section className="sb-mine" aria-label="Your sea">
          <h3 className="fw-h">Your sea</h3>
          <Sea
            b={b}
            fleet={b.mine}
            view={b.theirView}
            showShips
            label={
              phase === 'setup'
                ? 'Your sea: arrow keys move, Enter puts the picked ship here, R turns it'
                : 'Your sea'
            }
            onPick={placeAt}
            canPick={() => phase === 'setup'}
            lit={shipLit}
            last={b.lastMine}
            cursor={cursors.mine}
            setCursor={(i) => setCursors((c) => ({ ...c, mine: i }))}
            onKey={phase === 'setup' ? setupKey : undefined}
            splash={!reduced()}
          />
        </section>
        {phase === 'setup' && (
          <section className="sb-dock" aria-label="Your ships">
            <h3 className="fw-h">Your ships</h3>
            <div className="lab-controls" role="group" aria-label="Pick a ship to move">
              {b.mine.map((s, k) => (
                <button
                  key={s.id}
                  className="btn btn-ghost"
                  aria-pressed={picked === k}
                  onClick={() => setPicked(k)}
                >
                  {SHIP_NAMES[s.size]} · {s.size}
                </button>
              ))}
            </div>
            <div className="lab-controls">
              <button
                className="btn btn-ghost"
                aria-pressed={across}
                onClick={() => setAcross(true)}
              >
                ↔ Across
              </button>
              <button
                className="btn btn-ghost"
                aria-pressed={!across}
                onClick={() => setAcross(false)}
              >
                ↕ Down
              </button>
            </div>
            <p className="muted mc-note">Pick a ship, then tap the square where it should start.</p>
          </section>
        )}
      </div>

      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
          {record.fewest > 0 && <> · fewest shots to win {record.fewest}</>}
        </span>
      </p>
      {pending && <p className="muted mc-note">Your changes start with the next battle.</p>}

      <div className="fw-panel">
        <section aria-label="Rules">
          <h3 className="fw-h">Rules</h3>
          <div className="lab-controls" role="group" aria-label="Sea size">
            {SIZES.map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={saved.size === n}
                aria-label={`${n} by ${n} sea`}
                onClick={() => change({ size: n })}
              >
                {n}×{n}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Fleet">
            {(Object.keys(FLEETS) as FleetName[]).map((f) => (
              <button
                key={f}
                className="btn btn-ghost"
                aria-pressed={saved.fleet === f}
                onClick={() => change({ fleet: f })}
              >
                {FLEET_NAMES[f]}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.apart}
              onClick={() => change({ apart: !saved.apart })}
            >
              Ships may not touch
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={saved.again}
              onClick={() => change({ again: !saved.again })}
            >
              A hit fires again
            </button>
          </div>
        </section>
        <section aria-label="The sea">
          <h3 className="fw-h">The sea</h3>
          <div className="lab-controls" role="group" aria-label="Colours">
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
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Both fleets hide on their own grids. Take turns calling a square of the other sea: a dot is
        a miss, a cross a hit, and a ship is sunk when every square of it is hit. Sink their whole
        fleet first. Easy fires at random and is slow to finish a ship off; Fair searches on a
        chequerboard and works along a hit; Hard works out where the ships still afloat could lie
        and fires where they most likely are — it only ever knows what you would know, never where
        your ships are. Keys on a sea: arrows move, Enter fires; while laying out your fleet, Enter
        puts the picked ship down and R turns it.
      </p>
    </div>
  )
}
