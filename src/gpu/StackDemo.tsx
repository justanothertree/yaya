import { useEffect, useRef, useState } from 'react'
import { BeatShare } from '../lab/BeatShare'
import { useChallenge } from '../lab/useChallenge'
import { beatsStack, newSeed, type Beat } from '../lab/beat'
import { CanvasStage } from './CanvasStage'
import {
  BOTS,
  COLS,
  HIDDEN,
  KINDS,
  ROWS,
  STACK_KEY,
  bag,
  botHands,
  cellsOf,
  drop,
  ghost,
  level,
  newWell,
  readSaved,
  receive,
  seeded,
  sent,
  shift,
  step,
  swap,
  turn,
  type Bot,
  type Kind,
  type Well,
} from './stack'
import { clock } from './daily'
import { useKept } from './kept'

type Mode = 'solo' | 'bot' | 'two'
const MODES: { id: Mode; label: string }[] = [
  { id: 'solo', label: 'Survive' },
  { id: 'bot', label: 'Vs computer' },
  { id: 'two', label: 'Two players' },
]

/** the Lab's own colours for the seven shapes, and junk grey */
const COLOURS = [
  '',
  '#4fd1e8',
  '#f2c94c',
  '#b07cf0',
  '#5fd38a',
  '#f06b6b',
  '#5b8def',
  '#f29b4c',
  '#6b6b80',
]

/** a held direction moves once, waits, then repeats — the way a held key in a text box does */
const DELAY = 0.16
const REPEAT = 0.045

type Hands = {
  left: boolean
  right: boolean
  soft: boolean
  /** seconds a direction has been held, and time banked towards its next repeat */
  held: number
  rep: number
}
const noHands = (): Hands => ({ left: false, right: false, soft: false, held: 0, rep: 0 })

type Action = 'left' | 'right' | 'soft' | 'turn' | 'back' | 'drop' | 'hold'
/** which player and action a key is, by its place on the keyboard rather than its letter */
const KEYS: Record<string, [0 | 1, Action]> = {
  KeyA: [0, 'left'],
  KeyD: [0, 'right'],
  KeyS: [0, 'soft'],
  KeyW: [0, 'turn'],
  KeyQ: [0, 'hold'],
  KeyE: [0, 'back'],
  Space: [0, 'drop'],
  ArrowLeft: [1, 'left'],
  ArrowRight: [1, 'right'],
  ArrowDown: [1, 'soft'],
  ArrowUp: [1, 'turn'],
  Enter: [1, 'drop'],
  ShiftRight: [1, 'hold'],
  Slash: [1, 'back'],
  // alone, the usual extra keys work too
  KeyX: [1, 'turn'],
  KeyZ: [1, 'back'],
  KeyC: [1, 'hold'],
  ShiftLeft: [0, 'hold'],
}

type Game = {
  mode: Mode
  bot: Bot
  wells: Well[]
  draw: (i: number) => Kind
  junk: () => number
  hands: Hands[]
  computer: ReturnType<typeof botHands> | null
  /** seconds of countdown left before the pieces start */
  count: number
  paused: boolean
  done: boolean
  /** the draw this game was dealt, for a "beat my run" link */
  seed: number
}

/** a new game; a solo run is on a seed it can be challenged with, everything else on any seed */
function newGame(mode: Mode, bot: Bot, seed = newSeed()): Game {
  const junk = seeded(seed ^ 0x5f3759df)
  const n = mode === 'solo' ? 1 : 2
  return {
    mode,
    bot,
    wells: Array.from({ length: n }, newWell),
    draw: bag(seed),
    junk: () => Math.floor(junk() * COLS),
    hands: [noHands(), noHands()],
    computer: mode === 'bot' ? botHands(bot, seeded(seed + 1)) : null,
    count: 3,
    paused: false,
    done: false,
    seed,
  }
}

export function StackDemo() {
  const [saved, setSaved] = useKept(STACK_KEY, readSaved)
  const [mode, setMode] = useState<Mode>('solo')
  /** a friend's run to beat, from the address; it is played alone, on its seed */
  const [challenge, leaveChallenge] = useChallenge('stack')
  /** the last solo run, which can be sent as a challenge */
  const [lastRun, setLastRun] = useState<Extract<Beat, { game: 'stack' }> | null>(null)
  useEffect(() => {
    if (challenge) setMode('solo')
  }, [challenge])
  const [bot, setBot] = useState<Bot>('easy')
  const [said, setSaid] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const game = useRef<Game | null>(null)
  const roomRef = useRef<HTMLDivElement | null>(null)

  /** the game ended: say who won and keep the records */
  const finish = (g: Game) => {
    g.done = true
    setPlaying(false)
    const [a, b] = g.wells
    if (g.mode === 'solo') {
      const time = Math.round(a.time * 10) / 10
      const vs = challengeRef.current
      const against =
        vs && vs.seed === g.seed
          ? beatsStack(vs, time, a.lines)
            ? ` You beat the link’s ${clock(vs.time)}!`
            : ` The link says ${clock(vs.time)} with ${vs.lines} lines — not this time.`
          : ''
      setSaid(
        `Topped out at ${clock(a.time)} — ${a.lines} lines, ${a.score.toLocaleString()} points.${against}`,
      )
      setLastRun({ game: 'stack', seed: g.seed, time, lines: a.lines })
      setSaved((s) => ({
        ...s,
        longest: Math.max(s.longest, Math.round(a.time * 10) / 10),
        lines: Math.max(s.lines, a.lines),
        score: Math.max(s.score, a.score),
      }))
    } else if (g.mode === 'bot') {
      const won = b.over && !a.over
      setSaid(
        won
          ? `You win — the ${g.bot} computer topped out at ${clock(b.time)}.`
          : `The ${g.bot} computer wins at ${clock(a.time)}. You cleared ${a.lines} lines.`,
      )
      setSaved((s) => ({
        ...s,
        wins: won ? { ...s.wins, [g.bot]: s.wins[g.bot] + 1 } : s.wins,
        losses: won ? s.losses : { ...s.losses, [g.bot]: s.losses[g.bot] + 1 },
      }))
    } else {
      setSaid(`${a.over ? 'Right' : 'Left'} player wins at ${clock(a.time)}.`)
    }
  }
  const challengeRef = useRef(challenge)
  challengeRef.current = challenge
  const finishRef = useRef(finish)
  finishRef.current = finish

  const start = () => {
    game.current = newGame(mode, bot, mode === 'solo' && challenge ? challenge.seed : undefined)
    setSaid(null)
    setLastRun(null)
    setPaused(false)
    setPlaying(true)
    roomRef.current?.focus({ preventScroll: true })
  }
  const togglePause = () => {
    const g = game.current
    if (!g || g.done) return
    g.paused = !g.paused
    setPaused(g.paused)
  }

  /** an action for player p: in a game for one person, either side's keys are theirs */
  const act = (p: 0 | 1, a: Action, down: boolean) => {
    const g = game.current
    if (!g || g.done || g.paused || g.count > 0) {
      if (g && !down) g.hands[p] = noHands()
      return
    }
    const who = g.mode === 'two' ? p : 0
    const w = g.wells[who]
    const h = g.hands[who]
    if (a === 'left' || a === 'right') {
      h[a] = down
      if (down) {
        h[a === 'left' ? 'right' : 'left'] = false
        h.held = 0
        h.rep = 0
        shift(w, a === 'left' ? -1 : 1)
      }
      return
    }
    if (a === 'soft') {
      h.soft = down
      return
    }
    if (!down) return
    if (a === 'turn') turn(w, 1)
    else if (a === 'back') turn(w, -1)
    else if (a === 'drop') drop(w, g.draw)
    else if (a === 'hold') swap(w, g.draw)
  }
  const actRef = useRef(act)
  actRef.current = act

  useEffect(() => {
    if (!playing) return
    const on = (down: boolean) => (e: KeyboardEvent) => {
      // typing a comment is not playing
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return
      if (down && (e.code === 'KeyP' || e.code === 'Escape')) {
        togglePauseRef.current()
        return
      }
      const k = KEYS[e.code]
      if (!k) return
      e.preventDefault()
      // and no further: App's `?` for help does not ask whether a key was handled, and the right
      // player's Slash with Shift held is a `?`
      e.stopPropagation()
      if (down && e.repeat) return
      actRef.current(k[0], k[1], down)
    }
    const kd = on(true)
    const ku = on(false)
    // a key let go while the window was elsewhere would otherwise stay held
    const blur = () => game.current?.hands.forEach((_, i, all) => (all[i] = noHands()))
    /* ⚠️ IN THE CAPTURE PHASE, or the arrows leave the room. App's own window listener walks
       between rooms on ← → unless something has already called preventDefault — and it was
       registered first, so in the bubble phase it ran first and the first ← of a game took the
       player to the previous room. Capturing runs this before any bubble listener on window. */
    window.addEventListener('keydown', kd, true)
    window.addEventListener('keyup', ku, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', kd, true)
      window.removeEventListener('keyup', ku, true)
      window.removeEventListener('blur', blur)
    }
  }, [playing])
  const togglePauseRef = useRef(togglePause)
  togglePauseRef.current = togglePause

  /** a touch button: press and release, with the same repeat a held key has */
  const pad = (a: Action, label: string, text: string) => (
    <button
      className="btn btn-ghost stack-pad"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault()
        act(0, a, true)
      }}
      onPointerUp={() => act(0, a, false)}
      onPointerLeave={() => act(0, a, false)}
      onPointerCancel={() => act(0, a, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {text}
    </button>
  )

  const record =
    mode === 'solo'
      ? saved.longest
        ? `Longest ${clock(saved.longest)} · most lines ${saved.lines} · best score ${saved.score.toLocaleString()}`
        : 'No game kept yet.'
      : mode === 'bot'
        ? (Object.keys(BOTS) as Bot[])
            .map((b) => `${b} ${saved.wins[b]}–${saved.losses[b]}`)
            .join(' · ')
        : 'Left: A D move, W turn, S down, Space drop, Q hold. Right: arrows, Enter drop, right Shift hold.'

  return (
    <div className="lab-keys stack-room" tabIndex={-1} ref={roomRef}>
      {mode === 'solo' && challenge && (
        <p className="beat-banner">
          🏁 <strong>A run to beat:</strong> this link says {clock(challenge.time)} with{' '}
          {challenge.lines} lines. You get the same pieces in the same order — last longer.{' '}
          <button className="btn btn-ghost" onClick={leaveChallenge} disabled={playing}>
            Leave the challenge
          </button>
        </p>
      )}
      <CanvasStage
        className={mode === 'solo' ? undefined : 'stack-pair'}
        label="Falling-block wells"
        make={(ctx, canvas) => ({
          frame: (dt) => {
            const g = game.current
            if (g && !g.done && !g.paused) {
              if (g.count > 0) g.count = Math.max(0, g.count - dt)
              else {
                g.wells.forEach((w, i) => {
                  const h = g.hands[i]
                  // a held direction repeats
                  if (h.left || h.right) {
                    h.held += dt
                    if (h.held >= DELAY) {
                      h.rep += dt
                      while (h.rep >= REPEAT) {
                        h.rep -= REPEAT
                        shift(w, h.left ? -1 : 1)
                      }
                    }
                  }
                  step(w, dt, g.draw, h.soft)
                })
                if (g.computer) g.computer(g.wells[1], dt, g.draw)
                if (g.wells.length === 2) {
                  const [a, b] = g.wells
                  receive(b, sent(a), g.junk())
                  receive(a, sent(b), g.junk())
                }
                if (g.wells.some((w) => w.over)) finishRef.current(g)
              }
            }
            paint(ctx, canvas, g)
          },
        })}
      />
      {playing && mode !== 'two' && (
        <div className="stack-pads" aria-label="Touch controls">
          {pad('left', 'Move left', '◀')}
          {pad('turn', 'Turn', '⟳')}
          {pad('right', 'Move right', '▶')}
          {pad('soft', 'Down faster', '▼')}
          {pad('drop', 'Drop', '⤓')}
          {pad('hold', 'Hold', 'Hold')}
        </div>
      )}
      <div className="lab-controls">
        {!playing && (
          <div className="lab-group" role="group" aria-label="Mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                className="btn btn-ghost"
                aria-pressed={mode === m.id}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        {mode === 'bot' && !playing && (
          <div className="lab-group" role="group" aria-label="Computer">
            {(Object.keys(BOTS) as Bot[]).map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={bot === b}
                onClick={() => setBot(b)}
              >
                {b[0].toUpperCase() + b.slice(1)}
              </button>
            ))}
          </div>
        )}
        {playing ? (
          <>
            <button className="btn btn-ghost" onClick={togglePause} aria-keyshortcuts="P">
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                game.current = null
                setPlaying(false)
              }}
            >
              Stop
            </button>
          </>
        ) : (
          <button className="btn" onClick={start}>
            {game.current ? '↻ Play again' : '▶ Start'}
          </button>
        )}
      </div>
      {!playing && mode === 'solo' && lastRun && <BeatShare beat={lastRun} />}
      <p className="sun-reading" aria-live="polite">
        {said && <strong>{said} </strong>}
        <span className="muted">{record}</span>
      </p>
      <p className="muted lab-hint">
        Fill a row from wall to wall and it clears. It speeds up the longer you last — level{' '}
        {level(0)} to {level(150)} takes two and a half minutes. Against someone, clearing two rows
        at once sends one row of junk up their well, three sends two and four sends four, and a
        clear cancels junk on its way to you. Both wells get the same pieces in the same order.
        Keys: ← → move, ↑ or X turn, Z turn back, ↓ down faster, Enter or Space drop, C hold, P
        pause. Two players share a keyboard: left player A D W S, Space, Q; right player the arrows,
        Enter, right Shift.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------------------- drawing */

function paint(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, g: Game | null) {
  const { width: W, height: H } = canvas
  ctx.fillStyle = '#07071a'
  ctx.fillRect(0, 0, W, H)
  const n = g?.wells.length ?? 1
  // each well is COLS wide plus a side panel 4 cells wide, with a cell's gap between wells
  const unitW = n * (COLS + 4.5) + (n - 1) * 1
  const s = Math.floor(Math.min(W / unitW, (H * 0.96) / (ROWS + 1.6)))
  const totalW = unitW * s
  let x0 = Math.round((W - totalW) / 2)
  const y0 = Math.round((H - (ROWS + 1.6) * s) / 2 + s * 1.3)
  ctx.font = `600 ${Math.max(10, Math.round(s * 0.75))}px system-ui, sans-serif`
  ctx.textBaseline = 'alphabetic'
  for (let i = 0; i < n; i++) {
    const w = g?.wells[i] ?? null
    const name = !g
      ? 'Press Start'
      : g.mode === 'solo'
        ? 'You'
        : g.mode === 'bot'
          ? i === 0
            ? 'You'
            : `Computer · ${g.bot}`
          : i === 0
            ? 'Left · A D W S'
            : 'Right · arrows'
    well(ctx, w, w && g ? g.draw(w.drawn) : null, x0, y0, s, name)
    x0 += (COLS + 4.5 + 1) * s
  }
  if (g && g.count > 0 && !g.done) banner(ctx, W, H, String(Math.ceil(g.count)))
  else if (g?.paused) banner(ctx, W, H, 'Paused')
}

function banner(ctx: CanvasRenderingContext2D, W: number, H: number, text: string) {
  ctx.fillStyle = 'rgba(7, 7, 26, 0.6)'
  ctx.fillRect(0, H / 2 - H * 0.08, W, H * 0.16)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.round(H * 0.09)}px system-ui, sans-serif`
  ctx.fillText(text, W / 2, H / 2)
  ctx.textBaseline = 'alphabetic'
}

function block(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, colour: string) {
  ctx.fillStyle = colour
  ctx.fillRect(x + 1, y + 1, s - 2, s - 2)
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(x + 1, y + 1, s - 2, Math.max(1, s * 0.18))
}

function mini(ctx: CanvasRenderingContext2D, kind: Kind | null, x: number, y: number, s: number) {
  if (!kind) return
  const c = cellsOf(kind, 0)
  const k = s * 0.6
  for (const [cx, cy] of c) block(ctx, x + cx * k, y + cy * k, k, COLOURS[KINDS.indexOf(kind) + 1])
}

function well(
  ctx: CanvasRenderingContext2D,
  w: Well | null,
  coming: Kind | null,
  x0: number,
  y0: number,
  s: number,
  name: string,
) {
  ctx.textAlign = 'left'
  ctx.fillStyle = '#d6d6f0'
  ctx.fillText(name, x0, y0 - s * 0.4)
  ctx.fillStyle = '#10102a'
  ctx.fillRect(x0, y0, COLS * s, ROWS * s)
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 1
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath()
    ctx.moveTo(x0 + x * s + 0.5, y0)
    ctx.lineTo(x0 + x * s + 0.5, y0 + ROWS * s)
    ctx.stroke()
  }
  if (!w) return
  const cell = (x: number, y: number) => [x0 + x * s, y0 + (y - HIDDEN) * s] as const
  for (let y = HIDDEN; y < ROWS + HIDDEN; y++)
    for (let x = 0; x < COLS; x++) {
      const c = w.grid[y][x]
      if (c) block(ctx, ...cell(x, y), s, COLOURS[c])
    }
  const g = ghost(w)
  if (g && w.piece) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    for (const [cx, cy] of cellsOf(g.kind, g.rot)) {
      if (g.y + cy < HIDDEN) continue
      const [x, y] = cell(g.x + cx, g.y + cy)
      ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3)
    }
    for (const [cx, cy] of cellsOf(w.piece.kind, w.piece.rot)) {
      if (w.piece.y + cy < HIDDEN) continue
      block(
        ctx,
        ...cell(w.piece.x + cx, w.piece.y + cy),
        s,
        COLOURS[KINDS.indexOf(w.piece.kind) + 1],
      )
    }
  }
  // junk on its way: a red bar up the left wall, a cell per row
  const junk = w.incoming.reduce((t, r) => t + r.rows, 0)
  if (junk) {
    ctx.fillStyle = '#ff4d6d'
    ctx.fillRect(
      x0 - Math.max(3, s * 0.25),
      y0 + (ROWS - Math.min(ROWS, junk)) * s,
      Math.max(3, s * 0.2),
      Math.min(ROWS, junk) * s,
    )
  }
  // the side panel: next, hold, and the numbers
  const px = x0 + COLS * s + s * 0.6
  ctx.fillStyle = '#9a9ac0'
  ctx.font = `600 ${Math.max(9, Math.round(s * 0.6))}px system-ui, sans-serif`
  ctx.fillText('Next', px, y0 + s * 0.6)
  mini(ctx, coming, px, y0 + s * 1.1, s)
  ctx.fillStyle = '#9a9ac0'
  ctx.fillText('Hold', px, y0 + s * 4)
  mini(ctx, w.hold, px, y0 + s * 4.5, s)
  const facts: [string, string][] = [
    ['Lines', String(w.lines)],
    ['Level', String(level(w.time))],
    ['Time', clock(w.time)],
  ]
  facts.forEach(([k, v], i) => {
    ctx.fillStyle = '#9a9ac0'
    ctx.fillText(k, px, y0 + s * (8 + i * 2.4))
    ctx.fillStyle = '#ffffff'
    ctx.fillText(v, px, y0 + s * (8.9 + i * 2.4))
  })
  if (w.over) {
    ctx.fillStyle = 'rgba(7,7,26,0.7)'
    ctx.fillRect(x0, y0, COLS * s, ROWS * s)
    ctx.fillStyle = '#ff8fa8'
    ctx.textAlign = 'center'
    ctx.font = `700 ${Math.max(12, Math.round(s * 1.1))}px system-ui, sans-serif`
    ctx.fillText('Topped out', x0 + (COLS * s) / 2, y0 + (ROWS * s) / 2)
    ctx.textAlign = 'left'
  }
}
