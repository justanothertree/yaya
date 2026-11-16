import { useEffect, useRef, useState } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { CanvasStage } from './CanvasStage'
import {
  BALL_R,
  BETS,
  FALL,
  FLOOR,
  GAP,
  HEIGHT,
  ODDS,
  PEG_R,
  PEGDROP_KEY,
  RISKS,
  RISK_NAMES,
  ROWS,
  SLOTS,
  START,
  at,
  drop,
  expected,
  paid,
  pegs,
  pts,
  readSaved,
  slotX,
  type Drop,
  type Risk,
} from './pegdrop'
import { useKept } from './kept'

/** more balls than this in the air and Drop waits — a held key should not bury the board */
const MAX_IN_AIR = 24
const PEGS = pegs()

type Ball = { d: Drop; t: number; bet: number; risk: Risk; done: boolean }

/** a slot's colour by what it pays: losing slots cool, big ones hot */
function tint(m: number): string {
  if (m < 1) return `hsl(220 18% ${30 + m * 22}%)`
  const k = Math.min(1, Math.log(m) / Math.log(170))
  return `hsl(${130 - k * 130} 75% ${42 + k * 8}%)`
}

const odd = (p: number) => {
  const n = Math.round(1 / p)
  return n <= 1 ? 'more than half' : `1 in ${n.toLocaleString()}`
}

export function PegDropDemo() {
  const [saved, setSaved] = useKept(PEGDROP_KEY, readSaved)
  const [last, setLast] = useState<string | null>(null)
  const [sound, setSound] = useState(true)
  const [inAir, setInAir] = useState(0)
  const balls = useRef<Ball[]>([])
  /** where the landings are shown flashing, by slot */
  const flash = useRef<number[]>(new Array(SLOTS).fill(0))
  const now = useRef({ risk: saved.risk, sound })
  now.current = { risk: saved.risk, sound }

  useEffect(
    () => () => {
      for (let i = 0; i < 8; i++) noteOff(`pegdrop-${i}`)
    },
    [],
  )

  /** a ball reached its slot: pay it, once */
  const land = (b: Ball) => {
    const win = paid(b.bet, b.risk, b.d.slot)
    const m = RISKS[b.risk][b.d.slot]
    setSaved((s) => {
      const points = Math.round((s.points + win) * 10) / 10
      return {
        ...s,
        points,
        best: Math.max(s.best, points),
        bigHit: Math.max(s.bigHit, m),
      }
    })
    setLast(`${m}× — ${pts(b.bet)} became ${pts(win)}`)
    flash.current[b.d.slot] = 1
    if (now.current.sound) {
      const id = `pegdrop-${b.d.slot % 8}`
      noteOn(id, 'bell', m >= 1 ? 72 + Math.min(12, Math.round(Math.log2(m) * 3)) : 60)
      window.setTimeout(() => noteOff(id), 160)
    }
  }
  const landRef = useRef(land)
  landRef.current = land

  const broke = saved.points < BETS[0]
  const canDrop = saved.points >= saved.bet && inAir < MAX_IN_AIR

  const release = () => {
    if (!canDrop) return
    balls.current.push({
      d: drop(Math.random),
      t: 0,
      bet: saved.bet,
      risk: saved.risk,
      done: false,
    })
    setInAir(balls.current.length)
    setSaved((s) => ({
      ...s,
      points: Math.round((s.points - s.bet) * 10) / 10,
      drops: s.drops + 1,
    }))
  }

  const ev = expected(saved.risk)
  const pays = RISKS[saved.risk]

  return (
    <div
      className="lab-keys pegdrop-room"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          if ((e.target as HTMLElement).closest('button, select, input')) return
          e.preventDefault()
          release()
        }
      }}
    >
      <CanvasStage
        label={`A peg board of ${ROWS} rows. Slots pay, left to right: ${pays.join(', ')} times the drop.`}
        make={(ctx, canvas) => ({
          frame: (dt) => {
            // move every ball, and pay the ones that arrive
            for (const b of balls.current) {
              b.t += dt
              if (!b.done && b.t >= FALL) {
                b.done = true
                landRef.current(b)
              }
            }
            const before = balls.current.length
            balls.current = balls.current.filter((b) => b.t < FALL + 0.6)
            if (balls.current.length !== before) setInAir(balls.current.length)
            for (let i = 0; i < SLOTS; i++)
              flash.current[i] = Math.max(0, flash.current[i] - dt * 2)

            const { width: w, height: h } = canvas
            ctx.fillStyle = '#07071a'
            ctx.fillRect(0, 0, w, h)
            const s = Math.min(w / 1.02, h / HEIGHT)
            const ox = (w - s) / 2
            const oy = (h - s * HEIGHT) / 2
            const X = (x: number) => ox + x * s
            const Y = (y: number) => oy + y * s

            ctx.fillStyle = '#c9c9ee'
            for (const [x, y] of PEGS) {
              ctx.beginPath()
              ctx.arc(X(x), Y(y), Math.max(1.5, PEG_R * s), 0, Math.PI * 2)
              ctx.fill()
            }
            // the slots: their payouts for the risk chosen now
            const risk = RISKS[now.current.risk]
            const sw = GAP * s * 0.94
            const sy = Y(FLOOR + GAP * 0.25)
            const sh = GAP * s * 0.75
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.font = `700 ${Math.max(8, Math.round(sh * 0.36))}px system-ui, sans-serif`
            for (let k = 0; k < SLOTS; k++) {
              const x = X(slotX(k)) - sw / 2
              const lift = flash.current[k] * sh * 0.25
              ctx.fillStyle = tint(risk[k])
              ctx.globalAlpha = 0.75 + flash.current[k] * 0.25
              ctx.beginPath()
              ctx.roundRect(x, sy + lift, sw, sh, Math.min(6, sw * 0.15))
              ctx.fill()
              ctx.globalAlpha = 1
              ctx.fillStyle = '#0b0b1c'
              const m = risk[k]
              ctx.fillText(m >= 100 ? String(m) : `${m}×`, X(slotX(k)), sy + lift + sh / 2)
            }
            for (const b of balls.current) {
              const [x, y] = at(b.d, b.t)
              ctx.globalAlpha = b.done ? Math.max(0, 1 - (b.t - FALL) / 0.6) : 1
              ctx.fillStyle = '#ff5f8f'
              ctx.beginPath()
              ctx.arc(X(x), Y(y), Math.max(3, BALL_R * s), 0, Math.PI * 2)
              ctx.fill()
            }
            ctx.globalAlpha = 1
          },
        })}
      />
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Risk">
          {(Object.keys(RISKS) as Risk[]).map((r) => (
            <button
              key={r}
              className="btn btn-ghost"
              aria-pressed={saved.risk === r}
              onClick={() => setSaved((s) => ({ ...s, risk: r }))}
            >
              {RISK_NAMES[r]}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="Points per drop">
          {BETS.map((b) => (
            <button
              key={b}
              className="btn btn-ghost"
              aria-pressed={saved.bet === b}
              onClick={() => setSaved((s) => ({ ...s, bet: b }))}
            >
              {b}
            </button>
          ))}
        </div>
        {broke && inAir === 0 ? (
          <button
            className="btn"
            onClick={() => {
              setSaved((s) => ({ ...s, points: START, refills: s.refills + 1 }))
              setLast(null)
            }}
          >
            Out of points — start again with {START}
          </button>
        ) : (
          <button className="btn" onClick={release} disabled={!canDrop} aria-keyshortcuts="Space">
            ⚪ Drop {saved.bet}
          </button>
        )}
        <button className="btn btn-ghost" aria-pressed={sound} onClick={() => setSound((v) => !v)}>
          {sound ? '🔊 Sound' : '🔇 Sound'}
        </button>
      </div>
      <p className="sun-reading" aria-live="polite">
        <strong className="lab-score">{pts(saved.points)} points</strong>
        {last && <> · last ball {last}</>}
        {!canDrop && !broke && saved.points < saved.bet && (
          <> · not enough for a drop of {saved.bet} — pick a smaller one</>
        )}
        <span className="muted">
          {' '}
          · most ever {pts(saved.best)} · {saved.drops} drops
          {saved.bigHit > 0 && <> · biggest landing {saved.bigHit}×</>}
        </span>
      </p>
      <p className="muted lab-hint">
        Every peg is a coin toss, so a ball lands in an edge slot {odd(ODDS[0])} drops and in the
        middle one {odd(ODDS[ROWS / 2])}. At {RISK_NAMES[saved.risk].toLowerCase()} risk a drop pays
        back {Math.round(ev * 1000) / 10}% on average — the board keeps a little, as they do, so a
        run of luck is luck. Play points only, kept in this browser. Space or Enter drops.
      </p>
    </div>
  )
}
