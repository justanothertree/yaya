import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  CUPS,
  DICE,
  LEVELS,
  LIARS_KEY,
  bid,
  call,
  cheapest,
  decide,
  legal,
  newGame,
  readSaved,
  total,
  type Bid,
  type Game,
  type Level,
  type Saved,
} from './liars'
import { motionReduced as reduced } from '../ui/motion'
import { PIPS } from './pips'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(LIARS_KEY))
  } catch {
    return readSaved(null)
  }
}
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const CUP_NAMES: Record<Saved['cup'], string> = { leather: 'Leather', tin: 'Tin', velvet: 'Velvet' }
/** the computer players, by where they sit */
const SEATS = ['Left', 'Across', 'Right']
const FACE_WORDS = ['', 'ones', 'twos', 'threes', 'fours', 'fives', 'sixes']
const FACE_ONE = ['', 'one', 'two', 'three', 'four', 'five', 'six']
const say = (b: Bid) => `${b.q} ${b.q === 1 ? FACE_ONE[b.f] : FACE_WORDS[b.f]}`
const seed = () => (Math.random() * 2 ** 31) | 0

function Die({ f, lit, small }: { f: number; lit?: boolean; small?: boolean }) {
  return (
    <span className={`lr-die${lit ? ' is-lit' : ''}${small ? ' is-small' : ''}`} aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={PIPS[f].includes(i) ? 'is-pip' : ''} />
      ))}
    </span>
  )
}

export function LiarsDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [level, setLevel] = useState<Level>(saved.level)
  const [g, setG] = useState<Game>(() => newGame(1 + saved.rivals, seed(), saved.wild, 0))
  const [pick, setPick] = useState<Bid>({ q: 1, f: 2 })
  const [line, setLine] = useState(
    'You open. Bid how many of a face you think are under all the cups.',
  )
  const [paused, setPaused] = useState(false)
  const recorded = useRef(false)
  const timer = useRef(0)
  useEffect(() => {
    try {
      localStorage.setItem(LIARS_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const name = (p: number) => (p === 0 ? 'You' : SEATS[(p - 1) % SEATS.length])
  const dice = total(g)
  const yourTurn = g.winner === null && g.turn === 0 && g.left[0] > 0 && !paused
  const out = g.left[0] === 0

  // the cheapest legal bid on your commonest face, as a starting point for the picker
  const suggest = (game: Game): Bid => {
    const options = cheapest(game.bid, game.wild, total(game))
    const mine = game.dice[0] ?? []
    const faces = [2, 3, 4, 5, 6, 1].sort(
      (a, b) => mine.filter((d) => d === b).length - mine.filter((d) => d === a).length,
    )
    for (const f of faces) if (options[f - 1]) return options[f - 1]!
    return { q: Math.min(total(game), 1), f: 2 }
  }

  const finish = (game: Game) => {
    if (recorded.current) return
    recorded.current = true
    const won = game.winner === 0
    setSaved((s) => ({
      ...s,
      record: {
        ...s.record,
        [level]: {
          ...s.record[level],
          won: s.record[level].won + (won ? 1 : 0),
          lost: s.record[level].lost + (won ? 0 : 1),
        },
      },
    }))
  }

  /** after a call: say what the cups showed, keep score, and wait for the next round */
  const showdown = (game: Game) => {
    const s = game.shown!
    const caller = name(s.caller)
    const bidder = name(s.bidder)
    const stood = s.actual >= s.bid.q
    const wildWord = game.wild && s.bid.f !== 1 ? ' counting ones' : ''
    if (s.caller === 0 && !stood)
      setSaved((x) => ({
        ...x,
        record: {
          ...x.record,
          [level]: { ...x.record[level], caught: x.record[level].caught + 1 },
        },
      }))
    if (s.bidder === 0 && stood)
      setSaved((x) => ({
        ...x,
        record: {
          ...x.record,
          [level]: { ...x.record[level], fooled: x.record[level].fooled + 1 },
        },
      }))
    const loserName = name(s.loser)
    const said = `${caller === 'You' ? 'You call' : `${caller} calls`} ${bidder === 'You' ? 'your' : `${bidder}’s`} ${say(s.bid)} a lie. There ${s.actual === 1 ? 'is' : 'are'} ${s.actual}${wildWord} — ${stood ? 'the bid stands' : 'it was a lie'}, and ${loserName === 'You' ? 'you lose' : `${loserName} loses`} a die.`
    if (game.winner !== null || game.left[0] === 0) {
      // with you out, the rest is played out at once to name the winner
      let rest = game
      while (rest.winner === null) {
        const m = decide(rest, level)
        const before = rest
        rest = m.kind === 'call' ? call(rest) : bid(rest, m.bid)
        if (rest === before) rest = call(rest)
      }
      finish(rest)
      setG(game.winner === null ? { ...game, winner: rest.winner } : game)
      setLine(
        `${said} ${rest.winner === 0 ? '🏆 You are the last with dice!' : game.left[0] === 0 ? `You are out of dice — ${name(rest.winner!)} goes on to win.` : `${name(rest.winner!)} wins the game.`}`,
      )
      return
    }
    setLine(said)
    setPaused(true)
  }

  const act = (game: Game, m: { kind: 'call' } | { kind: 'bid'; bid: Bid }) => {
    const next = m.kind === 'call' ? call(game) : bid(game, m.bid)
    if (next === game) return
    setG(next)
    if (next.shown && m.kind === 'call') return showdown(next)
    if (m.kind === 'bid') {
      setLine(
        `${name(game.turn)} ${game.turn === 0 ? 'bid' : 'bids'} ${say(m.bid)}.${next.turn === 0 ? ' Your turn: raise, or call it a lie.' : ''}`,
      )
      if (next.turn === 0) setPick(suggest(next))
    }
  }

  // the computers' turns
  useEffect(() => {
    if (g.winner !== null || g.turn === 0 || paused || g.left[0] === 0) return
    timer.current = window.setTimeout(() => act(g, decide(g, level)), reduced() ? 300 : 1000)
    return () => window.clearTimeout(timer.current)
    // the game is what starts a computer's turn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, paused])

  const nextRound = () => {
    // the cups go back down: the reveal belongs to the round that has ended
    setG({ ...g, shown: null })
    setPaused(false)
    setLine(
      g.turn === 0
        ? 'A new round, and you start it. Look at your dice and bid.'
        : `A new round; ${name(g.turn)} starts.`,
    )
    if (g.turn === 0) setPick(suggest(g))
  }
  const fresh = (lv: Level = saved.level, rivals = saved.rivals, wild = saved.wild) => {
    window.clearTimeout(timer.current)
    recorded.current = false
    setLevel(lv)
    const game = newGame(1 + rivals, seed(), wild, 0)
    setG(game)
    setPaused(false)
    setPick(suggest(game))
    setLine('You open. Bid how many of a face you think are under all the cups.')
  }
  useEffect(() => {
    setPick(suggest(g))
    // the first deal's suggestion
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ok = legal(pick, g.bid, g.wild, dice)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!yourTurn) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight')
      setPick((p) => ({ ...p, q: Math.min(dice, p.q + 1) }))
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft')
      setPick((p) => ({ ...p, q: Math.max(1, p.q - 1) }))
    else if (/^[1-6]$/.test(e.key)) setPick((p) => ({ ...p, f: Number(e.key) }))
    else if (e.key === 'Enter' && ok) act(g, { kind: 'bid', bid: pick })
    else if ((e.key === 'l' || e.key === 'L') && g.bid) act(g, { kind: 'call' })
    else return
    e.preventDefault()
    e.stopPropagation()
  }
  const rec = saved.record[saved.level]
  const untouched = !g.bid && !g.shown && g.left.every((n) => n === DICE)
  const lastBid = (p: number) => [...g.bids].reverse().find((x) => x.who === p)?.bid
  const counts = g.shown
    ? (f: number) => f === g.shown!.bid.f || (g.wild && g.shown!.bid.f !== 1 && f === 1)
    : null

  return (
    <div className={`lab-keys lr-room is-${saved.cup}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computers play">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (untouched || g.winner !== null) fresh(l)
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="How many computer players">
          {([2, 3] as const).map((n) => (
            <button
              key={n}
              className="btn btn-ghost"
              aria-pressed={saved.rivals === n}
              onClick={() => {
                setSaved((s) => ({ ...s, rivals: n }))
                if (untouched || g.winner !== null) fresh(saved.level, n)
              }}
            >
              {n} rivals
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>

      <div className="lr-seats">
        {g.left.map((n, p) =>
          p === 0 ? null : (
            <div
              key={p}
              className={`lr-seat${g.turn === p && g.winner === null && !paused ? ' is-up' : ''}${n === 0 ? ' is-out' : ''}`}
            >
              <span className="lr-name">
                {name(p)}
                {g.turn === p && g.winner === null && !paused && n > 0 ? ' · thinking…' : ''}
              </span>
              {g.shown ? (
                <span
                  className="lr-dice"
                  role="img"
                  aria-label={`${name(p)} had ${g.shown.dice[p].join(', ') || 'no dice'}`}
                >
                  {g.shown.dice[p].map((f, k) => (
                    <Die key={k} f={f} small lit={counts!(f)} />
                  ))}
                </span>
              ) : (
                <span className="lr-cup" role="img" aria-label={`${n} dice under the cup`}>
                  {Array.from({ length: DICE }, (_, k) => (
                    <span key={k} className={k < n ? 'is-in' : ''} />
                  ))}
                </span>
              )}
              <span className="muted lr-said">
                {n === 0 ? 'out' : lastBid(p) ? say(lastBid(p)!) : '—'}
              </span>
            </div>
          ),
        )}
      </div>

      <div className="lr-bid" aria-live="polite">
        {g.shown ? (
          <>
            <span className="muted">{name(g.shown.bidder)} bid</span>
            <strong>{g.shown.bid.q} ×</strong>
            <Die f={g.shown.bid.f} />
            <span className="muted">
              — there {g.shown.actual === 1 ? 'was' : 'were'} {g.shown.actual}
            </span>
          </>
        ) : g.bid ? (
          <>
            <span className="muted">
              {name(g.bidder!)} {g.bidder === 0 ? 'bid' : 'bids'}
            </span>
            <strong>{g.bid.q} ×</strong>
            <Die f={g.bid.f} />
            <span className="muted">
              of {dice} dice{g.wild && g.bid.f !== 1 ? ', ones wild' : ''}
            </span>
          </>
        ) : (
          <span className="muted">
            No bid yet · {dice} dice on the table{g.wild ? ', ones wild' : ''}
          </span>
        )}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="lr-yours"
        role="img"
        aria-label={
          out
            ? 'You are out of dice'
            : `Your dice: ${(g.shown ? g.shown.dice[0] : g.dice[0]).join(', ')}`
        }
      >
        <span className="lr-name">You</span>
        {(g.shown ? g.shown.dice[0] : g.dice[0]).map((f, k) => (
          <Die key={k} f={f} lit={counts ? counts(f) : false} />
        ))}
        {out && <span className="muted">out of dice</span>}
      </div>

      {!out && g.winner === null && !paused && (
        <div
          className="lr-picker"
          role="group"
          aria-label="Your bid. Up and down change how many, 1 to 6 choose the face, Enter bids, L calls a lie."
          onKeyDown={onKey}
        >
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-label="One fewer"
              disabled={!yourTurn || pick.q <= 1}
              onClick={() => setPick((p) => ({ ...p, q: p.q - 1 }))}
            >
              −
            </button>
            <strong className="lr-q" aria-live="polite">
              {pick.q}
            </strong>
            <button
              className="btn btn-ghost"
              aria-label="One more"
              disabled={!yourTurn || pick.q >= dice}
              onClick={() => setPick((p) => ({ ...p, q: p.q + 1 }))}
            >
              +
            </button>
            <div className="lab-group" role="group" aria-label="Face">
              {[1, 2, 3, 4, 5, 6].map((f) => (
                <button
                  key={f}
                  className="btn btn-ghost lr-face"
                  aria-pressed={pick.f === f}
                  aria-label={FACE_WORDS[f]}
                  disabled={!yourTurn}
                  onClick={() => setPick((p) => ({ ...p, f }))}
                >
                  <Die f={f} small />
                </button>
              ))}
            </div>
          </div>
          <div className="lab-controls">
            <button
              className="btn"
              disabled={!yourTurn || !ok}
              onClick={() => act(g, { kind: 'bid', bid: pick })}
            >
              {ok ? `Bid ${say(pick)}` : g.bid ? `Too low to follow ${say(g.bid)}` : 'Bid'}
            </button>
            <button
              className="btn lr-liar"
              disabled={!yourTurn || !g.bid}
              onClick={() => act(g, { kind: 'call' })}
            >
              Liar!
            </button>
          </div>
        </div>
      )}
      <div className="lab-controls">
        {paused && g.winner === null && (
          <button className="btn" onClick={nextRound}>
            ▶ Next round
          </button>
        )}
        {g.winner !== null && (
          <button className="btn" onClick={() => fresh()}>
            ↻ Play again
          </button>
        )}
      </div>

      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {rec.won}, lost {rec.lost}
          {rec.caught ? ` · lies caught ${rec.caught}` : ''}
          {rec.fooled ? ` · doubted wrongly ${rec.fooled}` : ''}
        </span>
      </p>
      {level !== saved.level && !untouched && g.winner === null && (
        <p className="muted mc-note">The new level starts with the next game.</p>
      )}
      <div className="fw-panel">
        <section aria-label="Table">
          <h3 className="fw-h">Table</h3>
          <div className="lab-controls" role="group" aria-label="Cups">
            {CUPS.map((c) => (
              <button
                key={c}
                className="btn btn-ghost"
                aria-pressed={saved.cup === c}
                onClick={() => setSaved((s) => ({ ...s, cup: c }))}
              >
                {CUP_NAMES[c]} cups
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.wild}
              onClick={() => {
                setSaved((s) => ({ ...s, wild: !s.wild }))
                if (untouched || g.winner !== null) fresh(saved.level, saved.rivals, !saved.wild)
              }}
            >
              Ones are wild
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Everyone has five dice under a cup and sees only their own. In turn, raise the bid — at
        least this many of this face among ALL the dice — or call the last bid a lie. Then the cups
        come up: if the dice bear the bid out the caller loses a die, otherwise the bidder does, and
        the loser starts the next round. Lose all five and you are out; the last with dice wins.
        With ones wild, a one counts as any face; a bid on ones then needs only half as many, and
        moving off ones needs twice as many and one more. Easy bids honestly and rarely calls; Fair
        reads the odds and the other bids; Hard plays each round out in its head before it moves.
      </p>
    </div>
  )
}
