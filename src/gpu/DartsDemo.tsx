import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  BOARDS,
  DARTS_KEY,
  LEVELS,
  ORDER,
  R,
  ROUTES,
  SPREAD,
  aimFor,
  dart,
  hitAt,
  land,
  newLeg,
  points,
  readSaved,
  say,
  yourSpread,
  type Hit,
  type Leg,
  type Level,
  type Saved,
  type Who,
} from './darts'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'
import { dartsRules, tidy, type DartsGame } from './dartsRoom'
import { useLabRoom } from '../lab/social/useLabRoom'
import { CallTable } from '../lab/social/CallTable'
import { tableSeats } from '../lab/social/table'
import { myTurn as roomTurn } from '../lab/social/room'

const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const LOOK: Record<
  Saved['board'],
  {
    name: string
    a: string
    b: string
    red: string
    green: string
    wire: string
    ring: string
    numbers: string
    back: string
  }
> = {
  classic: {
    name: 'Classic',
    a: '#1c1c1c',
    b: '#f3e6c8',
    red: '#d1312b',
    green: '#1f8a4c',
    wire: '#c9c9c9',
    ring: '#141414',
    numbers: '#f5f5f5',
    back: '#2b1d14',
  },
  neon: {
    name: 'Neon',
    a: '#0b0b1a',
    b: '#1d1d3b',
    red: '#ff3d81',
    green: '#2ef2c7',
    wire: '#5a5aa8',
    ring: '#05050f',
    numbers: '#b8f7ff',
    back: '#05050f',
  },
  pub: {
    name: 'Pub',
    a: '#2b2522',
    b: '#d8c7a4',
    red: '#9c2a24',
    green: '#2f5e3b',
    wire: '#8a8a8a',
    ring: '#1d1814',
    numbers: '#e9e0cc',
    back: '#4a3526',
  },
}
/** how far the board reaches beyond the double ring, for the numbers */
const EDGE = 225
/** on a touch screen, the aim sits this far above the finger so the finger does not hide it */
const FINGER_LIFT = 46
const LEGS_TO_WIN = 2
type Thrown = { x: number; y: number; who: Who }
/** 'call': the match shared with friends in your call (src/lab/social/useLabRoom.ts) */
type Opponent = 'bot' | 'call'

export function DartsDemo() {
  const [saved, setSaved] = useKept(DARTS_KEY, readSaved)
  const [level, setLevel] = useState<Level>(saved.level)
  const [leg, setLeg] = useState<Leg>(() => newLeg(0))
  const [legs, setLegs] = useState<[number, number]>([0, 0])
  const [legNo, setLegNo] = useState(0)
  const [thrown, setThrown] = useState<Thrown[]>([])
  const [line, setLine] = useState('501, double out, first to two legs. You throw first.')
  const [over, setOver] = useState(false)
  /* ── the call's match: seat 0 throws first in the first leg; it travels as its darts */
  const [opp, setOpp] = useState<Opponent>('bot')
  const lab = useLabRoom('darts', dartsRules)
  const words = tableSeats(lab, dartsRules)
  const room = opp === 'call' ? lab.room : null
  const cg: DartsGame | null = room ? room.game : null
  /** the leg, the legs and the darts in the board on screen: the call's in a call */
  const vLeg = cg ? cg.leg : leg
  const vLegs = cg ? cg.legs : legs
  const vThrown: Thrown[] = cg ? cg.board : thrown
  const vOver = cg ? dartsRules.turn(cg) === null : over
  /** this player's side: their seat's, or the team's together */
  const meSide: Who = room?.mode === 'versus' && words.mySeat === 1 ? 1 : 0
  const legRef = useRef(vLeg)
  legRef.current = vLeg
  const savedRef = useRef(saved)
  savedRef.current = saved
  const thrownRef = useRef(vThrown)
  thrownRef.current = vThrown
  /** the aim, in board millimetres, and when the current breath began (0 when not holding) */
  const aim = useRef({ x: 0, y: 103, holdFrom: 0, touch: false })
  const view = useRef<{ s: number; cx: number; cy: number } | null>(null)
  const timers = useRef<number[]>([])
  const myDarts = useRef(0)
  const [, redraw] = useState(0)
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  const myTurn = room
    ? lab.live && roomTurn(dartsRules, room)
    : opp === 'bot' && !over && leg.winner === null && leg.turn === 0
  const aimingRef = useRef(myTurn)
  aimingRef.current = myTurn
  const record = (patch: (t: Saved['record'][Level]) => Partial<Saved['record'][Level]>) =>
    setSaved((s) => ({
      ...s,
      record: { ...s.record, [level]: { ...s.record[level], ...patch(s.record[level]) } },
    }))

  /** after any dart: the leg, the match, or the turn handed on */
  const after = (g: Leg, prev: Leg, by: Who) => {
    setLeg(g)
    const turnOver = g.turn !== by || g.winner !== null
    if (!turnOver) return
    const t = g.history[g.history.length - 1]
    const who = by === 0 ? 'You' : 'The computer'
    const darts = t.darts.map(say).join(', ')
    if (by === 0 && !t.bust && t.total === 180) record((r) => ({ tons: r.tons + 1 }))
    if (g.winner !== null) {
      const won = g.winner === 0
      const next: [number, number] = [legs[0] + (won ? 1 : 0), legs[1] + (won ? 0 : 1)]
      setLegs(next)
      if (won)
        record((r) => ({
          best: Math.max(r.best, prev.from),
          fewest: !r.fewest || myDarts.current < r.fewest ? myDarts.current : r.fewest,
        }))
      const match = Math.max(...next) >= LEGS_TO_WIN
      if (match) {
        setOver(true)
        record((r) => ({ won: r.won + (won ? 1 : 0), lost: r.lost + (won ? 0 : 1) }))
      }
      setLine(
        `${who} ${by === 0 ? 'check' : 'checks'} out ${prev.from} with ${darts}! ${match ? (won ? '🏆 You win the match' : 'The computer wins the match') : `${won ? 'You take' : 'It takes'} the leg`}, ${next[0]}–${next[1]}.`,
      )
      return
    }
    const left = g.scores[by]
    setLine(
      t.bust
        ? `${who}: ${darts} — bust! Back to ${left}.${g.turn === 0 ? ' Your throw.' : ''}`
        : `${who}: ${darts} — ${t.total === 180 ? 'ONE HUNDRED AND EIGHTY! ' : ''}${t.total}. ${left} left.${g.turn === 0 ? ' Your throw.' : ''}`,
    )
    // the computer's darts stay in the board until you throw your first
    if (g.turn === 1) later(reduced() ? 300 : 900, () => computerTurn(g))
  }

  const computerTurn = (start: Leg) => {
    setThrown([])
    let g = start
    const one = (k: number) => {
      if (g.winner !== null || g.turn !== 1) return
      const target = aimFor(g, level)
      const p = land(target, SPREAD[level], Math.random)
      const prev = g
      g = dart(g, hitAt(p.x, p.y))
      setThrown((t) => [...t, { x: p.x, y: p.y, who: 1 }])
      after(g, prev, 1)
      if (g.turn === 1 && g.winner === null) later(reduced() ? 250 : 750, () => one(k + 1))
    }
    one(0)
  }

  const throwMine = () => {
    const a = aim.current
    if (!a.holdFrom || !myTurn) return
    const held = (performance.now() - a.holdFrom) / 1000
    a.holdFrom = 0
    const p = land(a, yourSpread(held), Math.random)
    if (room) {
      // in the call the host scores it off the board, and the dart comes back to everybody
      lab.act({ t: 'move', move: tidy(p) })
      return
    }
    const prev = legRef.current
    if (prev.darts.length === 0) setThrown([])
    myDarts.current++
    const g = dart(prev, hitAt(p.x, p.y))
    setThrown((t) => [...(prev.darts.length === 0 ? [] : t), { x: p.x, y: p.y, who: 0 }])
    if (g.turn === 0 && g.winner === null) {
      const h: Hit = g.darts[g.darts.length - 1]
      setLine(
        `${say(h)}${h.mult >= 2 ? ` — ${points(h)}` : ''}. ${g.scores[0]} left, ${3 - g.darts.length} dart${g.darts.length === 2 ? '' : 's'} to go.`,
      )
      setLeg(g)
    } else after(g, prev, 0)
  }

  const nextLeg = (fresh = false) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    const n = fresh ? 0 : legNo + 1
    const first = (n % 2) as Who
    if (fresh) {
      setLegs([0, 0])
      setOver(false)
      setLevel(saved.level)
    }
    setLegNo(n)
    myDarts.current = 0
    const g = newLeg(first)
    setLeg(g)
    setThrown([])
    if (first === 1) {
      setLine('The computer throws first this leg…')
      later(800, () => computerTurn(g))
    } else setLine(fresh ? 'A new match. You throw first.' : 'Your throw first this leg.')
  }

  /* ── the call's match in words, and carrying it on alone */
  const callName = (w: Who) =>
    !room
      ? ''
      : room.mode === 'together'
        ? w === 1
          ? 'The computer'
          : words.mySeat !== null
            ? 'You'
            : 'The team'
        : words.who(room.seats[w])
  /** what the last dart did: a dart, a turn, a leg or the match */
  const callLine = (g: DartsGame) => {
    const l = g.last
    if (!l) return ''
    const who = callName(l.by)
    const you = who === 'You'
    if (l.legWon) {
      const darts = [...l.before.darts, l.hit].map(say).join(', ')
      return `${who} ${you ? 'check' : 'checks'} out ${l.before.from} with ${darts}! ${
        g.over ? 'The match' : 'The leg'
      }, ${g.legs[0]}–${g.legs[1]}.`
    }
    if (g.leg.turn === l.by && g.leg.darts.length > 0) {
      const left = g.leg.scores[l.by]
      return `${who}: ${say(l.hit)}${l.hit.mult >= 2 ? ` — ${points(l.hit)}` : ''}. ${left} left, ${3 - g.leg.darts.length} to go.`
    }
    const t = g.leg.history[g.leg.history.length - 1]
    const darts = t.darts.map(say).join(', ')
    return t.bust
      ? `${who}: ${darts} — bust! Back to ${g.leg.scores[l.by]}.`
      : `${who}: ${darts} — ${t.total === 180 ? 'ONE HUNDRED AND EIGHTY! ' : ''}${t.total}. ${g.leg.scores[l.by]} left.`
  }
  const stopHere = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    aim.current.holdFrom = 0
  }
  const computerRef = useRef(computerTurn)
  computerRef.current = computerTurn
  /**
   * ⚠️ A SEATED PLAYER LEFT ALONE carries on against the computer from the match as it stands,
   * their own side the toy's — the sides swapped round for the second seat — or starts a new
   * match if that one was over.
   */
  const carryOn = () => {
    const r = room ?? lab.room
    const me: Who = r?.mode === 'versus' && words.mySeat === 1 ? 1 : 0
    stopHere()
    setOpp('bot')
    if (!r || dartsRules.turn(r.game) === null) return nextLeg(true)
    const g = r.game
    const flip = (w: Who): Who => (me === 0 ? w : w === 0 ? 1 : 0)
    const L = g.leg
    const l: Leg = {
      ...L,
      scores: me === 0 ? L.scores : [L.scores[1], L.scores[0]],
      turn: flip(L.turn),
      history: L.history.map((t) => ({ ...t, who: flip(t.who) })),
      winner: L.winner === null ? null : flip(L.winner),
    }
    setLeg(l)
    setLegs(me === 0 ? g.legs : [g.legs[1], g.legs[0]])
    // the toy has you throw first in its even legs: count so that stays true of this one
    setLegNo(g.legNo + me)
    setThrown(g.board.map((d) => ({ ...d, who: flip(d.who) })))
    setOver(false)
    myDarts.current = 0
    if (l.turn === 1) {
      setLine('Carrying on against the computer, which throws next…')
      later(800, () => computerRef.current(l))
    } else setLine(`Carrying on against the computer. Your throw: ${l.scores[0]} left.`)
  }

  /* -------------------------------------------------------------------- aiming */

  const toBoard = (e: PointerEvent<HTMLCanvasElement>) => {
    const v = view.current
    if (!v) return null
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    const k = c.width / r.width
    const lift = e.pointerType === 'mouse' ? 0 : FINGER_LIFT
    const px = (e.clientX - r.left) * k
    const py = (e.clientY - r.top - lift) * k
    return { x: (px - v.cx) / v.s, y: -(py - v.cy) / v.s }
  }
  const clampAim = (p: { x: number; y: number }) => {
    const r = Math.hypot(p.x, p.y)
    const f = r > EDGE ? EDGE / r : 1
    return { x: p.x * f, y: p.y * f }
  }
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!myTurn) return
    const p = toBoard(e)
    if (!p) return
    Object.assign(aim.current, clampAim(p), {
      holdFrom: performance.now(),
      touch: e.pointerType !== 'mouse',
    })
  }
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = toBoard(e)
    if (!p) return
    Object.assign(aim.current, clampAim(p), { touch: e.pointerType !== 'mouse' })
  }
  const onUp = () => throwMine()
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 1.5 : 6
    const a = aim.current
    if (e.key.startsWith('Arrow')) {
      const p = clampAim({
        x: a.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0),
        y: a.y + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0),
      })
      Object.assign(a, p, { touch: false })
      redraw((n) => n + 1)
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (!e.repeat && myTurn && !a.holdFrom) a.holdFrom = performance.now()
    } else return
    e.preventDefault()
    e.stopPropagation()
  }
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      throwMine()
    }
  }

  const mine = vLeg.scores[meSide]
  const route = ROUTES.get(mine)
  const rec = saved.record[saved.level]
  const untouched = legNo === 0 && leg.history.length === 0 && leg.darts.length === 0

  return (
    <div className={`lab-keys dt-room is-${saved.board}`}>
      <div className="lab-controls">
        {(lab.live || opp === 'call') && (
          <div className="lab-group" role="group" aria-label="Opponent">
            <button
              className="btn btn-ghost"
              aria-pressed={opp === 'bot'}
              onClick={() => {
                if (opp === 'bot') return
                stopHere()
                setOpp('bot')
                nextLeg(true)
              }}
            >
              Against the computer
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={opp === 'call'}
              onClick={() => {
                stopHere()
                setOpp('call')
              }}
            >
              👥 With the call
            </button>
          </div>
        )}
        {opp === 'bot' && (
          <>
            <div className="lab-group" role="group" aria-label="How well the computer throws">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  className="btn btn-ghost"
                  aria-pressed={saved.level === l}
                  onClick={() => {
                    setSaved((s) => ({ ...s, level: l }))
                    if (untouched || over) {
                      setLevel(l)
                      if (over) nextLeg(true)
                    }
                  }}
                >
                  {LEVEL_NAMES[l]}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost" onClick={() => nextLeg(true)}>
              ↻ New match
            </button>
          </>
        )}
      </div>
      {opp === 'call' && (
        <CallTable
          table={lab}
          rules={dartsRules}
          sides={['the first thrower', 'the second thrower']}
          ink={['#ffd34d', '#7ec8ff']}
          levelNames={LEVEL_NAMES}
          score={(g) => `, ${Math.max(...g.legs)} legs to ${Math.min(...g.legs)}`}
          onCarryOn={carryOn}
        />
      )}
      <div className="dice-scores">
        {([0, 1] as Who[]).map((w) => (
          <div
            key={w}
            className={`dice-score${vLeg.turn === w && vLeg.winner === null && !vOver ? ' is-up' : ''}`}
          >
            <span>
              {room ? callName(w) : w === 0 ? 'You' : `The computer · ${LEVEL_NAMES[level]}`} · legs{' '}
              {vLegs[w]}
            </span>
            <strong>{vLeg.scores[w]}</strong>
            <span className="muted">
              {(() => {
                const last = [...vLeg.history].reverse().find((t) => t.who === w)
                return last ? `last ${last.bust ? 'bust' : last.total}` : 'to throw'
              })()}
            </span>
          </div>
        ))}
      </div>
      {cg ? (
        cg.last && (
          <p className="muted dt-said" aria-live="polite">
            {callLine(cg)}
          </p>
        )
      ) : (
        <p className="mc-line" aria-live="polite">
          {line}
        </p>
      )}
      {saved.hints && myTurn && route && (
        <p className="muted mc-note">
          Way out: {route.map(say).join(', ')}
          {route.length > 3 - vLeg.darts.length ? ' — more darts than this turn has left' : ''}
        </p>
      )}

      <div
        className={`dt-wrap${myTurn ? ' is-aiming' : ''}`}
        tabIndex={0}
        role="group"
        aria-label="The board. Point to aim, then press and hold — your hand steadies, then wavers — and let go to throw. With keys: arrows aim (Shift for fine), hold Space and let go to throw."
        onKeyDown={onKey}
        onKeyUp={onKeyUp}
        onBlur={() => (aim.current.holdFrom = 0)}
      >
        <CanvasStage
          className="dt-stage"
          label={
            cg
              ? `A dartboard. ${callName(0)} ${vLeg.scores[0]} left, ${callName(1)} ${vLeg.scores[1]}. ${callLine(cg)}`
              : `A dartboard. You have ${mine} left, the computer ${leg.scores[1]}. ${line}`
          }
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          make={(ctx, c) => {
            let last = ''
            return {
              frame: () => {
                const sv = savedRef.current
                const a0 = aim.current
                // a still board is drawn once; while you hold, the ring changes every frame
                const key = `${c.width}x${c.height}|${sv.board}|${a0.x.toFixed(2)},${a0.y.toFixed(2)}|${a0.holdFrom ? performance.now() : 0}|${thrownRef.current.length}|${legRef.current.turn}|${legRef.current.winner}|${aimingRef.current}`
                if (key === last) return
                last = key
                const L = LOOK[sv.board]
                const w = c.width
                const h = c.height
                const s = Math.min(w, h) / (EDGE * 2.05)
                const cx = w / 2
                const cy = h / 2
                view.current = { s, cx, cy }
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.fillStyle = L.back
                ctx.fillRect(0, 0, w, h)
                ctx.fillStyle = L.ring
                ctx.beginPath()
                ctx.arc(cx, cy, EDGE * s, 0, Math.PI * 2)
                ctx.fill()
                const wedge = (r0: number, r1: number, i: number, fill: string) => {
                  // the board's angles run clockwise from the top; the canvas's from the right
                  const a0 = -Math.PI / 2 + (i - 0.5) * (Math.PI / 10)
                  ctx.fillStyle = fill
                  ctx.beginPath()
                  ctx.arc(cx, cy, r1 * s, a0, a0 + Math.PI / 10)
                  ctx.arc(cx, cy, r0 * s, a0 + Math.PI / 10, a0, true)
                  ctx.closePath()
                  ctx.fill()
                }
                for (let i = 0; i < 20; i++) {
                  const even = i % 2 === 0
                  wedge(R.outer, R.trebleIn, i, even ? L.a : L.b)
                  wedge(R.trebleIn, R.trebleOut, i, even ? L.red : L.green)
                  wedge(R.trebleOut, R.doubleIn, i, even ? L.a : L.b)
                  wedge(R.doubleIn, R.doubleOut, i, even ? L.red : L.green)
                }
                ctx.fillStyle = L.green
                ctx.beginPath()
                ctx.arc(cx, cy, R.outer * s, 0, Math.PI * 2)
                ctx.fill()
                ctx.fillStyle = L.red
                ctx.beginPath()
                ctx.arc(cx, cy, R.bull * s, 0, Math.PI * 2)
                ctx.fill()
                ctx.strokeStyle = L.wire
                ctx.lineWidth = Math.max(0.6, s * 0.9)
                for (const r of [R.outer, R.trebleIn, R.trebleOut, R.doubleIn, R.doubleOut]) {
                  ctx.beginPath()
                  ctx.arc(cx, cy, r * s, 0, Math.PI * 2)
                  ctx.stroke()
                }
                ctx.fillStyle = L.numbers
                ctx.font = `700 ${Math.round(22 * s)}px system-ui, sans-serif`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ORDER.forEach((n, i) => {
                  const a = (i * Math.PI) / 10
                  ctx.fillText(String(n), cx + Math.sin(a) * 196 * s, cy - Math.cos(a) * 196 * s)
                })
                // the darts in the board this turn
                for (const d of thrownRef.current) {
                  const x = cx + d.x * s
                  const y = cy - d.y * s
                  ctx.fillStyle = d.who === 0 ? '#ffd34d' : '#7ec8ff'
                  ctx.strokeStyle = '#000'
                  ctx.lineWidth = 1.5
                  ctx.beginPath()
                  ctx.arc(x, y, Math.max(3, 4 * s), 0, Math.PI * 2)
                  ctx.fill()
                  ctx.stroke()
                }
                // the aim and, while holding, the ring a dart will probably land inside
                const a = aim.current
                const g = legRef.current
                if (aimingRef.current && g.winner === null) {
                  const x = cx + a.x * s
                  const y = cy - a.y * s
                  const held = a.holdFrom ? (performance.now() - a.holdFrom) / 1000 : 0
                  const spread = yourSpread(held)
                  ctx.strokeStyle = a.holdFrom
                    ? held > 1.6
                      ? '#ff6b4a'
                      : '#7ee787'
                    : 'rgba(255,255,255,0.55)'
                  ctx.lineWidth = 2
                  ctx.beginPath()
                  ctx.arc(x, y, spread * 1.6 * s, 0, Math.PI * 2)
                  ctx.stroke()
                  ctx.strokeStyle = '#fff'
                  ctx.beginPath()
                  ctx.moveTo(x - 8, y)
                  ctx.lineTo(x + 8, y)
                  ctx.moveTo(x, y - 8)
                  ctx.lineTo(x, y + 8)
                  ctx.stroke()
                }
              },
            }
          }}
        />
      </div>
      <div className="lab-controls">
        {!room && leg.winner !== null && !over && (
          <button className="btn" onClick={() => nextLeg()}>
            ▶ Next leg
          </button>
        )}
        {!room && over && (
          <button className="btn" onClick={() => nextLeg(true)}>
            ↻ Play again
          </button>
        )}
      </div>

      {!room && (
        <p className="sun-reading">
          <span className="muted">
            Against {LEVEL_NAMES[saved.level]}: won {rec.won}, lost {rec.lost}
            {rec.best ? ` · best checkout ${rec.best}` : ''}
            {rec.fewest ? ` · fastest leg ${rec.fewest} darts` : ''}
            {rec.tons ? ` · 180s ${rec.tons}` : ''}
          </span>
        </p>
      )}
      {!room && level !== saved.level && !untouched && !over && (
        <p className="muted mc-note">The new level starts with the next match.</p>
      )}
      <div className="fw-panel">
        <section aria-label="Board">
          <h3 className="fw-h">Board</h3>
          <div className="lab-controls" role="group" aria-label="Look">
            {BOARDS.map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={saved.board === b}
                onClick={() => setSaved((s) => ({ ...s, board: b }))}
              >
                {LOOK[b].name}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Show the way out
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        501, double out: three darts a turn, take the score off, and finish exactly on nought with a
        double — the bull counts as double 25. Below nought, on one, or nought without a double is
        bust, and the turn counts for nothing. To throw, aim, then press and hold: the ring is where
        the dart will probably land, and it tightens as your hand settles for about a second, then
        widens if you hold on. Let go when it is tightest. On a touch screen the cross sits just
        above your finger. Easy, Fair and Hard differ in how steady their hand is, and each aims
        where its own hand scores best. In a call, 👥 With the call puts a friend on the other side
        of the oche, or the two of you on one score taking darts in turn against the computer; each
        dart goes where your own hand sends it.
      </p>
    </div>
  )
}
