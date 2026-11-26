import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { RANK_NAMES, SUITS, rankOf, suitOf, type Card } from './poker'
import {
  BACKS,
  EIGHTS_KEY,
  FELTS,
  LEVELS,
  apply,
  choose,
  cost,
  deal,
  drawCard,
  isEight,
  legal,
  pass,
  payout,
  playCard,
  readSaved,
  top,
  type Hand,
  type Level,
  type Saved,
} from './eights'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'
import { totals as eightsTotals, type EightsGame } from './eightsRoom'
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
/** who sits where: you at the bottom, the computers round the table */
const SEATING: Record<number, string[]> = {
  2: ['You', 'North'],
  3: ['You', 'West', 'East'],
  4: ['You', 'West', 'North', 'East'],
}
const TARGET = 100

function Face({ c }: { c: Card }) {
  const red = suitOf(c) === 1 || suitOf(c) === 2
  return (
    <span className={`pk-card${red ? ' is-red' : ''}`} aria-hidden>
      <span>{RANK_NAMES[rankOf(c)]}</span>
      <span>{SUITS[suitOf(c)]}</span>
    </span>
  )
}

export function EightsDemo() {
  /* a match by turns, when the address names one (src/lab/matches/useLabMatch.ts): heads up, the
     hands, stock and a drawn card kept back by the server (eightsRoom.ts) */
  const lm = useLabMatch('eights', { preview: false })
  // keyed by the match: another match starts with nothing of this one (a half-picked eight)
  if (lm.id) return <EightsMatch key={lm.id} lm={lm} />
  return <EightsAlone />
}

function EightsAlone() {
  const signedIn = useSignedIn()
  const [saved, setSaved] = useKept(EIGHTS_KEY, readSaved)
  const [level, setLevel] = useState<Level>(saved.level)
  const [players, setPlayers] = useState<number>(saved.players)
  const [hand, setHand] = useState<Hand>(() => deal(saved.players, Math.random, 0))
  const [points, setPoints] = useState<number[]>(() => new Array(saved.players).fill(0))
  const [phase, setPhase] = useState<'play' | 'between' | 'over'>('play')
  /** an eight played, waiting for its suit */
  const [naming, setNaming] = useState<Card | null>(null)
  const [cursor, setCursor] = useState(0)
  const [line, setLine] = useState(
    'Match the top card by suit or by number. Eights go on anything.',
  )
  const timers = useRef<number[]>([])
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  const pointsRef = useRef(points)
  pointsRef.current = points
  const levelRef = useRef(level)
  levelRef.current = level
  const firstRef = useRef(0)
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
  const seats = SEATING[players]

  const endHand = (h: Hand) => {
    const w = h.winner!
    const pay = payout(h)
    const next = pointsRef.current.map((p, i) => (i === w ? p + pay : p))
    pointsRef.current = next
    setPoints(next)
    const desc = `${w === 0 ? 'You go out' : `${seats[w]} goes out`} and ${w === 0 ? 'take' : 'takes'} ${pay} points.`
    if (next[w] >= TARGET) {
      const lv = levelRef.current
      setSaved((x) => ({
        ...x,
        record: {
          ...x.record,
          [lv]: { won: x.record[lv].won + (w === 0 ? 1 : 0), played: x.record[lv].played + 1 },
        },
      }))
      setLine(`${desc} ${w === 0 ? `🏆 You win with ${next[0]}!` : `${seats[w]} wins the game.`}`)
      setPhase('over')
    } else {
      setLine(`${desc} Next hand when you are ready.`)
      setPhase('between')
    }
  }
  /** the computers take their turns until it is yours, or the hand ends */
  const run = (h: Hand) => {
    setHand(h)
    if (h.winner !== null) return endHand(h)
    if (h.turn === 0) {
      const can = legal(h)
      setLine(
        h.drew !== null
          ? `You drew the ${longName(h.drew)}. Play it, or keep it.`
          : can.length
            ? `Your turn${isEight(top(h)) || h.suit !== suitOf(top(h)) ? ` — ${SUIT_NAMES[h.suit]} asked for` : ''}.`
            : 'Nothing goes: draw a card.',
      )
      return
    }
    later(reduced() ? 150 : 650, () => {
      const lv = levelRef.current
      const ch = choose(h, lv)
      const next = apply(h, ch, Math.random)
      const who = seats[h.turn]
      if (ch.kind === 'play')
        setLine(
          `${who} plays the ${longName(ch.card)}${isEight(ch.card) ? ` and asks for ${SUIT_NAMES[next.suit]}` : ''}.`,
        )
      else if (ch.kind === 'draw') setLine(`${who} draws.`)
      run(next)
    })
  }
  const play = (c: Card) => {
    if (phase !== 'play' || hand.turn !== 0 || naming !== null) return
    if (!legal(hand).includes(c)) {
      setLine(
        hand.drew !== null
          ? 'Having drawn, only the card you drew may go — or keep it.'
          : `That does not match: ${SUIT_NAMES[hand.suit]} or a ${LONG[rankOf(top(hand))]}, or an eight.`,
      )
      return
    }
    if (isEight(c) && hand.hands[0].length > 1) {
      setNaming(c)
      setLine('Which suit do you ask for?')
      return
    }
    run(playCard(hand, c, suitOf(c)))
  }
  const name = (suit: number) => {
    if (naming === null) return
    const c = naming
    setNaming(null)
    run(playCard(hand, c, suit))
  }
  const draw = () => {
    if (phase !== 'play' || hand.turn !== 0 || hand.drew !== null || legal(hand).length) return
    run(drawCard(hand, Math.random))
  }
  const nextHand = (fresh = false) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    const n = fresh ? saved.players : players
    if (fresh) {
      setPlayers(n)
      setLevel(saved.level)
      levelRef.current = saved.level
      pointsRef.current = new Array(n).fill(0)
      setPoints(pointsRef.current)
      firstRef.current = 0
    } else firstRef.current = (firstRef.current + 1) % n
    setNaming(null)
    setPhase('play')
    setCursor(0)
    run(deal(n, Math.random, firstRef.current))
  }
  // the first deal is always yours to lead; once, when the toy opens, say so — and whether
  // anything goes or a draw is due — the way every later turn does
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    run(hand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mine = hand.hands[0]
  const can = new Set(phase === 'play' && hand.turn === 0 && naming === null ? legal(hand) : [])
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const k = Math.max(0, Math.min(mine.length - 1, cursor + (e.key === 'ArrowLeft' ? -1 : 1)))
    setCursor(k)
    cardRefs.current[k]?.focus()
  }
  const back = `pk-card is-back tw-back is-${saved.back}`
  const r = saved.record[saved.level]
  const yourTurn = phase === 'play' && hand.turn === 0
  const asked = hand.suit !== suitOf(top(hand))

  return (
    <div className={`lab-keys ce-room is-${saved.felt}`}>
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
        <div className="lab-group" role="group" aria-label="How many players">
          {([2, 3, 4] as const).map((n) => (
            <button
              key={n}
              className="btn btn-ghost"
              aria-pressed={saved.players === n}
              onClick={() => setSaved((s) => ({ ...s, players: n }))}
            >
              {n} players
            </button>
          ))}
        </div>
        {signedIn && <MatchChallenge demo="eights" settings={{}} levelNames={LEVEL_NAMES} />}
        <button className="btn btn-ghost" onClick={() => nextHand(true)}>
          ↻ New game
        </button>
      </div>
      <div className="dice-scores ce-scores" style={{ ['--ce-n' as string]: players }}>
        {seats.map((s, i) => (
          <div
            key={s}
            className={`dice-score${hand.turn === i && phase === 'play' ? ' is-up' : ''}`}
          >
            <span>{s}</span>
            <strong>{points[i]}</strong>
            <span className="muted">{hand.hands[i].length} cards</span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="ce-table">
        <div className="ce-seats">
          {seats.slice(1).map((s, k) => (
            <div
              key={s}
              className={`ce-seat${hand.turn === k + 1 && phase === 'play' ? ' is-up' : ''}`}
              role="img"
              aria-label={`${s}: ${hand.hands[k + 1].length} cards`}
            >
              <span className={back}>
                <span className="ce-count">{hand.hands[k + 1].length}</span>
              </span>
              <span>{s}</span>
            </div>
          ))}
        </div>
        <div className="ce-middle">
          <button
            className="ce-stock"
            onClick={draw}
            disabled={!yourTurn || hand.drew !== null || can.size > 0}
            aria-label={`Draw a card: ${hand.stock.length} in the stock`}
          >
            <span className={back}>
              <span className="ce-count">{hand.stock.length}</span>
            </span>
            <span>Draw</span>
          </button>
          <div
            className="ce-pile"
            role="img"
            aria-label={`On the pile: the ${longName(top(hand))}${asked ? `; ${SUIT_NAMES[hand.suit]} asked for` : ''}`}
          >
            <Face c={top(hand)} />
            {asked && <span className="ce-asked">{SUITS[hand.suit]} asked</span>}
          </div>
        </div>
      </div>

      {naming !== null && (
        <div className="lab-controls ce-name" role="group" aria-label="Which suit to ask for">
          {[0, 1, 2, 3].map((s) => (
            <button key={s} className="btn" onClick={() => name(s)}>
              {SUITS[s]} {SUIT_NAMES[s]}
            </button>
          ))}
        </div>
      )}
      {yourTurn && hand.drew !== null && (
        <div className="lab-controls">
          <button className="btn" onClick={() => play(hand.drew!)}>
            Play the {longName(hand.drew)}
          </button>
          <button className="btn btn-ghost" onClick={() => run(pass(hand))}>
            Keep it
          </button>
        </div>
      )}

      <div
        className="ce-hand"
        role="group"
        aria-label="Your hand. Left and right arrows move along it; Enter plays a card."
        onKeyDown={onKey}
      >
        {mine.map((c, k) => (
          <button
            key={c}
            ref={(el) => {
              cardRefs.current[k] = el
            }}
            className={`ce-mine${can.has(c) || !yourTurn ? '' : ' is-dim'}${hand.drew === c ? ' is-new' : ''}`}
            tabIndex={k === cursor ? 0 : -1}
            aria-label={`${longName(c)}${yourTurn && !can.has(c) ? ', cannot be played now' : ''}, worth ${cost(c)} if left`}
            onFocus={() => setCursor(k)}
            onClick={() => {
              setCursor(k)
              play(c)
            }}
          >
            <Face c={c} />
          </button>
        ))}
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
        </span>
      </p>
      {(level !== saved.level || players !== saved.players) && phase !== 'over' && (
        <p className="muted mc-note">The new choice starts with the next game.</p>
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
        Play a card that matches the top of the pile by suit or by number. An eight goes on
        anything, and you name the suit that must follow. If nothing goes, draw one; if it fits you
        may play it. The first to run out of cards takes the points left in everyone else’s hand:
        fifty for an eight, ten for a picture, one for an ace, the rest their number. First to a
        hundred wins. Fair keeps its eights until nothing else will go; Hard also remembers which
        suits each player has been seen without, and asks for those — a small edge, since between
        two sensible players this game is mostly the deal.
      </p>
    </div>
  )
}

type EightsMine = { hand: Card[] | null; drew: Card | null }

/** a match by turns, heads up: the table both players see, and my own hand as lab-move shows it */
function EightsMatch({ lm }: { lm: LabMatch }) {
  const [saved] = useKept(EIGHTS_KEY, readSaved)
  const g = lm.shown as EightsGame | null
  const together = lm.view?.mode === 'together'
  const side: 0 | 1 = together ? 0 : lm.view?.you === 1 ? 1 : 0
  const theirs: 0 | 1 = side === 0 ? 1 : 0
  const them = !lm.view ? 'They' : together ? 'The computer' : otherName(lm.view)
  const myName = together ? 'You two' : 'You'
  const [cards, setCards] = useState<EightsMine | null>(null)
  const [eight, setEight] = useState<Card | null>(null)
  const seq = lm.view?.seq
  const active = lm.view?.status === 'active' || lm.view?.status === 'finished'
  useEffect(() => {
    if (!lm.id || !active) return
    let live = true
    myHidden(lm.id)
      .then((m) => {
        if (!live) return
        setCards(m && typeof m === 'object' ? (m as EightsMine) : null)
        setEight(null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [lm.id, seq, active])
  if (!g)
    return (
      <div className="lab-keys ce-room">
        <MatchBar lm={lm} sides={['the first to play', 'the second']} />
      </div>
    )

  const t = eightsTotals(g)
  const myTurn = lm.canPlay
  const topCard = g.pile[g.pile.length - 1]
  const goes = (c: Card) => isEight(c) || suitOf(c) === g.suit || rankOf(c) === rankOf(topCard)
  const hand = cards?.hand ?? []
  const drew = myTurn && g.drawn ? (cards?.drew ?? null) : null
  const playable = new Set(
    myTurn ? (g.drawn ? (drew !== null && goes(drew) ? [drew] : []) : hand.filter(goes)) : [],
  )
  const mustDraw = myTurn && !g.drawn && cards !== null && !playable.size
  const asked = !g.between && isEight(topCard)
  const last = g.done[g.done.length - 1] ?? null
  const newHand = !!last && g.pile.length === 1 && g.moves === 0
  const lastWords = !last
    ? ''
    : last.winner === null
      ? 'The last hand went nowhere and was called off: no score.'
      : `${last.winner === side ? myName : them} went out: +${last.points}.`
  const tap = (c: Card) => {
    if (!playable.has(c)) return
    if (isEight(c)) setEight(c)
    else lm.commit({ play: c })
  }
  const words =
    lm.view?.status === 'finished'
      ? lastWords
      : eight !== null
        ? 'Name the suit to follow.'
        : drew !== null
          ? `You drew the ${longName(drew)}: play it, or keep it.`
          : myTurn
            ? `${newHand ? `${lastWords} A new hand. ` : ''}${mustDraw ? 'Nothing goes: draw one.' : `Your card: ${SUIT_NAMES[g.suit]}${asked ? ' were asked for' : ''}, or a ${LONG[rankOf(topCard)]}, or an eight.`}`
            : `${newHand ? `${lastWords} ` : ''}${together && lm.view?.turn !== lm.view?.you ? 'Your partner' : them} is to play${g.drawn ? ', with a card just drawn' : ''}.`
  return (
    <div className={`lab-keys ce-room is-${saved.felt}`}>
      <MatchBar lm={lm} sides={['the first to play', 'the second']} />
      <div className="dice-scores ce-scores" style={{ ['--ce-n' as string]: 2 }}>
        {[side, theirs].map((s) => (
          <div key={s} className={`dice-score${!g.between && g.turn === s ? ' is-up' : ''}`}>
            <span>{s === side ? myName : them}</span>
            <strong>{t[s]}</strong>
            <span className="muted">
              {g.sizes[s]} card{g.sizes[s] === 1 ? '' : 's'} · to {g.target}
            </span>
          </div>
        ))}
      </div>
      {words && (
        <p className="mc-line" aria-live="polite">
          {words}
        </p>
      )}
      {!g.between && (
        <div className="ce-table">
          <div className="ce-seats">
            <div
              className={`ce-seat${g.turn === theirs ? ' is-up' : ''}`}
              role="img"
              aria-label={`${them}: ${g.sizes[theirs]} cards`}
            >
              <span className={`pk-card is-back tw-back is-${saved.back}`}>
                <span className="ce-count">{g.sizes[theirs]}</span>
              </span>
              <span className="ce-who">{them}</span>
            </div>
          </div>
          <div className="ce-middle">
            <button
              className="ce-stock"
              onClick={() => lm.commit({ draw: true })}
              disabled={!mustDraw || lm.busy}
              aria-label={`Draw one from the stock, ${g.stockLeft} cards`}
            >
              <span className={`pk-card is-back tw-back is-${saved.back}`}>
                <span className="ce-count">{g.stockLeft}</span>
              </span>
            </button>
            <div
              className="ce-pile"
              role="img"
              aria-label={`On the pile: the ${longName(topCard)}${asked ? `; ${SUIT_NAMES[g.suit]} asked for` : ''}`}
            >
              <Face c={topCard} />
              {asked && <span className="ce-asked">{SUITS[g.suit]} asked</span>}
            </div>
          </div>
        </div>
      )}
      {eight !== null && (
        <div className="lab-controls ce-name" role="group" aria-label="Which suit to ask for">
          {[0, 1, 2, 3].map((s) => (
            <button
              key={s}
              className="btn"
              disabled={lm.busy}
              onClick={() => lm.commit({ play: eight, suit: s })}
            >
              {SUITS[s]} {SUIT_NAMES[s]}
            </button>
          ))}
          <button className="btn btn-ghost" onClick={() => setEight(null)}>
            Not the eight
          </button>
        </div>
      )}
      {drew !== null && eight === null && (
        <div className="lab-controls">
          {playable.has(drew) && (
            <button className="btn" disabled={lm.busy} onClick={() => tap(drew)}>
              Play the {longName(drew)}
            </button>
          )}
          <button
            className="btn btn-ghost"
            disabled={lm.busy}
            onClick={() => lm.commit({ pass: true })}
          >
            Keep it
          </button>
        </div>
      )}
      {cards && !g.between && (
        <div className="ce-hand" role="group" aria-label="Your hand">
          {hand.map((c) => (
            <button
              key={c}
              className={`ce-mine${playable.has(c) || !myTurn ? '' : ' is-dim'}${drew === c ? ' is-new' : ''}`}
              disabled={lm.busy || !playable.has(c)}
              aria-label={`${longName(c)}${drew === c ? ', just drawn' : ''}${myTurn && !playable.has(c) ? ', will not go' : ''}`}
              onClick={() => tap(c)}
            >
              <Face c={c} />
            </button>
          ))}
        </div>
      )}
      {last && last.winner !== null && (newHand || lm.view?.status === 'finished') && (
        <p className="sun-reading">
          <span className="muted">
            Left in{' '}
            {last.winner === side
              ? `${them.toLowerCase() === 'the computer' ? 'the computer’s' : `${them}’s`}`
              : 'your'}{' '}
            hand: {last.left.map(longName).join(', ') || 'nothing'}.
          </span>
        </p>
      )}
      <p className="muted lab-hint">
        Crazy eights by turns, heads up, to {g.target}: each hand is dealt by the server and your
        cards are shown to you alone. Match the top card by suit or number, or play an eight and
        name the suit; with nothing that goes, draw one — and play it if it fits. Out first takes
        the points left in the other hand.
        {together ? ' Together, the two of you hold one hand and take its moves in turn.' : ''}
      </p>
    </div>
  )
}
