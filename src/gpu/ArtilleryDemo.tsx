import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  ARTILLERY_KEY,
  COLS,
  DX,
  FIELD_W,
  GUN_R,
  LEVELS,
  LIFE,
  SKIES,
  gunAt,
  gunner,
  newField,
  readSaved,
  shoot,
  type Field,
  type Level,
  type Saved,
  type Who,
} from './artillery'
import { motionReduced as reduced } from '../ui/motion'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(ARTILLERY_KEY))
  } catch {
    return readSaved(null)
  }
}
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const SKY: Record<
  Saved['sky'],
  { name: string; top: string; low: string; hill: string; rim: string }
> = {
  dusk: { name: 'Dusk', top: '#2b1d3f', low: '#f08a5d', hill: '#3d5a3a', rim: '#7fae6f' },
  day: { name: 'Day', top: '#5fa8e8', low: '#d6ecff', hill: '#6a9b4c', rim: '#9fd27a' },
  night: { name: 'Night', top: '#05060d', low: '#1d2a4a', hill: '#22303d', rim: '#4b6a80' },
}
const FIELD_H = 0.8
const GUNS = ['#ffd34d', '#ff6b6b']
type Show = { path: number[]; t: number; burst: { x: number; y: number } | null; after: () => void }

export function ArtilleryDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [level, setLevel] = useState<Level>(saved.level)
  const [field, setField] = useState<Field>(() => newField((Math.random() * 2 ** 31) >>> 0, 0))
  const [angle, setAngle] = useState(45)
  const [charge, setCharge] = useState(0.6)
  const [busy, setBusy] = useState(false)
  const [line, setLine] = useState(
    'Your gun is on the left. Set the angle and the charge, mind the wind, and fire.',
  )
  const [shots, setShots] = useState(0)
  const fieldRef = useRef(field)
  fieldRef.current = field
  const aimRef = useRef({ angle, charge })
  aimRef.current = { angle, charge }
  const savedRef = useRef(saved)
  savedRef.current = saved
  const trail = useRef<number[] | null>(null)
  const show = useRef<Show | null>(null)
  const flash = useRef<{ x: number; y: number; t: number } | null>(null)
  const drag = useRef(false)
  const timers = useRef<number[]>([])
  const recorded = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem(ARTILLERY_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  const yourTurn = field.turn === 0 && field.winner === null && !busy
  const windWords = (w: number) =>
    w === 0 ? 'no wind' : `wind ${Math.abs(w).toFixed(2)} to the ${w > 0 ? 'right' : 'left'}`

  /** fire for whoever's turn it is, show the shell flying, then settle the turn */
  const fire = (f: Field, a: number, c: number) => {
    const by = f.turn
    const r = shoot(f, a, c)
    setBusy(true)
    if (by === 0) {
      trail.current = r.flight.path
      setShots((s) => s + 1)
    }
    const after = () => {
      show.current = null
      if (r.flight.burst) flash.current = { ...r.flight.burst, t: performance.now() }
      setField(r.field)
      const who = by === 0 ? 'You' : 'The computer'
      const hit = r.hurt[by === 0 ? 1 : 0]
      const self = r.hurt[by]
      const said = !r.flight.burst
        ? `${by === 0 ? 'Your' : 'Its'} shell sails over and off the field.`
        : r.flight.struck === (by === 0 ? 1 : 0)
          ? `A direct hit! ${hit} damage.`
          : hit
            ? `Close — ${hit} damage.`
            : self
              ? `${who} ${by === 0 ? 'hurt yourself' : 'hurts itself'}: ${self}.`
              : `${who} ${by === 0 ? 'miss' : 'misses'}.`
      if (r.field.winner !== null) {
        const won = r.field.winner === 0
        if (!recorded.current) {
          recorded.current = true
          const n = shots + (by === 0 ? 1 : 0)
          setSaved((s) => {
            const t = s.record[level]
            return {
              ...s,
              record: {
                ...s.record,
                [level]: {
                  won: t.won + (won ? 1 : 0),
                  lost: t.lost + (won ? 0 : 1),
                  fewest: won && (!t.fewest || n < t.fewest) ? n : t.fewest,
                },
              },
            }
          })
        }
        setLine(
          `${said} ${won ? '🏆 The other gun is out of action — you win!' : 'Your gun is out of action. The computer wins.'}`,
        )
        setBusy(false)
        return
      }
      if (r.field.turn === 1) {
        setLine(`${said} Now the ${windWords(r.field.wind)}. The computer takes aim…`)
        later(reduced() ? 300 : 900, () => {
          const s = gunner(r.field, level)
          fire(r.field, s.angle, s.charge)
        })
      } else {
        setLine(`${said} Your turn — ${windWords(r.field.wind)}.`)
        setBusy(false)
      }
    }
    if (reduced()) {
      show.current = { path: r.flight.path.slice(-2), t: 0, burst: r.flight.burst, after: () => {} }
      later(300, after)
    } else show.current = { path: r.flight.path, t: 0, burst: r.flight.burst, after }
  }

  const newGame = (lv: Level = saved.level) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    show.current = null
    trail.current = null
    recorded.current = false
    setLevel(lv)
    setShots(0)
    setBusy(false)
    const first: Who = field.winner === 0 || field.turn === 1 ? 1 : 0
    const f = newField((Math.random() * 2 ** 31) >>> 0, first)
    setField(f)
    if (first === 1) {
      setBusy(true)
      setLine(`A new field, and the computer fires first — ${windWords(f.wind)}.`)
      later(900, () => {
        const s = gunner(f, lv)
        fire(f, s.angle, s.charge)
      })
    } else setLine(`A new field. Your shot — ${windWords(f.wind)}.`)
  }

  /* -------------------------------------------------------------------- aiming by hand */

  const toField = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    const s = r.width / FIELD_W
    return { x: (e.clientX - r.left) / s, y: FIELD_H - (e.clientY - r.top) / s }
  }
  const aimAt = (p: { x: number; y: number }) => {
    const g = gunAt(fieldRef.current, 0)
    const dx = p.x - g.x
    const dy = p.y - g.y
    if (Math.hypot(dx, dy) < 0.02) return
    setAngle(
      Math.round(Math.max(5, Math.min(85, (Math.atan2(dy, Math.max(0.001, dx)) * 180) / Math.PI))),
    )
    setCharge(Math.round(Math.max(0.1, Math.min(1, Math.hypot(dx, dy) / 0.5)) * 100) / 100)
  }
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!yourTurn) return
    drag.current = true
    aimAt(toField(e))
  }
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current && yourTurn) aimAt(toField(e))
  }
  const onUp = () => {
    drag.current = false
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!yourTurn) return
    const fine = e.shiftKey ? 0.25 : 1
    if (e.key === 'ArrowLeft') setAngle((a) => Math.min(85, Math.round((a + fine) * 4) / 4))
    else if (e.key === 'ArrowRight') setAngle((a) => Math.max(5, Math.round((a - fine) * 4) / 4))
    else if (e.key === 'ArrowUp')
      setCharge((c) => Math.min(1, Math.round((c + 0.01 * fine * 4) * 100) / 100))
    else if (e.key === 'ArrowDown')
      setCharge((c) => Math.max(0.1, Math.round((c - 0.01 * fine * 4) * 100) / 100))
    else if (e.key === ' ' || e.key === 'Enter') fire(field, angle, charge)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const rec = saved.record[saved.level]
  const untouched = shots === 0 && field.turn === 0 && field.winner === null

  return (
    <div className={`lab-keys at-room is-${saved.sky}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer shoots">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (untouched || field.winner !== null) newGame(l)
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => newGame()}>
          ↻ New field
        </button>
      </div>
      <div className="dice-scores">
        {([0, 1] as Who[]).map((w) => (
          <div
            key={w}
            className={`dice-score${field.turn === w && field.winner === null ? ' is-up' : ''}`}
          >
            <span>{w === 0 ? 'Your gun' : `The computer · ${LEVEL_NAMES[level]}`}</span>
            <strong>{field.guns[w].life}</strong>
            <span className="at-life" aria-hidden>
              <span
                style={{ width: `${(field.guns[w].life / LIFE) * 100}%`, background: GUNS[w] }}
              />
            </span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="at-wrap"
        tabIndex={0}
        role="group"
        aria-label="The field. Drag from anywhere to aim your gun — the direction from your gun is the angle, the distance the charge. Keys: left and right turn the barrel, up and down set the charge, Space fires."
        onKeyDown={onKey}
      >
        <CanvasStage
          className="at-stage"
          label={`A field with two guns, ${windWords(field.wind)}. ${line}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          make={(ctx, c) => {
            let last = ''
            let lastField: Field | null = null
            return {
              frame: (dt) => {
                const sh = show.current
                if (sh) {
                  sh.t += dt * 60
                  if (sh.t * 2 >= sh.path.length / 2 - 1) sh.after()
                }
                const f = fieldRef.current
                const sv = savedRef.current
                const a = aimRef.current
                const fl = flash.current
                const flashing = fl && performance.now() - fl.t < (reduced() ? 600 : 450)
                const key = `${c.width}x${c.height}|${sv.sky}|${sv.trail}|${f.guns[0].life},${f.guns[1].life}|${a.angle},${a.charge}|${sh ? sh.t.toFixed(1) : ''}|${flashing ? performance.now() : ''}|${f.turn}|${f.wind}`
                // a field is replaced, never changed, so the object itself says whether it moved
                if (key === last && f === lastField) return
                last = key
                lastField = f
                const w = c.width
                const h = c.height
                const s = w / FIELD_W
                const X = (x: number) => x * s
                const Y = (y: number) => h - y * s
                const L = SKY[sv.sky]
                const sky = ctx.createLinearGradient(0, 0, 0, h)
                sky.addColorStop(0, L.top)
                sky.addColorStop(1, L.low)
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.fillStyle = sky
                ctx.fillRect(0, 0, w, h)
                ctx.fillStyle = L.hill
                ctx.beginPath()
                ctx.moveTo(0, h)
                for (let i = 0; i <= COLS; i++) ctx.lineTo(X(i * DX), Y(f.ground[i]))
                ctx.lineTo(w, h)
                ctx.fill()
                ctx.strokeStyle = L.rim
                ctx.lineWidth = Math.max(1.5, s * 0.004)
                ctx.beginPath()
                for (let i = 0; i <= COLS; i++) {
                  if (i) ctx.lineTo(X(i * DX), Y(f.ground[i]))
                  else ctx.moveTo(0, Y(f.ground[0]))
                }
                ctx.stroke()
                // the wind, as an arrow along the top
                const wx = w / 2
                const wy = h * 0.08
                const len = (f.wind / 0.35) * w * 0.12
                ctx.strokeStyle = 'rgba(255,255,255,0.85)'
                ctx.fillStyle = 'rgba(255,255,255,0.85)'
                ctx.lineWidth = 3
                ctx.beginPath()
                ctx.moveTo(wx - len, wy)
                ctx.lineTo(wx + len, wy)
                ctx.stroke()
                if (Math.abs(len) > 3) {
                  const d = Math.sign(len)
                  ctx.beginPath()
                  ctx.moveTo(wx + len + d * 8, wy)
                  ctx.lineTo(wx + len - d * 2, wy - 6)
                  ctx.lineTo(wx + len - d * 2, wy + 6)
                  ctx.fill()
                }
                ctx.font = `600 ${Math.max(11, s * 0.026)}px system-ui, sans-serif`
                ctx.textAlign = 'center'
                ctx.fillText(
                  f.wind === 0 ? 'calm' : `wind ${Math.abs(f.wind).toFixed(2)}`,
                  wx,
                  wy + 22,
                )
                // your last shell's path, to aim the next by
                if (sv.trail && trail.current && !sh) {
                  ctx.fillStyle = 'rgba(255,255,255,0.55)'
                  const p = trail.current
                  for (let i = 0; i < p.length; i += 8)
                    ctx.fillRect(X(p[i]) - 1.5, Y(p[i + 1]) - 1.5, 3, 3)
                }
                // the guns, each with its barrel
                for (const who of [0, 1] as Who[]) {
                  const g = gunAt(f, who)
                  const gx = X(g.x)
                  const gy = Y(g.y)
                  const r = GUN_R * s
                  const ang = who === 0 ? a.angle : 45
                  const dir = who === 0 ? 1 : -1
                  ctx.strokeStyle = '#222'
                  ctx.lineWidth = Math.max(3, r * 0.5)
                  ctx.beginPath()
                  ctx.moveTo(gx, gy)
                  ctx.lineTo(
                    gx + dir * Math.cos((ang * Math.PI) / 180) * r * 1.9,
                    gy - Math.sin((ang * Math.PI) / 180) * r * 1.9,
                  )
                  ctx.stroke()
                  ctx.fillStyle = f.guns[who].life > 0 ? GUNS[who] : '#555'
                  ctx.beginPath()
                  ctx.arc(gx, gy, r, Math.PI, 0)
                  ctx.fill()
                  ctx.fillRect(gx - r * 1.2, gy, r * 2.4, r * 0.7)
                }
                // the aim, as a short guide from your barrel, while it is your turn
                if (f.turn === 0 && f.winner === null && !sh) {
                  const g = gunAt(f, 0)
                  const rad = (a.angle * Math.PI) / 180
                  ctx.strokeStyle = 'rgba(255,255,255,0.8)'
                  ctx.setLineDash([4, 6])
                  ctx.lineWidth = 2
                  ctx.beginPath()
                  ctx.moveTo(X(g.x), Y(g.y))
                  ctx.lineTo(
                    X(g.x + Math.cos(rad) * a.charge * 0.5),
                    Y(g.y + Math.sin(rad) * a.charge * 0.5),
                  )
                  ctx.stroke()
                  ctx.setLineDash([])
                }
                // the shell in flight
                if (sh) {
                  const k = Math.min(sh.path.length / 2 - 1, Math.floor(sh.t * 2))
                  ctx.fillStyle = '#fff'
                  ctx.beginPath()
                  ctx.arc(
                    X(sh.path[k * 2]),
                    Y(sh.path[k * 2 + 1]),
                    Math.max(2.5, s * 0.006),
                    0,
                    Math.PI * 2,
                  )
                  ctx.fill()
                }
                // the burst: a ring, still under reduced motion and growing otherwise
                if (flashing && fl) {
                  const age = (performance.now() - fl.t) / 450
                  const rr = (reduced() ? 1 : 0.4 + age * 0.6) * 0.11 * s
                  ctx.strokeStyle = 'rgba(255,200,80,0.9)'
                  ctx.lineWidth = 4
                  ctx.beginPath()
                  ctx.arc(X(fl.x), Y(fl.y), rr, 0, Math.PI * 2)
                  ctx.stroke()
                }
              },
            }
          }}
        />
      </div>

      <div className="lab-controls" role="group" aria-label="Your aim">
        <span className="at-set">
          <button
            className="btn btn-ghost"
            aria-label="Raise the barrel"
            disabled={!yourTurn}
            onClick={() => setAngle((a) => Math.min(85, a + 1))}
          >
            ↺
          </button>
          <span className="at-read">Angle {angle}°</span>
          <button
            className="btn btn-ghost"
            aria-label="Lower the barrel"
            disabled={!yourTurn}
            onClick={() => setAngle((a) => Math.max(5, a - 1))}
          >
            ↻
          </button>
        </span>
        <span className="at-set">
          <button
            className="btn btn-ghost"
            aria-label="Less charge"
            disabled={!yourTurn}
            onClick={() => setCharge((c) => Math.max(0.1, Math.round((c - 0.02) * 100) / 100))}
          >
            −
          </button>
          <span className="at-read">Charge {Math.round(charge * 100)}%</span>
          <button
            className="btn btn-ghost"
            aria-label="More charge"
            disabled={!yourTurn}
            onClick={() => setCharge((c) => Math.min(1, Math.round((c + 0.02) * 100) / 100))}
          >
            +
          </button>
        </span>
        <button
          className="btn at-fire"
          disabled={!yourTurn}
          onClick={() => fire(field, angle, charge)}
        >
          💥 Fire
        </button>
      </div>
      {field.winner !== null && (
        <div className="lab-controls">
          <button className="btn" onClick={() => newGame()}>
            ↻ Play again
          </button>
        </div>
      )}

      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {rec.won}, lost {rec.lost}
          {rec.fewest ? ` · fewest shots to win ${rec.fewest}` : ''}
        </span>
      </p>
      {level !== saved.level && !untouched && field.winner === null && (
        <p className="muted mc-note">The new level starts with the next field.</p>
      )}
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Look</h3>
          <div className="lab-controls" role="group" aria-label="Sky">
            {SKIES.map((k) => (
              <button
                key={k}
                className="btn btn-ghost"
                aria-pressed={saved.sky === k}
                onClick={() => setSaved((s) => ({ ...s, sky: k }))}
              >
                {SKY[k].name}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.trail}
              onClick={() => setSaved((s) => ({ ...s, trail: !s.trail }))}
            >
              Show my last shot
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Two guns, turn about. Set your barrel’s angle and the charge — drag from anywhere on the
        field (the direction from your gun is the angle, the distance the charge), or use the
        buttons or keys — and fire. Gravity pulls the shell down and the wind, which changes a
        little every turn, pushes it sideways. A shell digs a crater where it lands, and a gun whose
        ground is dug away drops into the hole. A direct hit does the most; a near one less. Three
        good hits win. The computer works out the shot that would land on you exactly; Easy, Fair
        and Hard differ in how steady their hand is.
      </p>
    </div>
  )
}
