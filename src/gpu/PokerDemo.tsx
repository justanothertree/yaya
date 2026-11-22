import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
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
  type Table,
} from './poker'
import { useKept } from './kept'
import { lastHand, type HoldemGame } from './holdemRoom'
import { useLabMatch, type LabMatch } from '../lab/matches/useLabMatch'
import { MatchBar } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'
import { myHidden } from '../lab/matches/cloud'

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

/** the computer across the table in a match, by the toy's own players (holdemRoom.ts) */
const LEVEL_NAMES = { easy: 'Easy · Rook', fair: 'Fair · Jinx', hard: 'Hard · Wren' }

export function PokerDemo() {
  /* a match by turns, when the address names one (src/lab/matches/useLabMatch.ts): heads up, the
     deck and both pairs of hole cards kept back by the server (holdemRoom.ts) */
  const lm = useLabMatch('poker', { preview: false })
  // keyed by the match: another match starts with nothing of this one (a raise half-chosen)
  if (lm.id) return <HoldemMatch key={lm.id} lm={lm} />
  return <PokerAlone />
}

function PokerAlone() {
  const signedIn = useSignedIn()
  const [saved, setSaved] = useKept(POKER_KEY, readSaved)
  const table = useRef<Table | null>(null)
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const [log, setLog] = useState<string[]>([])
  const [raiseTo, setRaiseTo] = useState(0)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
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
            <div className="lab-controls">
              <button className="btn" onClick={sit}>
                🃏 Sit down
              </button>
              {signedIn && <MatchChallenge demo="poker" settings={{}} levelNames={LEVEL_NAMES} />}
            </div>
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

/** an action as the table says it, from the record alone */
const told = (a: Action) =>
  a.kind === 'raise'
    ? `raised to ${a.to.toLocaleString()}`
    : { fold: 'folded', check: 'checked', call: 'called' }[a.kind]

/** a match by turns, heads up: the table both players see, and my own two cards as lab-move shows */
function HoldemMatch({ lm }: { lm: LabMatch }) {
  const x = lm.shown as HoldemGame | null
  const together = lm.view?.mode === 'together'
  const side: 0 | 1 = together ? 0 : lm.view?.you === 1 ? 1 : 0
  const theirs: 0 | 1 = side === 0 ? 1 : 0
  const them = !lm.view ? 'They' : together ? 'The computer' : otherName(lm.view)
  const myName = together ? 'You two' : 'You'
  const [hole, setHole] = useState<Card[] | null>(null)
  const [raiseTo, setRaiseTo] = useState(0)
  const seq = lm.view?.seq
  const active = lm.view?.status === 'active'
  useEffect(() => {
    if (!lm.id || !active) return
    let live = true
    myHidden(lm.id)
      .then((d) => {
        if (live) setHole(Array.isArray(d) ? (d as Card[]) : null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [lm.id, seq, active])
  const done = x?.past.length ?? 0
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the last hand changes only when one ends
  const last = useMemo(() => (x ? lastHand(x) : null), [done, !!x])
  const t = x?.t
  const c = t && lm.canPlay && t.toAct === side ? choices(t) : null
  /* each new decision starts the raise at the smallest one the table allows */
  const at = `${done}-${x?.cur.actions.length ?? 0}`
  useEffect(() => {
    if (c) setRaiseTo(c.minTo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, !!c])
  if (!x || !t)
    return (
      <div className="lab-keys pk-room">
        <MatchBar lm={lm} sides={['the button first', 'the big blind first']} />
      </div>
    )

  const nameOf = (s: number) => (s === side ? myName : them)
  const finished = lm.view?.status === 'finished'
  const thePot = pot(t)
  const lastWords = (() => {
    if (!last) return ''
    const { result } = last
    const parts: string[] = []
    for (let i = 0; i < 2; i++) {
      if (!result.won[i]) continue
      const how = result.uncontested
        ? `${nameOf(1 - i) === myName ? (together ? 'you two' : 'you') : nameOf(1 - i)} folded`
        : describe(result.shown.find((v) => v.seat === i)!.value)
      parts.push(`${nameOf(i)} took ${result.won[i].toLocaleString()} — ${how}`)
    }
    const split = parts.length === 2 ? ' (a split pot)' : ''
    return `Hand ${done}: ${parts.join('; ')}${split}.`
  })()
  const now = (() => {
    if (finished) {
      const mine = t.seats[side].chips
      const other = t.seats[theirs].chips
      if (!other) return together ? '🏆 You two took every chip.' : '🏆 You took every chip.'
      if (!mine) return `${them} took every chip after ${t.hand} hands.`
      return `After ${t.hand} hands, ${mine > other ? (together ? 'you two have' : 'you have') : `${them} has`} more chips.`
    }
    const a = x.cur.actions[x.cur.actions.length - 1]
    const before = a && x.lastBy !== null ? `${nameOf(x.lastBy)} ${told(a)}. ` : ''
    if (lm.canPlay && t.toAct === side) return `${before}Your decision.`
    if (together && t.toAct === side) return `${before}Your partner is deciding.`
    return `${before}${them} is deciding.`
  })()
  const shownLast = last && !last.result.uncontested ? last.rec : null
  const clamp = (n: number) =>
    c ? Math.max(c.minTo, Math.min(c.maxTo, Math.round(n / t.small) * t.small)) : n

  const seat = (i: 0 | 1) => {
    const s = t.seats[i]
    const mine = i === side
    return (
      <div
        className={`pk-seat${mine ? ' pk-me' : ''}${t.toAct === i && !finished ? ' is-up' : ''}${s.folded ? ' is-out' : ''}`}
      >
        <span className="pk-name">
          {nameOf(i)}
          {t.dealer === i && (
            <span className="pk-button" title="Dealer">
              D
            </span>
          )}
        </span>
        <span className="pk-hole">
          {finished ? null : mine ? (
            (hole ?? [undefined, undefined]).map((h, j) => <CardFace key={j} c={h} />)
          ) : (
            <>
              <CardFace small hidden />
              <CardFace small hidden />
            </>
          )}
        </span>
        <span className="pk-chips">
          {s.chips.toLocaleString()} chips
          {s.bet > 0 && <span className="pk-bet"> · bet {s.bet}</span>}
          {s.chips === 0 && !s.folded && !finished && <span className="pk-bet"> · all in</span>}
        </span>
      </div>
    )
  }

  return (
    <div className="lab-keys pk-room">
      <MatchBar lm={lm} sides={['the button first', 'the big blind first']} />
      <div className="pk-table">
        <div className="pk-seats">{seat(theirs)}</div>
        <div className="pk-board" aria-label="The board">
          {Array.from({ length: 5 }, (_, j) => (
            <CardFace key={j} c={t.board[j]} hidden={t.board[j] === undefined} />
          ))}
        </div>
        <p className="pk-pot">
          {finished ? (
            <>Hand {t.hand}</>
          ) : (
            <>
              Pot <strong>{thePot.toLocaleString()}</strong> · hand {t.hand} · blinds {t.small}/
              {t.big}
            </>
          )}
        </p>
        {seat(side)}
      </div>
      <p className="mc-line" aria-live="polite">
        {now}
      </p>
      {c && (
        <div className="lab-controls pk-actions">
          <button
            className="btn btn-ghost"
            onClick={() => lm.commit({ kind: 'fold' })}
            disabled={c.canCheck || lm.busy}
          >
            Fold
          </button>
          <button
            className="btn"
            disabled={lm.busy}
            onClick={() => lm.commit({ kind: c.canCheck ? 'check' : 'call' })}
          >
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
                  value={clamp(raiseTo)}
                  onChange={(e) => setRaiseTo(Number(e.target.value))}
                />
              </label>
              <button
                className="btn"
                disabled={lm.busy}
                onClick={() =>
                  lm.commit({ kind: 'raise', to: raiseTo >= c.maxTo ? c.maxTo : clamp(raiseTo) })
                }
              >
                {raiseTo >= c.maxTo ? `All in ${c.maxTo}` : `Raise to ${clamp(raiseTo)}`}
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
      {lastWords && (
        <div className="pk-last" aria-live="polite">
          <p className="muted">{lastWords}</p>
          {shownLast && (
            <p className="pk-shown">
              {[side, theirs].map((i) =>
                shownLast.shown[i] ? (
                  <span key={i} className="pk-hole" role="group" aria-label={`${nameOf(i)} showed`}>
                    <span className="muted">{nameOf(i)}</span>
                    {shownLast.shown[i]!.map((h, j) => (
                      <CardFace key={j} c={h} small />
                    ))}
                  </span>
                ) : null,
              )}
              <span className="pk-hole" role="group" aria-label="The board it ran to">
                <span className="muted">board</span>
                {shownLast.board.map((h, j) => (
                  <CardFace key={j} c={h} small />
                ))}
              </span>
            </p>
          )}
        </div>
      )}
      <p className="muted lab-hint">
        Hold’em by turns, heads up, no limit, play chips only: {START.toLocaleString()} each, blinds{' '}
        {BLIND / 2}/{BLIND} doubling every {LEVEL_HANDS} hands. The server shuffles and deals, and
        shows each player only their own two cards; at a showdown both hands are turned up for the
        record. Last one with chips wins.
        {together ? ' Together, the two of you share a seat and take its decisions in turn.' : ''}
      </p>
    </div>
  )
}
