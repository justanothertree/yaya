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

type Phase = 'pass' | 'play' | 'between' | 'over'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(HEARTS_KEY))
  } catch {
    return readSaved(null)
  }
}
const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
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
  const [saved, setSaved] = useState<Saved>(load)
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
  useEffect(() => {
    try {
      localStorage.setItem(HEARTS_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
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
