import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  LAMPS_KEY,
  LOOKS,
  PATTERNS,
  SIZES,
  dark,
  keepBest,
  make,
  press,
  readSaved,
  reach,
  seedFor as daySeedFor,
  solve,
  type Pattern,
  type Saved,
  type Size,
} from './lamps'
import { dayNumber } from './daily'
import { useKept } from './kept'
import { lampsRules } from './lampsRoom'
import { useLabRoom } from '../lab/social/useLabRoom'
import { CallTable } from '../lab/social/CallTable'
import { useCallWords } from '../lab/social/callWords'
import { myTurn } from '../lab/social/room'

const LOOK_NAMES: Record<Saved['look'], string> = {
  bulbs: 'Bulbs',
  lanterns: 'Lanterns',
  neon: 'Neon',
}
const PATTERN_NAMES: Record<Pattern, string> = { plus: '✚ Beside', cross: '✖ Corners' }
/* today's board — one function with whatever checks a solve later (lamps.ts seedFor) */
const seedFor = (size: number, pattern: Pattern) => daySeedFor(dayNumber(), size, pattern)

export function LampsDemo() {
  const [saved, setSaved] = useKept(LAMPS_KEY, readSaved)
  const [seed, setSeed] = useState(() => seedFor(saved.size, saved.pattern))
  const n = saved.size
  const pattern = saved.pattern
  const daily = seed === seedFor(n, pattern)
  const fresh = useMemo(() => make(n, pattern, seed), [n, pattern, seed])
  const par = useMemo(() => solve(fresh, n, pattern)!.length, [fresh, n, pattern])
  /**
   * The lamps, kept with the board they belong to. A new size renders once before the effect below
   * can reset anything, and that render drew the old lamps on the new grid — 25 lamps in four
   * columns after 4×4 was pressed on a 5×5 board. Cages crashed the Lab from the same shape (12 Nov);
   * here it was one wrong frame, so the same fix: a render whose board is not the one the lamps were
   * lit on reads the new board
   */
  const [play, setPlay] = useState(() => ({ fresh, lit: fresh }))
  const lit = play.fresh === fresh ? play.lit : fresh
  const setLit = (next: boolean[]) => setPlay({ fresh, lit: next })
  const [history, setHistory] = useState<boolean[][]>([])
  /**
   * Every press on this board, and -1 for each undo — the run, kept with the day's best so the
   * finish can be checked by replaying it (verifyLamps). A ref: nothing on screen reads it.
   */
  const actions = useRef<number[]>([])
  const [presses, setPresses] = useState(0)
  const [hints, setHints] = useState(0)
  const [hint, setHint] = useState<number | null>(null)
  const [done, setDone] = useState(false)
  const [kept, setCursor] = useState(0)
  // the same for the keyboard's place: on the last lamp of 7×7, 4×4 had no lamp to Tab to for a render
  const cursor = kept < n * n ? kept : 0
  const [line, setLine] = useState(
    'Press a lamp and it switches, and so do the ones beside it. Switch them all off.',
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  // a fresh board whenever the size, pattern or seed changes
  useEffect(() => {
    setPlay({ fresh, lit: fresh })
    setHistory([])
    actions.current = []
    setPresses(0)
    setHints(0)
    setHint(null)
    setDone(false)
    setCursor(0)
  }, [fresh])

  const today = dayNumber()
  const best = saved.bests.find((b) => b.day === today && b.size === n && b.pattern === pattern)

  /* ── the call's room: today's board at the host's size, together or a race */
  const [withCall, setWithCall] = useState(false)
  const roomRules = useMemo(() => lampsRules(today, n, pattern), [today, n, pattern])
  const lab = useLabRoom('lamps', roomRules)
  const words = useCallWords(lab, roomRules)
  const room = withCall ? lab.room : null
  const g = room?.game
  // the board on screen: the one board together; in a race your own, or the first for a watcher
  const mine = g ? (g.boards.length === 1 ? 0 : (words.mySeat ?? 0)) : 0
  const callN = g?.size ?? n
  const callPattern = g?.pattern ?? pattern
  const shownLit = g ? g.lit[mine] : lit
  const callTurn = !!room && lab.live && myTurn(roomRules, room)
  const N = g ? callN : n
  const P = g ? callPattern : pattern
  const on = shownLit.filter(Boolean).length

  const tap = (i: number) => {
    if (room) {
      if (callTurn) lab.act({ t: 'move', move: i })
      return
    }
    if (done) return
    const next = press(lit, n, i, pattern)
    setHistory((h) => [...h.slice(-300), lit])
    actions.current = [...actions.current, i]
    setLit(next)
    setHint(null)
    const count = presses + 1
    setPresses(count)
    if (dark(next)) {
      setDone(true)
      setSaved((s) => ({
        ...s,
        solvedCount: s.solvedCount + 1,
        bests: daily
          ? keepBest(
              s.bests,
              { day: today, size: n, pattern, presses: count, par, actions: actions.current },
              today,
            )
          : s.bests,
      }))
      setLine(
        `🎉 All dark in ${count} presses${count === par ? ' — that is par, the fewest there are!' : `; par is ${par}.`}${hints ? ` (${hints} hint${hints === 1 ? '' : 's'})` : ''}`,
      )
    } else setLine(`${next.filter(Boolean).length} lamps still lit.`)
  }
  const undo = () => {
    const last = history[history.length - 1]
    if (!last || done) return
    setLit(last)
    setHistory((h) => h.slice(0, -1))
    actions.current = [...actions.current, -1]
    setPresses((p) => p + 1)
    setHint(null)
    setLine('Taken back — it still counts as a press.')
  }
  const askHint = () => {
    if (done) return
    const s = solve(lit, n, pattern)
    if (!s || !s.length) return
    // the press nearest the top-left of the shortest way from here, so the hint reads in order
    setHint(s[0])
    setHints((h) => h + 1)
    setCursor(s[0])
    refs.current[s[0]]?.focus()
    setLine(`From here it can be done in ${s.length}. Try the marked lamp.`)
  }
  const restart = () => {
    setLit(fresh)
    setHistory([])
    actions.current = []
    setPresses(0)
    setHints(0)
    setHint(null)
    setDone(false)
    setLine('The same board again, from the start.')
  }

  const at = cursor < N * N ? cursor : 0
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const r = Math.floor(at / N)
    const c = at % N
    let next = -1
    if (e.key === 'ArrowLeft') next = r * N + Math.max(0, c - 1)
    else if (e.key === 'ArrowRight') next = r * N + Math.min(N - 1, c + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, r - 1) * N + c
    else if (e.key === 'ArrowDown') next = Math.min(N - 1, r + 1) * N + c
    else if (!room && (e.key === 'h' || e.key === 'H')) askHint()
    else if (!room && (e.key === 'u' || e.key === 'U')) undo()
    else return
    e.preventDefault()
    e.stopPropagation()
    if (next >= 0) {
      setCursor(next)
      refs.current[next]?.focus()
    }
  }
  const switched = new Set(reach(N, at, P))
  const pressed = (k: number) => `${k} ${k === 1 ? 'press' : 'presses'}`
  /** a seat's progress in a race: how many of its lamps are still lit */
  const litOf = (k: number) => g?.lit[k]?.filter(Boolean).length ?? 0
  /** a seated player left alone carries on alone, from the board on screen */
  const carryOn = () => {
    const r = room ?? lab.room
    setWithCall(false)
    if (!r || r.game.winner !== null || r.game.size !== n || r.game.pattern !== pattern) return
    const k = r.game.boards.length === 1 ? 0 : (words.mySeat ?? 0)
    setSeed(seedFor(n, pattern))
    setPlay({ fresh, lit: r.game.lit[k] })
    actions.current = []
    setHistory([])
    setPresses(r.game.boards[k].length)
    setLine('Carrying on alone, from where the call left it.')
  }

  return (
    <div className={`lab-keys lp-room is-${saved.look}`}>
      {(lab.live || withCall) && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Who with">
            <button
              className="btn btn-ghost"
              aria-pressed={!withCall}
              onClick={() => setWithCall(false)}
            >
              On your own
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={withCall}
              onClick={() => setWithCall(true)}
            >
              👥 With the call
            </button>
          </div>
        </div>
      )}
      {withCall && (
        <CallTable
          lab={lab}
          rules={roomRules}
          sides={['Player 1', 'Player 2']}
          together="one board between you"
          anyTime={
            g && g.boards.length === 2
              ? 'A race on the same board: first to switch theirs off wins.'
              : 'Either of you, any lamp, any time.'
          }
          score={(gm) =>
            gm.winner === null
              ? null
              : ` in ${pressed(gm.boards[gm.boards.length === 1 ? 0 : gm.winner].length)}`
          }
          onCarryOn={carryOn}
        />
      )}
      {!withCall && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Board size">
            {SIZES.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={n === s}
                onClick={() => {
                  setSaved((x) => ({ ...x, size: s as Size }))
                  setSeed(seedFor(s, pattern))
                }}
              >
                {s}×{s}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Which lamps a press switches">
            {PATTERNS.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={pattern === p}
                onClick={() => {
                  setSaved((x) => ({ ...x, pattern: p }))
                  setSeed(seedFor(n, p))
                }}
              >
                {PATTERN_NAMES[p]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Which board">
            <button
              className="btn btn-ghost"
              aria-pressed={daily}
              onClick={() => setSeed(seedFor(n, pattern))}
            >
              Today’s
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setSeed((Math.random() * 2 ** 31) >>> 0)}
            >
              ⟳ New board
            </button>
          </div>
        </div>
      )}
      {g ? (
        <div className="dice-scores">
          {g.boards.length === 2 ? (
            ([0, 1] as const).map((k) => (
              <div key={k} className={`dice-score${k === mine ? ' is-up' : ''}`}>
                <span>{words.who(room!.seats[k])}</span>
                <strong>{litOf(k)}</strong>
                <span className="muted">lit · {pressed(g.boards[k].length)}</span>
              </div>
            ))
          ) : (
            <div className="dice-score is-up">
              <span>Together</span>
              <strong>{litOf(0)}</strong>
              <span className="muted">lit · {pressed(g.boards[0].length)}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="dice-scores">
          <div className="dice-score is-up">
            <span>Presses</span>
            <strong>{presses}</strong>
            <span className="muted">par {par}</span>
          </div>
          <div className="dice-score">
            <span>Lit</span>
            <strong>{on}</strong>
            <span className="muted">
              {hints ? `${hints} hint${hints === 1 ? '' : 's'}` : 'no hints'}
            </span>
          </div>
          <div className="dice-score">
            <span>Today’s best</span>
            <strong>{best ? best.presses : '—'}</strong>
            <span className="muted">{daily ? 'today’s board' : 'a random board'}</span>
          </div>
        </div>
      )}
      {!withCall && (
        <p className="mc-line" aria-live="polite">
          {line}
        </p>
      )}

      <div
        className={`lp-board${(g ? g.winner !== null : done) ? ' is-done' : ''}`}
        style={{ ['--lp-n' as string]: N }}
        role="group"
        aria-label={`The lamps, ${N} by ${N}. Arrow keys move, Enter or Space presses${g ? '' : ', H is a hint, U undoes'}.`}
        onKeyDown={onKey}
      >
        {shownLit.map((v, i) => (
          <button
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            className={[
              'lp-lamp',
              v ? 'is-on' : '',
              !g && hint === i ? 'is-hint' : '',
              i !== at && switched.has(i) ? 'is-near' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            tabIndex={i === at ? 0 : -1}
            aria-label={`Row ${Math.floor(i / N) + 1}, column ${(i % N) + 1}: ${v ? 'lit' : 'dark'}${!g && hint === i ? ', the hint' : ''}`}
            aria-pressed={v}
            onFocus={() => setCursor(i)}
            onClick={() => {
              setCursor(i)
              tap(i)
            }}
          >
            <span aria-hidden />
          </button>
        ))}
      </div>
      {!withCall && (
        <div className="lab-controls">
          <button className="btn btn-ghost" onClick={undo} disabled={!history.length || done}>
            ↶ Undo
          </button>
          <button className="btn btn-ghost" onClick={askHint} disabled={done}>
            💡 Hint
          </button>
          <button className="btn btn-ghost" onClick={restart}>
            ↺ Start this board again
          </button>
        </div>
      )}

      <p className="sun-reading">
        <span className="muted">Boards cleared: {saved.solvedCount}</span>
      </p>
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Lamps</h3>
          <div className="lab-controls" role="group" aria-label="Which lamps">
            {LOOKS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.look === l}
                onClick={() => setSaved((s) => ({ ...s, look: l }))}
              >
                {LOOK_NAMES[l]}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Press a lamp and it switches — on to off, off to on — and so do its neighbours: the four
        beside it, or with Corners the four on its diagonals. Switch every lamp off. Par is the
        fewest presses that can do it, worked out exactly; pressing a lamp twice undoes it, so no
        lamp ever needs pressing more than once. Today’s board is the same for everyone. Keys:
        arrows move, Enter or Space presses, H is a hint, U undoes.
      </p>
    </div>
  )
}
