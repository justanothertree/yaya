import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  DOMINOES_KEY,
  LEVELS,
  STYLES,
  TARGETS,
  choose,
  deal,
  drawOrPass,
  ends,
  fits,
  lay,
  playable,
  readSaved,
  same,
  type Level,
  type Round,
  type Saved,
  type Side,
  type Tile,
} from './dominoes'
import { motionReduced as reduced } from '../ui/motion'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(DOMINOES_KEY))
  } catch {
    return readSaved(null)
  }
}
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const STYLE_NAMES: Record<Saved['style'], string> = {
  ivory: 'Ivory',
  ebony: 'Ebony',
  candy: 'Candy',
}
const WORDS = ['blank', 'one', 'two', 'three', 'four', 'five', 'six']
const tileName = (t: [number, number]) => `${WORDS[t[0]]}–${WORDS[t[1]]}`

/** where the pips sit on a half, for each number, in a 3 × 3 */
const PIPS: number[][] = [
  [],
  [4],
  [0, 8],
  [0, 4, 8],
  [0, 2, 6, 8],
  [0, 2, 4, 6, 8],
  [0, 2, 3, 5, 6, 8],
]
function Half({ n, x }: { n: number; x: number }) {
  return (
    <>
      {PIPS[n].map((k) => (
        <circle key={k} cx={x + 8.5 + (k % 3) * 8} cy={7 + Math.floor(k / 3) * 8} r={2.4} />
      ))}
    </>
  )
}
function Domino({ a, b }: { a: number; b: number }) {
  return (
    <svg className="dm-tile" viewBox="0 0 66 30" aria-hidden>
      <rect x={1} y={1} width={64} height={28} rx={5} className="dm-face" />
      <line x1={33} y1={4} x2={33} y2={26} className="dm-bar" />
      <g className="dm-pips">
        <Half n={a} x={0} />
        <Half n={b} x={33} />
      </g>
    </svg>
  )
}

export function DominoesDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [level, setLevel] = useState<Level>(saved.level)
  const [round, setRound] = useState<Round>(() => deal((Math.random() * 2 ** 31) | 0, 0))
  const [totals, setTotals] = useState<[number, number]>([0, 0])
  const [picked, setPicked] = useState<Tile | null>(null)
  const [line, setLine] = useState('Your lead: lay any tile to start the line.')
  const [cursor, setCursor] = useState(0)
  const [over, setOver] = useState(false)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const timer = useRef(0)
  const levelRef = useRef(level)
  useEffect(() => {
    try {
      localStorage.setItem(DOMINOES_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const settle = (r: Round, t: [number, number]) => {
    const o = r.over!
    const next: [number, number] = [...t]
    if (o.winner !== null) next[o.winner] += o.points
    setTotals(next)
    const why =
      o.why === 'out'
        ? `${o.winner === 0 ? 'You are' : 'The computer is'} out`
        : 'The line is blocked'
    const gain =
      o.winner === null
        ? 'a tie — no points'
        : `${o.winner === 0 ? 'you score' : 'the computer scores'} ${o.points}`
    if (Math.max(...next) >= saved.target) {
      const won = next[0] > next[1]
      const lv = levelRef.current
      setSaved((s) => ({
        ...s,
        record: {
          ...s.record,
          [lv]: { won: s.record[lv].won + (won ? 1 : 0), lost: s.record[lv].lost + (won ? 0 : 1) },
        },
      }))
      setOver(true)
      setLine(
        `${why}: ${gain}. ${won ? '🏆 You win the game' : 'The computer wins the game'}, ${Math.max(...next)} to ${Math.min(...next)}.`,
      )
    } else setLine(`${why}: ${gain}. Next round when you are ready.`)
  }

  /** the computer's turn, an action at a time: lay, or draw (and look again), or pass */
  const computer = (r: Round, t: [number, number]) => {
    const gap = reduced() ? 150 : 650
    timer.current = window.setTimeout(() => {
      if (r.over) return
      const c = choose(r, levelRef.current)
      let next: Round
      if (c) {
        next = lay(r, c.tile, c.side)
        setLine(`The computer lays ${tileName(c.tile)}.`)
      } else {
        next = drawOrPass(r)
        setLine(
          r.yard.length
            ? 'The computer draws from the boneyard…'
            : 'The computer cannot play, and passes.',
        )
      }
      setRound(next)
      if (next.over) return settle(next, t)
      if (next.turn === 1) computer(next, t)
      else
        setLine((l) => `${l} Your turn.${playable(next, 0).length ? '' : ' Nothing fits — draw.'}`)
    }, gap)
  }
  const after = (r: Round) => {
    setRound(r)
    setPicked(null)
    if (r.over) return settle(r, totals)
    if (r.turn === 1) {
      setLine('The computer is thinking…')
      computer(r, totals)
    }
  }
  const tap = (t: Tile) => {
    if (over || round.over || round.turn !== 0) return
    const sides = fits(round, t)
    if (!sides.length) return setLine(`${tileName(t)} does not match either end.`)
    if (sides.length === 1) return after(lay(round, t, sides[0]))
    setPicked(t)
    setLine(`${tileName(t)} fits both ends — which side?`)
  }
  const draw = () => {
    if (round.turn !== 0 || round.over || playable(round, 0).length) return
    const next = drawOrPass(round)
    if (next.turn === 1) setLine('You pass.')
    else setLine(`You draw ${tileName(next.hands[0][next.hands[0].length - 1])}.`)
    after(next)
  }
  const nextRound = (fresh = false) => {
    window.clearTimeout(timer.current)
    const first = (fresh ? 0 : round.over && round.over.winner === 1 ? 1 : 0) as 0 | 1
    if (fresh) {
      setTotals([0, 0])
      setOver(false)
      levelRef.current = saved.level
      setLevel(saved.level)
    }
    const r = deal((Math.random() * 2 ** 31) | 0, first)
    setRound(r)
    setPicked(null)
    setCursor(0)
    if (first === 1) {
      setLine('The computer leads this round…')
      computer(r, fresh ? [0, 0] : totals)
    } else setLine('Your lead: lay any tile to start the line.')
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const n = Math.max(
      0,
      Math.min(round.hands[0].length - 1, cursor + (e.key === 'ArrowLeft' ? -1 : 1)),
    )
    setCursor(n)
    refs.current[n]?.focus()
  }

  const e = ends(round)
  const can = new Set(
    round.turn === 0 && !round.over ? playable(round, 0).map((t) => t.join()) : [],
  )
  const mustDraw = round.turn === 0 && !round.over && !can.size
  const r = saved.record[saved.level]
  return (
    <div className={`lab-keys dm-room is-${saved.style}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer plays">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (over || (totals[0] + totals[1] === 0 && !round.line.length)) {
                  levelRef.current = l
                  setLevel(l)
                }
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="Play to">
          {TARGETS.map((n) => (
            <button
              key={n}
              className="btn btn-ghost"
              aria-pressed={saved.target === n}
              onClick={() => setSaved((s) => ({ ...s, target: n }))}
            >
              To {n}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => nextRound(true)}>
          ↻ New game
        </button>
      </div>
      <div className="dice-scores">
        <div className={`dice-score${round.turn === 0 && !round.over ? ' is-up' : ''}`}>
          <span>You</span>
          <strong>{totals[0]}</strong>
          <span className="muted">{round.hands[0].length} tiles</span>
        </div>
        <div className={`dice-score${round.turn === 1 && !round.over ? ' is-up' : ''}`}>
          <span>The computer · {LEVEL_NAMES[level]}</span>
          <strong>{totals[1]}</strong>
          <span className="muted">
            {round.hands[1].length} tiles · boneyard {round.yard.length}
          </span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="dm-table">
        <div
          className="dm-theirs"
          role="img"
          aria-label={`The computer holds ${round.hands[1].length} tiles`}
        >
          {round.hands[1].map((_, k) => (
            <span key={k} className="dm-back" />
          ))}
        </div>
        <div
          className="dm-line"
          role="img"
          aria-label={
            e
              ? `The line, ${round.line.length} tiles: the left end is ${e[0]}, the right end ${e[1]}`
              : 'The table is empty'
          }
        >
          {round.line.map((l, k) => (
            <span
              key={k}
              className={`dm-laid${k === 0 || k === round.line.length - 1 ? ' is-end' : ''}${l.a === l.b ? ' is-double' : ''}`}
            >
              <Domino a={l.a} b={l.b} />
            </span>
          ))}
          {!round.line.length && <span className="muted">The line starts here.</span>}
        </div>
        {e && (
          <p className="dm-ends" aria-hidden>
            ends: <strong>{e[0]}</strong> and <strong>{e[1]}</strong>
          </p>
        )}
      </div>

      {picked && (
        <div className="lab-controls" role="group" aria-label="Which end">
          {(['left', 'right'] as Side[]).map((sd) => (
            <button key={sd} className="btn" onClick={() => after(lay(round, picked, sd))}>
              On the {sd} ({sd === 'left' ? e![0] : e![1]})
            </button>
          ))}
          <button className="btn btn-ghost" onClick={() => setPicked(null)}>
            Not this one
          </button>
        </div>
      )}
      <div
        className="dm-hand"
        role="group"
        aria-label="Your tiles. Left and right arrows move along them, Enter lays one."
        onKeyDown={onKey}
      >
        {round.hands[0].map((t, k) => {
          const ok = can.has(t.join())
          return (
            <button
              key={t.join()}
              ref={(el) => {
                refs.current[k] = el
              }}
              className={`dm-mine${ok && saved.hints ? ' is-ok' : ''}${picked && same(picked, t) ? ' is-picked' : ''}`}
              tabIndex={k === cursor ? 0 : -1}
              aria-label={`${tileName(t)}${ok ? ', fits' : ''}`}
              onFocus={() => setCursor(k)}
              onClick={() => {
                setCursor(k)
                tap(t)
              }}
            >
              <Domino a={t[0]} b={t[1]} />
            </button>
          )
        })}
      </div>
      <div className="lab-controls">
        {mustDraw && (
          <button className="btn" onClick={draw}>
            {round.yard.length ? `Draw from the boneyard (${round.yard.length})` : 'Pass'}
          </button>
        )}
        {round.over && !over && (
          <button className="btn" onClick={() => nextRound()}>
            ▶ Next round
          </button>
        )}
        {over && (
          <button className="btn" onClick={() => nextRound(true)}>
            ↻ New game
          </button>
        )}
      </div>
      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {r.won}, lost {r.lost}
        </span>
      </p>
      <div className="fw-panel">
        <section aria-label="Tiles">
          <h3 className="fw-h">Tiles</h3>
          <div className="lab-controls" role="group" aria-label="Tile style">
            {STYLES.map((st) => (
              <button
                key={st}
                className="btn btn-ghost"
                aria-pressed={saved.style === st}
                onClick={() => setSaved((s) => ({ ...s, style: st }))}
              >
                {STYLE_NAMES[st]}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Light up what fits
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Lay a tile whose number matches an open end of the line. With nothing that fits, draw from
        the boneyard until something does, and pass when it is empty. Out first and you score the
        pips left in the computer's hand; if neither of you can play, the lighter hand scores the
        difference. First to the target wins. Easy lays anything that fits; Fair keeps its hand
        varied and sheds heavy tiles; Hard also remembers what you could not follow and counts the
        tiles it has not seen. Keys: left and right arrows move along your tiles, Enter lays one.
      </p>
    </div>
  )
}
