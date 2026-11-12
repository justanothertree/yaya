import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { RANK_NAMES, SUITS, rankOf, suitOf, type Card } from './poker'
import {
  BACKS,
  FELTS,
  LEVELS,
  SPADES_KEY,
  TARGETS,
  bid,
  bidding,
  chooseBid,
  chooseCard,
  deal,
  handOver,
  legal,
  playCard,
  readSaved,
  scoreHand,
  winnerOf,
  winnerTeam,
  type Hand,
  type Level,
  type Saved,
  type Team,
} from './spades'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

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
const bidWord = (b: number | null) => (b === null ? '—' : b === 0 ? 'nil' : String(b))
const ZERO: Team[] = [
  { score: 0, bags: 0 },
  { score: 0, bags: 0 },
]
type Phase = 'bid' | 'play' | 'between' | 'over'

function Face({ c }: { c: Card }) {
  const red = suitOf(c) === 1 || suitOf(c) === 2
  return (
    <span className={`pk-card${red ? ' is-red' : ''}`} aria-hidden>
      <span>{RANK_NAMES[rankOf(c)]}</span>
      <span>{SUITS[suitOf(c)]}</span>
    </span>
  )
}

export function SpadesDemo() {
  const [saved, setSaved] = useKept(SPADES_KEY, readSaved)
  const [level, setLevel] = useState<Level>(saved.level)
  const [dealer, setDealer] = useState(3)
  const [hand, setHand] = useState<Hand>(() => deal(Math.random, 3))
  const [phase, setPhase] = useState<Phase>('bid')
  const [teams, setTeams] = useState<Team[]>(ZERO)
  const [myBid, setMyBid] = useState(3)
  const [line, setLine] = useState('A new game: you and North against West and East.')
  /** the last trick, held on the table a moment after it is won */
  const [shown, setShown] = useState<{ seat: number; card: Card }[] | null>(null)
  const [cursor, setCursor] = useState(0)
  const timers = useRef<number[]>([])
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  const nilsMade = useRef(0)
  /* the computers' turns run on timers set in an earlier render, so what a finished hand adds to,
     and the level the game is being played at, are read from refs rather than from that render */
  const teamsRef = useRef(teams)
  teamsRef.current = teams
  const levelRef = useRef(level)
  levelRef.current = level
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
  const gap = () => (reduced() ? 120 : 480)

  /** the computers bid in turn until it is yours, or the bidding is done */
  const runBids = (h: Hand, lv: Level = level) => {
    setHand(h)
    if (!bidding(h)) {
      setPhase('play')
      const t0 = (h.bids[0] ?? 0) + (h.bids[2] ?? 0)
      const t1 = (h.bids[1] ?? 0) + (h.bids[3] ?? 0)
      setLine(
        `Bids in: you ${bidWord(h.bids[0])} and North ${bidWord(h.bids[2])} (${t0}); West ${bidWord(h.bids[1])} and East ${bidWord(h.bids[3])} (${t1}).`,
      )
      later(gap() * 2, () => run(h, lv))
      return
    }
    if (h.turn === 0) {
      setPhase('bid')
      // a suggestion to start from: what the rule of thumb would bid with your cards
      setMyBid(chooseBid(h, 'fair'))
      setLine(
        `Your bid. ${h.bids[2] !== null ? `North bid ${bidWord(h.bids[2])}. ` : ''}How many tricks will you take?`,
      )
      return
    }
    later(gap(), () => {
      const b = chooseBid(h, lv)
      const next = bid(h, b)
      setLine(`${SEATS[h.turn]} bids ${bidWord(b)}.`)
      runBids(next, lv)
    })
  }
  const endHand = (h: Hand) => {
    const before = teamsRef.current
    const next = scoreHand(h.bids as number[], h.won, before)
    teamsRef.current = next
    setTeams(next)
    if (h.bids[0] === 0 && h.won[0] === 0) nilsMade.current++
    const gain = next.map((t, i) => t.score - before[i].score)
    const desc = `This hand: you and North ${gain[0] >= 0 ? '+' : ''}${gain[0]}, West and East ${gain[1] >= 0 ? '+' : ''}${gain[1]}.`
    const nil = [0, 1, 2, 3]
      .filter((s) => h.bids[s] === 0)
      .map((s) => `${SEATS[s]}’s nil ${h.won[s] === 0 ? 'came through' : 'was set'}`)
      .join('; ')
    const w = winnerTeam(next, saved.target)
    if (w !== null) {
      const level = levelRef.current
      setSaved((x) => ({
        ...x,
        record: {
          ...x.record,
          [level]: {
            won: x.record[level].won + (w === 0 ? 1 : 0),
            played: x.record[level].played + 1,
            nils: x.record[level].nils + nilsMade.current,
          },
        },
      }))
      setLine(
        `${desc}${nil ? ` ${nil}.` : ''} ${w === 0 ? `🏆 You and North win, ${next[0].score} to ${next[1].score}!` : `West and East win, ${next[1].score} to ${next[0].score}.`}`,
      )
      setPhase('over')
      return
    }
    setLine(`${desc}${nil ? ` ${nil}.` : ''} Next hand when you are ready.`)
    setPhase('between')
  }
  /** the computers play until it is your turn, a trick is won, or the hand ends */
  const run = (h: Hand, lv: Level = level) => {
    setHand(h)
    if (handOver(h)) return endHand(h)
    if (h.turn === 0) {
      setLine(
        h.trick.length
          ? 'Your turn.'
          : `Your lead.${!h.broken ? ' Spades cannot be led until one has been played.' : ''}`,
      )
      return
    }
    later(gap(), () => {
      const card = chooseCard(h, lv)
      const next = playCard(h, card)
      if (next.trick.length === 0) {
        const full = [...h.trick, { seat: h.turn, card }]
        setShown(full)
        setHand(next)
        const w = winnerOf(full)
        setLine(`${w === 0 ? 'You take' : `${SEATS[w]} takes`} the trick.`)
        later(reduced() ? 300 : 900, () => {
          setShown(null)
          run(next, lv)
        })
      } else run(next, lv)
    })
  }
  const play = (card: Card) => {
    if (phase !== 'play' || hand.turn !== 0 || shown) return
    if (!legal(hand).includes(card)) {
      setLine(
        hand.trick.length
          ? 'Follow the suit that was led if you can.'
          : 'Spades cannot be led until one has been played.',
      )
      return
    }
    const next = playCard(hand, card)
    if (next.trick.length === 0) {
      const full = [...hand.trick, { seat: 0, card }]
      setShown(full)
      setHand(next)
      const w = winnerOf(full)
      setLine(`${w === 0 ? 'You take' : `${SEATS[w]} takes`} the trick.`)
      later(reduced() ? 300 : 900, () => {
        setShown(null)
        run(next)
      })
    } else run(next)
  }
  const placeBid = () => {
    if (phase !== 'bid' || hand.turn !== 0) return
    setLine(`You bid ${bidWord(myBid)}.`)
    setPhase('play')
    runBids(bid(hand, myBid))
  }
  const nextHand = (fresh = false) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    const d = (dealer + 1) % 4
    setDealer(d)
    setShown(null)
    setCursor(0)
    const lv = fresh ? saved.level : level
    if (fresh) {
      setTeams(ZERO)
      teamsRef.current = ZERO
      setLevel(lv)
      levelRef.current = lv
      nilsMade.current = 0
    }
    setLine(`${SEATS[d]} deals.`)
    runBids(deal(Math.random, d), lv)
  }
  // the first hand's bidding starts once, when the toy opens
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    runBids(hand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mine = hand.hands[0]
  const can = new Set(
    phase === 'play' && hand.turn === 0 && !shown && !bidding(hand) ? legal(hand) : [],
  )
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const n = Math.max(0, Math.min(mine.length - 1, cursor + (e.key === 'ArrowLeft' ? -1 : 1)))
    setCursor(n)
    cardRefs.current[n]?.focus()
  }
  const onTable = shown ?? hand.trick
  const r = saved.record[saved.level]
  const back = `pk-card is-back tw-back is-${saved.back}`
  const seatLine = (s: number) =>
    hand.bids[s] === null
      ? hand.turn === s
        ? 'bidding…'
        : 'to bid'
      : `bid ${bidWord(hand.bids[s])} · won ${hand.won[s]}`

  return (
    <div className={`lab-keys sd-room is-${saved.felt}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computers play">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => setSaved((s) => ({ ...s, level: l }))}
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
        <button className="btn btn-ghost" onClick={() => nextHand(true)}>
          ↻ New game
        </button>
      </div>

      <div className="dice-scores sd-scores">
        {[0, 1].map((t) => (
          <div
            key={t}
            className={`dice-score${hand.turn % 2 === t && phase === 'play' ? ' is-up' : ''}`}
          >
            <span>{t === 0 ? 'You and North' : 'West and East'}</span>
            <strong>{teams[t].score}</strong>
            <span className="muted">
              {teams[t].bags} bag{teams[t].bags === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="sd-table">
        {[2, 1, 3].map((seat) => (
          <div
            key={seat}
            className={`sd-seat is-s${seat}${hand.turn === seat && phase !== 'between' && phase !== 'over' ? ' is-up' : ''}`}
            aria-label={`${SEATS[seat]}${seat === 2 ? ', your partner' : ''}: ${hand.hands[seat].length} cards, ${seatLine(seat)}`}
            role="img"
          >
            <span className={back}>
              <span className="sd-count">{hand.hands[seat].length}</span>
            </span>
            <span className="sd-name">
              {SEATS[seat]}
              {seat === 2 ? ' (partner)' : ''}
            </span>
            <span className="sd-bid">{seatLine(seat)}</span>
          </div>
        ))}
        <div
          className="sd-trick"
          aria-label={
            onTable.length
              ? `On the table: ${onTable.map((t) => `${SEATS[t.seat]} ${longName(t.card)}`).join(', ')}`
              : 'Nothing on the table'
          }
          role="img"
        >
          {onTable.map((t) => (
            <span key={t.seat} className={`sd-played is-s${t.seat}`}>
              <Face c={t.card} />
            </span>
          ))}
        </div>
      </div>
      <p className="sun-reading sd-me">
        <span className="muted">You: {seatLine(0)}</span>
      </p>

      {phase === 'bid' && hand.turn === 0 && (
        <div className="lab-controls sd-bidding" role="group" aria-label="Your bid">
          <button
            className="btn btn-ghost"
            aria-label="One trick fewer"
            disabled={myBid <= 0}
            onClick={() => setMyBid((b) => Math.max(0, b - 1))}
          >
            −
          </button>
          <strong className="sd-bidnum" aria-live="polite">
            {myBid === 0 ? 'Nil' : myBid}
          </strong>
          <button
            className="btn btn-ghost"
            aria-label="One trick more"
            disabled={myBid >= 13}
            onClick={() => setMyBid((b) => Math.min(13, b + 1))}
          >
            +
          </button>
          <button className="btn" onClick={placeBid}>
            Bid {myBid === 0 ? 'nil' : myBid}
          </button>
        </div>
      )}

      <div
        className="sd-hand"
        role="group"
        aria-label="Your hand. Left and right arrows move along it; Enter plays a card."
        onKeyDown={onKey}
      >
        {mine.map((c, k) => {
          const playable = can.has(c)
          return (
            <button
              key={c}
              ref={(el) => {
                cardRefs.current[k] = el
              }}
              className={`sd-mine${playable || phase !== 'play' ? '' : ' is-dim'}`}
              tabIndex={k === cursor ? 0 : -1}
              aria-label={`${longName(c)}${phase === 'play' && !playable ? ', cannot be played now' : ''}`}
              onFocus={() => setCursor(k)}
              onClick={() => {
                setCursor(k)
                play(c)
              }}
            >
              <Face c={c} />
            </button>
          )
        })}
      </div>
      <div className="lab-controls">
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
          {r.nils ? ` · your nils made ${r.nils}` : ''}
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
        You and North, across the table, play as partners against West and East. Each hand, everyone
        bids the tricks they expect to take, or nil for none at all; your team must make the sum of
        your two bids. Follow the suit led if you can; spades are trumps, and cannot be led until
        one has been played. A bid made scores ten a trick and one for each trick over — a bag; a
        bid missed loses ten a trick, and every tenth bag costs a hundred. Nil is a hundred, won or
        lost. Easy and Fair play by a player’s habits; Hard plays each hand out many ways, both to
        bid and before every card.
      </p>
    </div>
  )
}
