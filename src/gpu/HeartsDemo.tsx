import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  BACKS,
  ENDS,
  FELTS,
  HEARTS_KEY,
  LEVELS,
  PASS,
  chooseCard,
  choosePass,
  deal,
  handOver,
  legal,
  passTo,
  playCard,
  points,
  readSaved,
  score,
  startHand,
  winnerOf,
  type Hand,
  type Level,
  type Saved,
} from './hearts'
import { RANK_NAMES, SUITS, rankOf, suitOf, type Card } from './poker'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'
import { seatsPlayed, totals as heartsTotals, type HeartsGame } from './heartsRoom'
import { useLabMatch, type LabMatch } from '../lab/matches/useLabMatch'
import { MatchBar } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'
import { myHidden } from '../lab/matches/cloud'

type Phase = 'pass' | 'play' | 'between' | 'over'
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const FELT_NAMES: Record<Saved['felt'], string> = { green: 'Green', blue: 'Blue', red: 'Red' }
const BACK_NAMES: Record<Saved['back'], string> = {
  lattice: 'Lattice backs',
  stripes: 'Striped backs',
  stars: 'Starry backs',
}
const SEATS = ['You', 'West', 'North', 'East']
const LONG = [
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'jack',
  'queen',
  'king',
  'ace',
]
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs']
const longName = (c: Card) => `${LONG[rankOf(c)]} of ${SUIT_NAMES[suitOf(c)]}`

function Face({ c, small }: { c: Card; small?: boolean }) {
  const red = suitOf(c) === 1 || suitOf(c) === 2
  return (
    <span
      className={`pk-card ht-card${red ? ' is-red' : ''}${small ? ' is-small' : ''}`}
      aria-hidden
    >
      <span>{RANK_NAMES[rankOf(c)]}</span>
      <span>{SUITS[suitOf(c)]}</span>
    </span>
  )
}

export function HeartsDemo() {
  /* a match by turns, when the address names one (src/lab/matches/useLabMatch.ts): the friends
     across the table with two computers between, the hands kept back by the server (heartsRoom.ts) */
  const lm = useLabMatch('hearts', { preview: false })
  if (lm.id) return <HeartsMatch lm={lm} />
  return <HeartsAlone />
}

function HeartsAlone() {
  const signedIn = useSignedIn()
  const [saved, setSaved] = useKept(HEARTS_KEY, readSaved)
  const [level, setLevel] = useState<Level>(saved.level)
  const [round, setRound] = useState(0)
  const [dealt, setDealt] = useState<Card[][]>(() => deal(Math.random))
  const [hand, setHand] = useState<Hand | null>(null)
  const [phase, setPhase] = useState<Phase>('pass')
  const [chosen, setChosen] = useState<Card[]>([])
  const [received, setReceived] = useState<Card[]>([])
  const [totals, setTotals] = useState([0, 0, 0, 0])
  const [line, setLine] = useState('Pick three cards to pass left.')
  /** the last trick, held on the table a moment after it is won */
  const [shown, setShown] = useState<{ seat: number; card: Card }[] | null>(null)
  const [cursor, setCursor] = useState(0)
  const timers = useRef<number[]>([])
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
  const way = PASS[round % 4]

  const endHand = (h: Hand) => {
    const s = score(h)
    const next = totals.map((t, i) => t + s[i])
    setTotals(next)
    const moon = s.filter((x) => x === 26).length === 3 ? s.indexOf(0) : -1
    const desc =
      moon >= 0
        ? `${SEATS[moon]} shot the moon! Everyone else takes 26.`
        : `This hand: you ${s[0]}, West ${s[1]}, North ${s[2]}, East ${s[3]}.`
    if (Math.max(...next) >= saved.end) {
      const low = Math.min(...next)
      const won = next[0] === low
      setSaved((x) => ({
        ...x,
        record: {
          ...x.record,
          [level]: {
            won: x.record[level].won + (won ? 1 : 0),
            played: x.record[level].played + 1,
            moons: x.record[level].moons + (moon === 0 ? 1 : 0),
          },
        },
      }))
      setLine(
        `${desc} ${won ? '🏆 You win the game' : `${SEATS[next.indexOf(low)]} wins the game`} with ${low}.`,
      )
      setPhase('over')
    } else {
      if (moon === 0)
        setSaved((x) => ({
          ...x,
          record: {
            ...x.record,
            [level]: { ...x.record[level], moons: x.record[level].moons + 1 },
          },
        }))
      setLine(`${desc} Next hand when you are ready.`)
      setPhase('between')
    }
  }

  /** the computers play until it is your turn, a trick is won, or the hand ends */
  const run = (h: Hand) => {
    setHand(h)
    if (handOver(h)) return endHand(h)
    if (h.turn === 0) {
      setLine(
        h.trick.length
          ? 'Your turn.'
          : `Your lead.${!h.broken ? ' Hearts are not broken yet.' : ''}`,
      )
      return
    }
    const gap = reduced() ? 120 : 480
    later(gap, () => {
      const card = chooseCard(h, level)
      const next = playCard(h, card)
      if (next.trick.length === 0) {
        // a trick is complete: show it before it is gathered
        const full = [...h.trick, { seat: h.turn, card }]
        setShown(full)
        setHand(next)
        later(reduced() ? 300 : 900, () => {
          setShown(null)
          run(next)
        })
      } else run(next)
    })
  }
  const play = (card: Card) => {
    if (!hand || phase !== 'play' || hand.turn !== 0 || shown) return
    if (!legal(hand).includes(card)) {
      setLine(
        hand.trick.length
          ? 'Follow the suit that was led if you can.'
          : hand.tricks === 0
            ? 'The two of clubs leads the first trick.'
            : 'Hearts cannot be led until one has been played.',
      )
      return
    }
    const next = playCard(hand, card)
    setReceived([])
    if (next.trick.length === 0) {
      const full = [...hand.trick, { seat: 0, card }]
      setShown(full)
      setHand(next)
      const w = winnerOf(full)
      setLine(
        `${w === 0 ? 'You take' : `${SEATS[w]} takes`} the trick${full.some((t) => points(t.card)) ? `, with ${full.reduce((a, t) => a + points(t.card), 0)} points` : ''}.`,
      )
      later(reduced() ? 300 : 900, () => {
        setShown(null)
        run(next)
      })
    } else run(next)
  }
  const pass = () => {
    if (way !== 'hold' && chosen.length !== 3) return
    const passes = dealt.map((h, i) => (i === 0 ? chosen : choosePass(h, level)))
    const h = startHand(dealt, way === 'hold' ? null : passes, way)
    const from = [0, 1, 2, 3].find((i) => passTo(i, way) === 0)!
    setReceived(way === 'hold' ? [] : passes[from])
    setChosen([])
    setPhase('play')
    setLine(
      way === 'hold'
        ? 'No passing this hand.'
        : `You passed three ${way} and got three from ${SEATS[from]}.`,
    )
    run(h)
  }
  const nextHand = (fresh = false) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    const r = fresh ? 0 : round + 1
    setRound(r)
    setDealt(deal(Math.random))
    setHand(null)
    setShown(null)
    setReceived([])
    setChosen([])
    setPhase('pass')
    setCursor(0)
    if (fresh) {
      setTotals([0, 0, 0, 0])
      setLevel(saved.level)
    }
    const w = PASS[r % 4]
    setLine(w === 'hold' ? 'No passing this hand: press Play.' : `Pick three cards to pass ${w}.`)
  }

  const mine = phase === 'pass' ? dealt[0] : (hand?.hands[0] ?? [])
  const can = new Set(hand && phase === 'play' && hand.turn === 0 && !shown ? legal(hand) : [])
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const n = Math.max(0, Math.min(mine.length - 1, cursor + (e.key === 'ArrowLeft' ? -1 : 1)))
    setCursor(n)
    cardRefs.current[n]?.focus()
  }
  const onTable = shown ?? hand?.trick ?? []
  const r = saved.record[saved.level]
  const back = `pk-card is-back tw-back is-${saved.back}`
  const count = (seat: number) => (phase === 'pass' ? 13 : (hand?.hands[seat].length ?? 13))

  return (
    <div className={`lab-keys ht-room is-${saved.felt}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computers play">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (phase === 'over' || (round === 0 && phase === 'pass')) setLevel(l)
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="Play to">
          {ENDS.map((n) => (
            <button
              key={n}
              className="btn btn-ghost"
              aria-pressed={saved.end === n}
              onClick={() => setSaved((s) => ({ ...s, end: n }))}
            >
              To {n}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => nextHand(true)}>
          ↻ New game
        </button>
        {signedIn && (
          <MatchChallenge
            demo="hearts"
            settings={{ end: saved.end, level: saved.level }}
            levelNames={LEVEL_NAMES}
          />
        )}
      </div>

      <div className="dice-scores ht-scores">
        {SEATS.map((name, i) => (
          <div
            key={name}
            className={`dice-score${hand?.turn === i && phase === 'play' ? ' is-up' : ''}`}
          >
            <span>{name}</span>
            <strong>{totals[i]}</strong>
            <span className="muted">
              {phase === 'play' && hand
                ? `+${hand.taken[i].reduce((a, c) => a + points(c), 0)} this hand`
                : ' '}
            </span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="ht-table">
        {[2, 1, 3].map((seat) => (
          <div
            key={seat}
            className={`ht-seat is-s${seat}`}
            aria-label={`${SEATS[seat]}: ${count(seat)} cards`}
            role="img"
          >
            <span className={back}>
              <span className="ht-count">{count(seat)}</span>
            </span>
            <span className="ht-name">{SEATS[seat]}</span>
          </div>
        ))}
        <div
          className="ht-trick"
          aria-label={
            onTable.length
              ? `On the table: ${onTable.map((t) => `${SEATS[t.seat]} ${longName(t.card)}`).join(', ')}`
              : 'Nothing on the table'
          }
          role="img"
        >
          {onTable.map((t) => (
            <span key={t.seat} className={`ht-played is-s${t.seat}`}>
              <Face c={t.card} />
            </span>
          ))}
        </div>
      </div>

      <div
        className="ht-hand"
        role="group"
        aria-label="Your hand. Left and right arrows move along it; Enter plays a card, or picks it to pass."
        onKeyDown={onKey}
      >
        {mine.map((c, k) => {
          const picked = chosen.includes(c)
          const playable = phase === 'pass' || can.has(c)
          return (
            <button
              key={c}
              ref={(el) => {
                cardRefs.current[k] = el
              }}
              className={`ht-mine${picked ? ' is-picked' : ''}${playable ? '' : ' is-dim'}${received.includes(c) ? ' is-new' : ''}`}
              tabIndex={k === cursor ? 0 : -1}
              aria-label={`${longName(c)}${picked ? ', picked to pass' : ''}${phase === 'play' && !playable ? ', cannot be played now' : ''}${received.includes(c) ? ', passed to you' : ''}`}
              aria-pressed={phase === 'pass' ? picked : undefined}
              onFocus={() => setCursor(k)}
              onClick={() => {
                setCursor(k)
                if (phase === 'pass')
                  setChosen((x) =>
                    x.includes(c) ? x.filter((y) => y !== c) : x.length < 3 ? [...x, c] : x,
                  )
                else play(c)
              }}
            >
              <Face c={c} />
            </button>
          )
        })}
      </div>
      <div className="lab-controls">
        {phase === 'pass' && (
          <button className="btn" onClick={pass} disabled={way !== 'hold' && chosen.length !== 3}>
            {way === 'hold' ? '▶ Play' : `Pass ${chosen.length}/3 ${way}`}
          </button>
        )}
        {phase === 'between' && (
          <button className="btn" onClick={() => nextHand()}>
            ▶ Next hand
          </button>
        )}
        {phase === 'over' && (
          <button className="btn" onClick={() => nextHand(true)}>
            ↻ New game
          </button>
        )}
      </div>
      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {r.won} of {r.played}
          {r.moons ? ` · moons shot ${r.moons}` : ''}
        </span>
      </p>
      {level !== saved.level && phase !== 'over' && (
        <p className="muted mc-note">The new level starts with the next game.</p>
      )}

      <div className="fw-panel">
        <section aria-label="Table">
          <h3 className="fw-h">Table</h3>
          <div className="lab-controls" role="group" aria-label="Felt">
            {FELTS.map((f) => (
              <button
                key={f}
                className="btn btn-ghost"
                aria-pressed={saved.felt === f}
                onClick={() => setSaved((s) => ({ ...s, felt: f }))}
              >
                {FELT_NAMES[f]}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Card backs">
            {BACKS.map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={saved.back === b}
                onClick={() => setSaved((s) => ({ ...s, back: b }))}
              >
                {BACK_NAMES[b]}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Hearts for four: you and three computers. Each hand, pass three cards — left, then right,
        then across, then keep them — and play thirteen tricks. Follow the suit led if you can; the
        highest card of that suit takes the trick. Every heart you take costs a point and the queen
        of spades thirteen — unless you take every one of them and shoot the moon, when everyone
        else takes 26. The two of clubs leads, nobody may play points on the first trick if they can
        help it, and hearts cannot be led until one has been played. When someone reaches the end
        score, the lowest wins. Easy plays any card, Fair plays by the usual habits, and Hard deals
        the hidden cards out two dozen ways before each card and plays the one that costs it least.
      </p>
    </div>
  )
}

type HeartsMine = { hand: Card[] | null; passed: Card[] | null; got: Card[] | null }

/**
 * A match by turns: the table as all four seats see it, and my own hand as lab-move shows it me.
 * Seats are shown from where I sit: me, the computer on my left, my friend across, the computer
 * on my right — the computers by names both friends share.
 */
function HeartsMatch({ lm }: { lm: LabMatch }) {
  const [saved] = useKept(HEARTS_KEY, readSaved)
  const g = lm.shown as HeartsGame | null
  const at = lm.view?.you === 1 ? 2 : 0
  const friend = !lm.view ? 'Your friend' : otherName(lm.view)
  // the computers keep one name each at the table, so the two friends mean the same seat by it
  const nameOf = (seat: number) =>
    seat === at
      ? 'You'
      : seat % 2 === 0
        ? friend
        : seat === 1
          ? 'Robin (computer)'
          : 'Kit (computer)'
  const [cards, setCards] = useState<HeartsMine | null>(null)
  const [chosen, setChosen] = useState<Card[]>([])
  const seq = lm.view?.seq
  const active = lm.view?.status === 'active' || lm.view?.status === 'finished'
  useEffect(() => {
    if (!lm.id || !active) return
    let live = true
    myHidden(lm.id)
      .then((m) => {
        if (!live) return
        setCards(m && typeof m === 'object' ? (m as HeartsMine) : null)
        setChosen([])
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [lm.id, seq, active])
  if (!g)
    return (
      <div className="lab-keys ht-room">
        <MatchBar lm={lm} sides={['the first to pass', 'the second']} />
      </div>
    )

  const t = heartsTotals(g)
  const way = PASS[g.past.length % 4]
  const myTurn = lm.canPlay
  const hand = cards?.hand ?? []
  const passing = g.phase === 'pass' && myTurn
  const table: Hand = { ...g.h, hands: g.h.hands.map((x, i) => (i === at ? hand : x)) }
  const playable = new Set(g.phase === 'play' && myTurn ? legal(table, at) : [])
  const order = (a: Card, b: Card) => {
    const o = [3, 2, 0, 1]
    return o.indexOf(suitOf(a)) - o.indexOf(suitOf(b)) || rankOf(a) - rankOf(b)
  }
  const mine = [...hand].sort(order)
  const got = cards?.got ?? []
  // the last trick taken, shown while the next is still empty
  const seats = seatsPlayed(g.h.played, g.first)
  const lastTrick =
    g.phase === 'play' && !g.h.trick.length && g.h.played.length >= 4
      ? g.h.played.slice(-4).map((c, i) => ({ seat: seats[seats.length - 4 + i], card: c }))
      : []
  const onTable = g.h.trick.length ? g.h.trick : lastTrick
  const held = (seat: number) =>
    g.phase === 'pass' ? 13 : 13 - seats.filter((s) => s === seat).length
  const last = g.past[g.past.length - 1]
  const lastPts = last ? score(replayHandPoints(last.order, last.first)) : null
  const newHand = !!last && (g.phase === 'pass' || (g.phase === 'play' && g.h.played.length < 4))
  const words = (() => {
    const lastLine = lastPts
      ? `Hand ${g.past.length}: ${[0, 1, 2, 3].map((s) => `${nameOf(s).replace(' (computer)', '')} +${lastPts[s]}`).join(', ')}. `
      : ''
    if (lm.view?.status === 'finished') return lastLine
    if (g.phase === 'pass') {
      if (passing) return `${newHand ? lastLine : ''}Pick three cards to pass ${way}.`
      if (cards?.passed) return `Your three are passed face down. ${friend} is passing.`
      return `${friend} is passing first.`
    }
    if (myTurn)
      return `${newHand ? lastLine : ''}Your card${g.h.trick.length ? '' : ' — your lead'}.`
    return `${newHand ? lastLine : ''}${nameOf(g.h.turn)} is to play.`
  })()
  return (
    <div className={`lab-keys ht-room is-${saved.felt}`}>
      <MatchBar lm={lm} sides={['the first to pass', 'the second']} />
      <div className="dice-scores ht-scores">
        {[at, (at + 1) % 4, (at + 2) % 4, (at + 3) % 4].map((seat) => (
          <div
            key={seat}
            className={`dice-score${g.phase === 'play' && g.h.turn === seat ? ' is-up' : ''}`}
          >
            <span>{nameOf(seat)}</span>
            <strong>{t[seat]}</strong>
            <span className="muted">
              {g.phase === 'play'
                ? `+${g.h.taken[seat].reduce((a, c) => a + points(c), 0)} this hand`
                : ' '}
            </span>
          </div>
        ))}
      </div>
      <p className="muted mc-note">
        {`Lowest of you and ${friend} wins; the computers only fill the table. To ${g.end}.`}
      </p>
      {words && (
        <p className="mc-line" aria-live="polite">
          {words}
        </p>
      )}
      {g.phase !== 'over' && lm.view?.status !== 'finished' && (
        <div className="ht-table">
          {[2, 1, 3].map((rel) => {
            const seat = (at + rel) % 4
            return (
              <div
                key={rel}
                className={`ht-seat is-s${rel}`}
                aria-label={`${nameOf(seat)}: ${held(seat)} cards`}
                role="img"
              >
                <span className={`pk-card is-back tw-back is-${saved.back}`}>
                  <span className="ht-count">{held(seat)}</span>
                </span>
                <span className="ht-name">{nameOf(seat)}</span>
              </div>
            )
          })}
          <div
            className="ht-trick"
            aria-label={
              onTable.length
                ? `${g.h.trick.length ? 'On the table' : 'The last trick'}: ${onTable.map((x) => `${nameOf(x.seat)} ${longName(x.card)}`).join(', ')}`
                : 'Nothing on the table'
            }
            role="img"
          >
            {onTable.map((x) => (
              <span key={x.seat} className={`ht-played is-s${(x.seat - at + 4) % 4}`}>
                <Face c={x.card} />
              </span>
            ))}
          </div>
        </div>
      )}
      {cards && g.phase !== 'over' && lm.view?.status !== 'finished' && (
        <div
          className="ht-hand"
          role="group"
          aria-label={passing ? 'Your hand: pick three to pass' : 'Your hand'}
        >
          {mine.map((c) => {
            const picked = chosen.includes(c)
            const ok = passing || playable.has(c)
            return (
              <button
                key={c}
                className={`ht-mine${picked ? ' is-picked' : ''}${ok ? '' : ' is-dim'}${got.includes(c) ? ' is-new' : ''}`}
                disabled={lm.busy || !ok}
                aria-pressed={passing ? picked : undefined}
                aria-label={`${longName(c)}${picked ? ', picked to pass' : ''}${got.includes(c) ? ', passed to you' : ''}`}
                onClick={() => {
                  if (passing)
                    setChosen((x) =>
                      x.includes(c) ? x.filter((y) => y !== c) : x.length < 3 ? [...x, c] : x,
                    )
                  else if (playable.has(c)) lm.commit({ play: c })
                }}
              >
                <Face c={c} />
              </button>
            )
          })}
        </div>
      )}
      {passing && (
        <div className="lab-controls">
          <button
            className="btn"
            disabled={chosen.length !== 3 || lm.busy}
            onClick={() => lm.commit({ pass: [chosen[0], chosen[1], chosen[2]] })}
          >
            {`Pass ${chosen.length}/3 ${way}`}
          </button>
        </div>
      )}
      <p className="muted lab-hint">
        Hearts by turns: the hands are dealt by the server and yours is shown to you alone. Pass
        three (left, right, across, then none), then thirteen tricks — follow suit when you can;
        each heart costs a point and the queen of spades thirteen, unless one player takes them all.
        The computers play their seats the moment it is their turn.
      </p>
    </div>
  )
}

/** a finished hand's table, played back from its order and first seat, for its points */
function replayHandPoints(order: Card[], first: number): Hand {
  let h: Hand = {
    hands: [[], [], [], []],
    trick: [],
    leader: first,
    turn: first,
    taken: [[], [], [], []],
    broken: false,
    tricks: 0,
    void: [0, 1, 2, 3].map(() => [false, false, false, false]),
    played: [],
  }
  for (const c of order) h = playCard(h, c)
  return h
}
