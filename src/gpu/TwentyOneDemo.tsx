import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { RANK_NAMES, SUITS, rankOf, suitOf, type Card } from './poker'
import {
  BACKS,
  BETS,
  FELTS,
  START_CHIPS,
  TWENTYONE_KEY,
  book,
  bust,
  isBlackjack,
  pips,
  readSaved,
  settle,
  shoe,
  total,
  type Act,
  type Saved,
} from './twentyone'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'
import {
  BET as DUEL_BET,
  START as DUEL_START,
  chipsOf,
  offered,
  playRound,
  type RoundView,
  type TwentyOneGame,
} from './twentyoneDuel'
import { useLabMatch, type LabMatch } from '../lab/matches/useLabMatch'
import { MatchBar } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'
import { myHidden } from '../lab/matches/cloud'

type Phase = 'bet' | 'play' | 'dealer' | 'done'
type Hand = { cards: Card[]; doubled: boolean; split: boolean; stake: number; result?: number }
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs']
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
const FELT_NAMES: Record<Saved['felt'], string> = { green: 'Green', blue: 'Blue', red: 'Red' }
const BACK_NAMES: Record<Saved['back'], string> = {
  lattice: 'Lattice',
  stripes: 'Stripes',
  stars: 'Stars',
}
const ACT_NAMES: Record<Act, string> = {
  hit: 'hit',
  stand: 'stand',
  double: 'double',
  split: 'split',
}

function CardView({ c, hidden, back }: { c: Card; hidden?: boolean; back: Saved['back'] }) {
  if (hidden)
    return (
      <span
        className={`pk-card is-back tw-back is-${back}`}
        role="img"
        aria-label="A card face down"
      />
    )
  const red = suitOf(c) === 1 || suitOf(c) === 2
  return (
    <span
      className={`pk-card${red ? ' is-red' : ''}`}
      role="img"
      aria-label={`${LONG[rankOf(c)]} of ${SUIT_NAMES[suitOf(c)]}`}
    >
      <span aria-hidden>{RANK_NAMES[rankOf(c)]}</span>
      <span aria-hidden>{SUITS[suitOf(c)]}</span>
    </span>
  )
}
const say = (cards: Card[]) => {
  const t = total(cards)
  return `${t.soft ? 'soft ' : ''}${t.value}`
}

const MATCH_LEVELS = { easy: 'Easy', fair: 'Fair', hard: 'Hard · the book' }

export function TwentyOneDemo() {
  /* a duel by turns, when the address names one (src/lab/matches/useLabMatch.ts): the same rounds
     from the same shoes for both sides, the shoes and the first side's play kept back by the
     server (twentyoneDuel.ts) */
  const lm = useLabMatch('twentyone', { preview: false })
  // keyed by the match: another match starts with nothing of this one
  if (lm.id) return <TwentyOneMatch key={lm.id} lm={lm} />
  return <TwentyOneAlone />
}

function TwentyOneAlone() {
  const signedIn = useSignedIn()
  const [saved, setSaved] = useKept(TWENTYONE_KEY, readSaved)
  const [phase, setPhase] = useState<Phase>('bet')
  const [hands, setHands] = useState<Hand[]>([])
  const [active, setActive] = useState(0)
  const [dealer, setDealer] = useState<Card[]>([])
  const [line, setLine] = useState('Choose a bet and deal.')
  const cards = useRef<Card[]>([])
  const at = useRef(0)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const draw = (): Card => {
    if (!cards.current.length || at.current >= cards.current.length) {
      cards.current = shoe(saved.rules.decks, Math.random)
      at.current = 0
    }
    return cards.current[at.current++]
  }
  const up = dealer.length ? pips(dealer[0]) : 0
  const hand = hands[active]

  const finish = (hs: Hand[], d: Card[]) => {
    let back = 0
    const settled = hs.map((h) => {
      const r = settle(h.cards, d, h.doubled, h.split)
      back += (h.doubled ? 2 : 1) * h.stake + h.stake * r
      return { ...h, result: r }
    })
    setHands(settled)
    setPhase('done')
    setSaved((s) => {
      let chips = s.chips + back
      let rebuys = s.rebuys
      if (chips < BETS[0]) {
        chips = START_CHIPS
        rebuys++
      }
      return { ...s, chips, peak: Math.max(s.peak, chips), rebuys, hands: s.hands + 1 }
    })
    const net = settled.reduce((a, h) => a + h.stake * (h.result ?? 0), 0)
    const dt = total(d)
    setLine(
      `${bust(d) ? `The dealer busts with ${dt.value}.` : `The dealer has ${dt.value}${isBlackjack(d) ? ' — blackjack' : ''}.`} ${
        net > 0
          ? `You win ${net}.`
          : net < 0
            ? `You lose ${-net}.`
            : 'A push — your bet comes back.'
      }`,
    )
  }

  /** the dealer turns the hole card and draws, a card at a time */
  const dealerTurn = (hs: Hand[], d: Card[]) => {
    setPhase('dealer')
    const everyBust = hs.every((h) => bust(h.cards))
    const cards2 = d.slice()
    const step = () => {
      const t = total(cards2)
      const more =
        !everyBust && (t.value < 17 || (t.value === 17 && t.soft && saved.rules.hitSoft17))
      if (!more) return finish(hs, cards2)
      cards2.push(draw())
      setDealer(cards2.slice())
      if (reduced()) step()
      else timer.current = window.setTimeout(step, 500)
    }
    setDealer(cards2.slice())
    if (reduced()) step()
    else timer.current = window.setTimeout(step, 450)
  }

  const deal = () => {
    if (phase !== 'bet' && phase !== 'done') return
    const stake = Math.min(saved.bet, saved.chips)
    if (stake < BETS[0]) return
    setSaved((s) => ({ ...s, chips: s.chips - stake }))
    const p = [draw()]
    const d = [draw()]
    p.push(draw())
    d.push(draw())
    const hs: Hand[] = [{ cards: p, doubled: false, split: false, stake }]
    setHands(hs)
    setDealer(d)
    setActive(0)
    if (isBlackjack(d) || isBlackjack(p)) {
      setPhase('dealer')
      timer.current = window.setTimeout(() => finish(hs, d), reduced() ? 0 : 500)
      setLine(isBlackjack(p) ? 'Blackjack!' : 'The dealer checks the hole card…')
      return
    }
    setPhase('play')
    setLine(
      `You have ${say(p)}. The dealer shows ${rankOf(d[0]) === 12 || rankOf(d[0]) === 6 ? 'an' : 'a'} ${LONG[rankOf(d[0])]}.`,
    )
  }

  const canDouble = !!hand && hand.cards.length === 2 && saved.chips >= hand.stake
  const canSplit =
    !!hand &&
    hand.cards.length === 2 &&
    pips(hand.cards[0]) === pips(hand.cards[1]) &&
    hands.length < 4 &&
    saved.chips >= hand.stake
  const advice = hand && phase === 'play' ? book(hand.cards, up, canDouble, canSplit) : null

  const act = (a: Act) => {
    if (phase !== 'play' || !hand) return
    if (a === 'double' && !canDouble) return
    if (a === 'split' && !canSplit) return
    if (advice)
      setSaved((s) => ({ ...s, decided: s.decided + 1, agreed: s.agreed + (advice === a ? 1 : 0) }))
    const hs = hands.map((h) => ({ ...h, cards: h.cards.slice() }))
    const h = hs[active]
    let done = false
    if (a === 'hit') {
      h.cards.push(draw())
      done = total(h.cards).value >= 21
    } else if (a === 'stand') done = true
    else if (a === 'double') {
      setSaved((s) => ({ ...s, chips: s.chips - h.stake }))
      h.doubled = true
      h.cards.push(draw())
      done = true
    } else {
      setSaved((s) => ({ ...s, chips: s.chips - h.stake }))
      const moved = h.cards.pop()!
      h.split = true
      h.cards.push(draw())
      hs.splice(active + 1, 0, {
        cards: [moved, draw()],
        doubled: false,
        split: true,
        stake: h.stake,
      })
      // split aces take one card each and stand
      done = pips(moved) === 1
      if (done) {
        setHands(hs)
        return dealerTurn(hs, dealer)
      }
    }
    setHands(hs)
    if (!done) {
      setLine(
        `${hs.length > 1 ? `Hand ${active + 1}: ` : ''}${say(h.cards)}${bust(h.cards) ? ' — bust.' : '.'}`,
      )
      return
    }
    const next = active + 1
    if (next < hs.length) {
      setActive(next)
      setLine(`${bust(h.cards) ? 'Bust. ' : ''}Hand ${next + 1}: ${say(hs[next].cards)}.`)
    } else dealerTurn(hs, dealer)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return
    const k = e.key.toLowerCase()
    const map: Record<string, Act> = { h: 'hit', s: 'stand', d: 'double', p: 'split' }
    if (phase === 'play' && map[k]) {
      e.preventDefault()
      act(map[k])
    } else if (
      (phase === 'bet' || phase === 'done') &&
      (k === 'n' || k === 'enter') &&
      !(e.target as HTMLElement).closest('button')
    ) {
      e.preventDefault()
      deal()
    }
  }

  const hidden = phase === 'play'
  const agree = saved.decided ? Math.round((100 * saved.agreed) / saved.decided) : null
  return (
    <div className={`lab-keys tw-room is-${saved.felt}`} onKeyDown={onKey}>
      <div className="tw-bank">
        <span>
          Chips <strong>{saved.chips.toLocaleString()}</strong>
        </span>
        <span className="muted">
          most ever {saved.peak.toLocaleString()} · {saved.hands} hands
          {saved.rebuys ? ` · started again ${saved.rebuys}×` : ''}
          {agree !== null && ` · ${agree}% by the book`}
        </span>
      </div>

      <div className="tw-table" aria-label="The table">
        <section aria-label="The dealer">
          <p className="tw-who">
            Dealer {dealer.length > 0 && !hidden && <strong>{say(dealer)}</strong>}
          </p>
          <div className="tw-cards">
            {dealer.map((c, i) => (
              <CardView key={i} c={c} hidden={hidden && i === 1} back={saved.back} />
            ))}
          </div>
        </section>
        <section aria-label="Your hands" className="tw-mine">
          {hands.map((h, i) => (
            <div
              key={i}
              className={`tw-hand${i === active && phase === 'play' ? ' is-active' : ''}`}
            >
              <p className="tw-who">
                {hands.length > 1 ? `Hand ${i + 1}` : 'You'} <strong>{say(h.cards)}</strong>
                <span className="muted"> · bet {h.stake * (h.doubled ? 2 : 1)}</span>
                {h.result !== undefined && (
                  <span className={h.result > 0 ? 'tw-win' : h.result < 0 ? 'tw-lose' : 'muted'}>
                    {' '}
                    {h.result > 0
                      ? `+${h.stake * h.result}`
                      : h.result < 0
                        ? `${h.stake * h.result}`
                        : 'push'}
                  </span>
                )}
              </p>
              <div className="tw-cards">
                {h.cards.map((c, k) => (
                  <CardView key={k} c={c} back={saved.back} />
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
        {saved.hints && advice && (
          <span className="tw-hint"> · The book says: {ACT_NAMES[advice]}</span>
        )}
      </p>

      {phase === 'play' ? (
        <div className="lab-controls tw-acts">
          <button className="btn" onClick={() => act('hit')} aria-keyshortcuts="H">
            Hit <kbd>H</kbd>
          </button>
          <button className="btn" onClick={() => act('stand')} aria-keyshortcuts="S">
            Stand <kbd>S</kbd>
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => act('double')}
            disabled={!canDouble}
            aria-keyshortcuts="D"
          >
            Double <kbd>D</kbd>
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => act('split')}
            disabled={!canSplit}
            aria-keyshortcuts="P"
          >
            Split <kbd>P</kbd>
          </button>
        </div>
      ) : (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Bet">
            {BETS.map((b) => (
              <button
                key={b}
                className="btn btn-ghost tw-chip"
                aria-pressed={saved.bet === b}
                disabled={b > saved.chips}
                onClick={() => setSaved((s) => ({ ...s, bet: b }))}
              >
                {b}
              </button>
            ))}
          </div>
          <button
            className="btn"
            onClick={deal}
            disabled={phase === 'dealer'}
            aria-keyshortcuts="N"
          >
            Deal {saved.bet} <kbd>N</kbd>
          </button>
          {signedIn && (phase === 'bet' || phase === 'done') && (
            <MatchChallenge demo="twentyone" settings={{}} levelNames={MATCH_LEVELS} />
          )}
        </div>
      )}

      <div className="fw-panel">
        <section aria-label="Rules">
          <h3 className="fw-h">The house rules</h3>
          <div className="lab-controls" role="group" aria-label="Decks in the shoe">
            <span className="fw-label">Decks</span>
            {([1, 2, 6] as const).map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={saved.rules.decks === n}
                aria-label={`${n} deck${n > 1 ? 's' : ''}`}
                onClick={() => {
                  cards.current = []
                  setSaved((s) => ({ ...s, rules: { ...s.rules, decks: n } }))
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.rules.hitSoft17}
              onClick={() =>
                setSaved((s) => ({ ...s, rules: { ...s.rules, hitSoft17: !s.rules.hitSoft17 } }))
              }
            >
              Dealer hits soft 17
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Show the book play
            </button>
          </div>
        </section>
        <section aria-label="The table">
          <h3 className="fw-h">The table</h3>
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
        Get closer to 21 than the dealer without going over. Picture cards count ten, an ace one or
        eleven. Hit for another card, stand on what you have, double your bet for exactly one more
        card, or split a pair into two hands. The dealer must draw to 17. A blackjack — an ace and a
        ten-card — pays three to two. “The book” is the play that loses least over time for every
        hand against every dealer card: over 200,000 hands it lost under 1% of each bet, where
        playing like the dealer lost 6%. You start with {START_CHIPS.toLocaleString()} play chips,
        and if they run out the bank starts you again. Keys: H, S, D and P; N deals.
      </p>
    </div>
  )
}

/** what a round won, said in chips at the duel's bet */
const wonWords = (won: number) =>
  won > 0 ? `won ${won * DUEL_BET}` : won < 0 ? `lost ${-won * DUEL_BET}` : 'pushed'

/** a round on the felt: the dealer, then the hands, the one being played marked */
function RoundTable({ v, back, label }: { v: RoundView; back: Saved['back']; label: string }) {
  return (
    <div className="tw-table" aria-label={label}>
      <section aria-label="The dealer">
        <p className="tw-who">Dealer {v.over && <strong>{say(v.dealer)}</strong>}</p>
        <div className="tw-cards">
          {v.dealer.map((c, i) => (
            <CardView key={i} c={c} back={back} />
          ))}
          {!v.over && <CardView c={0} hidden back={back} />}
        </div>
      </section>
      <section aria-label="The hands" className="tw-mine">
        {v.hands.map((h, i) => (
          <div key={i} className={`tw-hand${i === v.active && !v.over ? ' is-active' : ''}`}>
            <p className="tw-who">
              {v.hands.length > 1 ? `Hand ${i + 1}` : 'Hand'} <strong>{say(h.cards)}</strong>
              {h.doubled && <span className="muted"> · doubled</span>}
            </p>
            <div className="tw-cards">
              {h.cards.map((c, k) => (
                <CardView key={k} c={c} back={back} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

/**
 * A duel by turns: the same rounds, from the same shoes, for both sides against the dealer. My
 * own rounds come from lab-move; the other side's are a count until the last round is done.
 */
function TwentyOneMatch({ lm }: { lm: LabMatch }) {
  const [saved] = useKept(TWENTYONE_KEY, readSaved)
  const x = lm.shown as TwentyOneGame | null
  const together = lm.view?.mode === 'together'
  const side: 0 | 1 = together ? 0 : lm.view?.you === 1 ? 1 : 0
  const theirs: 0 | 1 = side === 0 ? 1 : 0
  const them = !lm.view ? 'They' : together ? 'The computer' : otherName(lm.view)
  const [mine, setMine] = useState<RoundView[] | null>(null)
  const seq = lm.view?.seq
  const status = lm.view?.status
  useEffect(() => {
    if (!lm.id || (status !== 'active' && status !== 'finished')) return
    let live = true
    myHidden(lm.id)
      .then((d) => {
        if (live) setMine(Array.isArray(d) ? (d as RoundView[]) : [])
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [lm.id, seq, status])
  if (!x)
    return (
      <div className={`lab-keys tw-room is-${saved.felt}`}>
        <MatchBar lm={lm} sides={['plays second', 'plays first']} />
      </div>
    )

  const finished = !!x.shown
  /* at the end everything is shown: both sides' rounds, from the seeds and the decisions */
  const shownRounds = (s: 0 | 1) =>
    x.shown ? x.shown.acts[s].map((a, r) => playRound(x.shown!.seeds[r], a)!) : null
  const rounds = (finished ? shownRounds(side) : mine) ?? []
  const cur = rounds.length && !rounds[rounds.length - 1].over ? rounds[rounds.length - 1] : null
  const last = [...rounds].reverse().find((r) => r.over) ?? null
  const lastAt = last ? rounds.lastIndexOf(last) : -1
  const chips = DUEL_START + DUEL_BET * rounds.reduce((a, r) => a + (r.over ? (r.won ?? 0) : 0), 0)
  const myGo = lm.canPlay && !!cur
  const can = cur ? offered(cur) : []
  const act = (a: Act) => {
    if (!myGo || !can.includes(a) || lm.busy) return
    void lm.commit({ act: a })
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return
    const map: Record<string, Act> = { h: 'hit', s: 'stand', d: 'double', p: 'split' }
    const a = map[e.key.toLowerCase()]
    if (!a || !myGo) return
    e.preventDefault()
    act(a)
  }
  const both = x.shown ? chipsOf(x.shown.seeds, x.shown.acts) : null
  const myName = together ? 'You two' : 'You'
  const line = (() => {
    if (both) {
      const [me, other] = [both[side], both[theirs]]
      const how = `${myName} ${me}, ${them} ${other}.`
      return me > other ? `🏆 ${how}` : me < other ? `${them} wins. ${how}` : `A draw. ${how}`
    }
    const lastWords = last
      ? `Round ${lastAt + 1}: the dealer ${bust(last.dealer) ? 'bust' : `had ${say(last.dealer)}`} — ${together ? 'you two' : 'you'} ${wonWords(last.won ?? 0)}. `
      : ''
    if (myGo)
      return `${lastWords}Round ${x.done[side] + 1} of ${x.rounds}: hit, stand, double or split.`
    if (together && cur) return `${lastWords}Your partner is playing round ${x.done[side] + 1}.`
    if (x.done[side] >= x.rounds)
      return `${lastWords}Your rounds are done. ${them} plays the same shoes now, without seeing yours.`
    return `${them} is playing the rounds first (${x.done[theirs]} of ${x.rounds}). Yours come next, from the same shoes; theirs stay hidden until yours are done.`
  })()

  return (
    <div className={`lab-keys tw-room is-${saved.felt}`} onKeyDown={onKey}>
      <MatchBar lm={lm} sides={['plays second', 'plays first']} />
      <div className="tw-bank">
        <span>
          Chips <strong>{both ? both[side] : chips}</strong>
        </span>
        <span className="muted">
          {DUEL_BET} a round · {myName.toLowerCase()} {x.done[side]} of {x.rounds} played · {them}{' '}
          {x.done[theirs]} of {x.rounds}
        </span>
      </div>
      {cur ? (
        <RoundTable v={cur} back={saved.back} label={`Round ${x.done[side] + 1}`} />
      ) : last ? (
        <RoundTable v={last} back={saved.back} label={`Round ${lastAt + 1}, as it ended`} />
      ) : null}
      <p className="mc-line" aria-live="polite">
        {line}
      </p>
      {myGo && (
        <div className="lab-controls tw-acts">
          {(['hit', 'stand', 'double', 'split'] as const).map((a) => (
            <button
              key={a}
              className={a === 'hit' || a === 'stand' ? 'btn' : 'btn btn-ghost'}
              disabled={!can.includes(a) || lm.busy}
              onClick={() => act(a)}
              aria-keyshortcuts={{ hit: 'H', stand: 'S', double: 'D', split: 'P' }[a]}
            >
              {ACT_NAMES[a][0].toUpperCase() + ACT_NAMES[a].slice(1)}{' '}
              <kbd>{{ hit: 'H', stand: 'S', double: 'D', split: 'P' }[a]}</kbd>
            </button>
          ))}
        </div>
      )}
      {finished && (
        <table className="tw-duel">
          <caption className="sr-only">Every round, in chips</caption>
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col">{myName}</th>
              <th scope="col">{them}</th>
            </tr>
          </thead>
          <tbody>
            {shownRounds(side)!.map((r, i) => {
              const o = shownRounds(theirs)![i]
              const cell = (v: RoundView) => {
                const w = (v.won ?? 0) * DUEL_BET
                const hands = v.hands
                  .map((h) => (bust(h.cards) ? `${say(h.cards)} bust` : say(h.cards)))
                  .join(' & ')
                return `${hands} → ${w > 0 ? `+${w}` : w < 0 ? `−${-w}` : '0'}`
              }
              return (
                <tr key={i}>
                  <th scope="row">{i + 1}</th>
                  <td>{cell(r)}</td>
                  <td>{cell(o)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p className="muted lab-hint">
        Duplicate twenty-one by turns: {x.rounds} rounds, and each round’s shoe is shuffled by the
        server and dealt to both sides alike, {DUEL_BET} chips a round from {DUEL_START}. The luck
        of the cards falls on you both; what is left between you is the decisions. The first side’s
        rounds stay hidden until the second side’s are done. Keys: H, S, D and P.
        {together
          ? ' Together, you take the rounds in turn against the computer on the same shoes.'
          : ''}
      </p>
    </div>
  )
}
