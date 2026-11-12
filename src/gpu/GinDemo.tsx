import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  BACKS,
  FELTS,
  GIN_KEY,
  LEVELS,
  arrange,
  deal,
  discard,
  draw,
  play,
  readSaved,
  type Hand,
  type Level,
  type Result,
  type Saved,
} from './gin'
import { RANK_NAMES, SUITS, rankOf, suitOf, type Card } from './poker'
import { motionReduced as reduced } from '../ui/motion'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(GIN_KEY))
  } catch {
    return readSaved(null)
  }
}
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', hard: 'Hard' }
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
const TARGET = 100

function Face({ c, tint }: { c: Card; tint?: number }) {
  const red = suitOf(c) === 1 || suitOf(c) === 2
  return (
    <span
      className={`pk-card gn-card${red ? ' is-red' : ''}${tint !== undefined ? ` meld-${tint % 4}` : ''}`}
      aria-hidden
    >
      <span>{RANK_NAMES[rankOf(c)]}</span>
      <span>{SUITS[suitOf(c)]}</span>
    </span>
  )
}
/** a hand laid out the way it counts: each meld together, then the deadwood by suit and rank */
const laidOut = (cards: Card[]) => {
  const a = arrange(cards)
  const order = (x: Card, y: Card) => suitOf(x) - suitOf(y) || rankOf(x) - rankOf(y)
  return {
    ...a,
    list: [
      ...a.melds.flatMap((m, k) => [...m].sort(order).map((c) => ({ c, meld: k }))),
      ...[...a.dead].sort(order).map((c) => ({ c, meld: -1 })),
    ],
  }
}

export function GinDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [level, setLevel] = useState<Level>(saved.level)
  const [hand, setHand] = useState<Hand>(() => deal((Math.random() * 2 ** 31) | 0, 0))
  const [totals, setTotals] = useState<[number, number]>([0, 0])
  const [picked, setPicked] = useState<Card | null>(null)
  /** the card you drew this turn, from either place, so it can be found in the hand */
  const [fresh, setFresh] = useState<Card | null>(null)
  const [line, setLine] = useState('Your turn: draw from the stock, or take the card on the pile.')
  const [done, setDone] = useState(false)
  const [cursor, setCursor] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const timer = useRef(0)
  const levelRef = useRef(level)
  useEffect(() => {
    try {
      localStorage.setItem(GIN_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const settle = (h: Hand, t: [number, number]) => {
    const r = h.over as Result
    const next: [number, number] = [...t]
    if (r.winner !== null) next[r.winner] += r.points
    setTotals(next)
    const who = (w: 0 | 1) => (w === 0 ? 'You' : 'The computer')
    const desc =
      r.how === 'void'
        ? 'The stock ran out with nobody out: no score.'
        : r.how === 'gin'
          ? `${who(r.winner!)} went gin! +${r.points}.`
          : r.how === 'undercut'
            ? `${who(r.knocker!)} knocked, but ${r.winner === 0 ? 'you' : 'the computer'} undercut: +${r.points}.`
            : `${who(r.knocker!)} knocked: +${r.points}.`
    if (Math.max(...next) >= TARGET) {
      const won = next[0] > next[1]
      const lv = levelRef.current
      setSaved((s) => ({
        ...s,
        record: {
          ...s.record,
          [lv]: {
            won: s.record[lv].won + (won ? 1 : 0),
            lost: s.record[lv].lost + (won ? 0 : 1),
            gins: s.record[lv].gins + (r.how === 'gin' && r.winner === 0 ? 1 : 0),
          },
        },
      }))
      setDone(true)
      setLine(
        `${desc} ${won ? '🏆 You win the game' : 'The computer wins the game'}, ${Math.max(...next)} to ${Math.min(...next)}.`,
      )
    } else {
      if (r.how === 'gin' && r.winner === 0) {
        const lv = levelRef.current
        setSaved((s) => ({
          ...s,
          record: { ...s.record, [lv]: { ...s.record[lv], gins: s.record[lv].gins + 1 } },
        }))
      }
      setLine(`${desc} Next hand when you are ready.`)
    }
  }

  const computer = (h: Hand, t: [number, number]) => {
    timer.current = window.setTimeout(
      () => {
        const top = h.pile[h.pile.length - 1]
        const next = play(h, levelRef.current)
        const tookPile = next.picked[1].length > h.picked[1].length
        const threw = next.pile[next.pile.length - 1]
        setHand(next)
        if (next.over) return settle(next, t)
        setLine(
          `The computer ${tookPile ? `takes the ${longName(top)}` : 'draws from the stock'} and discards the ${longName(threw)}. Your turn.`,
        )
      },
      reduced() ? 200 : 800,
    )
  }
  const take = (from: 'stock' | 'pile') => {
    if (hand.over || hand.turn !== 0 || hand.phase !== 'draw') return
    const next = draw(hand, from)
    setHand(next)
    const got =
      from === 'pile'
        ? hand.pile[hand.pile.length - 1]
        : next.hands[0].find((c) => !hand.hands[0].includes(c))!
    setFresh(got)
    setLine(
      `You ${from === 'pile' ? 'take' : 'draw'} the ${longName(got)}. Now pick a card to discard.`,
    )
  }
  const throwAway = (c: Card, knock: boolean) => {
    const next = discard(hand, c, knock)
    if (next === hand) return
    setPicked(null)
    setFresh(null)
    setHand(next)
    if (next.over) return settle(next, totals)
    setLine('The computer is thinking…')
    computer(next, totals)
  }
  const nextHand = (newGame = false) => {
    window.clearTimeout(timer.current)
    const first = (newGame ? 0 : hand.over && hand.over.winner === 1 ? 0 : 1) as 0 | 1
    if (newGame) {
      setTotals([0, 0])
      setDone(false)
      levelRef.current = saved.level
      setLevel(saved.level)
    }
    const h = deal((Math.random() * 2 ** 31) | 0, first)
    setHand(h)
    setPicked(null)
    setFresh(null)
    setCursor(0)
    if (first === 1) {
      setLine('The computer goes first this hand…')
      computer(h, newGame ? [0, 0] : totals)
    } else setLine('Your turn: draw from the stock, or take the card on the pile.')
  }

  const mine = laidOut(hand.hands[0])
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const n = Math.max(0, Math.min(mine.list.length - 1, cursor + (e.key === 'ArrowLeft' ? -1 : 1)))
    setCursor(n)
    refs.current[n]?.focus()
  }
  const top = hand.pile[hand.pile.length - 1]
  const myTurn = !hand.over && hand.turn === 0
  const after = picked !== null ? arrange(hand.hands[0].filter((c) => c !== picked)).points : null
  const r = saved.record[saved.level]
  const back = `pk-card is-back tw-back is-${saved.back}`
  const shown = hand.over?.shown

  return (
    <div className={`lab-keys gn-room is-${saved.felt}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer plays">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (done || (totals[0] + totals[1] === 0 && hand.pile.length === 1)) {
                  levelRef.current = l
                  setLevel(l)
                }
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => nextHand(true)}>
          ↻ New game
        </button>
      </div>
      <div className="dice-scores">
        <div className={`dice-score${hand.turn === 0 && !hand.over ? ' is-up' : ''}`}>
          <span>You</span>
          <strong>{totals[0]}</strong>
          <span className="muted">deadwood {mine.points}</span>
        </div>
        <div className={`dice-score${hand.turn === 1 && !hand.over ? ' is-up' : ''}`}>
          <span>The computer · {LEVEL_NAMES[level]}</span>
          <strong>{totals[1]}</strong>
          <span className="muted">to {TARGET}</span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="gn-table">
        <div
          className="gn-theirs"
          role="img"
          aria-label={
            shown
              ? 'The computer shows its hand'
              : `The computer holds ${hand.hands[1].length} cards`
          }
        >
          {shown
            ? laidOut([...shown[1].melds.flat(), ...shown[1].dead]).list.map(({ c, meld }) => (
                <Face key={c} c={c} tint={meld >= 0 ? meld : undefined} />
              ))
            : hand.hands[1].map((_, k) => <span key={k} className={`${back} gn-back`} />)}
        </div>
        <div className="gn-middle">
          <button
            className="gn-pile"
            onClick={() => take('stock')}
            disabled={!myTurn || hand.phase !== 'draw'}
            aria-label={`Draw from the stock, ${hand.stock.length} cards`}
          >
            <span className={back}>
              <span className="gn-count">{hand.stock.length}</span>
            </span>
          </button>
          <button
            className="gn-pile"
            onClick={() => take('pile')}
            disabled={!myTurn || hand.phase !== 'draw' || top === undefined}
            aria-label={
              top !== undefined ? `Take the ${longName(top)} from the pile` : 'The pile is empty'
            }
          >
            {top !== undefined ? <Face c={top} /> : <span className="gn-empty" />}
          </button>
        </div>
      </div>

      <div
        className="gn-hand"
        role="group"
        aria-label="Your hand, melds first. Left and right arrows move along it; Enter picks a card to discard."
        onKeyDown={onKey}
      >
        {mine.list.map(({ c, meld }, k) => (
          <button
            key={c}
            ref={(el) => {
              refs.current[k] = el
            }}
            className={`gn-mine${picked === c ? ' is-picked' : ''}${fresh === c ? ' is-new' : ''}`}
            tabIndex={k === cursor ? 0 : -1}
            aria-label={`${longName(c)}${meld >= 0 && saved.melds ? `, in a meld` : ', deadwood'}${hand.took === c ? ', just taken from the pile' : fresh === c ? ', just drawn' : ''}`}
            onFocus={() => setCursor(k)}
            onClick={() => {
              setCursor(k)
              if (myTurn && hand.phase === 'discard') setPicked(picked === c ? null : c)
              else if (myTurn) setLine('Draw first: from the stock or the pile.')
            }}
          >
            <Face c={c} tint={saved.melds && meld >= 0 ? meld : undefined} />
          </button>
        ))}
      </div>
      <div className="lab-controls">
        {picked !== null && myTurn && hand.phase === 'discard' && (
          <>
            <button
              className="btn"
              onClick={() => throwAway(picked, false)}
              disabled={picked === hand.took}
            >
              {picked === hand.took ? 'Just taken — keep it' : `Discard the ${longName(picked)}`}
            </button>
            {after !== null && after <= 10 && picked !== hand.took && (
              <button className="btn" onClick={() => throwAway(picked, true)}>
                {after === 0 ? '✨ Gin!' : `Knock with ${after}`}
              </button>
            )}
          </>
        )}
        {hand.over && !done && (
          <button className="btn" onClick={() => nextHand()}>
            ▶ Next hand
          </button>
        )}
        {done && (
          <button className="btn" onClick={() => nextHand(true)}>
            ↻ Play again
          </button>
        )}
      </div>
      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {r.won}, lost {r.lost}
          {r.gins ? ` · gin ${r.gins} times` : ''}
        </span>
      </p>
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
            <button
              className="btn btn-ghost"
              aria-pressed={saved.melds}
              onClick={() => setSaved((s) => ({ ...s, melds: !s.melds }))}
            >
              Show my melds
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Draw a card — from the stock, or the top of the pile — then discard one. Three or four of a
        rank, or three or more in a row of one suit, make a meld; what is left over is deadwood,
        aces one and pictures ten. With ten or less you may knock, and the computer lays what it can
        onto your melds: you score the difference, unless it has as little as you, when it undercuts
        and scores 25 more. No deadwood at all is gin: 25 and everything it holds. First to a
        hundred. Easy throws any loose card; Hard keeps what can still make a meld and steers clear
        of what you are collecting.
      </p>
    </div>
  )
}
