import { useEffect, useRef, useState } from 'react'
import {
  FIRST_TO,
  ICONS,
  MOVES,
  NAMES,
  RPS_KEY,
  flip,
  pick,
  readSaved,
  recent,
  result,
  type Move,
  type Pick,
  type Round,
  type Saved,
  type Side,
} from './rps'

type Tab = 'reader' | 'two' | 'coin'
const TABS: { id: Tab; label: string }[] = [
  { id: 'reader', label: '🧠 Vs the mind-reader' },
  { id: 'two', label: '👥 Two players' },
  { id: 'coin', label: '🪙 Call the coin' },
]

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(RPS_KEY))
  } catch {
    return readSaved(null)
  }
}

const said = (r: 1 | 0 | -1) =>
  r > 0 ? 'You win the round' : r < 0 ? 'It wins the round' : 'A draw'

export function RpsDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [tab, setTab] = useState<Tab>('reader')
  useEffect(() => {
    try {
      localStorage.setItem(RPS_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  return (
    <div className="lab-keys rps-room">
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Game">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="btn btn-ghost"
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'reader' && <Reader saved={saved} setSaved={setSaved} />}
      {tab === 'two' && <TwoPlayers />}
      {tab === 'coin' && <Coin saved={saved} setSaved={setSaved} />}
    </div>
  )
}

type Keep = { saved: Saved; setSaved: (f: (s: Saved) => Saved) => void }

/** keys for one player, by place on the keyboard: 1 2 3 or the first letters */
const ONE: Record<string, Move> = { Digit1: 0, Digit2: 1, Digit3: 2, KeyR: 0, KeyP: 1, KeyS: 2 }

function useKeys(map: (code: string) => void) {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      ref.current(e.code)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
}

function Reader({ saved, setSaved }: Keep) {
  const [history, setHistory] = useState<Round[]>([])
  const [score, setScore] = useState({ me: 0, it: 0 })
  const [last, setLast] = useState<(Round & { why: Pick }) | null>(null)
  /* ⚠️ ITS MOVE IS MADE BEFORE YOURS, from the rounds already played, and kept here until you
     choose — so nothing about your choice can reach it. */
  const sealed = useRef<Pick>(pick([], Math.random))
  const over = score.me >= FIRST_TO || score.it >= FIRST_TO

  const play = (me: Move) => {
    if (over) return
    const p = sealed.current
    const r = result(me, p.it)
    const round = { me, it: p.it }
    const h = [...history, round]
    setHistory(h)
    setLast({ ...round, why: p })
    const next = { me: score.me + (r > 0 ? 1 : 0), it: score.it + (r < 0 ? 1 : 0) }
    setScore(next)
    const ends = next.me >= FIRST_TO || next.it >= FIRST_TO
    setSaved((s) => ({
      ...s,
      won: s.won + (r > 0 ? 1 : 0),
      lost: s.lost + (r < 0 ? 1 : 0),
      drawn: s.drawn + (r === 0 ? 1 : 0),
      matchesWon: s.matchesWon + (ends && next.me >= FIRST_TO ? 1 : 0),
      matchesLost: s.matchesLost + (ends && next.it >= FIRST_TO ? 1 : 0),
    }))
    sealed.current = pick(recent(h), Math.random)
  }
  useKeys((code) => {
    if (code in ONE) play(ONE[code])
  })
  const again = () => {
    setScore({ me: 0, it: 0 })
    setLast(null)
    // it keeps what it learned about you: a new match is not a new person
  }

  const r = last ? result(last.me, last.it) : null
  return (
    <>
      <div className="rps-table" aria-live="polite">
        <div className="rps-side">
          <span className="rps-who">You</span>
          <span className="rps-big" aria-hidden>
            {last ? ICONS[last.me] : '·'}
          </span>
          <span className="rps-score">{score.me}</span>
        </div>
        <div className="rps-mid">
          {over ? (
            <strong>{score.me >= FIRST_TO ? 'You win the match!' : 'The mind-reader wins.'}</strong>
          ) : r === null ? (
            <span className="muted">First to {FIRST_TO}</span>
          ) : (
            <strong className={r > 0 ? 'rps-good' : r < 0 ? 'rps-bad' : undefined}>
              {said(r)}
            </strong>
          )}
          {last && (
            <span className="sr-only">
              You played {NAMES[last.me]}, it played {NAMES[last.it]}.
            </span>
          )}
        </div>
        <div className="rps-side">
          <span className="rps-who">Mind-reader 🔒</span>
          <span className="rps-big" aria-hidden>
            {last ? ICONS[last.it] : '·'}
          </span>
          <span className="rps-score">{score.it}</span>
        </div>
      </div>
      <div className="rps-hands" role="group" aria-label="Your move">
        {MOVES.map((m) => (
          <button
            key={m}
            className="btn rps-hand"
            onClick={() => play(m)}
            disabled={over}
            aria-keyshortcuts={`${m + 1}`}
          >
            <span aria-hidden>{ICONS[m]}</span> {NAMES[m]}
          </button>
        ))}
        {over && (
          <button className="btn btn-ghost" onClick={again}>
            ↻ New match
          </button>
        )}
      </div>
      <p className="sun-reading">
        {last &&
          (last.why.expected === null ? (
            <>It was guessing that round — it has not found a habit of yours that pays yet. </>
          ) : (
            <>
              It expected {ICONS[last.why.expected]} {NAMES[last.why.expected]} — {last.why.reason}
              {last.me === last.why.expected ? '. It was right. ' : ', but you changed. '}
            </>
          ))}
        <span className="muted">
          Matches {saved.matchesWon}–{saved.matchesLost} · rounds {saved.won} won, {saved.lost}{' '}
          lost, {saved.drawn} drawn
        </span>
      </p>
      {history.length > 0 && (
        <p className="rps-strip" aria-label="Recent rounds">
          {history.slice(-16).map((h, i) => {
            const k = result(h.me, h.it)
            return (
              <span key={i} className={k > 0 ? 'rps-good' : k < 0 ? 'rps-bad' : 'muted'}>
                {ICONS[h.me]}
              </span>
            )
          })}
        </p>
      )}
      <p className="muted lab-hint">
        The mind-reader picks its move before you pick yours, from nothing but the rounds already
        played. Then it looks for habits: what you play most, what you play after your own last move
        or two, after its move, and after you win or lose. People are poor at being random, and a
        habit is found in a few rounds. Truly random play wins a third of the time, and it can do no
        better than that against you. Keys 1 2 3, or R P S.
      </p>
    </>
  )
}

/** two people, one keyboard: each side's choice is hidden until both have chosen */
const LEFT: Record<string, Move> = { KeyA: 0, KeyS: 1, KeyD: 2 }
const RIGHT: Record<string, Move> = { KeyJ: 0, KeyK: 1, KeyL: 2 }

function TwoPlayers() {
  const [chosen, setChosen] = useState<[Move | null, Move | null]>([null, null])
  const [shown, setShown] = useState<[Move, Move] | null>(null)
  const [score, setScore] = useState([0, 0, 0])
  /* ⚠️ THE CHOICES LIVE IN A REF, and state only mirrors them. Deciding the round inside a state
     updater would set the score from inside it, and React runs updaters twice in development —
     a round would count double. */
  const picks = useRef<[Move | null, Move | null]>([null, null])
  const choose = (side: 0 | 1, m: Move) => {
    const c = picks.current
    if (c[side] !== null) return
    c[side] = m
    if (c[0] !== null && c[1] !== null) {
      const [a, b] = [c[0], c[1]]
      picks.current = [null, null]
      setShown([a, b])
      const r = result(a, b)
      setScore((s) => [s[0] + (r > 0 ? 1 : 0), s[1] + (r < 0 ? 1 : 0), s[2] + (r === 0 ? 1 : 0)])
    }
    setChosen([...picks.current])
  }
  useKeys((code) => {
    if (code in LEFT) choose(0, LEFT[code])
    else if (code in RIGHT) choose(1, RIGHT[code])
  })
  const r = shown ? result(shown[0], shown[1]) : null
  const side = (s: 0 | 1, name: string, keys: string) => (
    <div className="rps-side">
      <span className="rps-who">{name}</span>
      <span className="rps-big" aria-hidden>
        {chosen[s] !== null ? '✅' : shown ? ICONS[shown[s]] : '·'}
      </span>
      <span className="rps-score">{score[s]}</span>
      <div className="rps-mini" role="group" aria-label={`${name}'s move`}>
        {MOVES.map((m) => (
          <button
            key={m}
            className="btn btn-ghost"
            aria-label={`${name}: ${NAMES[m]}`}
            disabled={chosen[s] !== null}
            onClick={() => choose(s, m)}
          >
            <span aria-hidden>{ICONS[m]}</span>
            <span className="rps-key">{keys[m]}</span>
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <>
      <div className="rps-table rps-two" aria-live="polite">
        {side(0, 'Left', 'ASD')}
        <div className="rps-mid">
          {r === null ? (
            <span className="muted">Both choose, then both show</span>
          ) : (
            <strong>{r > 0 ? 'Left wins' : r < 0 ? 'Right wins' : 'A draw'}</strong>
          )}
          {shown && (
            <span className="sr-only">
              Left played {NAMES[shown[0]]}, right played {NAMES[shown[1]]}.
            </span>
          )}
          <span className="muted">{score[2]} drawn</span>
        </div>
        {side(1, 'Right', 'JKL')}
      </div>
      <p className="muted lab-hint">
        Left player: A rock, S paper, D scissors. Right player: J rock, K paper, L scissors. Nothing
        shows until both have chosen, so on a keyboard you can both press at once. Sharing one
        phone, take turns tapping while the other looks away — where a finger lands gives it away.
      </p>
    </>
  )
}

function Coin({ saved, setSaved }: Keep) {
  const [call, setCall] = useState<Side | null>(null)
  const [landed, setLanded] = useState<Side | null>(null)
  const [spinning, setSpinning] = useState(false)
  const run = useRef(0)
  const [runShown, setRunShown] = useState(0)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const toss = (c: Side) => {
    if (spinning) return
    setCall(c)
    setLanded(null)
    setSpinning(true)
    // decided now, shown when the coin comes down
    const side = flip(Math.random)
    timer.current = window.setTimeout(() => {
      setSpinning(false)
      setLanded(side)
      const right = side === c
      const next = right ? run.current + 1 : 0
      run.current = next
      setRunShown(next)
      setSaved((s) => ({
        ...s,
        calls: s.calls + 1,
        right: s.right + (right ? 1 : 0),
        streak: Math.max(s.streak, next),
      }))
    }, 900)
  }
  useKeys((code) => {
    if (code === 'KeyH') toss('heads')
    else if (code === 'KeyT') toss('tails')
  })
  const pct = saved.calls ? Math.round((saved.right / saved.calls) * 100) : null
  return (
    <>
      <div className="rps-table rps-coin-table" aria-live="polite">
        <div className={`rps-coin${spinning ? ' is-spinning' : ''}`} aria-hidden>
          {spinning ? '🪙' : landed === 'heads' ? 'H' : landed === 'tails' ? 'T' : '🪙'}
        </div>
        <div className="rps-mid">
          {spinning ? (
            <span className="muted">You called {call}…</span>
          ) : landed ? (
            <strong className={landed === call ? 'rps-good' : 'rps-bad'}>
              {landed === 'heads' ? 'Heads' : 'Tails'} — {landed === call ? 'right!' : 'wrong'}
            </strong>
          ) : (
            <span className="muted">Call it</span>
          )}
          <span>
            Run of {runShown} {runShown === 1 ? 'right call' : 'right calls'}
          </span>
        </div>
      </div>
      <div className="rps-hands" role="group" aria-label="Your call">
        <button className="btn rps-hand" disabled={spinning} onClick={() => toss('heads')}>
          Heads
        </button>
        <button className="btn rps-hand" disabled={spinning} onClick={() => toss('tails')}>
          Tails
        </button>
      </div>
      <p className="sun-reading">
        <span className="muted">
          Longest run {saved.streak}
          {pct !== null && (
            <>
              {' '}
              · right {saved.right} of {saved.calls} ({pct}%)
            </>
          )}
        </span>
      </p>
      <p className="muted lab-hint">
        A fair coin, decided the moment you call. A run of five comes about once in thirty-two tries
        and ten once in a thousand — and however long your run, the next call is still a coin toss.
        Keys H and T.
      </p>
    </>
  )
}
