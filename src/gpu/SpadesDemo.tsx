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
import { dealerOf, teams as spadesTeams, type SpadesGame } from './spadesRoom'
import { useLabMatch, type LabMatch } from '../lab/matches/useLabMatch'
import { MatchBar } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'
import { myHidden } from '../lab/matches/cloud'

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
  /* a match by turns, when the address names one (src/lab/matches/useLabMatch.ts): partnerships
     with the computer filling the table, the hands kept back by the server (spadesRoom.ts) */
  const lm = useLabMatch('spades', { preview: false })
  // keyed by the match: another match starts with nothing of this one (a half-chosen bid)
  if (lm.id) return <SpadesMatch key={lm.id} lm={lm} />
  return <SpadesAlone />
}

function SpadesAlone() {
  const signedIn = useSignedIn()
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
        {signedIn && (
          <MatchChallenge
            demo="spades"
            settings={{ target: saved.target, level: saved.level }}
            levelNames={LEVEL_NAMES}
          />
        )}
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

/**
 * A match by turns: the table as all four seats see it, and my own hand as lab-move shows it me,
 * from where I sit. Versus, each friend has a computer partner across the table; together, the
 * friends are partners. The computers keep one name each, so both friends mean the same seat.
 */
function SpadesMatch({ lm }: { lm: LabMatch }) {
  const [saved] = useKept(SPADES_KEY, readSaved)
  const g = lm.shown as SpadesGame | null
  const together = lm.view?.mode === 'together'
  const you = lm.view?.you === 1 ? 1 : 0
  const at = together ? you * 2 : you
  const friend = !lm.view ? 'Your friend' : otherName(lm.view)
  const humans = together ? [0, 2] : [0, 1]
  const bots = [0, 1, 2, 3].filter((s) => !humans.includes(s))
  const nameOf = (seat: number) =>
    seat === at ? 'You' : humans.includes(seat) ? friend : seat === bots[0] ? 'Robin' : 'Kit'
  const [hand, setHand] = useState<Card[] | null>(null)
  const [myBid, setMyBid] = useState(3)
  const seq = lm.view?.seq
  const active = lm.view?.status === 'active' || lm.view?.status === 'finished'
  useEffect(() => {
    if (!lm.id || !active) return
    let live = true
    myHidden(lm.id)
      .then((m) => {
        if (live)
          setHand(m && typeof m === 'object' ? ((m as { hand: Card[] }).hand ?? null) : null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [lm.id, seq, active])
  if (!g)
    return (
      <div className="lab-keys sd-room">
        <MatchBar lm={lm} sides={['the first to bid', 'the second']} />
      </div>
    )

  const h = g.h
  const tm = spadesTeams(g)
  const isBidding = !g.over && bidding(h)
  const myTurn = lm.canPlay
  const table: Hand = { ...h, hands: h.hands.map((x, i) => (i === at ? (hand ?? []) : x)) }
  const playable = new Set(!isBidding && myTurn ? legal(table, at) : [])
  const order = (a: Card, b: Card) => {
    const o = [2, 3, 1, 0]
    return o.indexOf(suitOf(a)) - o.indexOf(suitOf(b)) || rankOf(a) - rankOf(b)
  }
  const mine = [...(hand ?? [])].sort(order)
  const teamName = (t: number) =>
    [t, t + 2]
      .map(nameOf)
      .sort((a, b) => (a === 'You' ? -1 : b === 'You' ? 1 : 0))
      .join(' and ')
  const held = (seat: number) => 13 - h.played.filter((_, i) => seatOfPlay(h, i) === seat).length
  const seatLine = (seat: number) => {
    const b = h.bids[seat]
    return b === null ? (isBidding ? 'to bid' : '') : `bid ${bidWord(b)} · took ${h.won[seat]}`
  }
  const onTable = h.trick
  const last = g.past[g.past.length - 1]
  const newHand = !!last && h.played.length === 0
  const lastLine = last
    ? `Hand ${g.past.length}: ${teamName(0)} ${tm[0].score}, ${teamName(1)} ${tm[1].score}. `
    : ''
  const words = (() => {
    if (lm.view?.status === 'finished' || g.over) return lastLine
    if (isBidding)
      return myTurn
        ? `${newHand ? lastLine : ''}Your bid: the tricks you will take, or nil for none.`
        : `${newHand ? lastLine : ''}${nameOf(h.turn)} is bidding.`
    if (myTurn) return `Your card${h.trick.length ? '' : ' — your lead'}.`
    return `${nameOf(h.turn)} is to play.`
  })()
  return (
    <div className={`lab-keys sd-room is-${saved.felt}`}>
      <MatchBar lm={lm} sides={['the first to bid', 'the second']} />
      <div className="dice-scores sd-scores">
        {[at % 2, (at + 1) % 2].map((t) => (
          <div
            key={t}
            className={`dice-score${!g.over && h.turn % 2 === t && !isBidding ? ' is-up' : ''}`}
          >
            <span>{teamName(t)}</span>
            <strong>{tm[t].score}</strong>
            <span className="muted">
              {tm[t].bags} bag{tm[t].bags === 1 ? '' : 's'} · to {g.target}
            </span>
          </div>
        ))}
      </div>
      {words && (
        <p className="mc-line" aria-live="polite">
          {words}
        </p>
      )}
      {!g.over && lm.view?.status !== 'finished' && (
        <div className="sd-table">
          {[2, 1, 3].map((rel) => {
            const seat = (at + rel) % 4
            return (
              <div
                key={rel}
                className={`sd-seat is-s${rel}${h.turn === seat ? ' is-up' : ''}`}
                aria-label={`${nameOf(seat)}${rel === 2 ? ', your partner' : ''}: ${held(seat)} cards, ${seatLine(seat)}`}
                role="img"
              >
                <span className={`pk-card is-back tw-back is-${saved.back}`}>
                  <span className="sd-count">{held(seat)}</span>
                </span>
                <span className="sd-name">
                  {nameOf(seat)}
                  {rel === 2 ? ' (partner)' : ''}
                </span>
                <span className="sd-bid">{seatLine(seat)}</span>
              </div>
            )
          })}
          <div
            className="sd-trick"
            aria-label={
              onTable.length
                ? `On the table: ${onTable.map((x) => `${nameOf(x.seat)} ${longName(x.card)}`).join(', ')}`
                : 'Nothing on the table'
            }
            role="img"
          >
            {onTable.map((x) => (
              <span key={x.seat} className={`sd-played is-s${(x.seat - at + 4) % 4}`}>
                <Face c={x.card} />
              </span>
            ))}
          </div>
        </div>
      )}
      {!g.over && (
        <p className="sun-reading sd-me">
          <span className="muted">You: {seatLine(at)}</span>
        </p>
      )}
      {isBidding && myTurn && (
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
          <button className="btn" disabled={lm.busy} onClick={() => lm.commit({ bid: myBid })}>
            Bid {myBid === 0 ? 'nil' : myBid}
          </button>
        </div>
      )}
      {hand && !g.over && lm.view?.status !== 'finished' && (
        <div className="sd-hand" role="group" aria-label="Your hand">
          {mine.map((c) => {
            const ok = playable.has(c)
            return (
              <button
                key={c}
                className={`sd-mine${ok || isBidding ? '' : ' is-dim'}`}
                disabled={lm.busy || !ok}
                aria-label={`${longName(c)}${!isBidding && myTurn && !ok ? ', cannot be played now' : ''}`}
                onClick={() => ok && lm.commit({ play: c })}
              >
                <Face c={c} />
              </button>
            )
          })}
        </div>
      )}
      <p className="muted lab-hint">
        Spades by turns, to {g.target}:{' '}
        {together
          ? `you and ${friend} are partners across the table, against Robin and Kit, the computers.`
          : `you and ${friend} each have a computer partner across the table.`}{' '}
        The hands are dealt by the server and yours is shown to you alone. Bid the tricks you will
        take, or nil; follow suit when you can; spades are trumps. The computers bid and play the
        moment it is their turn. The dealer of this hand is {nameOf(dealerOf(g.past.length))}.
      </p>
    </div>
  )
}

/** which seat played the i-th card of a hand: round the table from each trick's leader */
function seatOfPlay(h: Hand, i: number): number {
  const first = (h.dealer + 1) % 4
  let lead = first
  for (let t = 0; t * 4 <= i; t++) {
    const trick = h.played.slice(t * 4, t * 4 + 4)
    if (i < t * 4 + 4) return (lead + (i - t * 4)) % 4
    lead = winnerOf(trick.map((card, k) => ({ seat: (lead + k) % 4, card })))
  }
  return first
}
