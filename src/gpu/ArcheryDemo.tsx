import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { here } from '../lab/links'
import { CanvasStage } from './CanvasStage'
import {
  ARCHERY_KEY,
  ARROWS_PER_END,
  BOWS,
  FACES,
  FACE_R,
  FLETCHES,
  RING,
  ROUNDS,
  dailySeed,
  dayKey,
  flight,
  land,
  maxScore,
  readSaved,
  scoreAt,
  sway,
  winds,
  type Bow,
  type RoundName,
  type Saved,
} from './archery'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

type Mode = 'daily' | 'practice'
type Phase = 'aim' | 'fly' | 'end' | 'over'
type Shot = { x: number; y: number; ring: number; x10: boolean }
const STAMINA = 2.5

const ROUND_NAMES: Record<RoundName, string> = {
  short: 'Short (18–25 m)',
  standard: 'Standard (30–90 m)',
  long: 'Long (50–110 m)',
}
const FACE_NAMES: Record<Saved['face'], string> = {
  target: 'Target',
  field: 'Field',
  bullseye: 'Bullseye',
}
const FLETCH_NAMES = ['Red', 'Yellow', 'Blue', 'Green', 'Violet', 'White']
const RINGS: Record<Saved['face'], string[]> = {
  // from the outside in, two rings a colour
  target: [
    '#f4f4f0',
    '#f4f4f0',
    '#1a1a1a',
    '#1a1a1a',
    '#2f86d6',
    '#2f86d6',
    '#e0303a',
    '#e0303a',
    '#f5d020',
    '#f5d020',
  ],
  field: [
    '#1a1a1a',
    '#1a1a1a',
    '#1a1a1a',
    '#1a1a1a',
    '#1a1a1a',
    '#1a1a1a',
    '#f4f4f0',
    '#f4f4f0',
    '#f4f4f0',
    '#f5d020',
  ],
  bullseye: [
    '#f4f4f0',
    '#d7263d',
    '#f4f4f0',
    '#d7263d',
    '#f4f4f0',
    '#d7263d',
    '#f4f4f0',
    '#d7263d',
    '#f4f4f0',
    '#d7263d',
  ],
}

type Live = {
  mode: Mode
  bow: Bow
  round: RoundName
  ws: number[]
  shots: Shot[]
  /** the aim, in metres on the face, before sway */
  aim: { x: number; y: number }
  held: number
  phase0: number
  stamina: number
  steady: boolean
  flying: { from: { x: number; y: number }; to: Shot; at: number; time: number } | null
}

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  L: Live,
  s: Saved,
  phase: Phase,
  now: number,
): { px: number; cx: number; cy: number } {
  const arrow = L.shots.length
  const end = Math.min(ROUNDS[L.round].length - 1, Math.floor(arrow / ARROWS_PER_END))
  const d = ROUNDS[L.round][end]
  // sky and grass, then the boss with the face on it, smaller the further off it stands
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#bfe0f5')
  g.addColorStop(0.55, '#e6f2e0')
  g.addColorStop(0.56, '#6fae4f')
  g.addColorStop(1, '#4f8f36')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  const px = (Math.min(w, h) * 0.42 * 30) / Math.max(30, d) / FACE_R
  const cx = w / 2
  const cy = h * 0.45
  ctx.fillStyle = '#d9c08a'
  ctx.fillRect(
    cx - FACE_R * px * 1.25,
    cy - FACE_R * px * 1.25,
    FACE_R * px * 2.5,
    FACE_R * px * 2.5,
  )
  ctx.fillStyle = '#8a6b3d'
  ctx.fillRect(cx - FACE_R * px * 0.9, cy + FACE_R * px * 1.25, FACE_R * px * 0.15, h)
  ctx.fillRect(cx + FACE_R * px * 0.75, cy + FACE_R * px * 1.25, FACE_R * px * 0.15, h)
  RINGS[s.face].forEach((colour, k) => {
    ctx.fillStyle = colour
    ctx.beginPath()
    ctx.arc(cx, cy, (10 - k) * RING * px, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'
    ctx.lineWidth = 1
    ctx.stroke()
  })
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.beginPath()
  ctx.moveTo(cx - 3, cy)
  ctx.lineTo(cx + 3, cy)
  ctx.moveTo(cx, cy - 3)
  ctx.lineTo(cx, cy + 3)
  ctx.stroke()
  // this end's arrows, in the face
  const first = end * ARROWS_PER_END
  const inEnd = L.shots.slice(first, first + ARROWS_PER_END)
  for (const sh of inEnd) {
    if (L.flying && sh === L.flying.to) continue
    const x = cx + sh.x * px
    const y = cy - sh.y * px
    ctx.fillStyle = '#222'
    ctx.beginPath()
    ctx.arc(x, y, Math.max(2, px * 0.012), 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = FLETCHES[s.fletch]
    ctx.lineWidth = Math.max(2, px * 0.012)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.max(6, px * 0.05), y + Math.max(6, px * 0.05))
    ctx.stroke()
  }
  // the arrow in the air: from the bottom of the view to where it lands, shrinking as it goes
  if (L.flying) {
    const t = Math.min(1, (now - L.flying.at) / (L.flying.time * 1000))
    const x0 = cx
    const y0 = h * 1.1
    const x1 = cx + L.flying.to.x * px
    const y1 = cy - L.flying.to.y * px
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * h * 0.12
    ctx.strokeStyle = '#3b2a1a'
    ctx.lineWidth = Math.max(1.5, 6 * (1 - t) + 1)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 30 * (1 - t) + 4, y + 40 * (1 - t) + 4)
    ctx.stroke()
  }
  // the sight: the aim plus the sway, and where the drop will take the arrow if asked
  if (phase === 'aim') {
    const sw = sway(L.held, L.bow, d, L.steady, L.phase0)
    const x = cx + (L.aim.x + sw.x) * px
    const y = cy - (L.aim.y + sw.y) * px
    ctx.strokeStyle = '#0b0b0b'
    ctx.lineWidth = 2
    const r = Math.max(14, RING * px * 1.4)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.moveTo(x - r * 1.6, y)
    ctx.lineTo(x - r * 0.4, y)
    ctx.moveTo(x + r * 0.4, y)
    ctx.lineTo(x + r * 1.6, y)
    ctx.moveTo(x, y - r * 1.6)
    ctx.lineTo(x, y - r * 0.4)
    ctx.moveTo(x, y + r * 0.4)
    ctx.lineTo(x, y + r * 1.6)
    ctx.stroke()
    if (s.sightPin) {
      const f = flight(L.bow, d, 0)
      ctx.fillStyle = '#ff2fd0'
      ctx.beginPath()
      ctx.arc(x, y + f.drop * px, Math.max(3, r * 0.18), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  return { px, cx, cy }
}

export function ArcheryDemo() {
  const [saved, setSaved] = useKept(ARCHERY_KEY, readSaved)
  const today = dayKey(new Date())
  const playedToday = saved.daily?.day === today
  const [mode, setMode] = useState<Mode>(playedToday ? 'practice' : 'daily')
  const [phase, setPhase] = useState<Phase>('aim')
  const make = (m: Mode, s: Saved): Live => ({
    mode: m,
    bow: m === 'daily' ? 'recurve' : s.bow,
    round: m === 'daily' ? 'standard' : s.round,
    ws:
      m === 'daily'
        ? winds(dailySeed(new Date()), 'standard')
        : winds((Math.random() * 2 ** 32) >>> 0, s.round),
    shots: [],
    aim: { x: 0, y: 0 },
    held: 0,
    phase0: Math.random() * 6,
    stamina: STAMINA,
    steady: false,
    flying: null,
  })
  const live = useRef<Live>(make(mode, saved))
  const [, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)
  const [line, setLine] = useState(
    mode === 'daily'
      ? "Today's round — the same wind for everyone. Aim, then loose."
      : 'Practice — aim, then loose.',
  )
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const savedRef = useRef(saved)
  savedRef.current = saved
  const view = useRef<{ px: number; cx: number; cy: number } | null>(null)
  const keys = useRef(new Set<string>())
  /** the steady button, held down */
  const holding = useRef(false)
  const staminaRef = useRef<HTMLSpanElement | null>(null)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const L = live.current
  const ends = ROUNDS[L.round]
  const arrowNo = L.shots.length
  const endNo = Math.min(ends.length - 1, Math.floor(arrowNo / ARROWS_PER_END))
  const dist = ends[endNo]
  const wind = L.ws[Math.min(arrowNo, L.ws.length - 1)]
  const total = L.shots.reduce((a, sh) => a + sh.ring, 0)
  const bestKey = `${L.bow}/${L.round}`

  const start = (m: Mode, s: Saved = saved) => {
    window.clearTimeout(timer.current)
    setMode(m)
    if (m === 'daily' && s.daily?.day === today) {
      live.current = make(m, s)
      setPhase('over')
      setLine(
        `You shot today's round: ${s.daily.total} of ${maxScore('standard')}. A new one comes tomorrow.`,
      )
      return
    }
    live.current = make(m, s)
    setPhase('aim')
    setLine(
      m === 'daily'
        ? "Today's round — the same wind for everyone. Aim, then loose."
        : 'Practice — aim, then loose.',
    )
  }
  const loose = () => {
    if (phaseRef.current !== 'aim') return
    const Lv = live.current
    const d = ROUNDS[Lv.round][Math.floor(Lv.shots.length / ARROWS_PER_END)]
    const w = Lv.ws[Lv.shots.length]
    const sw = sway(Lv.held, Lv.bow, d, Lv.steady, Lv.phase0)
    const at = land({ x: Lv.aim.x + sw.x, y: Lv.aim.y + sw.y }, Lv.bow, d, w)
    const sc = scoreAt(at.x, at.y)
    const shot: Shot = { x: at.x, y: at.y, ring: sc.ring, x10: sc.x }
    Lv.shots.push(shot)
    const time = flight(Lv.bow, d, w).time * 1.4
    const settle = () => {
      Lv.flying = null
      Lv.held = 0
      Lv.phase0 = Math.random() * 6
      const n = Lv.shots.length
      const said = sc.ring ? `${sc.x ? 'X — ' : ''}${sc.ring}` : 'a miss'
      if (n >= ROUNDS[Lv.round].length * ARROWS_PER_END) {
        const tot = Lv.shots.reduce((a, s2) => a + s2.ring, 0)
        setPhase('over')
        setSaved((s) => ({
          ...s,
          best: {
            ...s.best,
            [`${Lv.bow}/${Lv.round}`]: Math.max(s.best[`${Lv.bow}/${Lv.round}`] ?? 0, tot),
          },
          daily: Lv.mode === 'daily' ? { day: today, total: tot } : s.daily,
        }))
        setLine(`${said}. Round over: ${tot} of ${maxScore(Lv.round)}.`)
      } else if (n % ARROWS_PER_END === 0) {
        setPhase('end')
        const endTot = Lv.shots.slice(n - ARROWS_PER_END).reduce((a, s2) => a + s2.ring, 0)
        setLine(
          `${said}. End ${n / ARROWS_PER_END} scored ${endTot}. Tap or press Space to walk to ${ROUNDS[Lv.round][n / ARROWS_PER_END]} m.`,
        )
      } else {
        setPhase('aim')
        setLine(`${said}.`)
      }
      bump()
    }
    if (reduced()) settle()
    else {
      Lv.flying = { from: Lv.aim, to: shot, at: performance.now(), time }
      setPhase('fly')
      timer.current = window.setTimeout(settle, time * 1000 + 120)
    }
  }
  const next = () => {
    if (phase === 'end') {
      live.current.aim = { x: 0, y: 0 }
      setPhase('aim')
      setLine('Aim, then loose.')
    }
  }

  const toFace = (e: PointerEvent<HTMLCanvasElement>, lift: number) => {
    const v = view.current
    if (!v) return null
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * c.width
    const py = ((e.clientY - r.top) / r.height) * c.height - lift * (c.height / r.height)
    return { x: (px - v.cx) / v.px, y: (v.cy - py) / v.px }
  }
  const clampAim = (a: { x: number; y: number }) => ({
    x: Math.max(-FACE_R * 2, Math.min(FACE_R * 2, a.x)),
    y: Math.max(-FACE_R * 2, Math.min(FACE_R * 2, a.y)),
  })
  /** a finger aims a little above itself, so it does not hide what it is aiming at */
  const touching = useRef(false)
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    // a tap on the range walks on between ends, but never throws away a finished round's card
    if (phaseRef.current === 'end') return next()
    if (phaseRef.current !== 'aim') return
    if (e.pointerType !== 'mouse') {
      touching.current = true
      const a = toFace(e, 70)
      if (a) live.current.aim = clampAim(a)
    } else loose()
  }
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (phaseRef.current !== 'aim') return
    if (e.pointerType === 'mouse') {
      const a = toFace(e, 0)
      if (a) live.current.aim = clampAim(a)
    } else if (touching.current) {
      const a = toFace(e, 70)
      if (a) live.current.aim = clampAim(a)
    }
  }
  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== 'mouse' && touching.current) {
      touching.current = false
      loose()
    }
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift'].includes(e.key)) {
      if (e.key !== 'Shift') {
        e.preventDefault()
        e.stopPropagation()
      }
      if (down) keys.current.add(e.key)
      else keys.current.delete(e.key)
    } else if (down && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault()
      if (phaseRef.current === 'aim') loose()
      else if (phaseRef.current === 'end') next()
    }
  }

  const share =
    mode === 'daily' && phase === 'over' && L.shots.length
      ? `🏹 Archery ${today}: ${total}/${maxScore('standard')}\n${ROUNDS.standard
          .map((_, e) =>
            L.shots
              .slice(e * 3, e * 3 + 3)
              .map((sh) =>
                sh.ring >= 9
                  ? '🟡'
                  : sh.ring >= 7
                    ? '🔴'
                    : sh.ring >= 5
                      ? '🔵'
                      : sh.ring
                        ? '⚫'
                        : '✖️',
              )
              .join(''),
          )
          .join(' ')}\n${here()}#lab?demo=archery`
      : ''

  return (
    <div className="lab-keys ar-room">
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="What to shoot">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'daily'}
            onClick={() => start('daily')}
          >
            📅 Today’s round
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'practice'}
            onClick={() => start('practice')}
          >
            Practice
          </button>
        </div>
        {mode === 'practice' && (
          <button className="btn btn-ghost" onClick={() => start('practice')}>
            ↻ New round
          </button>
        )}
      </div>

      <div className="ar-hud">
        <span>
          End <strong>{endNo + 1}</strong>/{ends.length} · arrow{' '}
          <strong>{(arrowNo % ARROWS_PER_END) + 1}</strong>
        </span>
        <span>
          <strong>{dist} m</strong>
        </span>
        <span
          aria-label={`Wind ${Math.abs(wind)} metres a second ${wind > 0 ? 'to the right' : wind < 0 ? 'to the left' : ''}`}
        >
          Wind {wind < 0 ? '←' : wind > 0 ? '→' : '·'} <strong>{Math.abs(wind).toFixed(1)}</strong>{' '}
          m/s
        </span>
        <span>
          Total <strong>{total}</strong>
          {saved.best[bestKey] ? (
            <span className="muted"> · best {saved.best[bestKey]}</span>
          ) : null}
        </span>
      </div>

      <div
        className="ar-wrap"
        tabIndex={0}
        role="group"
        aria-label="The range. Arrow keys aim, Shift steadies, Space looses."
        onKeyDown={(e) => onKey(e, true)}
        onKeyUp={(e) => onKey(e, false)}
        onBlur={() => keys.current.clear()}
      >
        <CanvasStage
          className="ar-stage"
          label={`An archery target at ${dist} metres; ${total} points so far.`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          make={(ctx, c) => {
            let key = ''
            return {
              frame: (dt) => {
                const Lv = live.current
                const s = savedRef.current
                const ph = phaseRef.current
                const still = reduced()
                if (ph === 'aim' && dt > 0) {
                  Lv.held += dt
                  const k = keys.current
                  const step = 0.35 * dt
                  if (k.has('ArrowLeft')) Lv.aim.x -= step
                  if (k.has('ArrowRight')) Lv.aim.x += step
                  if (k.has('ArrowUp')) Lv.aim.y += step
                  if (k.has('ArrowDown')) Lv.aim.y -= step
                  const want = k.has('Shift') || holding.current
                  Lv.steady = want && Lv.stamina > 0
                  Lv.stamina = Math.max(
                    0,
                    Math.min(STAMINA, Lv.stamina + (Lv.steady ? -dt : dt * 0.5)),
                  )
                }
                // held still, nothing sways: the sight is drawn where it rests
                if (still && ph === 'aim') Lv.held = 1
                const k2 = `${c.width}x${c.height}|${ph}|${Lv.shots.length}|${s.face}${s.fletch}${s.sightPin}`
                if (still && k2 === key && ph !== 'fly') return
                key = k2
                view.current = draw(ctx, c.width, c.height, Lv, s, ph, performance.now())
                if (staminaRef.current)
                  staminaRef.current.style.width = `${(Lv.stamina / STAMINA) * 100}%`
              },
            }
          }}
        />
      </div>
      <div className="ar-steady">
        <button
          className="btn btn-ghost"
          onPointerDown={() => (holding.current = true)}
          onPointerUp={() => (holding.current = false)}
          onPointerLeave={() => (holding.current = false)}
          aria-label="Hold to steady the sight"
        >
          🫁 Hold to steady
        </button>
        <span className="ar-stamina" aria-hidden>
          <span ref={staminaRef} />
        </span>
        <button
          className="btn"
          onClick={() =>
            phase === 'aim'
              ? loose()
              : phase === 'end'
                ? next()
                : phase === 'over'
                  ? start('practice')
                  : undefined
          }
          disabled={phase === 'fly'}
        >
          {phase === 'aim' || phase === 'fly'
            ? '🏹 Loose'
            : phase === 'end'
              ? 'Next end →'
              : mode === 'daily'
                ? 'Practise now →'
                : '↻ Another round'}
        </button>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <table className="ar-card">
        <caption className="sr-only">Score card</caption>
        <thead>
          <tr>
            <th scope="col">End</th>
            <th scope="col">Distance</th>
            <th scope="col">Arrows</th>
            <th scope="col">Score</th>
          </tr>
        </thead>
        <tbody>
          {ends.map((d, e) => {
            const sh = L.shots.slice(e * ARROWS_PER_END, (e + 1) * ARROWS_PER_END)
            return (
              <tr key={e} className={e === endNo && phase !== 'over' ? 'is-now' : undefined}>
                <td>{e + 1}</td>
                <td>{d} m</td>
                <td>{sh.map((x) => (x.x10 ? 'X' : x.ring || 'M')).join(' · ')}</td>
                <td>{sh.length ? sh.reduce((a, x) => a + x.ring, 0) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {share && <CopyLink text={share} label="🔗 Copy today’s round" />}

      <div className="fw-panel">
        <section aria-label="Your bow">
          <h3 className="fw-h">
            Your bow{' '}
            {mode === 'daily' && (
              <span className="muted">(today’s round is always a recurve at 30–90 m)</span>
            )}
          </h3>
          <div className="lab-controls" role="group" aria-label="Bow">
            {(Object.keys(BOWS) as Bow[]).map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={saved.bow === b}
                onClick={() => setSaved((s) => ({ ...s, bow: b }))}
              >
                {BOWS[b].label}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Round">
            {(Object.keys(ROUNDS) as RoundName[]).map((r) => (
              <button
                key={r}
                className="btn btn-ghost"
                aria-pressed={saved.round === r}
                onClick={() => setSaved((s) => ({ ...s, round: r }))}
              >
                {ROUND_NAMES[r]}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.sightPin}
              onClick={() => setSaved((s) => ({ ...s, sightPin: !s.sightPin }))}
            >
              Show the drop on the sight
            </button>
          </div>
        </section>
        <section aria-label="Target and arrows">
          <h3 className="fw-h">Target and arrows</h3>
          <div className="lab-controls" role="group" aria-label="Target face">
            {FACES.map((f) => (
              <button
                key={f}
                className="btn btn-ghost"
                aria-pressed={saved.face === f}
                onClick={() => setSaved((s) => ({ ...s, face: f }))}
              >
                {FACE_NAMES[f]}
              </button>
            ))}
          </div>
          <div className="fw-swatches" role="group" aria-label="Fletching">
            <span className="fw-label">Fletching</span>
            {FLETCHES.map((c, i) => (
              <button
                key={c}
                className="fw-swatch"
                style={{ background: c }}
                aria-label={`${FLETCH_NAMES[i]} fletching`}
                aria-pressed={saved.fletch === i}
                onClick={() => setSaved((s) => ({ ...s, fletch: i }))}
              />
            ))}
          </div>
        </section>
      </div>
      {mode === 'practice' && (L.bow !== saved.bow || L.round !== saved.round) && (
        <p className="muted mc-note">Your bow and round change with the next round.</p>
      )}
      <p className="muted lab-hint">
        Twelve arrows, three an end, each end further back. Your sight sways — it settles for a
        moment and then your arm tires — so steady it (hold Shift, or the button) while your breath
        lasts and loose when it crosses the gold. The sight is set for 50 m: closer in an arrow
        lands high, further off it drops, and the pink dot shows by how much. The wind pushes it
        sideways, more the further it flies: aim into it. A compound bow shoots fastest and sways
        least; a longbow is slow and lively. Today’s round has the same wind for everyone and can be
        shot once a day. On a phone, press on the range to aim (the sight sits above your finger)
        and lift to loose; with a mouse, click; on keys, arrows aim and Space looses.
      </p>
    </div>
  )
}
