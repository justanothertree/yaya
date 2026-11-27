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
import { type YachtGame } from './yachtRoom'
import { useLabMatch } from '../lab/matches/useLabMatch'
import { MatchBar, MatchSend } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'
import { BeatBanner, BeatShare } from '../lab/BeatShare'
import { useChallenge } from '../lab/useChallenge'
import { dealRand, newSeed, outcome, verdict, type Beat } from '../lab/beat'

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
const ALONE = 'Twelve turns alone: fill every box for the best total you can.'
/**
 * The dice for a roll in a game alone: roll k of turn t on the game's seed, where t is how many
 * boxes are filled (see beat.ts `dealRand`). The dice not kept draw in order, so the same keeps get
 * the same dice and keeping one more takes the first of the same draw — which is what makes a game
 * alone something a friend can be sent. yacht.test.ts writes this call out again to pin the luck.
 */
const aloneDice = (g: Game, seed: number) =>
  dealRand(seed, 12 - open(g.cards[0]).length, 3 - g.rolls)

export function YachtDemo() {
  const [saved, setSaved] = useKept(YACHT_KEY, readSaved)
  /** a friend's game alone to beat, from the address: it opens on their seed */
  const [challenge, leaveChallenge] = useChallenge('yacht')
  const [mode, setMode] = useState<Mode>(() => (challenge ? 'alone' : 'bot'))
  const [level, setLevel] = useState<Level>(saved.level)
  const [game, setGame] = useState<Game>(() => (challenge ? soloGame() : newGame(0)))
  /** the seed a game alone rolls from, so any game alone can be sent as a link */
  const [seed, setSeed] = useState(() => challenge?.seed ?? newSeed())
  const [line, setLine] = useState(
    challenge
      ? ALONE
      : 'Roll up to three times, keeping any dice between rolls, then score them in one of the twelve boxes.',
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
      // a game on a link's seed is practice: the link's dice can be learned by heart
      const result: Beat = { game: 'yacht', seed, points: me }
      if (challenge && outcome(result, challenge) !== null) {
        setLine(`All twelve boxes filled: ${me} points.${verdict(result, challenge)}`)
        return
      }
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

  /* ── a match by turns, when the address names one (src/lab/matches/useLabMatch.ts). The server
     rolls every die (yachtRoom.ts): a hold, or a box, is chosen on the dice it rolled, proposed and
     sent, and the next roll comes back with the board. */
  const lm = useLabMatch('yacht')
  const inMatch = !!lm.id
  const signedIn = useSignedIn()
  const mg = inMatch ? (lm.shown as YachtGame | null) : null
  const [mHeld, setMHeld] = useState([false, false, false, false, false])
  const rollKey = mg ? `${mg.log.length}|${lm.hasPending}` : ''
  useEffect(() => setMHeld(mg ? [...mg.g.held] : [false, false, false, false, false]), [rollKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const wasInMatch = useRef(inMatch)
  useEffect(() => {
    if (wasInMatch.current && !inMatch) fresh('bot')
    wasInMatch.current = inMatch
    // only leaving the match starts a game
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMatch])
  /* a link opened while this toy is already up starts a game alone on its seed; and a link that
     leaves the address some other way than Leave (Back, say) takes its game with it, so a game on
     its seed never goes on to record as the reader's own */
  const lastSeed = useRef(challenge?.seed)
  useEffect(() => {
    if (!inMatch && challenge && challenge.seed !== lastSeed.current)
      fresh('alone', saved.level, challenge.seed)
    else if (!inMatch && !challenge && mode === 'alone' && seed === lastSeed.current)
      fresh('alone', saved.level, newSeed())
    lastSeed.current = challenge?.seed
    // fresh is rebuilt every render; only a new challenge should run this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge])

  /** a new game; alone, on the link's seed while one is up (a retry), or on `s`, or a new one */
  const fresh = (m: Mode = mode, lv: Level = saved.level, s?: number) => {
    recorded.current = false
    setMode(m)
    setLevel(lv)
    setSeed(s ?? challenge?.seed ?? newSeed())
    // against the computer, whoever went second in a game under way or over goes first
    const begun = Object.keys(mine).length + Object.keys(theirs).length > 0
    const first: 0 | 1 = m === 'bot' && m === mode && begun ? (starter === 0 ? 1 : 0) : 0
    setStarter(first)
    setGame(m === 'alone' ? soloGame() : newGame(first))
    setLine(
      m === 'alone'
        ? ALONE
        : first
          ? 'A new game — the computer goes first.'
          : 'A new game. Roll the dice.',
    )
  }
  const rollMine = () => {
    if (!yours || game.rolls === 0) return
    setRoller((n) => n + 1)
    const g = roll(game, mode === 'alone' ? aloneDice(game, seed) : Math.random)
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

  if (inMatch) {
    const v = lm.view
    const together = v?.mode === 'together'
    const me: 0 | 1 = together ? 0 : v?.you === 1 ? 1 : 0
    const them: 0 | 1 = me === 0 ? 1 : 0
    const theirName = !v ? 'They' : together ? 'The computer' : otherName(v)
    const g = mg?.g ?? null
    const rolledM = !!g && g.rolls < 3 && !mg!.need
    const canDecide = lm.canPlay && rolledM
    const myCard = g?.cards[me] ?? {}
    const theirCard = g?.cards[them] ?? {}
    /* what the other side last scored, from the log: the dice as they lay, and the box */
    let lastTheirs: string | null = null
    if (mg) {
      let side = 0
      const filled = [0, 0]
      let dice: number[] = []
      for (const e of mg.log) {
        if ('roll' in e) dice = e.roll
        else if ('box' in e) {
          if (side === them)
            lastTheirs = `${theirName} scored ${score(dice, e.box)} in ${BOXES[e.box][0].toLowerCase()}.`
          filled[side]++
          side = filled[1 - side] < 12 ? 1 - side : side
        }
      }
    }
    return (
      <div className={`lab-keys yt-room is-${saved.look}`}>
        <MatchBar lm={lm} sides={['the first card', 'the second card']} />
        {g && (
          <div className="dice-scores">
            {([me, them] as (0 | 1)[]).map((s) => (
              <div key={s} className={`dice-score${!g.over && g.turn === s ? ' is-up' : ''}`}>
                <span>{s === me ? (together ? 'You two' : 'You') : theirName}</span>
                <strong>{total(g.cards[s])}</strong>
                <span className="muted">{12 - open(g.cards[s]).length} of 12 boxes</span>
              </div>
            ))}
          </div>
        )}
        {lastTheirs && <p className="muted yt-said">{lastTheirs}</p>}
        {g && (
          <div className="yt-play">
            <div className="yt-table">
              <div className="dice-row" role="group" aria-label="The dice: press a die to keep it">
                {g.dice.map((d, i) => (
                  <button
                    key={i}
                    className={`die${mHeld[i] ? ' is-picked' : ''}`}
                    aria-pressed={mHeld[i]}
                    aria-label={
                      rolledM
                        ? `Die ${i + 1} showing ${d}${mHeld[i] ? ', kept' : ''}`
                        : `Die ${i + 1}, not rolled yet`
                    }
                    disabled={!canDecide || g.rolls === 0}
                    onClick={() => setMHeld((h) => h.map((x, k) => (k === i ? !x : x)))}
                    style={rolledM ? undefined : { opacity: 0.45 }}
                  >
                    <DieFace face={d} />
                  </button>
                ))}
              </div>
              <div className="lab-controls yt-roll">
                <button
                  className="btn"
                  onClick={() => lm.play({ hold: mHeld })}
                  disabled={!canDecide || g.rolls === 0 || mHeld.every(Boolean)}
                >
                  🎲 Roll again ({g.rolls} left)
                </button>
              </div>
            </div>
            <table className="yt-card">
              <caption className="sr-only">The score cards</caption>
              <thead>
                <tr>
                  <th scope="col">Box</th>
                  <th scope="col">{together ? 'You two' : 'You'}</th>
                  <th scope="col">{theirName}</th>
                </tr>
              </thead>
              <tbody>
                {CATS.map((k) => {
                  const could = canDecide && g.turn === me && myCard[k] === undefined
                  return (
                    <tr key={k} className={k === 'full' ? 'yt-split' : undefined}>
                      <th scope="row">
                        {BOXES[k][0]}
                        <span className="muted yt-rule">{BOXES[k][1]}</span>
                      </th>
                      <td>
                        {myCard[k] !== undefined ? (
                          <span className="yt-done">{myCard[k]}</span>
                        ) : (
                          <button
                            className="yt-box"
                            disabled={!could}
                            aria-label={
                              could
                                ? `Score ${score(g.dice, k)} in ${BOXES[k][0].toLowerCase()}`
                                : `${BOXES[k][0]}: open`
                            }
                            onClick={() => lm.play({ box: k })}
                          >
                            {could ? score(g.dice, k) : '·'}
                          </button>
                        )}
                      </td>
                      <td>
                        <span className="yt-done">{theirCard[k] ?? ''}</span>
                      </td>
                    </tr>
                  )
                })}
                <tr className="yt-total">
                  <th scope="row">Total</th>
                  <td>{total(myCard)}</td>
                  <td>{total(theirCard)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <MatchSend lm={lm} />
      </div>
    )
  }

  const record = saved.record[saved.level]
  const meTotal = total(mine)
  /** a game alone that is over, as it would be sent */
  const result: Beat | null =
    mode === 'alone' && game.over ? { game: 'yacht', seed, points: meTotal } : null
  const onLink = !!challenge && mode === 'alone' && challenge.seed === seed
  return (
    <div className={`lab-keys yt-room is-${saved.look}`}>
      {challenge && mode === 'alone' && (
        <BeatBanner
          beat={challenge}
          onLeave={() => {
            leaveChallenge()
            fresh('alone', saved.level, newSeed())
          }}
        />
      )}
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Opponent">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'bot'}
            onClick={() => {
              if (challenge) leaveChallenge()
              fresh('bot')
            }}
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
        {signedIn && mode === 'bot' && (
          <MatchChallenge demo="yacht" settings={{}} levelNames={LEVEL_NAMES} />
        )}
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
            <strong>{Math.max(saved.best, game.over && !onLink ? meTotal : 0)}</strong>
            <span className="muted">of 297 possible</span>
          </div>
        )}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>
      {result && <BeatShare beat={result} answering={challenge} />}

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
