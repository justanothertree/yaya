import { useEffect, useMemo, useRef, useState } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { hashParam, here } from '../lab/links'
import { CanvasStage } from './CanvasStage'
import {
  COLS,
  HATS,
  HERO_COLOURS,
  LEVELS_KEY,
  MAX_KEPT,
  ROOMS,
  ROWS,
  THEMES,
  TILES,
  TILE_NAMES,
  WAIT,
  at,
  begin,
  decode,
  encode,
  fromText,
  isCrate,
  move,
  platesOf,
  readSaved,
  solve,
  spikesUp,
  type Dir,
  type Hat,
  type Level,
  type Saved,
  type Solution,
  type Square,
  type State,
  type Theme,
  type Tile,
} from './levels'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(LEVELS_KEY))
  } catch {
    return readSaved(null)
  }
}
const BLANK = fromText('My room', [
  '############',
  '#S.........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '#.........E#',
  '############',
])
const THEME_NAMES: Record<Theme, string> = { dungeon: 'Dungeon', garden: 'Garden', space: 'Space' }
const HAT_NAMES: Record<Hat, string> = {
  none: 'No hat',
  crown: 'Crown',
  cap: 'Cap',
  bow: 'Bow',
  antenna: 'Antenna',
}
const KEYS: Record<string, Dir> = {
  ArrowUp: 0,
  ArrowRight: 1,
  ArrowDown: 2,
  ArrowLeft: 3,
  w: 0,
  d: 1,
  s: 2,
  a: 3,
  W: 0,
  D: 1,
  S: 2,
  A: 3,
  ' ': WAIT,
  '.': WAIT,
}

type Source =
  | { kind: 'room'; i: number }
  | { kind: 'kept'; i: number }
  | { kind: 'draft' }
  | { kind: 'link' }

export function LevelsDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [linked] = useState<Level | null>(() => {
    const t = hashParam('room')
    return t ? decode(t) : null
  })
  const [mode, setMode] = useState<'play' | 'build'>('play')
  const [source, setSource] = useState<Source>(linked ? { kind: 'link' } : { kind: 'room', i: 0 })
  const [draft, setDraft] = useState<Level>(
    () => (saved.draft ? decode(saved.draft) : null) ?? BLANK,
  )
  const [brush, setBrush] = useState<Tile>('wall')
  const [cursor, setCursor] = useState(at(1, 1))
  const [check, setCheck] = useState<Solution | null>(null)
  const roomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(LEVELS_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(() => {
    setSaved((s) => ({ ...s, draft: encode(draft) }))
    setCheck(null)
  }, [draft])

  const level: Level = useMemo(() => {
    if (source.kind === 'room') return ROOMS[source.i]
    if (source.kind === 'kept') return decode(saved.kept[source.i] ?? '') ?? ROOMS[0]
    if (source.kind === 'link') return linked ?? ROOMS[0]
    return draft
  }, [source, saved.kept, linked, draft])
  const code = useMemo(() => encode(level), [level])
  const plates = useMemo(() => platesOf(level), [level])
  /** par is worked out once per room — the solver is quick, but not every frame */
  const par = useMemo(() => solve(level), [level])

  // the game: a stack of states, so undo is a pop
  const [history, setHistory] = useState<State[]>(() => [begin(level)!].filter(Boolean))
  useEffect(() => setHistory([begin(level)!].filter(Boolean)), [level])
  const state = history[history.length - 1]
  const step = (d: Dir) => {
    if (!state || state.over) return
    const next = move(state, d, plates)
    if (next === state) return
    setHistory((h) => [...h, next])
    if (next.over === 'won')
      setSaved((s) => ({
        ...s,
        best: { ...s.best, [code]: Math.min(s.best[code] ?? Infinity, next.moves) },
      }))
  }
  const undo = () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h))
  const restart = () => setHistory([begin(level)!])

  const paint = (i: number, t: Tile = brush) => {
    setDraft((l) => {
      if (l.grid[i] === t) return l
      const grid = [...l.grid]
      // one start: placing it moves it
      if (t === 'start') {
        const old = grid.indexOf('start')
        if (old >= 0) grid[old] = 'floor'
      } else if (grid[i] === 'start') return l
      grid[i] = t
      return { ...l, grid }
    })
  }
  const painting = useRef(false)
  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const s = Math.min(r.width / COLS, r.height / ROWS)
    const ox = (r.width - s * COLS) / 2
    const oy = (r.height - s * ROWS) / 2
    const x = Math.floor((e.clientX - r.left - ox) / s)
    const y = Math.floor((e.clientY - r.top - oy) / s)
    return x >= 0 && y >= 0 && x < COLS && y < ROWS ? at(x, y) : null
  }
  const swipe = useRef<{ x: number; y: number } | null>(null)

  /* ⚠️ WHAT IS DRAWN IS THE ROOM BEING BUILT IN BUILD, NOT THE ROOM BEING PLAYED: the two are
     different rooms whenever a built-in one is chosen to play, and the first version drew the
     played one while the brush painted the other. */
  const shown = mode === 'build' ? draft : level
  const now = useRef({ mode, level: shown, state, hero: saved.hero, cursor, brush })
  now.current = { mode, level: shown, state, hero: saved.hero, cursor, brush }

  const keep = () => {
    if (check?.par == null) return
    const text = encode(draft)
    setSaved((s) => ({
      ...s,
      kept: [text, ...s.kept.filter((k) => k !== text)].slice(0, MAX_KEPT),
    }))
  }
  const best = saved.best[code]
  const link = `${here()}#lab?demo=levels&room=${code}`

  return (
    <div
      className="lab-keys lv-room"
      tabIndex={0}
      ref={roomRef}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('input, textarea, select')) return
        if (mode === 'play') {
          const d = KEYS[e.key]
          if (d !== undefined && !(e.key === ' ' && (e.target as HTMLElement).closest('button'))) {
            e.preventDefault()
            e.stopPropagation()
            step(d)
          } else if (
            e.key === 'u' ||
            e.key === 'U' ||
            ((e.ctrlKey || e.metaKey) && e.key === 'z')
          ) {
            e.preventDefault()
            undo()
          } else if (e.key === 'r' || e.key === 'R') restart()
        } else {
          const d = KEYS[e.key]
          if (d !== undefined && d !== WAIT && e.key.startsWith('Arrow')) {
            e.preventDefault()
            e.stopPropagation()
            const x = cursor % COLS
            const y = Math.floor(cursor / COLS)
            const nx = Math.max(0, Math.min(COLS - 1, x + [0, 1, 0, -1][d]))
            const ny = Math.max(0, Math.min(ROWS - 1, y + [-1, 0, 1, 0][d]))
            setCursor(at(nx, ny))
          } else if (
            (e.key === ' ' || e.key === 'Enter') &&
            !(e.target as HTMLElement).closest('button')
          ) {
            e.preventDefault()
            paint(cursor)
          }
        }
      }}
    >
      {source.kind === 'link' && mode === 'play' && (
        <p className="beat-banner">
          🧩 <strong>A room somebody built: “{level.name}”</strong>
          {par.par !== null && <> — out in {par.par} moves at best.</>} Can you match it?
        </p>
      )}
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Mode">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'play'}
            onClick={() => setMode('play')}
          >
            ▶ Play
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'build'}
            onClick={() => setMode('build')}
          >
            🧱 Build
          </button>
        </div>
        {mode === 'play' && (
          <label className="studio-pick">
            <span className="sr-only">Room</span>
            <select
              value={
                source.kind === 'room'
                  ? `r${source.i}`
                  : source.kind === 'kept'
                    ? `k${source.i}`
                    : source.kind
              }
              onChange={(e) => {
                const v = e.target.value
                if (v === 'draft') setSource({ kind: 'draft' })
                else if (v === 'link') setSource({ kind: 'link' })
                else setSource({ kind: v[0] === 'r' ? 'room' : 'kept', i: Number(v.slice(1)) })
                /* ⚠️ AND HAND THE KEYS BACK TO THE ROOM. Left on the select, the arrows would change
                   the room again — and App's own arrows, which ignore a text box but not a select,
                   would walk off to the next page of the site. */
                roomRef.current?.focus({ preventScroll: true })
              }}
            >
              {linked && <option value="link">Sent to you: {linked.name}</option>}
              {ROOMS.map((r, i) => (
                <option key={r.name} value={`r${i}`}>
                  {saved.best[encode(r)] ? '✓ ' : ''}
                  {r.name}
                </option>
              ))}
              {saved.kept.map((k, i) => (
                <option key={k} value={`k${i}`}>
                  Kept: {decode(k)?.name}
                </option>
              ))}
              <option value="draft">Your room: {draft.name}</option>
            </select>
          </label>
        )}
      </div>

      <CanvasStage
        className="lv-stage"
        label={
          mode === 'play'
            ? `${level.name}: a room to get out of. Arrow keys move, Space waits.`
            : 'The room you are building. Tap or drag to paint.'
        }
        onPointerDown={(e) => {
          if (mode === 'build') {
            const i = cellAt(e)
            if (i !== null) {
              painting.current = true
              setCursor(i)
              paint(i)
            }
          } else swipe.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMove={(e) => {
          if (mode === 'build' && painting.current) {
            const i = cellAt(e)
            if (i !== null) paint(i)
          }
        }}
        onPointerUp={(e) => {
          painting.current = false
          const s = swipe.current
          swipe.current = null
          if (mode !== 'play' || !s) return
          const dx = e.clientX - s.x
          const dy = e.clientY - s.y
          if (Math.hypot(dx, dy) < 24) return
          step(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0)
        }}
        make={(ctx, canvas) => ({
          frame: () => {
            const n = now.current
            const W = canvas.width
            const H = canvas.height
            ctx.fillStyle = '#0c0c14'
            ctx.fillRect(0, 0, W, H)
            const size = Math.floor(Math.min(W / COLS, H / ROWS))
            const ox = Math.floor((W - size * COLS) / 2)
            const oy = Math.floor((H - size * ROWS) / 2)
            const grid: Square[] =
              n.mode === 'build' ? n.level.grid : (n.state?.grid ?? n.level.grid)
            const moves = n.mode === 'build' ? 0 : (n.state?.moves ?? 0)
            const coinsLeft = n.mode === 'build' ? 1 : (n.state?.coinsLeft ?? 1)
            const gateOpen =
              n.mode === 'play' &&
              !!n.state &&
              platesOf(n.level).some((i) => i === n.state!.p || n.state!.grid[i] === 'crateOnPlate')
            for (let i = 0; i < COLS * ROWS; i++)
              tile(
                ctx,
                grid[i],
                n.level.theme,
                ox + (i % COLS) * size,
                oy + Math.floor(i / COLS) * size,
                size,
                {
                  spikesUp: spikesUp(moves),
                  exitOpen: coinsLeft === 0,
                  gateOpen,
                },
              )
            if (n.mode === 'play' && n.state) {
              const p = n.state.p
              hero(
                ctx,
                ox + (p % COLS) * size,
                oy + Math.floor(p / COLS) * size,
                size,
                n.hero.colour,
                n.hero.hat,
                n.state.over === 'spiked',
              )
            }
            if (n.mode === 'build') {
              const c = n.cursor
              ctx.strokeStyle = '#ffd34d'
              ctx.lineWidth = Math.max(2, size / 14)
              ctx.strokeRect(
                ox + (c % COLS) * size + 1,
                oy + Math.floor(c / COLS) * size + 1,
                size - 2,
                size - 2,
              )
            }
          },
        })}
      />

      {mode === 'play' && state && (
        <>
          <div className="lv-pad" role="group" aria-label="Move">
            <span />
            <button className="btn btn-ghost" aria-label="Up" onClick={() => step(0)}>
              ▲
            </button>
            <span />
            <button className="btn btn-ghost" aria-label="Left" onClick={() => step(3)}>
              ◀
            </button>
            <button className="btn btn-ghost" aria-label="Wait a turn" onClick={() => step(WAIT)}>
              ⏸
            </button>
            <button className="btn btn-ghost" aria-label="Right" onClick={() => step(1)}>
              ▶
            </button>
            <span />
            <button className="btn btn-ghost" aria-label="Down" onClick={() => step(2)}>
              ▼
            </button>
            <span />
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              onClick={undo}
              disabled={history.length < 2}
              aria-keyshortcuts="U"
            >
              ↶ Undo
            </button>
            <button className="btn btn-ghost" onClick={restart} aria-keyshortcuts="R">
              ↻ Restart
            </button>
            <span className="lab-score">
              {state.moves} moves
              {state.coinsLeft > 0 && <> · {state.coinsLeft} coins to go</>}
              {(['keyR', 'keyB', 'keyG'] as const).map((k) =>
                state.keys[k] ? (
                  <span key={k}>
                    {' '}
                    · {TILE_NAMES[k].toLowerCase()} ×{state.keys[k]}
                  </span>
                ) : null,
              )}
            </span>
          </div>
          <p className="sun-reading" aria-live="polite">
            {state.over === 'won' ? (
              <strong>
                Out in {state.moves} moves
                {par.par !== null &&
                  (state.moves <= par.par
                    ? ' — as few as it can be done!'
                    : ` — it can be done in ${par.par}.`)}
              </strong>
            ) : state.over === 'spiked' ? (
              <strong className="rps-bad">The spikes came up. Undo, or start again.</strong>
            ) : (
              <span className="muted">
                {par.par !== null ? `Par ${par.par}` : ''}
                {best ? ` · your best ${best}` : ''}
                {spikesUp(state.moves) ? ' · spikes are up' : ''}
              </span>
            )}
          </p>
          {state.over === 'won' && (
            <CopyLink
              text={`🧩 I got out of “${level.name}” in ${state.moves} moves. Your turn:\n${link}`}
              label="🔗 Copy a link to this room"
            />
          )}
        </>
      )}

      {mode === 'build' && (
        <div className="lv-build">
          <div className="lv-palette" role="group" aria-label="Paint with">
            {TILES.map((t) => (
              <button
                key={t}
                className="btn btn-ghost lv-tile"
                aria-pressed={brush === t}
                onClick={() => setBrush(t)}
              >
                <TileIcon t={t} theme={draft.theme} />
                {TILE_NAMES[t]}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <label className="fw-name">
              <span className="sr-only">Room name</span>
              <input
                value={draft.name}
                maxLength={24}
                onChange={(e) => setDraft((l) => ({ ...l, name: e.target.value }))}
                placeholder="Room name"
              />
            </label>
            <div className="lab-group" role="group" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t}
                  className="btn btn-ghost"
                  aria-pressed={draft.theme === t}
                  onClick={() => setDraft((l) => ({ ...l, theme: t }))}
                >
                  {THEME_NAMES[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="lab-controls">
            <span className="fw-label">Hero</span>
            {HERO_COLOURS.map((c, i) => (
              <button
                key={c}
                className="fw-swatch"
                style={{ background: c }}
                aria-label={`Hero colour ${i + 1}`}
                aria-pressed={saved.hero.colour === i}
                onClick={() => setSaved((s) => ({ ...s, hero: { ...s.hero, colour: i } }))}
              />
            ))}
            <div className="lab-group" role="group" aria-label="Hat">
              {HATS.map((h) => (
                <button
                  key={h}
                  className="btn btn-ghost"
                  aria-pressed={saved.hero.hat === h}
                  onClick={() => setSaved((s) => ({ ...s, hero: { ...s.hero, hat: h } }))}
                >
                  {HAT_NAMES[h]}
                </button>
              ))}
            </div>
          </div>
          <div className="lab-controls">
            <button className="btn" onClick={() => setCheck(solve(draft))}>
              🔍 Check it
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setSource({ kind: 'draft' })
                setMode('play')
              }}
            >
              ▶ Play it
            </button>
            <button className="btn btn-ghost" onClick={() => setDraft(BLANK)}>
              New room
            </button>
            <label className="studio-pick">
              <span className="sr-only">Start from a room</span>
              <select
                value=""
                onChange={(e) => {
                  const r = ROOMS[Number(e.target.value)]
                  if (r) setDraft({ ...r, name: `${r.name} (mine)`.slice(0, 24) })
                }}
              >
                <option value="">Start from…</option>
                {ROOMS.map((r, i) => (
                  <option key={r.name} value={i}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="sun-reading" aria-live="polite">
            {check === null ? (
              <span className="muted">
                Check it to find out whether it can be done, and in how few moves.
              </span>
            ) : check.par !== null ? (
              <strong>It can be done in {check.par} moves. Keep it, or send it to somebody.</strong>
            ) : (
              <strong className="rps-bad">
                {check.reason === 'no start'
                  ? 'It needs a start.'
                  : check.reason === 'no exit'
                    ? 'It needs an exit.'
                    : check.reason === 'too big'
                      ? 'Too many crates to be sure — simplify it and check again.'
                      : 'Nobody can get out of this one yet.'}
              </strong>
            )}
          </p>
          {check?.par != null && (
            <div className="lab-controls">
              <button className="btn btn-ghost" onClick={keep}>
                Keep it
              </button>
              <CopyLink
                text={`🧩 I built a room, “${draft.name}”. Get out in ${check.par} moves if you can:\n${here()}#lab?demo=levels&room=${encode(draft)}`}
                label="🔗 Copy a link to this room"
              />
            </div>
          )}
        </div>
      )}
      <p className="muted lab-hint">
        Get to the exit — it opens once every coin is taken. Push crates (into holes to fill them),
        slide across ice, take a key to open a door of its colour (gold opens either), stand
        something on a plate to hold the gates open, and cross spikes when they are down: they rise
        after every odd move, so wait a turn (Space) to time it. Keys: arrows or WASD, Space waits,
        U undoes, R restarts; on a phone, swipe or use the pad. In Build, tap or drag to paint, or
        move the yellow square with the arrows and press Space. Every room is checked by a solver
        before it can be kept or sent, and par is the fewest moves it found.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------------------- drawing */

const PALETTES: Record<Theme, { floor: string; floor2: string; wall: string; wallLine: string }> = {
  dungeon: { floor: '#2e2838', floor2: '#332c3e', wall: '#6b5747', wallLine: '#4c3d31' },
  garden: { floor: '#5f9e4c', floor2: '#68a854', wall: '#2c5e2a', wallLine: '#214a20' },
  space: { floor: '#1f2635', floor2: '#232b3c', wall: '#56627a', wallLine: '#3b4558' },
}
const KEY_COLOURS = {
  keyR: '#ff5d5d',
  keyB: '#4d8dff',
  keyG: '#ffcc33',
  doorR: '#c43c3c',
  doorB: '#2f63c4',
}

function tile(
  ctx: CanvasRenderingContext2D,
  t: Square,
  theme: Theme,
  x: number,
  y: number,
  s: number,
  f: { spikesUp: boolean; exitOpen: boolean; gateOpen: boolean },
) {
  const pal = PALETTES[theme]
  const cx = x + s / 2
  const cy = y + s / 2
  ctx.fillStyle = ((x + y) / s) % 2 ? pal.floor : pal.floor2
  ctx.fillRect(x, y, s, s)
  const base = isCrate(t)
    ? t === 'crate'
      ? 'floor'
      : t === 'crateOnPlate'
        ? 'plate'
        : t === 'crateOnIce'
          ? 'ice'
          : 'spikes'
    : t
  switch (base) {
    case 'wall':
      ctx.fillStyle = pal.wall
      ctx.fillRect(x, y, s, s)
      ctx.strokeStyle = pal.wallLine
      ctx.lineWidth = Math.max(1, s / 24)
      ctx.beginPath()
      ctx.moveTo(x, y + s / 2)
      ctx.lineTo(x + s, y + s / 2)
      ctx.moveTo(x + s / 2, y)
      ctx.lineTo(x + s / 2, y + s / 2)
      ctx.moveTo(x + s / 4, y + s / 2)
      ctx.lineTo(x + s / 4, y + s)
      ctx.stroke()
      break
    case 'hole':
      ctx.fillStyle = '#050508'
      ctx.beginPath()
      ctx.ellipse(cx, cy, s * 0.42, s * 0.36, 0, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'ice':
      ctx.fillStyle = '#bfe6ff'
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = Math.max(1, s / 20)
      ctx.beginPath()
      ctx.moveTo(x + s * 0.2, y + s * 0.6)
      ctx.lineTo(x + s * 0.45, y + s * 0.3)
      ctx.stroke()
      break
    case 'spikes':
      ctx.fillStyle = f.spikesUp ? '#d8d8e8' : '#6b6b80'
      for (const [px, py] of [
        [0.25, 0.3],
        [0.75, 0.3],
        [0.5, 0.7],
        [0.25, 0.8],
        [0.75, 0.8],
      ]) {
        const h = f.spikesUp ? s * 0.24 : s * 0.06
        ctx.beginPath()
        ctx.moveTo(x + px * s - s * 0.1, y + py * s + s * 0.08)
        ctx.lineTo(x + px * s, y + py * s + s * 0.08 - h)
        ctx.lineTo(x + px * s + s * 0.1, y + py * s + s * 0.08)
        ctx.fill()
      }
      break
    case 'plate':
      ctx.fillStyle = '#8a8a9a'
      ctx.fillRect(x + s * 0.18, y + s * 0.18, s * 0.64, s * 0.64)
      ctx.fillStyle = '#b5b5c5'
      ctx.fillRect(x + s * 0.24, y + s * 0.24, s * 0.52, s * 0.52)
      break
    case 'gate':
      ctx.strokeStyle = f.gateOpen ? 'rgba(200,200,220,0.25)' : '#c9c9d9'
      ctx.lineWidth = Math.max(2, s / 10)
      for (let k = 1; k <= 3; k++) {
        ctx.beginPath()
        ctx.moveTo(x + (k * s) / 4, y + 2)
        ctx.lineTo(x + (k * s) / 4, y + s - 2)
        ctx.stroke()
      }
      break
    case 'coin':
      ctx.fillStyle = '#ffd34d'
      ctx.beginPath()
      ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#e0a800'
      ctx.fillRect(cx - s * 0.04, cy - s * 0.12, s * 0.08, s * 0.24)
      break
    case 'exit':
      ctx.fillStyle = f.exitOpen ? '#7dffb2' : '#3c5a4a'
      for (let k = 0; k < 3; k++)
        ctx.fillRect(
          x + s * 0.18 + k * s * 0.1,
          y + s * (0.3 + k * 0.15),
          s * (0.64 - k * 0.2),
          s * 0.12,
        )
      if (f.exitOpen) {
        ctx.strokeStyle = 'rgba(125,255,178,0.6)'
        ctx.lineWidth = Math.max(1, s / 16)
        ctx.strokeRect(x + 2, y + 2, s - 4, s - 4)
      }
      break
    case 'start':
      ctx.strokeStyle = '#ffd34d'
      ctx.lineWidth = Math.max(1, s / 16)
      ctx.beginPath()
      ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2)
      ctx.stroke()
      break
    case 'keyR':
    case 'keyB':
    case 'keyG':
      ctx.strokeStyle = KEY_COLOURS[base]
      ctx.fillStyle = KEY_COLOURS[base]
      ctx.lineWidth = Math.max(2, s / 10)
      ctx.beginPath()
      ctx.arc(x + s * 0.35, cy, s * 0.14, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillRect(x + s * 0.47, cy - s * 0.04, s * 0.32, s * 0.08)
      ctx.fillRect(x + s * 0.68, cy, s * 0.06, s * 0.14)
      break
    case 'doorR':
    case 'doorB':
      ctx.fillStyle = KEY_COLOURS[base]
      ctx.fillRect(x + s * 0.1, y + s * 0.05, s * 0.8, s * 0.9)
      ctx.fillStyle = '#111'
      ctx.beginPath()
      ctx.arc(cx, cy - s * 0.05, s * 0.07, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(cx - s * 0.03, cy, s * 0.06, s * 0.15)
      break
  }
  if (isCrate(t)) {
    ctx.fillStyle = '#a0703c'
    ctx.fillRect(x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8)
    ctx.strokeStyle = '#6e4a22'
    ctx.lineWidth = Math.max(2, s / 12)
    ctx.strokeRect(x + s * 0.14, y + s * 0.14, s * 0.72, s * 0.72)
    ctx.beginPath()
    ctx.moveTo(x + s * 0.14, y + s * 0.14)
    ctx.lineTo(x + s * 0.86, y + s * 0.86)
    ctx.moveTo(x + s * 0.86, y + s * 0.14)
    ctx.lineTo(x + s * 0.14, y + s * 0.86)
    ctx.stroke()
  }
}

function hero(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  colour: number,
  hat: Hat,
  hurt: boolean,
) {
  const cx = x + s / 2
  const cy = y + s * 0.56
  ctx.fillStyle = hurt ? '#888' : HERO_COLOURS[colour]
  ctx.beginPath()
  ctx.arc(cx, cy, s * 0.32, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  for (const dx of [-0.11, 0.11]) {
    ctx.beginPath()
    ctx.arc(cx + dx * s, cy - s * 0.05, s * 0.08, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#111'
  for (const dx of [-0.1, 0.12]) {
    ctx.beginPath()
    ctx.arc(cx + dx * s, cy - s * 0.04, s * 0.04, 0, Math.PI * 2)
    ctx.fill()
  }
  const top = cy - s * 0.3
  ctx.fillStyle = '#ffd34d'
  if (hat === 'crown') {
    ctx.beginPath()
    ctx.moveTo(cx - s * 0.18, top + s * 0.04)
    for (const [px, py] of [
      [-0.18, -0.12],
      [-0.09, -0.02],
      [0, -0.14],
      [0.09, -0.02],
      [0.18, -0.12],
      [0.18, 0.04],
    ])
      ctx.lineTo(cx + px * s, top + py * s)
    ctx.fill()
  } else if (hat === 'cap') {
    ctx.fillStyle = '#e63946'
    ctx.beginPath()
    ctx.arc(cx, top + s * 0.06, s * 0.2, Math.PI, 0)
    ctx.fill()
    ctx.fillRect(cx, top + s * 0.03, s * 0.3, s * 0.05)
  } else if (hat === 'bow') {
    ctx.fillStyle = '#ff6fb5'
    ctx.beginPath()
    ctx.moveTo(cx, top)
    ctx.lineTo(cx - s * 0.16, top - s * 0.08)
    ctx.lineTo(cx - s * 0.16, top + s * 0.08)
    ctx.moveTo(cx, top)
    ctx.lineTo(cx + s * 0.16, top - s * 0.08)
    ctx.lineTo(cx + s * 0.16, top + s * 0.08)
    ctx.fill()
  } else if (hat === 'antenna') {
    ctx.strokeStyle = '#ddd'
    ctx.lineWidth = Math.max(1, s / 30)
    ctx.beginPath()
    ctx.moveTo(cx, top + s * 0.02)
    ctx.lineTo(cx + s * 0.08, top - s * 0.16)
    ctx.stroke()
    ctx.fillStyle = '#7dffb2'
    ctx.beginPath()
    ctx.arc(cx + s * 0.08, top - s * 0.18, s * 0.05, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** a tile drawn small for the palette, the same way the room draws it */
function TileIcon({ t, theme }: { t: Tile; theme: Theme }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const s = c.width
    tile(ctx, t === 'crate' ? 'crate' : t, theme, 0, 0, s, {
      spikesUp: true,
      exitOpen: true,
      gateOpen: false,
    })
  }, [t, theme])
  return <canvas ref={ref} width={44} height={44} className="lv-icon" aria-hidden />
}
