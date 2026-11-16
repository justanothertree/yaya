import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  CATS,
  LEVELS,
  LOOKS,
  YACHT_KEY,
  bestBox,
  chooseBox,
  chooseKeep,
  fill,
  hold,
  newGame,
  open,
  readSaved,
  roll,
  score,
  soloGame,
  total,
  type Cat,
  type Game,
  type Level,
  type Saved,
} from './yacht'
import { motionReduced as reduced } from '../ui/motion'
import { DieFace } from './DieFace'
import { useKept } from './kept'

type Mode = 'bot' | 'alone'
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const LOOK_NAMES: Record<Saved['look'], string> = { felt: 'Felt', wood: 'Wood', sea: 'Sea' }
const BOXES: Record<Cat, [string, string]> = {
  ones: ['Ones', 'the ones'],
  twos: ['Twos', 'the twos'],
  threes: ['Threes', 'the threes'],
  fours: ['Fours', 'the fours'],
  fives: ['Fives', 'the fives'],
  sixes: ['Sixes', 'the sixes'],
  full: ['Full house', 'three and two: all five'],
  four: ['Four of a kind', 'the four'],
  little: ['Little straight', '1 to 5: 30'],
  big: ['Big straight', '2 to 6: 30'],
  choice: ['Choice', 'all five'],
  yacht: ['Yacht', 'five alike: 50'],
}
const dicePhrase = (dice: number[]) => (dice.length ? [...dice].sort().join(' ') : 'nothing')

export function YachtDemo() {
  const [saved, setSaved] = useKept(YACHT_KEY, readSaved)
  const [mode, setMode] = useState<Mode>('bot')
  const [level, setLevel] = useState<Level>(saved.level)
  const [game, setGame] = useState<Game>(() => newGame(0))
  const [line, setLine] = useState(
    'Roll up to three times, keeping any dice between rolls, then score them in one of the twelve boxes.',
  )
  const [roller, setRoller] = useState(0)
  /** who went first in this game against the computer: the next one, the other side does */
  const [starter, setStarter] = useState<0 | 1>(0)
  const recorded = useRef(false)

  const mine = game.cards[0]
  const theirs = game.cards[1]
  const yours = !game.over && game.turn === 0
  const computer = mode === 'bot' && !game.over && game.turn === 1
  const rolled = game.rolls < 3
  const advice =
    saved.advice && yours && rolled && game.rolls > 0
      ? chooseKeep(game.dice, mine, game.rolls, 'hard')
      : null
  const adviceBox = saved.advice && yours && rolled ? bestBox(game.dice, mine) : null

  // the computer's turn, a step at a time so it can be followed: roll, keep, roll, keep, score
  useEffect(() => {
    if (!computer) return
    const t = window.setTimeout(
      () => {
        const card = game.cards[1]
        if (game.rolls === 3) {
          setRoller((n) => n + 1)
          setGame(roll(game, Math.random))
          setLine('The computer rolls…')
          return
        }
        if (game.rolls > 0) {
          const keep = chooseKeep(game.dice, card, game.rolls, level)
          if (!keep.every(Boolean)) {
            if (keep.some((k, i) => k !== game.held[i])) {
              setGame(hold(game, keep))
              setLine(`The computer keeps ${dicePhrase(game.dice.filter((_, i) => keep[i]))}.`)
            } else {
              setRoller((n) => n + 1)
              setGame(roll(game, Math.random))
              setLine('The computer rolls again…')
            }
            return
          }
        }
        const box = chooseBox(game.dice, card, level)
        const got = score(game.dice, box)
        setGame(fill(game, box))
        setLine(
          `The computer scores ${got} in ${BOXES[box][0].toLowerCase()}. Your turn: roll the dice.`,
        )
      },
      reduced() ? 250 : 700,
    )
    return () => window.clearTimeout(t)
    // the game is what moves the computer on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computer, game])

  // the end of a game: the record, once
  useEffect(() => {
    if (!game.over || recorded.current) return
    recorded.current = true
    const me = total(game.cards[0])
    if (mode === 'alone') {
      const record = me > saved.best
      setSaved((s) => ({ ...s, best: Math.max(s.best, me) }))
      setLine(`All twelve boxes filled: ${me} points${record ? ' — your best alone!' : '.'}`)
      return
    }
    const them = total(game.cards[1])
    const r = me > them ? 'won' : me < them ? 'lost' : 'drawn'
    setSaved((s) => ({
      ...s,
      record: { ...s.record, [level]: { ...s.record[level], [r]: s.record[level][r] + 1 } },
    }))
    setLine(
      r === 'won'
        ? `🏆 ${me} to ${them} — you win!`
        : r === 'lost'
          ? `${them} to ${me} — the computer wins.`
          : `${me} each — a draw.`,
    )
    // only the end of a game records it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.over])

  const fresh = (m: Mode = mode, lv: Level = saved.level) => {
    recorded.current = false
    setMode(m)
    setLevel(lv)
    // against the computer, whoever went second in a game under way or over goes first
    const begun = Object.keys(mine).length + Object.keys(theirs).length > 0
    const first: 0 | 1 = m === 'bot' && m === mode && begun ? (starter === 0 ? 1 : 0) : 0
    setStarter(first)
    setGame(m === 'alone' ? soloGame() : newGame(first))
    setLine(
      m === 'alone'
        ? 'Twelve turns alone: fill every box for the best total you can.'
        : first
          ? 'A new game — the computer goes first.'
          : 'A new game. Roll the dice.',
    )
  }
  const rollMine = () => {
    if (!yours || game.rolls === 0) return
    setRoller((n) => n + 1)
    const g = roll(game, Math.random)
    setGame(g)
    setLine(
      g.rolls
        ? `You rolled ${g.dice.join(' ')}. Tap dice to keep them, then roll again — or score now.`
        : `You rolled ${g.dice.join(' ')}. Choose a box to score them in.`,
    )
  }
  const toggle = (i: number) => {
    if (!yours || !rolled || game.rolls === 0) return
    setGame(
      hold(
        game,
        game.held.map((h, k) => (k === i ? !h : h)),
      ),
    )
  }
  const take = (box: Cat) => {
    if (!yours || !rolled || mine[box] !== undefined) return
    const got = score(game.dice, box)
    setGame(fill(game, box))
    setLine(
      `${got} in ${BOXES[box][0].toLowerCase()}.${mode === 'bot' ? ' The computer’s turn…' : ''}`,
    )
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLButtonElement && e.target.closest('.yt-card')) return
    const n = Number(e.key)
    if (n >= 1 && n <= 5) toggle(n - 1)
    else if (e.key === 'r' || e.key === 'R') rollMine()
    else return
    e.preventDefault()
  }

  const record = saved.record[saved.level]
  const meTotal = total(mine)
  return (
    <div className={`lab-keys yt-room is-${saved.look}`}>
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
                  if (game.over || (!Object.keys(mine).length && !Object.keys(theirs).length))
                    fresh(mode, l)
                }}
              >
                {LEVEL_NAMES[l]}
              </button>
            ))}
          </div>
        )}
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>
      <div className="dice-scores">
        <div className={`dice-score${yours ? ' is-up' : ''}`}>
          <span>You</span>
          <strong>{meTotal}</strong>
          <span className="muted">{12 - open(mine).length} of 12 boxes</span>
        </div>
        {mode === 'bot' ? (
          <div className={`dice-score${computer ? ' is-up' : ''}`}>
            <span>The computer · {LEVEL_NAMES[level].toLowerCase()}</span>
            <strong>{total(theirs)}</strong>
            <span className="muted">{12 - open(theirs).length} of 12 boxes</span>
          </div>
        ) : (
          <div className="dice-score">
            <span>Best alone</span>
            <strong>{Math.max(saved.best, game.over ? meTotal : 0)}</strong>
            <span className="muted">of 297 possible</span>
          </div>
        )}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="yt-play">
        <div className="yt-table" onKeyDown={onKey}>
          <div
            className="dice-row"
            role="group"
            aria-label="The dice: press a die, or 1 to 5, to keep it"
          >
            {game.dice.map((d, i) => (
              <button
                key={`${i}-${roller}`}
                className={[
                  'die',
                  game.held[i] ? 'is-picked' : '',
                  advice?.[i] ? 'is-advised' : '',
                  rolled && !game.held[i] && !reduced() ? 'yt-tumble' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-pressed={game.held[i]}
                aria-label={
                  rolled
                    ? `Die ${i + 1} showing ${d}${game.held[i] ? ', kept' : ''}${advice?.[i] ? ', worth keeping' : ''}`
                    : `Die ${i + 1}, not rolled yet`
                }
                disabled={!yours || !rolled || game.rolls === 0}
                onClick={() => toggle(i)}
                style={rolled ? undefined : { opacity: 0.45 }}
              >
                <DieFace face={d} />
              </button>
            ))}
          </div>
          <div className="lab-controls yt-roll">
            <button
              className="btn"
              onClick={rollMine}
              disabled={!yours || game.rolls === 0}
              data-focus-next=".yt-box:not(:disabled)"
            >
              🎲 {rolled ? 'Roll again' : 'Roll'} ({game.rolls} left)
            </button>
          </div>
        </div>

        <table className="yt-card">
          <caption className="sr-only">The score card</caption>
          <thead>
            <tr>
              <th scope="col">Box</th>
              <th scope="col">You</th>
              {mode === 'bot' && <th scope="col">Computer</th>}
            </tr>
          </thead>
          <tbody>
            {CATS.map((k) => {
              const could = yours && rolled && mine[k] === undefined
              return (
                <tr key={k} className={k === 'full' ? 'yt-split' : undefined}>
                  <th scope="row">
                    {BOXES[k][0]}
                    <span className="muted yt-rule">{BOXES[k][1]}</span>
                  </th>
                  <td>
                    {mine[k] !== undefined ? (
                      <span className="yt-done">{mine[k]}</span>
                    ) : (
                      <button
                        className={`yt-box${could && adviceBox === k ? ' is-advised' : ''}`}
                        disabled={!could}
                        data-focus-next=".yt-roll .btn:not(:disabled)"
                        aria-label={
                          could
                            ? `Score ${score(game.dice, k)} in ${BOXES[k][0].toLowerCase()}${adviceBox === k ? ', the best box' : ''}`
                            : `${BOXES[k][0]}: open`
                        }
                        onClick={() => take(k)}
                      >
                        {could ? score(game.dice, k) : '·'}
                      </button>
                    )}
                  </td>
                  {mode === 'bot' && (
                    <td>
                      <span className="yt-done">{theirs[k] ?? ''}</span>
                    </td>
                  )}
                </tr>
              )
            })}
            <tr className="yt-total">
              <th scope="row">Total</th>
              <td>{meTotal}</td>
              {mode === 'bot' && <td>{total(theirs)}</td>}
            </tr>
          </tbody>
        </table>
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
          <h3 className="fw-h">Table</h3>
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
              aria-pressed={saved.advice}
              onClick={() => setSaved((s) => ({ ...s, advice: !s.advice }))}
            >
              Show the best play
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Each turn, roll the five dice up to three times, keeping any you like between rolls, then
        score them in a box you have not used: ones to sixes count those faces; a full house (three
        of one and two of another) and choice count all five; four of a kind counts the four; a
        little straight (1–5) or big straight (2–6) is 30; a yacht, five alike, is 50. Dice that do
        not fit a box score nothing there — sometimes a nought is the best place for a bad turn.
        Twelve turns each. Easy keeps whatever it has most of; Fair looks one roll ahead; Hard works
        out every roll left and weighs each box against what it usually scores. Show the best play
        marks the dice and the box Hard would choose. Keys: 1 to 5 keep a die, R rolls.
      </p>
    </div>
  )
}
