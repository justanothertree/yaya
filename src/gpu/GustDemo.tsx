import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  FAN_SPEED,
  FIRST_TO,
  H,
  W,
  GUST_KEY,
  LEVELS,
  LEVEL_SPEED,
  brain,
  breathe,
  easier,
  goal,
  kickoff,
  newMatch,
  readSaved,
  rinkFit,
  scored,
  steer,
  type Fan,
  type Level,
  type Match,
  type Puck,
  type V2,
} from './gust'
import { DT, createGust, type GustView } from './gustEngine'
import { useKept } from './kept'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Mode = 'computer' | 'friend'
const NAMES = ['Blue', 'Orange'] as const
const title = (l: string) => l[0].toUpperCase() + l.slice(1)

/** the keys each player holds: a direction each, and a blow */
const KEYS: Record<string, [number, 'up' | 'down' | 'left' | 'right' | 'blow']> = {
  w: [0, 'up'],
  s: [0, 'down'],
  a: [0, 'left'],
  d: [0, 'right'],
  f: [0, 'blow'],
  arrowup: [1, 'up'],
  arrowdown: [1, 'down'],
  arrowleft: [1, 'left'],
  arrowright: [1, 'right'],
  '/': [1, 'blow'],
  enter: [1, 'blow'],
}

const startFans = (): [Fan, Fan] => [
  { x: 24, y: H / 2, blowing: false, breath: 1 },
  { x: W - 24, y: H / 2, blowing: false, breath: 1 },
]

/** where on the rink a point of the canvas is: the shader's own fit, upright on a tall stage */
const toRink = (e: PointerEvent<HTMLCanvasElement>): V2 => {
  const r = e.currentTarget.getBoundingClientRect()
  return rinkFit([r.width, r.height], [e.clientX - r.left, e.clientY - r.top])
}

export function GustDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [mode, setMode] = useState<Mode>('computer')
  const [saved, setSaved] = useKept(GUST_KEY, readSaved)
  const level = saved.level
  /** the easiest level this match has been played at: what a finish against the computer counts at */
  const playedAt = useRef<Level>(level)
  const setLevel = (l: Level) => {
    setSaved((s) => ({ ...s, level: l }))
    playedAt.current = easier(playedAt.current, l)
  }
  const [sound, setSound] = useState(true)
  const [score, setScore] = useState<{ s: [number, number]; winner: number; kick: boolean }>({
    s: [0, 0],
    winner: -1,
    kick: true,
  })
  const now = useRef({ mode, level, sound, running })
  now.current = { mode, level, sound, running }
  const engine = useRef<GustView | null>(null)
  const match = useRef<Match>(newMatch())
  const fans = useRef<[Fan, Fan]>(startFans())
  const puck = useRef<Puck>(kickoff(-1))
  const held = useRef(new Set<string>())
  /** each finger on the ice: which fan it steers and where it wants it */
  const touches = useRef(new Map<number, { side: number; at: V2 }>())
  const voices = useRef(new Map<string, number>())

  /* sound stops when the toy goes: every note still ringing is let go and no timer outlives it */
  useEffect(
    () => () => {
      for (const [id, t] of voices.current) {
        window.clearTimeout(t)
        noteOff(id)
      }
      voices.current.clear()
    },
    [],
  )
  const play = (midi: number, ms: number, delay = 0) => {
    if (!now.current.sound) return
    const id = `gust-${midi}-${performance.now()}-${delay}`
    const start = window.setTimeout(() => {
      noteOn(id, 'bell', midi)
      voices.current.set(
        id,
        window.setTimeout(() => {
          noteOff(id)
          voices.current.delete(id)
        }, ms),
      )
    }, delay)
    voices.current.set(id, start)
  }

  const fresh = () => {
    match.current = newMatch()
    playedAt.current = now.current.level
    fans.current = startFans()
    puck.current = kickoff(-1)
    engine.current?.calm()
    engine.current?.place(puck.current)
    setScore({ s: [0, 0], winner: -1, kick: true })
    if (!now.current.running) setRunning(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const k = e.key.toLowerCase()
    if (k in KEYS) {
      if (e.target !== e.currentTarget && k === 'enter') return
      if (down) {
        held.current.add(k)
        if (!now.current.running) setRunning(true)
      } else held.current.delete(k)
    } else if (!down || e.target !== e.currentTarget) return
    else if (k === 'p' || k === ' ') setRunning((r) => !r)
    else if (k === 'n') fresh()
    else return
    e.preventDefault()
  }

  /** whose fan a finger steers: the half it lands in, or always Blue against the computer */
  const sideOf = (at: V2) => (now.current.mode === 'computer' ? 0 : at[0] < W / 2 ? 0 : 1)

  const s = score.s
  const record = saved.record[level]
  return (
    <div
      className="lab-keys"
      tabIndex={0}
      onKeyDown={(e) => onKey(e, true)}
      onKeyUp={(e) => onKey(e, false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) held.current.clear()
      }}
      aria-label="Gust"
    >
      <LabStage
        label="An air-hockey rink with no mallets: two fans blow coloured wind that carries a puck between four posts"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const v = await createGust(device, context, format, canvas)
          engine.current = v
          v.place(puck.current)
          let acc = 0
          let t = 0
          let kickShown = true
          return {
            frame: (dt: number) => {
              const m = match.current
              const f = fans.current
              const { mode: md, level: lv } = now.current
              let steps = 0
              if (dt > 0) {
                acc = Math.min(acc + dt, DT * 3)
                steps = Math.floor(acc / DT)
                acc -= steps * DT
                t += dt
                m.pause = Math.max(0, m.pause - dt)
                // each player: keys move the fan at its speed, a finger draws it toward itself
                for (const side of [0, 1]) {
                  const fan = f[side]
                  let blow = false
                  if (side === 1 && md === 'computer') {
                    const want = brain(puck.current, fan)
                    steer(fan, 1, want.at, dt, FAN_SPEED * LEVEL_SPEED[lv])
                    breathe(fan, want.blow && m.winner < 0, dt)
                    continue
                  }
                  const h = held.current
                  const has = (what: string) =>
                    Object.entries(KEYS).some(([k, [p, w]]) => p === side && w === what && h.has(k))
                  const dx = (has('right') ? 1 : 0) - (has('left') ? 1 : 0)
                  const dy = (has('down') ? 1 : 0) - (has('up') ? 1 : 0)
                  if (dx || dy) steer(fan, side, [fan.x + dx * 50, fan.y + dy * 50], dt)
                  blow = has('blow')
                  for (const touch of touches.current.values())
                    if (touch.side === side) {
                      steer(fan, side, touch.at, dt)
                      blow = true
                    }
                  breathe(fan, blow && m.winner < 0, dt)
                }
              }
              v.frame({ fans: f, time: t, pause: m.pause > 0 || m.winner >= 0 }, steps)
              const kicking = m.pause > 0
              if (kicking !== kickShown) {
                kickShown = kicking
                setScore((x) => ({ ...x, kick: kicking }))
              }
              void v.puck().then((n) => {
                if (!n || engine.current !== v) return
                puck.current = n.puck
                if (n.into < 0 || match.current.winner >= 0) return
                const mm = match.current
                goal(mm, n.into, puck.current)
                v.place(puck.current)
                setScore({ s: [...mm.score], winner: mm.winner, kick: true })
                const scorer = n.into === 0 ? 1 : 0
                const root = scorer === 0 ? 72 : 67
                if (mm.winner >= 0 && now.current.mode === 'computer') {
                  const at = playedAt.current
                  const final: [number, number] = [mm.score[0], mm.score[1]]
                  setSaved((x) => scored(x, at, final))
                }
                if (mm.winner >= 0) [0, 4, 7, 12].forEach((k, i) => play(root + k, 500, i * 120))
                else [0, 7].forEach((k, i) => play(root + k, 300, i * 90))
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const at = toRink(e)
          touches.current.set(e.pointerId, { side: sideOf(at), at })
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const t = touches.current.get(e.pointerId)
          if (t) t.at = toRink(e)
        }}
        onPointerUp={(e) => {
          touches.current.delete(e.pointerId)
        }}
      />

      {live && (
        <div className="lab-controls">
          <span className="lab-score gust-score" aria-live="polite">
            <span className="gust-blue">
              {NAMES[0]} {s[0]}
            </span>
            {' – '}
            <span className="gust-orange">
              {s[1]} {mode === 'computer' ? 'Computer' : NAMES[1]}
            </span>
            {score.winner >= 0
              ? ` · ${score.winner === 0 ? NAMES[0] : mode === 'computer' ? 'The computer' : NAMES[1]} wins!`
              : score.kick
                ? ' · get ready…'
                : ` · first to ${FIRST_TO}`}
          </span>
          <button className="btn" onClick={fresh}>
            {score.winner >= 0 ? '🏒 Again' : '⏮ New match'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setRunning((r) => !r)}
            aria-pressed={!running}
          >
            {running ? '⏸ Pause' : '▶ Play'}
          </button>
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Who Orange is">
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'computer'}
              onClick={() => {
                setMode('computer')
                fresh()
              }}
            >
              🤖 vs computer
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'friend'}
              onClick={() => {
                setMode('friend')
                fresh()
              }}
            >
              👥 Two players
            </button>
          </div>
          {mode === 'computer' && (
            <div className="lab-group" role="group" aria-label="How quick the computer is">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  className="btn btn-ghost"
                  aria-pressed={level === l}
                  onClick={() => setLevel(l)}
                >
                  {title(l)}
                </button>
              ))}
            </div>
          )}
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((v) => !v)}
          >
            {sound ? '🔔 Sound' : '🔕 Muted'}
          </button>
        </div>
      )}
      {live && mode === 'computer' && (
        <p className="sun-reading">
          <span className="muted">
            Against {title(level)}: won {record.won}, lost {record.lost}
            {record.shutouts > 0 && <> · {record.shutouts} without letting one in</>}
          </span>
        </p>
      )}
      {live && (
        <p className="lab-hint muted">
          {mode === 'computer'
            ? 'Hold a finger or the mouse on the ice: your blue fan follows it and blows at the puck — get behind the puck to send it at the orange goal. You can reach a little past halfway; the posts are solid. Keys: WASD to move, F to blow.'
            : 'Each player starts a finger on their own side of the ice: the fan follows it and blows while you hold. Either fan can reach a little past halfway, so the middle is contested. Keys: Blue WASD + F, Orange arrows + / or Enter.'}{' '}
          Breath runs out, so blow in bursts. P pauses, N starts again.
        </p>
      )}
    </div>
  )
}
