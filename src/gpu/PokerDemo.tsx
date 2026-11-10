import { useEffect, useReducer, useRef, useState } from 'react'
import {
  POKER_KEY,
  STYLES,
  SUITS,
  RANK_NAMES,
  act,
  choices,
  deal,
  decide,
  describe,
  newTable,
  pot,
  rankOf,
  readSaved,
  suitOf,
  type Action,
  type Card,
  type Saved,
  type Table,
} from './poker'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(POKER_KEY))
  } catch {
    return readSaved(null)
  }
}

/** the three computer players, each with a way of playing that shows */
const BOTS = [
  { name: 'Wren', style: STYLES.steady, about: 'steady' },
  { name: 'Jinx', style: STYLES.wild, about: 'bluffs' },
  { name: 'Rook', style: STYLES.rock, about: 'waits for cards' },
]
const START = 1000
const BLIND = 20
/** the blinds double every this many hands, so a table ends */
const LEVEL_HANDS = 10

function CardFace({ c, hidden, small }: { c?: Card; hidden?: boolean; small?: boolean }) {
  if (c === undefined || hidden)
    return (
      <span
        className={`pk-card is-back${small ? ' is-small' : ''}`}
        aria-label="A card, face down"
        role="img"
      />
    )
  const red = suitOf(c) === 1 || suitOf(c) === 2
  return (
    <span
      className={`pk-card${red ? ' is-red' : ''}${small ? ' is-small' : ''}`}
      role="img"
      aria-label={`${RANK_NAMES[rankOf(c)]} of ${['spades', 'hearts', 'diamonds', 'clubs'][suitOf(c)]}`}
    >
      <span aria-hidden>{RANK_NAMES[rankOf(c)]}</span>
      <span aria-hidden>{SUITS[suitOf(c)]}</span>
    </span>
  )
}

/**
 * What an action is, as a verb — "raises to 120", or for you "raise to 120". Worked out from the
 * table BEFORE the action is applied: applying it can end the street and reset the bet to match.
 */
function said(t: Table, a: Action, you: boolean): string {
  const c = choices(t)
  const [one, many] =
    a.kind === 'fold' && !c.canCheck
      ? ['fold', 'folds']
      : a.kind === 'raise' && c.canRaise
        ? (() => {
            const to = Math.max(c.minTo, Math.min(c.maxTo, Math.round(a.to)))
            const all = to >= c.maxTo ? ' (all in)' : ''
            return [`raise to ${to}${all}`, `raises to ${to}${all}`]
          })()
        : c.canCheck
          ? ['check', 'checks']
          : [`call ${c.owe}`, `calls ${c.owe}`]
  return you ? one : many
}

export function PokerDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const table = useRef<Table | null>(null)
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const [log, setLog] = useState<string[]>([])
  const [raiseTo, setRaiseTo] = useState(0)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    try {
      localStorage.setItem(POKER_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 8))

  const t = table.current
  const me = t?.seats[0]
  const over =
    !!t && (me!.chips <= 0 || t.seats.slice(1).every((s) => s.chips <= 0)) && t.street === 'done'

  /** the hand ended: say who won what, and keep the records */
  const ended = (tt: Table) => {
    const r = tt.result!
    const names = tt.seats.map((s) => s.name)
    for (let i = 0; i < r.won.length; i++) {
      if (!r.won[i]) continue
      const how = r.uncontested
        ? 'everyone else folded'
        : describe(r.shown.find((x) => x.seat === i)!.value)
      say(`${names[i]} ${i === 0 ? 'win' : 'wins'} ${r.won[i].toLocaleString()} — ${how}.`)
    }
    const mine = r.won[0]
    const done = tt.seats[0].chips <= 0 || tt.seats.slice(1).every((s) => s.chips <= 0)
    setSaved((s) => ({
      ...s,
      hands: s.hands + 1,
      biggestPot: Math.max(s.biggestPot, mine),
      won: s.won + (done && tt.seats[0].chips > 0 ? 1 : 0),
    }))
  }

  /** let the computer players act until it is your turn or the hand is over */
  const run = () => {
    const tt = table.current
    if (!tt) return
    window.clearTimeout(timer.current)
    if (tt.street === 'done') {
      ended(tt)
      redraw()
      return
    }
    if (tt.toAct === 0) {
      const c = choices(tt)
      setRaiseTo(c.minTo)
      redraw()
      return
    }
    redraw()
    timer.current = window.setTimeout(() => {
      const i = tt.toAct
      const a = decide(tt, BOTS[i - 1].style, Math.random)
      const words = said(tt, a, false)
      act(tt, a)
      say(`${tt.seats[i].name} ${words}.`)
      run()
    }, 650)
  }

  const nextHand = () => {
    const tt = table.current
    if (!tt) return
    // the blinds go up as the table goes on
    const level = Math.floor(tt.hand / LEVEL_HANDS)
    tt.big = BLIND * 2 ** level
    tt.small = tt.big / 2
    deal(tt, Math.random)
    say(`Hand ${tt.hand} — blinds ${tt.small}/${tt.big}.`)
    run()
  }

  const sit = () => {
    table.current = newTable(['You', ...BOTS.map((b) => b.name)], START, BLIND)
    setLog([])
    setSaved((s) => ({ ...s, tables: s.tables + 1 }))
    nextHand()
  }

  const mine = (a: Action) => {
    const tt = table.current
    if (!tt || tt.toAct !== 0) return
    const words = said(tt, a, true)
    act(tt, a)
    say(`You ${words}.`)
    run()
  }

  const c = t && t.toAct === 0 ? choices(t) : null
  const thePot = t ? pot(t) : 0
  const shownSeats = new Set(t?.result?.shown.map((x) => x.seat) ?? [])

  return (
    <div className="lab-keys pk-room">
      <div className="pk-table">
        {!t ? (
          <div className="pk-welcome">
            <p>
              You and three computer players, {START.toLocaleString()} play chips each. Blinds{' '}
              {BLIND / 2}/{BLIND}, doubling every {LEVEL_HANDS} hands. Last one with chips wins.
            </p>
            <button className="btn" onClick={sit}>
              🃏 Sit down
            </button>
          </div>
        ) : (
          <>
            <div className="pk-seats">
              {t.seats.slice(1).map((s, k) => {
                const i = k + 1
                return (
                  <div
                    key={s.name}
                    className={`pk-seat${t.toAct === i ? ' is-up' : ''}${s.folded || s.out ? ' is-out' : ''}`}
                  >
                    <span className="pk-name">
                      {s.name}
                      {t.dealer === i && (
                        <span className="pk-button" title="Dealer">
                          D
                        </span>
                      )}
                    </span>
                    <span className="pk-hole">
                      {s.out
                        ? null
                        : s.hole.map((h, j) => (
                            <CardFace key={j} c={h} small hidden={!shownSeats.has(i)} />
                          ))}
                    </span>
                    <span className="pk-chips">
                      {s.out ? 'out' : `${s.chips.toLocaleString()}`}
                      {s.bet > 0 && <span className="pk-bet"> · bet {s.bet}</span>}
                      {!s.out && s.chips === 0 && !s.folded && t.street !== 'done' && (
                        <span className="pk-bet"> · all in</span>
                      )}
                    </span>
                    <span className="muted pk-style">{BOTS[k].about}</span>
                  </div>
                )
              })}
            </div>
            <div className="pk-board" aria-label="The board">
              {Array.from({ length: 5 }, (_, j) => (
                <CardFace key={j} c={t.board[j]} hidden={t.board[j] === undefined} />
              ))}
            </div>
            <p className="pk-pot">
              Pot <strong>{thePot.toLocaleString()}</strong>
            </p>
            <div
              className={`pk-seat pk-me${t.toAct === 0 ? ' is-up' : ''}${me!.folded ? ' is-out' : ''}`}
            >
              <span className="pk-name">
                You
                {t.dealer === 0 && (
                  <span className="pk-button" title="Dealer">
                    D
                  </span>
                )}
              </span>
              <span className="pk-hole">
                {me!.hole.map((h, j) => (
                  <CardFace key={j} c={h} />
                ))}
              </span>
              <span className="pk-chips">
                {me!.chips.toLocaleString()} chips
                {me!.bet > 0 && <span className="pk-bet"> · bet {me!.bet}</span>}
              </span>
            </div>
          </>
        )}
      </div>

      {t && c && (
        <div className="lab-controls pk-actions">
          <button
            className="btn btn-ghost"
            onClick={() => mine({ kind: 'fold' })}
            disabled={c.canCheck}
          >
            Fold
          </button>
          <button className="btn" onClick={() => mine({ kind: c.canCheck ? 'check' : 'call' })}>
            {c.canCheck ? 'Check' : `Call ${c.owe}`}
          </button>
          {c.canRaise && (
            <>
              <label className="pk-raise">
                <span className="sr-only">Raise to</span>
                <input
                  type="range"
                  min={c.minTo}
                  max={c.maxTo}
                  step={t.small}
                  value={Math.max(c.minTo, Math.min(c.maxTo, raiseTo))}
                  onChange={(e) => setRaiseTo(Number(e.target.value))}
                />
              </label>
              <button className="btn" onClick={() => mine({ kind: 'raise', to: raiseTo })}>
                {raiseTo >= c.maxTo
                  ? `All in ${c.maxTo}`
                  : `Raise to ${Math.max(c.minTo, raiseTo)}`}
              </button>
              <span className="lab-group">
                <button
                  className="btn btn-ghost"
                  onClick={() => setRaiseTo(t.current + Math.round(thePot / 2 / t.small) * t.small)}
                >
                  ½ pot
                </button>
                <button className="btn btn-ghost" onClick={() => setRaiseTo(t.current + thePot)}>
                  Pot
                </button>
                <button className="btn btn-ghost" onClick={() => setRaiseTo(c.maxTo)}>
                  All in
                </button>
              </span>
            </>
          )}
        </div>
      )}
      {t && t.street === 'done' && (
        <div className="lab-controls">
          {over ? (
            <>
              <strong>
                {me!.chips > 0
                  ? '🏆 You took every chip at the table!'
                  : `You’re out after ${t.hand} hands.`}
              </strong>
              <button className="btn" onClick={sit}>
                ↻ New table
              </button>
            </>
          ) : (
            <button className="btn" onClick={nextHand}>
              Next hand
            </button>
          )}
        </div>
      )}
      {t && !c && t.street !== 'done' && (
        <p className="muted lab-hint">Waiting for {t.seats[t.toAct]?.name}…</p>
      )}

      {log.length > 0 && (
        <ul className="dice-log" aria-live="polite">
          {log.map((l, i) => (
            <li key={i} className={i ? 'muted' : undefined}>
              {l}
            </li>
          ))}
        </ul>
      )}
      <p className="sun-reading">
        <span className="muted">
          Tables won {saved.won} of {saved.tables} · {saved.hands} hands played
          {saved.biggestPot > 0 && <> · biggest pot you took {saved.biggestPot.toLocaleString()}</>}
        </span>
      </p>
      <p className="muted lab-hint">
        Texas hold’em, no limit, play chips only. Each computer player works out its chance of
        winning by dealing the unseen cards hundreds of times, then weighs it against the price of
        staying in: calling costs what you owe to win what is in the pot. Wren plays it straight,
        Jinx bluffs, Rook waits for good cards. Best five of your two cards and the five on the
        board wins; a tie splits the pot, and a player all in can only win what they could match.
      </p>
    </div>
  )
}
