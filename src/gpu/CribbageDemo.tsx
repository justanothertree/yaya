import { useEffect, useRef, useState } from 'react'
import {
  BOARDS,
  CRIBBAGE_KEY,
  LEVELS,
  TARGET,
  canPlay,
  chooseDiscard,
  choosePeg,
  count,
  deal,
  discard,
  other,
  parts,
  peg,
  readSaved,
  score,
  show,
  type Level,
  type Part,
  type Round,
  type Saved,
  type Who,
} from './cribbage'
import { value } from './gin'
import { RANK_NAMES, SUITS, rankOf, suitOf, type Card } from './poker'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(CRIBBAGE_KEY))
  } catch {
    return readSaved(null)
  }
}
const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const BOARD_NAMES: Record<Saved['board'], string> = { oak: 'Oak', walnut: 'Walnut', mint: 'Mint' }
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
const seed = () => (Math.random() * 2 ** 31) | 0
/** a card's place in a hand laid out for reading: ace low, by rank then suit */
const order = (a: Card, b: Card) =>
  ((rankOf(a) + 1) % 13) - ((rankOf(b) + 1) % 13) || suitOf(a) - suitOf(b)

function Face({ c, small }: { c: Card; small?: boolean }) {
  const red = suitOf(c) === 1 || suitOf(c) === 2
  return (
    <span
      className={`pk-card cg-card${red ? ' is-red' : ''}${small ? ' is-small' : ''}`}
      aria-hidden
    >
      <span>{RANK_NAMES[rankOf(c)]}</span>
      <span>{SUITS[suitOf(c)]}</span>
    </span>
  )
}

/** a count read out the way it is said at the table: fifteen two, fifteen four, a pair is six… */
function readOut(ps: Part[]): string {
  if (!ps.length) return 'nineteen — which is to say, nothing'
  let total = 0
  const said: string[] = []
  const fifteens = ps.filter((p) => p.what === 'fifteen')
  for (let i = 0; i < fifteens.length; i++) {
    total += 2
    said.push(`fifteen ${total}`)
  }
  const pairs = ps.filter((p) => p.what === 'pair').length
  if (pairs) {
    total += pairs * 2
    said.push(
      `${['', 'a pair', 'two pairs', 'three of a kind', '', '', 'four of a kind'][pairs] || `${pairs} pairs`} is ${total}`,
    )
  }
  const runs = ps.filter((p) => p.what === 'run')
  if (runs.length) {
    total += runs.reduce((s, p) => s + p.points, 0)
    const len = runs[0].cards.length
    const n =
      ['', 'a run', 'a double run', 'a triple run', 'a double double run'][runs.length] ??
      `${runs.length} runs`
    said.push(`${n} of ${len} is ${total}`)
  }
  const flush = ps.find((p) => p.what === 'flush')
  if (flush) {
    total += flush.points
    said.push(`a flush of ${flush.points} is ${total}`)
  }
  if (ps.some((p) => p.what === 'nobs')) {
    total += 1
    said.push(`and one for his nobs is ${total}`)
  }
  return said.join(', ')
}

type Shown = { who: string; cards: Card[]; points: number; spoken: string }

export function CribbageDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [level, setLevel] = useState<Level>(saved.level)
  const [r, setR] = useState<Round>(() => deal(seed(), 1))
  const [picked, setPicked] = useState<Card[]>([])
  const [line, setLine] = useState('The computer deals. Pick two cards to put in its crib.')
  const [back, setBack] = useState<[number, number]>([0, 0])
  const [shown, setShown] = useState<Shown[]>([])
  /** your best single count this game, for the record */
  const best = useRef(0)
  const timer = useRef(0)
  const recorded = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem(CRIBBAGE_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const whose = (w: Who) => (w === 0 ? 'your' : 'the computer’s')
  /** move to a new state, remembering where each peg was so the back peg can show it */
  const go = (next: Round, prev: Round) => {
    if (next.scores[0] !== prev.scores[0] || next.scores[1] !== prev.scores[1])
      setBack([
        next.scores[0] !== prev.scores[0] ? prev.scores[0] : back[0],
        next.scores[1] !== prev.scores[1] ? prev.scores[1] : back[1],
      ])
    setR(next)
    if (next.winner !== null) finish(next)
  }
  const finish = (g: Round) => {
    if (recorded.current) return
    recorded.current = true
    const won = g.winner === 0
    const loser = g.scores[won ? 1 : 0]
    const skunk = loser < TARGET - 30
    setSaved((s) => {
      const t = s.record[level]
      return {
        ...s,
        record: {
          ...s.record,
          [level]: {
            won: t.won + (won ? 1 : 0),
            lost: t.lost + (won ? 0 : 1),
            skunks: t.skunks + (won && skunk ? 1 : 0),
            best: Math.max(t.best, best.current),
          },
        },
      }
    })
    setLine(
      `${won ? '🏆 You reach' : 'The computer reaches'} ${TARGET}, ${g.scores[0]} to ${g.scores[1]}${skunk ? ' — a skunk' : ''}.`,
    )
  }

  const sendToCrib = () => {
    if (picked.length !== 2 || r.phase !== 'discard') return
    const theirs = chooseDiscard(r, 1, level)
    const next = discard(r, picked as [Card, Card], theirs)
    setPicked([])
    go(next, r)
    const heels =
      next.said === 'heels'
        ? ` The starter is the ${longName(next.starter)} — two for his heels to ${r.dealer === 0 ? 'you' : 'the computer'}.`
        : ` The starter is the ${longName(next.starter)}.`
    setLine(`${heels.trim()} ${next.turn === 0 ? 'You lead.' : 'The computer leads…'}`)
  }

  const playCard = (c: Card) => {
    if (r.phase !== 'peg' || r.turn !== 0) return
    const next = peg(r, c)
    if (next === r) return
    go(next, r)
    say(next, r, 0, c)
  }
  const say = (next: Round, prev: Round, w: Who, c: Card) => {
    const got = next.scores[w] - prev.scores[w]
    const who = w === 0 ? 'You play' : 'The computer plays'
    const scored = got ? ` — ${next.said} for ${got}` : ''
    let after = ''
    if (next.phase === 'peg') {
      if (!next.pile.length)
        after = next.turn === 0 ? ' You lead the new count.' : ' The count starts again.'
      else if (next.turn === w)
        after =
          w === 0 ? ' The computer cannot follow — play on.' : ' You cannot follow, so it plays on…'
      else if (next.turn === 0) after = ' Your turn.'
    }
    setLine(`${who} the ${longName(c)}: ${count(prev) + value(c)}${scored}.${after}`)
  }

  // the computer's pegging
  useEffect(() => {
    if (r.phase !== 'peg' || r.turn !== 1 || r.winner !== null) return
    timer.current = window.setTimeout(
      () => {
        const c = choosePeg(r, level)
        const next = peg(r, c)
        go(next, r)
        say(next, r, 1, c)
      },
      reduced() ? 250 : 900,
    )
    return () => window.clearTimeout(timer.current)
    // the round is what starts the computer's turn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r])

  // the show, counted as soon as the pegging is done, stopping when someone reaches the target
  useEffect(() => {
    if (r.phase !== 'show') return
    const pone = other(r.dealer)
    const counts: [string, Card[], boolean, Who][] = [
      [`${pone === 0 ? 'Your' : 'The computer’s'} hand`, r.kept[pone], false, pone],
      [`${r.dealer === 0 ? 'Your' : 'The computer’s'} hand`, r.kept[r.dealer], false, r.dealer],
      [`${r.dealer === 0 ? 'Your' : 'The computer’s'} crib`, r.crib, true, r.dealer],
    ]
    const list: Shown[] = []
    const running = [...r.scores]
    for (const [who, cards, crib, w] of counts) {
      const points = score(cards, r.starter, crib)
      list.push({ who, cards, points, spoken: readOut(parts(cards, r.starter, crib)) })
      if (w === 0) best.current = Math.max(best.current, points)
      running[w] += points
      if (running[w] >= TARGET) break
    }
    setShown(list)
    const next = show(r)
    timer.current = window.setTimeout(() => go(next, r), reduced() ? 100 : 400)
    if (next.winner === null)
      setLine(`The show: ${list.map((x) => `${x.who.toLowerCase()} ${x.points}`).join(', ')}.`)
    return () => window.clearTimeout(timer.current)
    // the end of the pegging is what starts the show
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.phase])

  const nextHand = () => {
    const d = other(r.dealer)
    const g = deal(seed(), d, r.scores)
    setR(g)
    setShown([])
    setPicked([])
    setLine(
      `${d === 0 ? 'You deal' : 'The computer deals'}. Pick two cards to put in ${whose(d)} crib.`,
    )
  }
  const newGame = (lv: Level = saved.level) => {
    window.clearTimeout(timer.current)
    recorded.current = false
    setLevel(lv)
    const d = other(r.dealer)
    setR(deal(seed(), d))
    setBack([0, 0])
    setShown([])
    setPicked([])
    best.current = 0
    setLine(
      `${d === 0 ? 'You deal' : 'The computer deals'}. Pick two cards to put in ${whose(d)} crib.`,
    )
  }

  const mine = [...r.hands[0]].sort(order)
  const playable = new Set(r.phase === 'peg' && r.turn === 0 ? canPlay(r, 0) : [])
  const rec = saved.record[saved.level]
  const untouched = r.phase === 'discard' && r.scores[0] + r.scores[1] === 0
  const showing =
    r.phase === 'show' || r.phase === 'done' || (r.phase === 'over' && shown.length > 0)

  return (
    <div className={`lab-keys cg-room is-${saved.board}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer plays">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (untouched || r.phase === 'over') newGame(l)
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => newGame()}>
          ↻ New game
        </button>
      </div>

      <div
        className="cg-board"
        role="img"
        aria-label={`The board: you ${r.scores[0]}, the computer ${r.scores[1]}, of ${TARGET}.`}
      >
        {([0, 1] as Who[]).map((w) => (
          <div key={w} className={`cg-lane is-${w}`}>
            <span className="cg-who">
              {w === 0 ? 'You' : LEVEL_NAMES[level]}
              {r.dealer === w ? ' · deals' : ''}
            </span>
            <span className="cg-track">
              <span className="cg-fill" style={{ width: `${(r.scores[w] / TARGET) * 100}%` }} />
              <span className="cg-peg is-back" style={{ left: `${(back[w] / TARGET) * 100}%` }} />
              <span className="cg-peg" style={{ left: `${(r.scores[w] / TARGET) * 100}%` }} />
            </span>
            <strong className="cg-score">{r.scores[w]}</strong>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div className="cg-table">
        <div
          className="cg-row"
          aria-label={`The computer holds ${r.hands[1].length} cards`}
          role="img"
        >
          {r.hands[1].map((_, k) => (
            <span key={k} className="pk-card is-back tw-back cg-back" />
          ))}
        </div>
        <div className="cg-middle">
          <div className="cg-spot">
            <span className="cg-label">Starter</span>
            {r.phase === 'discard' ? (
              <span
                className="pk-card is-back tw-back cg-back"
                role="img"
                aria-label="The starter, face down"
              />
            ) : (
              <span role="img" aria-label={`The starter: the ${longName(r.starter)}`}>
                <Face c={r.starter} />
              </span>
            )}
          </div>
          <div className="cg-spot">
            <span className="cg-label">{r.dealer === 0 ? 'Your crib' : 'Its crib'}</span>
            <span
              className="cg-crib"
              role="img"
              aria-label={`${r.dealer === 0 ? 'Your' : 'The computer’s'} crib: ${r.crib.length} cards`}
            >
              {r.crib.length ? (
                r.crib.map((_, k) => (
                  <span key={k} className="pk-card is-back tw-back cg-back is-small" />
                ))
              ) : (
                <span className="muted">empty</span>
              )}
            </span>
          </div>
          <div className="cg-spot cg-count">
            <span className="cg-label">Count</span>
            <strong>{r.phase === 'peg' ? count(r) : '—'}</strong>
          </div>
        </div>
        {r.phase === 'peg' && (
          <div
            className="cg-row cg-pile"
            role="img"
            aria-label={`Cards in this count: ${r.pile.map(longName).join(', ') || 'none yet'}`}
          >
            {r.pile.map((c) => {
              const by = r.played.find((p) => p.card === c)?.by
              return (
                <span key={c} className={`cg-played by-${by}`}>
                  <Face c={c} small />
                </span>
              )
            })}
          </div>
        )}
      </div>

      <div
        className="cg-hand"
        role="group"
        aria-label={r.phase === 'discard' ? 'Your hand: pick two for the crib' : 'Your hand'}
      >
        {mine.map((c) => {
          const can = r.phase === 'discard' || playable.has(c)
          return (
            <button
              key={c}
              className={`cg-mine${picked.includes(c) ? ' is-picked' : ''}${r.phase === 'peg' && !playable.has(c) ? ' is-dim' : ''}`}
              disabled={!can || r.winner !== null}
              aria-pressed={r.phase === 'discard' ? picked.includes(c) : undefined}
              aria-label={`${longName(c)}${r.phase === 'peg' && r.turn === 0 && !playable.has(c) ? ', would pass thirty-one' : ''}`}
              onClick={() => {
                if (r.phase === 'discard')
                  setPicked((p) =>
                    p.includes(c) ? p.filter((x) => x !== c) : p.length < 2 ? [...p, c] : [p[1], c],
                  )
                else playCard(c)
              }}
            >
              <Face c={c} />
            </button>
          )
        })}
      </div>
      <div className="lab-controls">
        {r.phase === 'discard' && (
          <button className="btn" disabled={picked.length !== 2} onClick={sendToCrib}>
            {picked.length === 2
              ? `Send them to ${whose(r.dealer)} crib`
              : `Pick ${2 - picked.length} more`}
          </button>
        )}
        {r.phase === 'done' && (
          <button className="btn" onClick={nextHand}>
            ▶ Next hand
          </button>
        )}
        {r.phase === 'over' && (
          <button className="btn" onClick={() => newGame()}>
            ↻ Play again
          </button>
        )}
      </div>

      {showing && shown.length > 0 && (
        <section className="fw-panel cg-show" aria-label="The show">
          <h3 className="fw-h">
            The show · starter {RANK_NAMES[rankOf(r.starter)]}
            {SUITS[suitOf(r.starter)]}
          </h3>
          {shown.map((s) => (
            <div key={s.who} className="cg-shown">
              <span className="cg-shown-cards" aria-hidden>
                {[...s.cards].sort(order).map((c) => (
                  <Face key={c} c={c} small />
                ))}
              </span>
              <span>
                <strong>
                  {s.who}: {s.points}
                </strong>
                {saved.spell && <span className="muted"> — {s.spoken}</span>}
              </span>
            </div>
          ))}
        </section>
      )}

      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {rec.won}, lost {rec.lost}
          {rec.skunks ? ` · ${rec.skunks} skunk${rec.skunks === 1 ? '' : 's'}` : ''}
          {rec.best ? ` · best hand ${rec.best}` : ''}
        </span>
      </p>
      {level !== saved.level && !untouched && r.phase !== 'over' && (
        <p className="muted mc-note">The new level starts with the next game.</p>
      )}
      <div className="fw-panel">
        <section aria-label="Board">
          <h3 className="fw-h">Board</h3>
          <div className="lab-controls" role="group" aria-label="Wood">
            {BOARDS.map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={saved.board === b}
                onClick={() => setSaved((s) => ({ ...s, board: b }))}
              >
                {BOARD_NAMES[b]}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.spell}
              onClick={() => setSaved((s) => ({ ...s, spell: !s.spell }))}
            >
              Read the counts out
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Six cards each; pick two to throw into the dealer’s crib, and a starter is cut — a jack is
        two to the dealer. Then the pegging: lay cards in turn without passing 31, scoring two for
        fifteen or 31, pairs and runs as they fall, one for a go when neither can play, and one for
        the last card. Then the show: each hand with the starter scores two for every fifteen, two a
        pair, a point a card for runs, four for a flush (five with the starter; a crib needs all
        five) and one for the jack of the starter’s suit. The dealer’s crib is counted last. First
        to 121; win by 31 or more and it is a skunk. Easy plays at random; Fair keeps its best four
        but pegs without thinking; Hard also weighs the crib and what you could score straight back.
      </p>
    </div>
  )
}
