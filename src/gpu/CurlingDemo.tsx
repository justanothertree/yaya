import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  BACK,
  CURLING_KEY,
  END_COUNTS,
  HALF_W,
  HOG,
  HOUSE_R,
  ICES,
  LEVELS,
  STEP,
  STONES_EACH,
  STONE_R,
  TEE,
  after,
  choose,
  count,
  deliver,
  drawTo,
  fromButton,
  hitAt,
  inHouse,
  left,
  lineOf,
  moving,
  newGame,
  readSaved,
  settle,
  step,
  throwPlan,
  toThrow,
  totals,
  winner,
  wobble,
  type Game,
  type Level,
  type Plan,
  type Saved,
  type Shot,
  type Stone,
  type Team,
} from './curling'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const ICE: Record<
  Saved['ice'],
  { name: string; ice: string; line: string; outer: string; inner: string; pad: string }
> = {
  arena: {
    name: 'Arena',
    ice: '#eef4f8',
    line: '#9fb3c4',
    outer: '#2f6fd1',
    inner: '#d6363c',
    pad: '#ffffff',
  },
  pond: {
    name: 'Pond',
    ice: '#d7e9ef',
    line: '#86a8b5',
    outer: '#2d8a5a',
    inner: '#e0a92a',
    pad: '#eef7f9',
  },
  night: {
    name: 'Night',
    ice: '#16212d',
    line: '#3b5266',
    outer: '#22b7c9',
    inner: '#e0459b',
    pad: '#0e1620',
  },
}
const STONES = ['#f2c230', '#d6363c']
/** how much of the sheet is in view: from just short of the far hog line to past the back line */
const VIEW_L = 8.5
const AIM_LEFT = HOG - 0.3
type Weight = 'draw' | 'hit' | 'peel'
const WEIGHTS: { id: Weight; name: string; speed: number }[] = [
  { id: 'draw', name: 'Draw', speed: 0 },
  { id: 'hit', name: 'Hit', speed: 5.6 },
  { id: 'peel', name: 'Hit hard', speed: 7 },
]
const shotFor = (mark: { x: number; y: number }, spin: 1 | -1, weight: Weight): Shot =>
  weight === 'draw'
    ? drawTo(mark, spin)
    : hitAt(mark, spin, WEIGHTS.find((w) => w.id === weight)!.speed)
const clampMark = (m: { x: number; y: number }) => ({
  x: Math.max(-HALF_W + 0.25, Math.min(HALF_W - 0.25, m.x)),
  y: Math.max(HOG + 0.3, Math.min(BACK - 0.05, m.y)),
})
/** the lie in words, for the line and for a screen reader */
function lieWords(stones: readonly Stone[]): string {
  const c = count(stones)
  const near = stones.filter(inHouse).sort((a, b) => fromButton(a) - fromButton(b))[0]
  if (c.team === null) return 'Nothing in the house.'
  const who = c.team === 0 ? 'You lie' : 'The computer lies'
  return `${who} ${c.points} — ${c.team === 0 ? 'your' : 'its'} best stone ${fromButton(near).toFixed(1)} m from the button.`
}
type Live = {
  stones: Stone[]
  thrown: Stone
  knocked: Set<Stone>
  by: Team
  /** the computer's stones play back a slide worked out in advance */
  frames?: Stone[][]
  t: number
  final?: Stone[]
}

export function CurlingDemo() {
  const [saved, setSaved] = useKept(CURLING_KEY, readSaved)
  const [level, setLevel] = useState<Level>(saved.level)
  // the computer has the hammer in your first game, so you throw first; after that it alternates
  const [game, setGame] = useState<Game>(() => newGame(saved.ends, 1))
  /** the stones as they lie, between throws; the ice is shown from this */
  const [lie, setLie] = useState<Stone[]>([])
  const [mark, setMark] = useState({ x: 0, y: TEE })
  const [spin, setSpin] = useState<1 | -1>(1)
  const [weight, setWeight] = useState<Weight>('draw')
  const [busy, setBusy] = useState(false)
  const [sliding, setSliding] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const [line, setLine] = useState(
    'The computer has the hammer — the last stone of each end until someone scores — so you throw first. Tap the ice where you want your stone to stop, choose which way it turns, and throw. Hold Sweep while it slides to carry it further and straighter.',
  )
  const gameRef = useRef(game)
  gameRef.current = game
  const lieRef = useRef(lie)
  lieRef.current = lie
  const aimRef = useRef({ mark, spin, weight, busy })
  aimRef.current = { mark, spin, weight, busy }
  const savedRef = useRef(saved)
  savedRef.current = saved
  const live = useRef<Live | null>(null)
  const sweepRef = useRef(false)
  const cam = useRef(AIM_LEFT)
  const timers = useRef<number[]>([])
  const drag = useRef(false)
  const recorded = useRef(false)
  const firstHammer = useRef<Team>(1)
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
  const setSweep = (on: boolean) => {
    sweepRef.current = on
    setSweeping(on)
  }

  const yourTurn = !busy && !game.over && toThrow(game) === 0
  const [youTotal, itTotal] = totals(game)
  const endNo = game.scores.length + 1

  /** a stone has come to rest: the next throw, or the end scored, or the game over */
  const rested = (stones: Stone[], by: Team) => {
    live.current = null
    setSliding(false)
    setSweep(false)
    setLie(stones)
    const g = gameRef.current
    const r = after(g, stones)
    // a throw that leaves its side no more stones in play than before went out, or took its own
    const mine = (xs: readonly Stone[]) => xs.filter((x) => x.team === by).length
    const gone =
      mine(stones) <= mine(g.stones) ? `${by === 0 ? 'Your' : 'Its'} stone is out of play. ` : ''
    const said = gone + lieWords(stones)
    if (!r.ended) {
      setGame(r.game)
      if (toThrow(r.game) === 1) {
        setLine(`${said} The computer is reading the ice…`)
        computer(r.game)
      } else {
        setLine(`${said} Your stone — ${left(r.game, 0)} to come.`)
        setBusy(false)
      }
      return
    }
    const e = r.ended
    const endWords =
      e.team === null
        ? `A blank end — ${g.hammer === 0 ? 'you keep' : 'the computer keeps'} the hammer.`
        : e.team === 0
          ? `You score ${e.points} in end ${r.game.scores.length}.`
          : `The computer scores ${e.points} in end ${r.game.scores.length}.`
    if (r.game.over) {
      setGame(r.game)
      const w = winner(r.game)
      const [a, b] = totals(r.game)
      if (!recorded.current) {
        recorded.current = true
        const best = Math.max(0, ...r.game.scores.map((s) => s[0]))
        setSaved((s) => {
          const t = s.record[level]
          return {
            ...s,
            record: {
              ...s.record,
              [level]: {
                won: t.won + (w === 0 ? 1 : 0),
                lost: t.lost + (w === 1 ? 1 : 0),
                drawn: t.drawn + (w === 'draw' ? 1 : 0),
                bestEnd: Math.max(t.bestEnd, best),
              },
            },
          }
        })
      }
      setLine(
        `${endWords} ${w === 0 ? `🏆 You win ${a}–${b}!` : w === 1 ? `The computer wins ${b}–${a}.` : `Level at ${a}–${b} after the extra end: a draw.`}`,
      )
      setBusy(false)
      return
    }
    const extra = r.game.scores.length >= r.game.ends ? ' Level — one extra end.' : ''
    setLine(`${endWords}${extra} The stones come off…`)
    later(reduced() ? 1400 : 2200, () => {
      setLie([])
      setGame(r.game)
      if (toThrow(r.game) === 1) {
        setLine(`End ${r.game.scores.length + 1}: the computer throws first.`)
        computer(r.game)
      } else {
        setLine(
          `End ${r.game.scores.length + 1}: you throw first; the computer has the hammer.${extra}`,
        )
        setBusy(false)
      }
    })
  }
  const restedRef = useRef(rested)
  restedRef.current = rested

  const KIND_WORDS: Record<Plan['kind'], string> = {
    draw: 'draws into the house',
    guard: 'puts up a guard',
    hit: 'throws a hit',
  }
  const computer = (g: Game) => {
    setBusy(true)
    later(reduced() ? 300 : 800, () => {
      const last = g.thrown === STONES_EACH * 2 - 1
      const plan = choose(g.stones, 1, level, last, Math.random)
      const r = throwPlan(g.stones, plan, 1, level, Math.random, !reduced())
      setLine(`The computer ${KIND_WORDS[plan.kind]}…`)
      if (reduced()) later(300, () => restedRef.current(r.stones, 1))
      else {
        live.current = {
          stones: r.frames[0] ?? r.stones,
          thrown: r.frames[0]?.[r.frames[0].length - 1] ?? r.stones[0],
          knocked: new Set(),
          by: 1,
          frames: r.frames,
          t: 0,
          final: r.stones,
        }
      }
    })
  }

  const throwIt = () => {
    if (!yourTurn) return
    const planned = shotFor(mark, spin, weight)
    // your hand strays as much as Fair's does, and on average a touch light — about 40cm short of a
    // draw to the button — as a curler throws, so that sweeping is how a stone is brought home
    const w = wobble(planned, 'fair', Math.random)
    const shot = { ...w, speed: w.speed * 0.985 }
    const stones = deliver(game.stones, shot, 0)
    live.current = {
      stones,
      thrown: stones[stones.length - 1],
      knocked: new Set(),
      by: 0,
      t: 0,
    }
    setBusy(true)
    setSliding(true)
    setLine('Away it goes — hold Sweep to carry it further and straighter.')
  }

  const start = (lv: Level = saved.level, ends = saved.ends) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    live.current = null
    recorded.current = false
    setSliding(false)
    setSweep(false)
    setLevel(lv)
    setLie([])
    setBusy(false)
    setMark({ x: 0, y: TEE })
    setWeight('draw')
    // the first end's hammer goes to each side in turn, game by game
    firstHammer.current = firstHammer.current === 1 ? 0 : 1
    const g = newGame(ends, firstHammer.current)
    setGame(g)
    if (g.hammer === 1) setLine('A new game, and the computer has the hammer: you throw first.')
    else {
      setLine('A new game. You have the hammer, so the computer throws first.')
      computer(g)
    }
  }

  /* -------------------------------------------------------------------- the ice by hand */

  const toIce = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    const s = r.width / VIEW_L
    return { y: cam.current + (e.clientX - r.left) / s, x: (e.clientY - r.top - r.height / 2) / s }
  }
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!yourTurn) return
    drag.current = true
    setMark(clampMark(toIce(e)))
  }
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current && yourTurn) setMark(clampMark(toIce(e)))
  }
  const onUp = () => {
    drag.current = false
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' && sliding) {
      if (!e.repeat || sweepRef.current) setSweep(true)
    } else if (!yourTurn) return
    else {
      const d = e.shiftKey ? 0.02 : 0.1
      if (e.key === 'ArrowLeft') setMark((m) => clampMark({ ...m, y: m.y - d }))
      else if (e.key === 'ArrowRight') setMark((m) => clampMark({ ...m, y: m.y + d }))
      else if (e.key === 'ArrowUp') setMark((m) => clampMark({ ...m, x: m.x - d }))
      else if (e.key === 'ArrowDown') setMark((m) => clampMark({ ...m, x: m.x + d }))
      else if (e.key === 't' || e.key === 'T') setSpin((s) => (s === 1 ? -1 : 1))
      else if (e.key === 'w' || e.key === 'W')
        setWeight((w) => WEIGHTS[(WEIGHTS.findIndex((x) => x.id === w) + 1) % WEIGHTS.length].id)
      else if ((e.key === ' ' && !e.repeat) || e.key === 'Enter') throwIt()
      else return
    }
    e.preventDefault()
    e.stopPropagation()
  }
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ') setSweep(false)
  }

  const rec = saved.record[saved.level]
  const untouched = game.thrown === 0 && game.scores.length === 0 && !busy
  const stonesLeft = (t: Team) => (game.over ? 0 : left(game, t))
  const pips = (t: Team) =>
    Array.from({ length: STONES_EACH }, (_, i) => (i < stonesLeft(t) ? '●' : '○')).join('')

  return (
    <div className={`lab-keys cu-room is-${saved.ice}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer throws">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (untouched || game.over) start(l)
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="How many ends">
          {END_COUNTS.map((n) => (
            <button
              key={n}
              className="btn btn-ghost"
              aria-pressed={saved.ends === n}
              onClick={() => {
                setSaved((s) => ({ ...s, ends: n }))
                if (untouched || game.over) start(saved.level, n)
              }}
            >
              {n} ends
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => start()}>
          ↻ New game
        </button>
      </div>
      <div className="dice-scores">
        {([0, 1] as Team[]).map((t) => (
          <div key={t} className={`dice-score${!game.over && toThrow(game) === t ? ' is-up' : ''}`}>
            <span>
              <span className="cu-dot" style={{ background: STONES[t] }} aria-hidden />
              {t === 0 ? 'You' : `The computer · ${LEVEL_NAMES[level]}`}
              {game.hammer === t && !game.over ? ' · hammer' : ''}
            </span>
            <strong>{t === 0 ? youTotal : itTotal}</strong>
            <span className="muted" aria-label={`${stonesLeft(t)} stones to come this end`}>
              {pips(t)}
            </span>
          </div>
        ))}
        <div className="dice-score">
          <span>End</span>
          <strong>
            {game.over ? '—' : endNo > game.ends ? 'Extra' : `${endNo} of ${game.ends}`}
          </strong>
          <span className="muted">
            {game.scores.map((s) => `${s[0]}–${s[1]}`).join(' · ') || 'no ends yet'}
          </span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="cu-wrap"
        tabIndex={0}
        role="group"
        aria-label="The sheet, the house on the right. Tap or drag on the ice to mark where your stone should stop. Keys: arrows move the mark, T changes the turn, W the weight, Enter throws, and Space throws or, while it slides, sweeps for as long as it is held."
        onKeyDown={onKey}
        onKeyUp={onKeyUp}
        onBlur={() => setSweep(false)}
      >
        <CanvasStage
          className="cu-stage"
          label={`The house. ${lieWords(lie)}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          make={(ctx, c) => {
            let last = ''
            return {
              frame: (dt) => {
                const lv = live.current
                // advance whatever is sliding
                if (lv) {
                  if (lv.frames) {
                    lv.t += dt * 60
                    const i = Math.min(lv.frames.length - 1, Math.floor(lv.t))
                    lv.stones = lv.frames[i]
                    const by = lv.stones.filter((s) => s.team === 1)
                    lv.thrown = by[by.length - 1] ?? lv.thrown
                    if (lv.t >= lv.frames.length - 1) restedRef.current(lv.final ?? lv.stones, 1)
                  } else {
                    const n = Math.min(30, Math.round(dt / STEP))
                    for (let k = 0; k < n && moving(lv.stones); k++) {
                      const sw =
                        sweepRef.current && lv.stones.includes(lv.thrown) ? lv.thrown : null
                      lv.stones = step(lv.stones, sw, STEP, lv.knocked)
                    }
                    if (!moving(lv.stones)) {
                      for (const s of lv.stones) {
                        s.vx = 0
                        s.vy = 0
                      }
                      restedRef.current(settle(lv.stones, lv.thrown, lv.knocked.has(lv.thrown)), 0)
                    }
                  }
                }
                const now = live.current
                // the view follows a sliding stone down the sheet, unless motion is to be kept down
                const want =
                  now && !reduced() && now.stones.includes(now.thrown)
                    ? Math.max(0, Math.min(AIM_LEFT, now.thrown.y - 2.5))
                    : AIM_LEFT
                cam.current = reduced()
                  ? AIM_LEFT
                  : cam.current + (want - cam.current) * Math.min(1, dt * 7 || 1)
                if (Math.abs(cam.current - want) < 0.002) cam.current = want
                const sv = savedRef.current
                const a = aimRef.current
                const stones = now ? now.stones : lieRef.current
                const key = `${c.width}x${c.height}|${sv.ice}|${sv.line}|${a.mark.x},${a.mark.y},${a.spin},${a.weight},${a.busy}|${cam.current.toFixed(3)}|${sweepRef.current}|${stones.map((s) => `${s.x.toFixed(3)},${s.y.toFixed(3)}`).join(';')}`
                if (key === last) return
                last = key
                const w = c.width
                const h = c.height
                const s = w / VIEW_L
                const X = (y: number) => (y - cam.current) * s
                const Y = (x: number) => h / 2 + x * s
                const L = ICE[sv.ice]
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.fillStyle = L.ice
                ctx.fillRect(0, 0, w, h)
                // the house
                for (const [r, col] of [
                  [HOUSE_R, L.outer],
                  [1.22, L.pad],
                  [0.61, L.inner],
                  [0.15, L.pad],
                ] as const) {
                  ctx.fillStyle = col
                  ctx.beginPath()
                  ctx.arc(X(TEE), Y(0), r * s, 0, Math.PI * 2)
                  ctx.fill()
                }
                // the lines: centre, tee, hog and back
                ctx.strokeStyle = L.line
                ctx.lineWidth = Math.max(1, s * 0.025)
                ctx.beginPath()
                ctx.moveTo(X(Math.max(0, cam.current)), Y(0))
                ctx.lineTo(X(BACK + 0.6), Y(0))
                for (const y of [TEE, BACK]) {
                  ctx.moveTo(X(y), 0)
                  ctx.lineTo(X(y), h)
                }
                ctx.stroke()
                ctx.strokeStyle = '#c0392b'
                ctx.lineWidth = Math.max(2, s * 0.05)
                ctx.beginPath()
                ctx.moveTo(X(HOG), 0)
                ctx.lineTo(X(HOG), h)
                ctx.stroke()
                // where you are aiming, and where it would rest on an empty sheet
                if (!a.busy && !gameRef.current.over && toThrow(gameRef.current) === 0) {
                  const shot = shotFor(a.mark, a.spin, a.weight)
                  if (sv.line) {
                    const pts = lineOf(shot)
                    ctx.strokeStyle = 'rgba(40, 60, 90, 0.45)'
                    if (sv.ice === 'night') ctx.strokeStyle = 'rgba(200, 230, 255, 0.45)'
                    ctx.setLineDash([s * 0.12, s * 0.12])
                    ctx.lineWidth = Math.max(1.5, s * 0.03)
                    ctx.beginPath()
                    pts.forEach((p, i) =>
                      i ? ctx.lineTo(X(p.y), Y(p.x)) : ctx.moveTo(X(p.y), Y(p.x)),
                    )
                    ctx.stroke()
                    ctx.setLineDash([])
                  }
                  // the mark: a broom head where the skip holds it
                  const mx = X(a.mark.y)
                  const my = Y(a.mark.x)
                  ctx.strokeStyle = sv.ice === 'night' ? '#fff' : '#1b2a3a'
                  ctx.lineWidth = Math.max(2, s * 0.04)
                  ctx.beginPath()
                  ctx.arc(mx, my, STONE_R * s * 1.15, 0, Math.PI * 2)
                  ctx.moveTo(mx - STONE_R * s * 1.8, my)
                  ctx.lineTo(mx + STONE_R * s * 1.8, my)
                  ctx.moveTo(mx, my - STONE_R * s * 1.8)
                  ctx.lineTo(mx, my + STONE_R * s * 1.8)
                  ctx.stroke()
                }
                // the stones
                for (const st of stones) {
                  const x = X(st.y)
                  const y = Y(st.x)
                  if (x < -s || x > w + s) continue
                  ctx.fillStyle = '#8e969e'
                  ctx.beginPath()
                  ctx.arc(x, y, STONE_R * s, 0, Math.PI * 2)
                  ctx.fill()
                  ctx.fillStyle = STONES[st.team]
                  ctx.beginPath()
                  ctx.arc(x, y, STONE_R * s * 0.66, 0, Math.PI * 2)
                  ctx.fill()
                  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
                  ctx.lineWidth = Math.max(1, s * 0.012)
                  ctx.beginPath()
                  ctx.arc(x, y, STONE_R * s, 0, Math.PI * 2)
                  ctx.stroke()
                }
                // the sweepers' brooms, just ahead of your stone
                if (now && now.by === 0 && sweepRef.current && now.stones.includes(now.thrown)) {
                  const x = X(now.thrown.y + 0.5)
                  const y = Y(now.thrown.x)
                  ctx.strokeStyle = sv.ice === 'night' ? '#fff' : '#1b2a3a'
                  ctx.lineWidth = Math.max(2, s * 0.05)
                  const wig = reduced() ? 0 : Math.sin(performance.now() / 45) * s * 0.06
                  ctx.beginPath()
                  ctx.moveTo(x + wig, y - STONE_R * s * 1.4)
                  ctx.lineTo(x + wig, y - STONE_R * s * 0.3)
                  ctx.moveTo(x - wig, y + STONE_R * s * 0.3)
                  ctx.lineTo(x - wig, y + STONE_R * s * 1.4)
                  ctx.stroke()
                  last = ''
                }
                // a stone still on its way, before the view reaches it
                if (now && now.stones.includes(now.thrown) && X(now.thrown.y) < 0) {
                  const y = Y(now.thrown.x)
                  ctx.fillStyle = STONES[now.thrown.team]
                  ctx.beginPath()
                  ctx.moveTo(4, y)
                  ctx.lineTo(4 + s * 0.3, y - s * 0.15)
                  ctx.lineTo(4 + s * 0.3, y + s * 0.15)
                  ctx.fill()
                }
              },
            }
          }}
        />
      </div>

      <div className="lab-controls cu-aim">
        <span className="cu-set" role="group" aria-label="Which way it turns">
          <button
            className="btn btn-ghost"
            aria-pressed={spin === -1}
            disabled={!yourTurn}
            onClick={() => setSpin(-1)}
          >
            ↺ Curls up
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={spin === 1}
            disabled={!yourTurn}
            onClick={() => setSpin(1)}
          >
            ↻ Curls down
          </button>
        </span>
        <span className="cu-set" role="group" aria-label="Weight">
          {WEIGHTS.map((wt) => (
            <button
              key={wt.id}
              className="btn btn-ghost"
              aria-pressed={weight === wt.id}
              disabled={!yourTurn}
              onClick={() => setWeight(wt.id)}
            >
              {wt.name}
            </button>
          ))}
        </span>
        {sliding ? (
          <button
            className={`btn cu-go${sweeping ? ' is-on' : ''}`}
            aria-pressed={sweeping}
            onPointerDown={(e) => {
              setSweep(true)
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch {
                /* a pointer the browser no longer has: the sweep still holds until it lifts */
              }
            }}
            onPointerUp={() => setSweep(false)}
            onPointerCancel={() => setSweep(false)}
            onLostPointerCapture={() => setSweep(false)}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSweep(true)
            }}
            onKeyUp={(e) => {
              if (e.key === 'Enter') setSweep(false)
            }}
          >
            🧹 {sweeping ? 'Sweeping!' : 'Hold to sweep'}
          </button>
        ) : (
          <button className="btn cu-go" disabled={!yourTurn} onClick={throwIt}>
            🥌 Throw
          </button>
        )}
      </div>

      <p className="sun-reading">
        <span className="muted">
          {LEVEL_NAMES[saved.level]}: won {rec.won}, lost {rec.lost}
          {rec.drawn ? `, drawn ${rec.drawn}` : ''}
          {rec.bestEnd ? ` · your best end ${rec.bestEnd}` : ''}
        </span>
      </p>
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Ice</h3>
          <div className="lab-controls" role="group" aria-label="Which ice">
            {ICES.map((i) => (
              <button
                key={i}
                className="btn btn-ghost"
                aria-pressed={saved.ice === i}
                onClick={() => setSaved((s) => ({ ...s, ice: i }))}
              >
                {ICE[i].name}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.line}
              onClick={() => setSaved((s) => ({ ...s, line: !s.line }))}
            >
              Show the line
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Mark where you want your stone to come to rest — tap or drag on the ice — choose which way
        it turns and how hard, and throw. A turning stone curls, most as it slows. Your hand is not
        perfect: a stone can come up short, and holding Sweep while it slides carries it further and
        keeps it straighter, but nothing brings back a stone thrown too hard. A Hit is thrown at the
        mark to knock out whatever is there. A stone that stops short of the red hog line comes off,
        unless it touched another. When all eight are thrown, the side nearest the button scores one
        for each stone nearer than the other side’s best, and the other side takes the hammer — the
        last stone — next end.
      </p>
    </div>
  )
}
