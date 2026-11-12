import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  EXPECT,
  LEVELS,
  LOOKS,
  ROLLS,
  SHUT_CHANCE,
  SHUT_KEY,
  chooseDice,
  chooseWay,
  newTurn,
  oneDieAllowed,
  pick,
  readSaved,
  roll,
  rollTotal,
  score,
  sum,
  tilesOf,
  ways,
  type Level,
  type Saved,
  type Turn,
} from './shut'

type Mode = 'bot' | 'alone'
type Whose = 'you' | 'computer' | 'done'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(SHUT_KEY))
  } catch {
    return readSaved(null)
  }
}
const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const LOOK_NAMES: Record<Saved['look'], string> = { wood: 'Wood', felt: 'Felt', brass: 'Brass' }
/** which of the nine places on a die's face hold a pip, for 1 to 6 */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}
const TILES = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const and = (t: number[]) =>
  t.length > 1 ? `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}` : String(t[0] ?? '')
/** what the best player expects to be left with after rolling one die or two here */
const expectBy = (up: number, n: 1 | 2) =>
  ROLLS[n].reduce((s, { roll: r, p }) => {
    const w = ways(up, r)
    return s + p * (w.length ? Math.min(...w.map((x) => EXPECT[up & ~x])) : sum(up))
  }, 0)

export function ShutDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>('bot')
  const [level, setLevel] = useState<Level>(saved.level)
  const [whose, setWhose] = useState<Whose>('you')
  const [yours, setYours] = useState<Turn>(newTurn)
  const [theirs, setTheirs] = useState<Turn>(newTurn)
  /** the tiles the computer is about to shut, shown a moment before they go */
  const [aiming, setAiming] = useState(0)
  const [roller, setRoller] = useState(0)
  const [line, setLine] = useState(
    'Roll, then shut tiles that add up to the roll. Lowest total left wins; shut them all to shut the box.',
  )
  const recorded = useRef(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  /** whether the player was last working in the box, by key or by pointer */
  const inBox = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem(SHUT_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const t = whose === 'computer' ? theirs : yours
  const mine = whose === 'you'
  const best =
    saved.odds && mine && yours.live
      ? ways(yours.up, rollTotal(yours)).reduce(
          (b, x) => (EXPECT[yours.up & ~x] < EXPECT[yours.up & ~b] ? x : b),
          ways(yours.up, rollTotal(yours))[0] ?? 0,
        )
      : 0

  /** your turn is over: alone, the score; against the computer, its turn */
  const yoursDone = (u: Turn) => {
    const s = score(u)
    if (mode === 'alone') {
      setWhose('done')
      const record = saved.best === null || s < saved.best
      setSaved((x) => ({
        ...x,
        turns: x.turns + 1,
        shut: x.shut + (s === 0 ? 1 : 0),
        best: x.best === null ? s : Math.min(x.best, s),
      }))
      setLine(
        s === 0
          ? '🎉 You shut the box!'
          : `No way to make ${rollTotal(u)}: ${s} left${record ? ' — your best yet!' : '.'}`,
      )
      return
    }
    setWhose('computer')
    setTheirs(newTurn())
    setLine(
      s === 0
        ? '🎉 You shut the box! The computer must do the same to draw…'
        : `No way to make ${rollTotal(u)}: you are left with ${s}. The computer’s turn…`,
    )
  }

  // the computer's turn, a step at a time: roll, the tiles it will shut, shut them, roll again
  useEffect(() => {
    if (whose !== 'computer') return
    const wait = reduced() ? 250 : 750
    const timer = window.setTimeout(() => {
      if (theirs.over) {
        setWhose('done')
        return
      }
      if (!theirs.live) {
        const n = chooseDice(theirs.up, level)
        setRoller((k) => k + 1)
        const next = roll(theirs, n, Math.random)
        setTheirs(next)
        setLine(
          next.over
            ? `The computer rolls ${rollTotal(next)} and cannot make it.`
            : `The computer rolls ${rollTotal(next)}${n === 1 ? ' on one die' : ''}…`,
        )
        return
      }
      if (!aiming) {
        setAiming(chooseWay(theirs.up, rollTotal(theirs), level, Math.random))
        return
      }
      let next = theirs
      for (const tile of tilesOf(aiming)) next = pick(next, tile)
      setLine(`The computer shuts ${and(tilesOf(aiming))}.`)
      setAiming(0)
      setTheirs(next)
    }, wait)
    return () => window.clearTimeout(timer)
  }, [whose, theirs, aiming, level])

  // the end of a game against the computer: who left less, recorded once
  useEffect(() => {
    if (whose !== 'done' || mode !== 'bot' || recorded.current) return
    recorded.current = true
    const me = score(yours)
    const it = score(theirs)
    const r = me < it ? 'won' : me > it ? 'lost' : 'drawn'
    setSaved((s) => ({
      ...s,
      record: { ...s.record, [level]: { ...s.record[level], [r]: s.record[level][r] + 1 } },
    }))
    setLine(
      r === 'won'
        ? `🏆 You left ${me}, the computer ${it} — you win!`
        : r === 'lost'
          ? `The computer left ${it}, you ${me} — it wins.`
          : `${me} each — a draw.`,
    )
    // only the end of a game records it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whose])

  const fresh = (m: Mode = mode, lv: Level = saved.level) => {
    recorded.current = false
    setMode(m)
    setLevel(lv)
    setWhose('you')
    setYours(newTurn())
    setTheirs(newTurn())
    setAiming(0)
    setLine(m === 'alone' ? 'Alone: shut as many as you can. Roll.' : 'Your turn first. Roll.')
  }
  const rollMine = (n: 1 | 2) => {
    if (!mine || yours.live || yours.over) return
    if (n === 1 && !oneDieAllowed(yours.up)) return
    setRoller((k) => k + 1)
    const next = roll(yours, n, Math.random)
    setYours(next)
    if (next.over) yoursDone(next)
    else setLine(`You rolled ${rollTotal(next)}. Shut tiles that add up to it.`)
  }
  const tap = (tile: number) => {
    if (!mine || !yours.live) return
    const next = pick(yours, tile)
    if (next === yours) {
      setLine(`That would go past ${rollTotal(yours)}.`)
      return
    }
    setYours(next)
    if (next.over) yoursDone(next)
    else if (!next.live) setLine(`Shut. ${sum(next.up)} still up — roll again.`)
    else setLine(`${sum(next.picked)} of ${rollTotal(next)} picked.`)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key.toLowerCase()
    if (/^[1-9]$/.test(e.key)) tap(Number(e.key))
    else if (k === 'r' || k === ' ') rollMine(2)
    else if (k === 'o') rollMine(1)
    else return
    e.preventDefault()
  }

  // a control that is pressed and then disabled by what it did drops the focus on the page, and a
  // keyboard player's next key goes nowhere: after a roll the Roll button is disabled, and after a
  // shut the tiles are. So the focus moves on to what comes next — a tile, or the Roll button —
  // when it was in the box and has just been dropped
  useEffect(() => {
    const box = boxRef.current
    const active = document.activeElement as HTMLButtonElement | null
    const dropped =
      !active || active === document.body || (box?.contains(active) && active.disabled)
    if (!box || !inBox.current || !dropped) return
    const next = box.querySelector<HTMLButtonElement>(
      yours.live ? '.xb-tile:not(:disabled)' : '.xb-roll .btn:not(:disabled)',
    )
    next?.focus()
  }, [yours.live, yours.over, whose])
  useEffect(() => {
    const away = (e: FocusEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) inBox.current = false
    }
    document.addEventListener('focusin', away)
    return () => document.removeEventListener('focusin', away)
  }, [])

  const record = saved.record[saved.level]
  const showDice = t.dice.length > 0
  return (
    <div className={`lab-keys xb-room is-${saved.look}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Opponent">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'bot'}
            onClick={() => fresh('bot')}
          >
            Against the computer
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'alone'}
            onClick={() => fresh('alone')}
          >
            Alone
          </button>
        </div>
        {mode === 'bot' && (
          <div className="lab-group" role="group" aria-label="How well the computer plays">
            {LEVELS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.level === l}
                onClick={() => {
                  setSaved((s) => ({ ...s, level: l }))
                  if (whose === 'done' || (!yours.dice.length && mine)) fresh(mode, l)
                }}
              >
                {LEVEL_NAMES[l]}
              </button>
            ))}
          </div>
        )}
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ {mode === 'alone' ? 'New turn' : 'New game'}
        </button>
      </div>
      <div className="dice-scores">
        <div className={`dice-score${mine ? ' is-up' : ''}`}>
          <span>You</span>
          <strong>{sum(yours.up)}</strong>
          <span className="muted">still up</span>
        </div>
        {mode === 'bot' ? (
          <div className={`dice-score${whose === 'computer' ? ' is-up' : ''}`}>
            <span>The computer · {LEVEL_NAMES[level].toLowerCase()}</span>
            <strong>{whose === 'you' ? '—' : sum(theirs.up)}</strong>
            <span className="muted">still up</span>
          </div>
        ) : (
          <div className="dice-score">
            <span>Best alone</span>
            <strong>{saved.best ?? '—'}</strong>
            <span className="muted">
              shut {saved.shut} in {saved.turns}
            </span>
          </div>
        )}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        ref={boxRef}
        className="xb-box"
        onKeyDown={(e) => {
          inBox.current = true
          onKey(e)
        }}
        onPointerDown={() => {
          inBox.current = true
        }}
      >
        <p className="xb-whose">{whose === 'computer' ? 'The computer’s box' : 'Your box'}</p>
        <div
          className="xb-tiles"
          role="group"
          aria-label="The tiles: press one, or its number, to shut it"
        >
          {TILES.map((tile) => {
            const bit = 1 << (tile - 1)
            const up = (t.up & bit) !== 0
            const picked = (t.picked & bit) !== 0 || (whose === 'computer' && (aiming & bit) !== 0)
            return (
              <button
                key={tile}
                className={[
                  'xb-tile',
                  up ? '' : 'is-down',
                  picked ? 'is-picked' : '',
                  best & bit ? 'is-advised' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!mine || !yours.live || !up}
                aria-pressed={picked}
                aria-label={`${tile}: ${up ? (picked ? 'picked' : 'up') : 'shut'}${best & bit ? ', in the best way' : ''}`}
                onClick={() => tap(tile)}
              >
                {tile}
              </button>
            )
          })}
        </div>
        <div className="dice-row" aria-live="off">
          {showDice ? (
            t.dice.map((d, i) => (
              <span
                key={`${i}-${roller}`}
                className={`die is-kept${reduced() ? '' : ' xb-tumble'}`}
                role="img"
                aria-label={`A die showing ${d}`}
              >
                <span className="die-face" aria-hidden>
                  {Array.from({ length: 9 }, (_, k) => (
                    <span key={k} className={PIPS[d].includes(k) ? 'pip' : undefined} />
                  ))}
                </span>
              </span>
            ))
          ) : (
            <span className="muted xb-nodice">No dice rolled yet</span>
          )}
        </div>
        <div className="lab-controls xb-roll">
          <button
            className="btn"
            onClick={() => rollMine(2)}
            disabled={!mine || yours.live || yours.over}
          >
            🎲🎲 Roll two
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => rollMine(1)}
            disabled={!mine || yours.live || yours.over || !oneDieAllowed(yours.up)}
          >
            🎲 Roll one
          </button>
        </div>
        {saved.odds && mine && !yours.over && (
          <p className="muted xb-odds">
            {yours.live
              ? best
                ? `Best: shut ${and(tilesOf(best))} — leaves ${EXPECT[yours.up & ~best].toFixed(1)} to expect.`
                : ''
              : `Expect to be left with ${expectBy(yours.up, 2).toFixed(1)} on two dice${oneDieAllowed(yours.up) ? `, ${expectBy(yours.up, 1).toFixed(1)} on one` : ''}; a ${(SHUT_CHANCE[yours.up] * 100).toFixed(1)}% chance to shut the box from here.`}
          </p>
        )}
      </div>

      {mode === 'bot' && (
        <p className="sun-reading">
          <span className="muted">
            On {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
            {record.drawn ? `, drawn ${record.drawn}` : ''}
          </span>
        </p>
      )}
      <div className="fw-panel">
        <section aria-label="Looks and help">
          <h3 className="fw-h">Box</h3>
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
              aria-pressed={saved.odds}
              onClick={() => setSaved((s) => ({ ...s, odds: !s.odds }))}
            >
              Show the odds
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Nine tiles, 1 to 9. Roll two dice and shut any tiles still up that add up to the roll — one
        tile or several — then roll again, until a roll cannot be made from what is left. Add up the
        tiles still up: lower is better, and none at all is shutting the box. Once the 7, 8 and 9
        are down you may roll one die instead of two. Against the computer, you each take a turn and
        the lower total wins. Easy shuts any way that adds up; Fair the fewest tiles, the biggest;
        Hard has worked out every one of the 512 ways the tiles can stand and plays the best — it
        shuts the box about one turn in ten. Show the odds marks its choice for you. Keys: R or
        Space rolls two, O rolls one, 1 to 9 pick tiles.
      </p>
    </div>
  )
}
