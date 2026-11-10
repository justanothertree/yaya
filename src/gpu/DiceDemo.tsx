import { useEffect, useRef, useState } from 'react'
import {
  BUST,
  DICE_KEY,
  TARGET,
  chooseKeep,
  newTurn,
  readSaved,
  rollOn,
  scoreOf,
  setAside,
  wantsBank,
  type Saved,
  type Turn,
} from './dice'
import { BeatShare } from '../lab/BeatShare'
import { useChallenge } from '../lab/useChallenge'
import { beatsDice, dealRand, newSeed, type Beat } from '../lab/beat'

/** against the computer, two at one screen, or alone against the turn count on a numbered deal */
type Mode = 'bot' | 'two' | 'race'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(DICE_KEY))
  } catch {
    return readSaved(null)
  }
}

/** which of the nine places on a die's face hold a pip, for 1 to 6 */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

function Die({
  face,
  picked,
  onClick,
  still,
}: {
  face: number
  picked?: boolean
  onClick?: () => void
  still?: boolean
}) {
  const pips = (
    <span className="die-face" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={PIPS[face].includes(i) ? 'pip' : undefined} />
      ))}
    </span>
  )
  if (still)
    return (
      <span className="die is-kept" role="img" aria-label={`${face}`}>
        {pips}
      </span>
    )
  return (
    <button
      className={`die${picked ? ' is-picked' : ''}`}
      aria-pressed={picked}
      aria-label={`Die showing ${face}`}
      onClick={onClick}
    >
      {pips}
    </button>
  )
}

const pct = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`

export function DiceDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  /** a friend's race to beat, from the address: it opens on their deal */
  const [challenge, leaveChallenge] = useChallenge('dice')
  const [mode, setMode] = useState<Mode>(() => (challenge ? 'race' : 'bot'))
  /** the deal a race is played on, and which roll of the turn is next — see dealRand */
  const deal = useRef(challenge?.seed ?? newSeed())
  const rollNo = useRef(0)
  /** the last race finished, which can be sent as a challenge */
  const [lastRace, setLastRace] = useState<Extract<Beat, { game: 'dice' }> | null>(null)
  const [totals, setTotals] = useState([0, 0])
  const [who, setWho] = useState(0)
  const [turn, setTurn] = useState<Turn | null>(null)
  /** dice set aside this turn, in the order they were kept, for showing */
  const [kept, setKept] = useState<number[]>([])
  const [picked, setPicked] = useState<number[]>([])
  const [log, setLog] = useState<string[]>([])
  const [winner, setWinner] = useState<number | null>(null)
  const turns = useRef([0, 0])
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    try {
      localStorage.setItem(DICE_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const names =
    mode === 'bot' ? ['You', 'Computer'] : mode === 'race' ? ['You'] : ['Player 1', 'Player 2']
  /** the dice for the next roll: a race's come from its deal, everything else's from anywhere */
  const dice = () =>
    mode === 'race' ? dealRand(deal.current, turns.current[0], rollNo.current++) : Math.random
  const computerTurn = mode === 'bot' && who === 1 && winner === null
  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 6))

  const reset = (m: Mode = mode, seed?: number) => {
    window.clearTimeout(timer.current)
    setMode(m)
    deal.current = seed ?? (m === 'race' && challenge ? challenge.seed : newSeed())
    rollNo.current = 0
    setLastRace(null)
    setTotals([0, 0])
    setWho(0)
    setTurn(null)
    setKept([])
    setPicked([])
    setLog([])
    setWinner(null)
    turns.current = [0, 0]
  }

  /** the turn is over: bank its points (or none, after a bust) and pass the dice */
  const pass = (p: number, points: number) => {
    turns.current[p]++
    const next = [...totals]
    next[p] += points
    setTotals(next)
    setTurn(null)
    setKept([])
    setPicked([])
    if (p === 0 && mode === 'bot' && points > 0)
      setSaved((s) => ({ ...s, bestTurn: Math.max(s.bestTurn, points) }))
    if (mode === 'race') {
      const n = turns.current[0]
      if (next[0] < TARGET) {
        rollNo.current = 0
        return
      }
      setWinner(0)
      const race = { game: 'dice' as const, seed: deal.current, turns: n }
      setLastRace(race)
      const vs = challenge && challenge.seed === deal.current ? challenge : null
      say(
        `You reached ${next[0].toLocaleString()} in ${n} turns.` +
          (vs
            ? beatsDice(vs, n)
              ? ` That beats the link’s ${vs.turns}!`
              : ` The link says ${vs.turns} — not this time.`
            : ''),
      )
      return
    }
    if (next[p] >= TARGET) {
      setWinner(p)
      say(`${names[p]} reached ${next[p].toLocaleString()} and won.`)
      if (mode === 'bot')
        setSaved((s) =>
          p === 0
            ? {
                ...s,
                won: s.won + 1,
                fewestTurns: s.fewestTurns
                  ? Math.min(s.fewestTurns, turns.current[0])
                  : turns.current[0],
              }
            : { ...s, lost: s.lost + 1 },
        )
      return
    }
    setWho(1 - p)
  }

  // the computer plays its turn a step at a time, so it can be followed
  const state = useRef({ totals, turn })
  state.current = { totals, turn }
  useEffect(() => {
    if (!computerTurn) return
    let t: Turn = newTurn(Math.random)
    let keptHere: number[] = []
    const show = () => {
      setTurn(t)
      setKept(keptHere)
    }
    const stepOnce = () => {
      if (t.bust) {
        say(`Computer rolled nothing that scores and lost ${t.points.toLocaleString()}.`)
        timer.current = window.setTimeout(() => pass(1, 0), 1100)
        return
      }
      const keep = chooseKeep(t.roll)
      const faces = keep.map((i) => t.roll[i])
      keptHere = [...keptHere, ...faces]
      t = setAside(t, keep)!
      if (t.free === 6) keptHere = []
      show()
      const [mine, theirs] = [state.current.totals[1], state.current.totals[0]]
      if (wantsBank(t, mine, theirs)) {
        say(`Computer kept ${faces.join(' ')} and banked ${t.points.toLocaleString()}.`)
        timer.current = window.setTimeout(() => pass(1, t.points), 1000)
        return
      }
      say(
        `Computer kept ${faces.join(' ')} (${t.points.toLocaleString()} so far) and rolls ${t.free}.`,
      )
      timer.current = window.setTimeout(() => {
        t = rollOn(t, Math.random)
        show()
        timer.current = window.setTimeout(stepOnce, 900)
      }, 900)
    }
    timer.current = window.setTimeout(() => {
      show()
      timer.current = window.setTimeout(stepOnce, 900)
    }, 600)
    return () => window.clearTimeout(timer.current)
    // one run per computer turn; `pass` and the totals are read when they are needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerTurn])

  // a challenge link opened while this game is already up switches to its deal
  const lastSeed = useRef(challenge?.seed)
  useEffect(() => {
    if (challenge && challenge.seed !== lastSeed.current) reset('race', challenge.seed)
    lastSeed.current = challenge?.seed
    // reset is rebuilt every render; only a new challenge should run this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge])

  const human = winner === null && !computerTurn
  const pickedFaces = turn ? picked.map((i) => turn.roll[i]) : []
  const pickedScore = picked.length ? scoreOf(pickedFaces) : null
  const leaves = turn ? turn.free - picked.length : 6
  const next = leaves === 0 ? 6 : leaves

  const start = () => {
    const t = newTurn(dice())
    setTurn(t)
    setKept([])
    setPicked([])
    if (t.bust) say(`${names[who]} rolled nothing that scores.`)
  }
  const keep = (bank: boolean) => {
    if (!turn || pickedScore === null) return
    const after = setAside(turn, picked)!
    const faces = pickedFaces
    if (bank) {
      say(`${names[who]} kept ${faces.join(' ')} and banked ${after.points.toLocaleString()}.`)
      pass(who, after.points)
      return
    }
    const rolled = rollOn(after, dice())
    setKept(after.free === 6 ? [] : [...kept, ...faces])
    setTurn(rolled)
    setPicked([])
    if (rolled.bust)
      say(`${names[who]} rolled nothing that scores and lost ${after.points.toLocaleString()}.`)
  }

  return (
    <div className="lab-keys dice-room">
      {mode === 'race' && challenge && (
        <p className="beat-banner">
          🏁 <strong>A race to beat:</strong> this link says 10,000 in {challenge.turns} turns. The
          same choices get the same dice — do it in fewer.{' '}
          <button
            className="btn btn-ghost"
            onClick={() => {
              leaveChallenge()
              reset('race', newSeed())
            }}
          >
            Leave the challenge
          </button>
        </p>
      )}
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Opponent">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'bot'}
            onClick={() => reset('bot')}
          >
            Vs computer
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'two'}
            onClick={() => reset('two')}
          >
            Two players
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'race'}
            onClick={() => reset('race')}
          >
            Race the deal
          </button>
        </div>
        <button className="btn btn-ghost" onClick={() => reset()}>
          ↻ New game
        </button>
      </div>

      <div className="dice-scores">
        {names.map((n, i) => (
          <div key={n} className={`dice-score${who === i && winner === null ? ' is-up' : ''}`}>
            <span>{n}</span>
            <strong>{totals[i].toLocaleString()}</strong>
            <span className="dice-bar" aria-hidden>
              <span style={{ width: `${Math.min(100, (totals[i] / TARGET) * 100)}%` }} />
            </span>
          </div>
        ))}
      </div>

      <div className="dice-table" aria-live="polite">
        {winner !== null ? (
          <p className="dice-big">
            {mode === 'race' && lastRace
              ? `${challenge?.seed === lastRace.seed && beatsDice(challenge, lastRace.turns) ? '🏆 Beaten — ' : '🏁 '}${TARGET.toLocaleString()} in ${lastRace.turns} turns`
              : winner === 0 && mode === 'bot'
                ? '🏆 You win!'
                : `${names[winner]} wins`}
          </p>
        ) : !turn ? (
          <p className="muted">
            {computerTurn ? 'The computer is thinking…' : `${names[who]} to roll.`}
          </p>
        ) : (
          <>
            <div className="dice-row" role="group" aria-label="The roll">
              {turn.roll.map((f, i) => (
                <Die
                  key={i}
                  face={f}
                  picked={picked.includes(i)}
                  still={!human || turn.bust}
                  onClick={() =>
                    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))
                  }
                />
              ))}
            </div>
            {kept.length > 0 && (
              <div className="dice-row dice-kept" aria-label="Set aside this turn">
                {kept.map((f, i) => (
                  <Die key={i} face={f} still />
                ))}
              </div>
            )}
            <p className="dice-line">
              {turn.bust ? (
                <strong className="rps-bad">
                  Nothing scores — the turn’s {turn.points.toLocaleString()} is lost.
                </strong>
              ) : (
                <>
                  This turn: <strong>{turn.points.toLocaleString()}</strong>
                  {human &&
                    picked.length > 0 &&
                    (pickedScore === null ? (
                      <span className="rps-bad"> · those don’t all score</span>
                    ) : (
                      <> · keeping them adds {pickedScore.toLocaleString()}</>
                    ))}
                </>
              )}
            </p>
          </>
        )}
      </div>

      {human && (
        <div className="lab-controls">
          {!turn ? (
            <button className="btn" onClick={start}>
              🎲 Roll six
            </button>
          ) : turn.bust ? (
            <button className="btn" onClick={() => pass(who, 0)}>
              Pass the dice
            </button>
          ) : (
            <>
              <button className="btn" disabled={pickedScore === null} onClick={() => keep(false)}>
                Keep and roll{pickedScore === null ? '' : ` ${next}`}
              </button>
              <button
                className="btn btn-ghost"
                disabled={pickedScore === null}
                onClick={() => keep(true)}
              >
                Keep and bank{' '}
                {pickedScore === null ? '' : (turn.points + pickedScore).toLocaleString()}
              </button>
              <span className="muted lab-score">
                {pickedScore === null
                  ? 'Tap the dice to keep'
                  : `${next} dice: ${pct(BUST[next])} chance of nothing`}
              </span>
            </>
          )}
        </div>
      )}

      {log.length > 0 && (
        <ul className="dice-log">
          {log.map((l, i) => (
            <li key={i} className={i ? 'muted' : undefined}>
              {l}
            </li>
          ))}
        </ul>
      )}
      {mode === 'race' && lastRace && winner !== null && <BeatShare beat={lastRace} />}
      <p className="sun-reading">
        <span className="muted">
          {mode === 'race' ? (
            <>
              Turns so far {turns.current[0]} — the fewer it takes to reach{' '}
              {TARGET.toLocaleString()}, the better
            </>
          ) : (
            <>
              Against the computer: won {saved.won}, lost {saved.lost}
              {saved.bestTurn > 0 && <> · best turn {saved.bestTurn.toLocaleString()}</>}
              {saved.fewestTurns > 0 && <> · fastest win {saved.fewestTurns} turns</>}
            </>
          )}
        </span>
      </p>
      <p className="muted lab-hint">
        Roll six dice and keep at least one that scores: a 1 is 100, a 5 is 50, three of a kind is
        the number × 100 (three 1s are 1,000), and every extra one of the kind doubles it. 1 to 6 in
        a row is 1,500 and three pairs are 750. Then bank the turn, or roll what is left and risk it
        — a roll with nothing that scores loses the turn. Keep all six and you roll all six again.
        First to {TARGET.toLocaleString()}. The chance of scoring nothing is counted exactly: one
        die {pct(BUST[1])}, three {pct(BUST[3])}, six {pct(BUST[6])}.
      </p>
    </div>
  )
}
