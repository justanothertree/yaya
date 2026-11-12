import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { here } from '../lab/links'
import { daySeed } from './bricks'
import { CanvasStage } from './CanvasStage'
import {
  COLS,
  KINDS,
  MAPS,
  ROWS,
  SPEC,
  THEMES,
  TOWERS_KEY,
  at,
  build,
  callWave,
  canBuild,
  dailyMap,
  held,
  newGame,
  onPath,
  readSaved,
  sell,
  step,
  upgrade,
  type Event,
  type Game,
  type Kind,
  type Saved,
} from './towers'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

const KIND_NAMES: Record<Kind, string> = { dart: 'Darts', cannon: 'Cannon', frost: 'Frost' }
const KIND_ABOUT: Record<Kind, string> = {
  dart: 'quick shots at one',
  cannon: 'slow, and hits a bunch at once',
  frost: 'slows everything near where it lands',
}
const KIND_COLOUR: Record<Kind, string> = { dart: '#f2c12e', cannon: '#d9534f', frost: '#5bc0eb' }
const THEME_NAMES: Record<Saved['theme'], string> = {
  meadow: 'Meadow',
  desert: 'Desert',
  snow: 'Snow',
}
const LOOK: Record<Saved['theme'], { grass: string; grass2: string; path: string; edge: string }> =
  {
    meadow: { grass: '#5c9e4a', grass2: '#64a852', path: '#c9a46b', edge: '#a8844f' },
    desert: { grass: '#e2c27d', grass2: '#e8ca88', path: '#b78a55', edge: '#97703f' },
    snow: { grass: '#e6eef5', grass2: '#edf3f8', path: '#9fb3c4', edge: '#7f95a8' },
  }
type View = { s: number; ox: number; oy: number }
const fit = (w: number, h: number): View => {
  const s = Math.min(w / COLS, h / ROWS)
  return { s, ox: (w - COLS * s) / 2, oy: (h - ROWS * s) / 2 }
}

export function TowersDemo() {
  const [saved, setSaved] = useKept(TOWERS_KEY, readSaved)
  const day = daySeed(new Date())
  const today = useMemo(() => dailyMap(day), [day])
  const mapOf = (id: string) =>
    id === 'today' ? today : (MAPS.find((m) => m.id === id) ?? MAPS[0])
  const game = useRef<Game>(newGame(mapOf(saved.map)))
  const [playing, setPlaying] = useState(false)
  const [hud, setHud] = useState({
    coins: game.current.coins,
    lives: game.current.lives,
    wave: 0,
    held: 0,
    over: false,
    rest: 8,
    busy: false,
  })
  const [sel, setSel] = useState<{ c: number; r: number } | null>(null)
  const [cursor, setCursor] = useState({ c: 0, r: 0 })
  const [line, setLine] = useState(
    'Build a tower or two beside the path, then ▶ Start. Tap a square to build there.',
  )
  const [share, setShare] = useState('')
  const [, redraw] = useState(0)
  const playingRef = useRef(playing)
  playingRef.current = playing
  const savedRef = useRef(saved)
  savedRef.current = saved
  const selRef = useRef(sel)
  selRef.current = sel
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const view = useRef<View | null>(null)
  useEffect(() => {
    const hide = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])

  const sync = () => {
    const g = game.current
    setHud({
      coins: g.coins,
      lives: g.lives,
      wave: g.wave,
      held: held(g),
      over: g.over,
      rest: Math.ceil(g.rest),
      busy: g.queue.length + g.foes.length > 0,
    })
  }
  const change = (g: Game, said?: string) => {
    game.current = g
    sync()
    if (said) setLine(said)
    redraw((n) => n + 1)
  }
  const finish = (g: Game) => {
    const waves = held(g)
    const id = g.map.id.startsWith('day-') ? 'today' : g.map.id
    const prev =
      id === 'today'
        ? saved.today && saved.today.day === day
          ? saved.today.waves
          : 0
        : (saved.best[id] ?? 0)
    setSaved((s) => ({
      ...s,
      best: id === 'today' ? s.best : { ...s.best, [id]: Math.max(s.best[id] ?? 0, waves) },
      today:
        id === 'today'
          ? { day, waves: Math.max(s.today && s.today.day === day ? s.today.waves : 0, waves) }
          : s.today,
    }))
    setPlaying(false)
    setLine(
      `The field is overrun. You held ${waves} ${waves === 1 ? 'wave' : 'waves'}${waves > prev ? ' — a new best here!' : `; your best here is ${prev}.`}`,
    )
    if (id === 'today')
      setShare(`I held ${waves} waves on today's Towers field. Beat it:\n${here()}#lab?demo=towers`)
  }
  const onEvents = (g: Game, ev: Event[]) => {
    for (const e of ev) {
      if (e.kind === 'wave')
        setLine(
          `Wave ${e.n} is coming${e.n === 3 ? ' — runners now too' : e.n === 5 ? ' — and brutes' : ''}.`,
        )
      else if (e.kind === 'leak')
        setLine(
          `${e.n === 1 ? 'One' : e.n} got through — ${g.lives} ${g.lives === 1 ? 'life' : 'lives'} left.`,
        )
      else if (e.kind === 'cleared')
        setLine(`Wave ${e.n} held! +${20 + (e.n ?? 0) * 5} coins. The next comes in ten seconds.`)
    }
    if (g.over) finish(g)
  }

  const fresh = (id: string = saved.map) => {
    game.current = newGame(mapOf(id))
    setPlaying(false)
    setSel(null)
    setShare('')
    sync()
    setLine(`${mapOf(id).name}. Build a tower or two, then ▶ Start.`)
  }
  const pick = (c: number, r: number) => {
    const g = game.current
    setCursor({ c, r })
    if (onPath(g.map, c, r)) {
      setSel(null)
      setLine('That is the path — towers go beside it.')
      return
    }
    setSel({ c, r })
  }
  const doBuild = (kind: Kind) => {
    const s = selRef.current ?? cursorRef.current
    const g = game.current
    if (!canBuild(g, s.c, s.r, kind)) {
      setLine(
        g.coins < SPEC[kind].cost[0]
          ? `${KIND_NAMES[kind]} cost ${SPEC[kind].cost[0]} — you have ${g.coins}.`
          : 'You cannot build there.',
      )
      return
    }
    change(build(g, s.c, s.r, kind), `${KIND_NAMES[kind]} built.`)
    setSel(s)
  }
  const doUpgrade = () => {
    const s = selRef.current ?? cursorRef.current
    const before = game.current
    const g = upgrade(before, s.c, s.r)
    if (g === before)
      return setLine('No upgrade there — the tower is at its top level, or the coins are short.')
    change(g, 'Upgraded.')
  }
  const doSell = () => {
    const s = selRef.current ?? cursorRef.current
    const before = game.current
    const g = sell(before, s.c, s.r)
    if (g !== before) change(g, `Sold for ${g.coins - before.coins}.`)
  }

  const toCell = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    const v = view.current
    if (!v) return null
    const r = c.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * c.width
    const py = ((e.clientY - r.top) / r.height) * c.height
    const cc = Math.floor((px - v.ox) / v.s)
    const rr = Math.floor((py - v.oy) / v.s)
    return cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS ? { c: cc, r: rr } : null
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const d: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    }
    if (d[k]) {
      e.preventDefault()
      e.stopPropagation()
      const c = Math.max(0, Math.min(COLS - 1, cursor.c + d[k][0]))
      const r = Math.max(0, Math.min(ROWS - 1, cursor.r + d[k][1]))
      setCursor({ c, r })
      setSel(onPath(game.current.map, c, r) ? null : { c, r })
      return
    }
    if (k === '1' || k === '2' || k === '3') doBuild(KINDS[Number(k) - 1])
    else if (k === 'u') doUpgrade()
    else if (k === 's') doSell()
    else if (k === 'n') change(callWave(game.current), 'Here they come!')
    else if (k === ' ') {
      e.preventDefault()
      if (!game.current.over) setPlaying((p) => !p)
    } else return
  }

  const g = game.current
  const tower = sel ? g.towers.find((t) => t.c === sel.c && t.r === sel.r) : undefined
  const best =
    saved.map === 'today'
      ? saved.today && saved.today.day === day
        ? saved.today.waves
        : 0
      : (saved.best[saved.map] ?? 0)

  return (
    <div className="lab-keys tw-room">
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Field">
          {[
            ...MAPS.map((m) => ({ id: m.id, name: m.name })),
            { id: 'today', name: "Today's field" },
          ].map((m) => (
            <button
              key={m.id}
              className="btn btn-ghost"
              aria-pressed={saved.map === m.id}
              onClick={() => {
                setSaved((s) => ({ ...s, map: m.id }))
                fresh(m.id)
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>
      <div className="lab-controls">
        <button className="btn" onClick={() => (hud.over ? fresh() : setPlaying((p) => !p))}>
          {hud.over ? '↻ Play again' : playing ? '⏸ Pause' : '▶ Start'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => change(callWave(g), 'Here they come!')}
          disabled={hud.busy || hud.over || !playing}
        >
          ⏩ Next wave now (+{Math.ceil(hud.rest * 2)})
        </button>
        <button
          className="btn btn-ghost"
          aria-pressed={saved.fast}
          onClick={() => setSaved((s) => ({ ...s, fast: !s.fast }))}
        >
          Double speed
        </button>
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>
      <div className="dice-scores tw-hud">
        <div className="dice-score">
          <span>Coins</span>
          <strong>{hud.coins}</strong>
        </div>
        <div className="dice-score">
          <span>Lives</span>
          <strong>{hud.lives}</strong>
        </div>
        <div className="dice-score">
          <span>Wave</span>
          <strong>{hud.wave}</strong>
          <span className="muted">held {hud.held}</span>
        </div>
        <div className="dice-score">
          <span>Best here</span>
          <strong>{best}</strong>
        </div>
      </div>

      <div
        className={`tw-wrap${playing ? ' is-playing' : ''}`}
        tabIndex={0}
        role="group"
        aria-label="The field. Arrow keys move the square; 1, 2 and 3 build darts, cannon or frost there; U upgrades, S sells; Space starts and pauses; N calls the next wave."
        onKeyDown={onKey}
      >
        <CanvasStage
          className="tw-stage"
          label={`A field with a path. Wave ${hud.wave}, ${hud.lives} lives, ${hud.coins} coins, ${g.towers.length} towers.`}
          onPointerDown={(e) => {
            const cell = toCell(e)
            if (cell) pick(cell.c, cell.r)
          }}
          make={(ctx, c) => {
            let last = ''
            let hudKey = ''
            return {
              frame: (dt) => {
                let gm = game.current
                const s = savedRef.current
                if (playingRef.current && dt > 0 && !gm.over) {
                  const { game: next, events } = step(gm, dt * (s.fast ? 2 : 1))
                  game.current = gm = next
                  if (events.length) onEvents(gm, events)
                  const hk = `${gm.coins}|${gm.lives}|${gm.wave}|${gm.over}|${Math.ceil(gm.rest)}|${gm.queue.length + gm.foes.length > 0}`
                  if (hk !== hudKey) {
                    hudKey = hk
                    sync()
                  }
                }
                const se = selRef.current
                const cu = cursorRef.current
                const key = `${c.width}x${c.height}|${s.theme}|${gm.foes.map((f) => `${f.d.toFixed(2)}:${f.life}`).join(',')}|${gm.towers.map((t) => `${t.c},${t.r},${t.level}`).join(';')}|${gm.shots.length}|${se?.c},${se?.r}|${cu.c},${cu.r}`
                if (key === last) return
                last = key
                const v = fit(c.width, c.height)
                view.current = v
                const look = LOOK[s.theme]
                const X = (x: number) => v.ox + x * v.s
                const Y = (y: number) => v.oy + y * v.s
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.fillStyle = '#1b2a1b'
                ctx.fillRect(0, 0, c.width, c.height)
                for (let cc = 0; cc < COLS; cc++)
                  for (let rr = 0; rr < ROWS; rr++) {
                    ctx.fillStyle = (cc + rr) % 2 ? look.grass : look.grass2
                    ctx.fillRect(X(cc), Y(rr), v.s + 0.5, v.s + 0.5)
                  }
                for (const p of gm.map.path) {
                  ctx.fillStyle = look.path
                  ctx.fillRect(X(p.c), Y(p.r), v.s + 0.5, v.s + 0.5)
                }
                // the path's edges, and arrows at the two ends
                ctx.strokeStyle = look.edge
                ctx.lineWidth = Math.max(1, v.s * 0.06)
                ctx.beginPath()
                gm.map.path.forEach((p, k) =>
                  k
                    ? ctx.lineTo(X(p.c + 0.5), Y(p.r + 0.5))
                    : ctx.moveTo(X(p.c + 0.5), Y(p.r + 0.5)),
                )
                ctx.setLineDash([v.s * 0.15, v.s * 0.25])
                ctx.stroke()
                ctx.setLineDash([])
                // the reach of what is selected: a tower's range, or a dart's if building
                const ring = se
                  ? (gm.towers.find((t) => t.c === se.c && t.r === se.r) ?? null)
                  : null
                if (se) {
                  const range = ring ? SPEC[ring.kind].range[ring.level] : SPEC.dart.range[0]
                  ctx.fillStyle = 'rgba(255,255,255,0.15)'
                  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
                  ctx.beginPath()
                  ctx.arc(X(se.c + 0.5), Y(se.r + 0.5), range * v.s, 0, Math.PI * 2)
                  ctx.fill()
                  ctx.stroke()
                }
                for (const t of gm.towers) {
                  const x = X(t.c + 0.5)
                  const y = Y(t.r + 0.5)
                  ctx.fillStyle = '#3b3b44'
                  ctx.beginPath()
                  ctx.arc(x, y, v.s * 0.4, 0, Math.PI * 2)
                  ctx.fill()
                  ctx.fillStyle = KIND_COLOUR[t.kind]
                  ctx.beginPath()
                  if (t.kind === 'dart') {
                    ctx.moveTo(x, y - v.s * 0.28)
                    ctx.lineTo(x + v.s * 0.24, y + v.s * 0.2)
                    ctx.lineTo(x - v.s * 0.24, y + v.s * 0.2)
                  } else if (t.kind === 'cannon') ctx.arc(x, y, v.s * 0.24, 0, Math.PI * 2)
                  else {
                    for (let k = 0; k < 6; k++) {
                      const a = (k / 6) * Math.PI * 2
                      ctx.lineTo(x + Math.cos(a) * v.s * 0.27, y + Math.sin(a) * v.s * 0.27)
                    }
                  }
                  ctx.closePath()
                  ctx.fill()
                  // a pip for each level above the first
                  ctx.fillStyle = '#fff'
                  for (let k = 0; k < t.level; k++)
                    ctx.fillRect(
                      x - v.s * 0.2 + k * v.s * 0.16,
                      y + v.s * 0.3,
                      v.s * 0.1,
                      v.s * 0.08,
                    )
                }
                if (!reduced())
                  for (const sh of gm.shots) {
                    ctx.strokeStyle = KIND_COLOUR[sh.kind]
                    ctx.lineWidth = Math.max(1, v.s * 0.05)
                    ctx.beginPath()
                    ctx.moveTo(X(sh.from.c + 0.5), Y(sh.from.r + 0.5))
                    ctx.lineTo(X(sh.to.x), Y(sh.to.y))
                    ctx.stroke()
                  }
                for (const f of gm.foes) {
                  const p = at(gm.map, f.d)
                  const rad = v.s * (f.kind === 'brute' ? 0.32 : f.kind === 'runner' ? 0.18 : 0.23)
                  ctx.fillStyle =
                    f.kind === 'brute' ? '#5b2a86' : f.kind === 'runner' ? '#e8590c' : '#2b2d42'
                  if (f.chill > 0) ctx.fillStyle = '#7fb3d5'
                  ctx.beginPath()
                  ctx.arc(X(p.x), Y(p.y), rad, 0, Math.PI * 2)
                  ctx.fill()
                  // life left, as a bar over its head
                  ctx.fillStyle = 'rgba(0,0,0,0.5)'
                  ctx.fillRect(X(p.x) - rad, Y(p.y) - rad - v.s * 0.12, rad * 2, v.s * 0.07)
                  ctx.fillStyle = '#2fbf71'
                  ctx.fillRect(
                    X(p.x) - rad,
                    Y(p.y) - rad - v.s * 0.12,
                    rad * 2 * Math.max(0, f.life / f.full),
                    v.s * 0.07,
                  )
                }
                ctx.strokeStyle = '#ffb000'
                ctx.lineWidth = Math.max(2, v.s * 0.06)
                ctx.strokeRect(X(cu.c) + 1, Y(cu.r) + 1, v.s - 2, v.s - 2)
              },
            }
          }}
        />
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      {sel && !onPath(g.map, sel.c, sel.r) && (
        <div className="tw-panel" role="group" aria-label={tower ? 'This tower' : 'Build here'}>
          {tower ? (
            <>
              <p className="tw-what">
                {KIND_NAMES[tower.kind]}, level {tower.level + 1} — {KIND_ABOUT[tower.kind]}
              </p>
              <div className="lab-controls">
                <button
                  className="btn"
                  onClick={doUpgrade}
                  disabled={tower.level >= 2 || hud.coins < SPEC[tower.kind].cost[tower.level + 1]}
                >
                  {tower.level >= 2
                    ? 'At the top level'
                    : `⬆ Upgrade (${SPEC[tower.kind].cost[tower.level + 1]})`}
                </button>
                <button className="btn btn-ghost" onClick={doSell}>
                  Sell (+{Math.floor((tower.spent * 2) / 3)})
                </button>
              </div>
            </>
          ) : (
            <div className="lab-controls">
              {KINDS.map((k, i) => (
                <button
                  key={k}
                  className="btn btn-ghost tw-build"
                  onClick={() => doBuild(k)}
                  disabled={hud.coins < SPEC[k].cost[0] || hud.over}
                >
                  <span className="tw-dot" style={{ background: KIND_COLOUR[k] }} aria-hidden />
                  {KIND_NAMES[k]} · {SPEC[k].cost[0]}
                  <span className="muted"> {KIND_ABOUT[k]}</span>
                  <span className="sr-only"> (key {i + 1})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {share && <CopyLink text={share} label="🔗 Copy my waves" />}

      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Field</h3>
          <div className="lab-controls" role="group" aria-label="Ground">
            {THEMES.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={saved.theme === t}
                onClick={() => setSaved((s) => ({ ...s, theme: t }))}
              >
                {THEME_NAMES[t]}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Creatures walk the path from left to right; each one that gets across costs a life, and a
        brute three. Tap a square beside the path to build: darts shoot quickly at one, a cannon
        hits a bunch at once, frost slows them. Tap a tower to upgrade or sell it. Every wave held
        pays a bonus, and the next one is bigger and tougher — runners from the third, brutes from
        the fifth — so in the end the field is overrun; the score is how many waves you held.
        Today's field is new each day and the same for everyone. Keys: arrows move the square, 1 2 3
        build, U upgrades, S sells, Space starts and pauses, N calls the next wave early.
      </p>
    </div>
  )
}
