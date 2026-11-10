import { useEffect, useMemo, useRef, useState } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { hashParam, here } from '../lab/links'
import { CanvasStage } from './CanvasStage'
import {
  COLOURS,
  FIREWORKS_KEY,
  MAX_CUES,
  MAX_SAVED,
  MAX_SECONDS,
  PATTERNS,
  PATTERN_NAMES,
  PRESETS,
  RAINBOW,
  RISE,
  SCENES,
  apex,
  burst,
  decode,
  encode,
  lengthOf,
  readSaved,
  riseAt,
  seeded,
  settle,
  sparkAt,
  splitOf,
  type Cue,
  type Saved,
  type Scene,
  type Shell,
  type Show,
  type Spark,
} from './fireworks'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(FIREWORKS_KEY))
  } catch {
    return readSaved(null)
  }
}
const SCENE_NAMES: Record<Scene, string> = { city: 'City', hills: 'Hills', lake: 'Lake' }
/** after a tap places a shell, the playhead moves on this far, so taps lay a show out in order */
const STEP = 0.6
const rgb = (c: number, t: number) => {
  if (c === RAINBOW) {
    const h = (t * 120) % 360
    return `hsl(${h} 100% 65%)`
  }
  const [r, g, b] = COLOURS[c].rgb
  return `rgb(${r} ${g} ${b})`
}

/** the show to start with: a link's, then this browser's own, then the first preset */
function startShow(saved: Saved): { show: Show; fromLink: boolean } {
  const linked = hashParam('show')
  const fromLink = linked ? decode(linked) : null
  if (fromLink) return { show: fromLink, fromLink: true }
  const mine = saved.show ? decode(saved.show) : null
  return { show: mine ?? PRESETS[0].show, fromLink: false }
}

export function FireworksDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [start] = useState(() => startShow(saved))
  const [show, setShow] = useState<Show>(start.show)
  const [fromLink, setFromLink] = useState(start.fromLink)
  const [shell, setShell] = useState<Shell>(saved.shell)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [name, setName] = useState('')
  const [sure, setSure] = useState(false)
  /** the show's clock and what the frame loop draws, kept out of React so it can run each frame */
  const clock = useRef({ t: 0, playing: false, last: 0 })
  const live = useRef({ show, previews: [] as { cue: Cue; born: number }[] })
  live.current.show = show
  const roomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(FIREWORKS_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  // what is designed and composed is kept as you go — a shared show only once you change it
  useEffect(() => setSaved((s) => ({ ...s, shell })), [shell])
  useEffect(() => {
    if (!fromLink) setSaved((s) => ({ ...s, show: encode(show) }))
  }, [show, fromLink])
  // a show link clicked while the Lab is already open
  useEffect(() => {
    const on = () => {
      const linked = hashParam('show')
      const s = linked ? decode(linked) : null
      if (!s) return
      setShow(s)
      setFromLink(true)
      clock.current.t = 0
      clock.current.playing = false
      setPlaying(false)
      setTime(0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const length = Math.max(lengthOf(show), 6)
  const seek = (t: number) => {
    clock.current.t = Math.max(0, Math.min(MAX_SECONDS, t))
    setTime(clock.current.t)
  }
  const play = (on: boolean) => {
    if (on && clock.current.t >= lengthOf(live.current.show) - 0.1) seek(0)
    clock.current.playing = on
    setPlaying(on)
  }
  /** a shell set off at x (0–1): on the playhead in the show, and seen at once */
  const place = (x: number) => {
    const cues = live.current.show.cues
    if (cues.length >= MAX_CUES) return
    const at = Math.round(clock.current.t * 10) / 10
    const next = settle({ ...live.current.show, cues: [...cues, { at, x, seed: 1, shell }] })
    setShow(next)
    setFromLink(false)
    if (!clock.current.playing) {
      // not playing: the shell goes up now so you see what you placed, and the playhead moves on
      live.current.previews.push({
        cue: { at: 0, x, seed: 1 + Math.floor(Math.random() * 1e9), shell },
        born: performance.now() / 1000,
      })
      seek(clock.current.t + STEP)
    }
  }
  const tryIt = () =>
    live.current.previews.push({
      cue: { at: 0, x: 0.5, seed: 1 + Math.floor(Math.random() * 1e9), shell },
      born: performance.now() / 1000,
    })
  const undo = () => {
    const cues = [...show.cues]
    // the cue placed last is the one with the latest time at or before the playhead, else the last
    let k = -1
    for (let i = 0; i < cues.length; i++) if (cues[i].at <= clock.current.t + 0.05) k = i
    if (k < 0) k = cues.length - 1
    if (k < 0) return
    cues.splice(k, 1)
    setShow(settle({ ...show, cues }))
    setFromLink(false)
    seek(k >= 0 && cues[k - 1] ? cues[k - 1].at + STEP : 0)
  }
  const clear = () => {
    if (!sure) {
      setSure(true)
      return
    }
    setSure(false)
    setShow({ scene: show.scene, cues: [] })
    setFromLink(false)
    play(false)
    seek(0)
  }
  useEffect(() => {
    if (!sure) return
    const t = window.setTimeout(() => setSure(false), 3000)
    return () => window.clearTimeout(t)
  }, [sure])

  const keep = () => {
    const n = name.trim() || `Show ${saved.shows.length + 1}`
    setSaved((s) => ({
      ...s,
      shows: [
        { name: n.slice(0, 40), show: encode(show) },
        ...s.shows.filter((x) => x.name !== n),
      ].slice(0, MAX_SAVED),
    }))
    setName('')
  }
  const open = (text: string) => {
    const s = decode(text)
    if (!s) return
    setShow(s)
    setFromLink(false)
    play(false)
    seek(0)
  }

  const link = useMemo(() => `${here()}#lab?demo=fireworks&show=${encode(show)}`, [show])
  const set = (p: Partial<Shell>) => setShell((s) => ({ ...s, ...p }))

  return (
    <div
      className="lab-keys fw-room"
      tabIndex={-1}
      ref={roomRef}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('input, textarea, select')) return
        if (e.key >= '1' && e.key <= '9') {
          e.preventDefault()
          place(Number(e.key) / 10)
        } else if (e.key === ' ' && !(e.target as HTMLElement).closest('button')) {
          e.preventDefault()
          play(!clock.current.playing)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          e.stopPropagation()
          seek(clock.current.t + (e.key === 'ArrowLeft' ? -0.5 : 0.5))
        }
      }}
    >
      {fromLink && (
        <p className="beat-banner">
          🎆 <strong>A show somebody sent you</strong> — {show.cues.length} shells. Press Play to
          watch it; change anything and it becomes yours to keep.
        </p>
      )}
      <CanvasStage
        label={`Fireworks over a ${SCENE_NAMES[show.scene].toLowerCase()} at night. Tap the sky to set off a shell.`}
        className="fw-stage"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          place(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
        }}
        make={(ctx, canvas) => {
          const cache = new Map<string, Spark[]>()
          const sparksOf = (c: Cue) => {
            const k = `${c.seed}:${c.x}:${c.shell.pattern}:${c.shell.size}:${c.shell.colours}:${c.shell.height}:${c.shell.trail}:${c.shell.crackle}`
            let s = cache.get(k)
            if (!s) {
              s = burst(c.shell, c.x, apex(c.shell), c.seed)
              cache.set(k, s)
              if (cache.size > 400) cache.delete(cache.keys().next().value!)
            }
            return s
          }
          let lastUi = 0
          return {
            frame: (dt) => {
              const ck = clock.current
              const show = live.current.show
              if (ck.playing) {
                ck.t += dt
                const end = lengthOf(show)
                if (ck.t >= end) {
                  ck.t = end
                  ck.playing = false
                  setPlaying(false)
                }
              }
              const now = performance.now() / 1000
              if (now - lastUi > 0.1) {
                lastUi = now
                setTime(ck.t)
              }
              const { width: W, height: H } = canvas
              const lake = show.scene === 'lake'
              const ground = lake ? 0.22 : 0.12
              const X = (x: number) => x * W
              const Y = (y: number) => H - (ground + y * (1 - ground)) * H
              draw(ctx, W, H, show.scene, ground)
              ctx.save()
              ctx.globalCompositeOperation = 'lighter'
              const pen = Math.max(1.2, W / 500)
              const shellsAt = (cue: Cue, age: number) => {
                if (age < 0) return
                if (age < RISE) {
                  const [x, y] = riseAt(cue, age)
                  const [px, py] = riseAt(cue, Math.max(0, age - 0.12))
                  ctx.strokeStyle = 'rgba(255, 210, 150, 0.8)'
                  ctx.lineWidth = pen
                  ctx.beginPath()
                  ctx.moveTo(X(px), Y(py))
                  ctx.lineTo(X(x), Y(y))
                  ctx.stroke()
                  return
                }
                const b = age - RISE
                if (b < 0.12) {
                  // the flash of the burst
                  const g = ctx.createRadialGradient(
                    X(cue.x),
                    Y(apex(cue.shell)),
                    0,
                    X(cue.x),
                    Y(apex(cue.shell)),
                    W * 0.08,
                  )
                  g.addColorStop(0, `rgba(255,255,255,${0.5 * (1 - b / 0.12)})`)
                  g.addColorStop(1, 'rgba(255,255,255,0)')
                  ctx.fillStyle = g
                  ctx.fillRect(0, 0, W, H)
                }
                const sparks = sparksOf(cue)
                const crackle = cue.shell.crackle
                sparks.forEach((s, i) => {
                  spark(s, b, i, crackle)
                  if (s.splits && b > s.life * 0.6)
                    for (const k of splitOf(s, cue.seed + i)) spark(k, b - s.life * 0.6, i, crackle)
                })
              }
              const spark = (s: Spark, b: number, i: number, crackle: boolean) => {
                if (b < 0 || b > s.life) return
                const f = 1 - b / s.life
                if (s.strobe && Math.floor(b * 14 + i) % 2) return
                const [x, y] = sparkAt(s, b)
                const alpha = Math.min(1, f * 1.6) ** 1.3
                ctx.strokeStyle = rgb(s.colour, b + i * 0.01)
                ctx.globalAlpha = alpha
                ctx.lineWidth = pen * (0.8 + f)
                const [tx, ty] = sparkAt(s, Math.max(0, b - 0.05 - s.tail * 0.25))
                ctx.beginPath()
                ctx.moveTo(X(tx), Y(ty))
                ctx.lineTo(X(x) + 0.01, Y(y))
                ctx.stroke()
                if (lake) {
                  // the lake mirrors it across the far shore, squashed, dimmer and rippled
                  const shore = H - ground * H
                  const down = (yy: number) => shore + (shore - Y(yy)) * 0.35
                  ctx.globalAlpha = alpha * 0.25
                  const wob = Math.sin(y * 90 + b * 6) * W * 0.004
                  ctx.beginPath()
                  ctx.moveTo(X(tx) + wob, down(ty))
                  ctx.lineTo(X(x) + wob, down(y))
                  ctx.stroke()
                }
                // crackle: white pinpricks late in life
                if (crackle && b > s.life * 0.55 && (i * 7 + Math.floor(b * 30)) % 9 === 0) {
                  ctx.globalAlpha = 0.9
                  ctx.fillStyle = '#fff'
                  ctx.fillRect(
                    X(x) + ((i % 5) - 2) * pen * 2,
                    Y(y) + ((i % 3) - 1) * pen * 2,
                    pen * 1.2,
                    pen * 1.2,
                  )
                }
              }
              for (const cue of show.cues) shellsAt(cue, ck.t - cue.at)
              // shells set off by hand, outside the show's clock
              live.current.previews = live.current.previews.filter((p) => now - p.born < RISE + 5)
              for (const p of live.current.previews) shellsAt(p.cue, now - p.born)
              ctx.restore()
              ctx.globalAlpha = 1
            },
          }
        }}
      />

      <div className="fw-time">
        <button className="btn" onClick={() => play(!playing)} aria-keyshortcuts="Space">
          {playing ? '⏸ Pause' : '▶ Play show'}
        </button>
        <button className="btn btn-ghost" onClick={() => seek(0)} aria-label="Back to the start">
          ⏮
        </button>
        <label className="fw-scrub">
          <span className="sr-only">Show time</span>
          <span className="fw-marks" aria-hidden>
            {show.cues.map((c, i) => (
              <span
                key={i}
                style={{
                  left: `${(c.at / length) * 100}%`,
                  background: rgb(c.shell.colours[0], 0),
                }}
              />
            ))}
          </span>
          <input
            type="range"
            min={0}
            max={length}
            step={0.1}
            value={Math.min(time, length)}
            onChange={(e) => seek(Number(e.target.value))}
          />
        </label>
        <span className="lab-score">
          {time.toFixed(1)} s · {show.cues.length} shells
        </span>
      </div>

      <div className="fw-panel">
        <section aria-label="Design a shell">
          <h3 className="fw-h">Shell</h3>
          <div className="lab-group" role="group" aria-label="Burst">
            {PATTERNS.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={shell.pattern === p}
                onClick={() => set({ pattern: p })}
              >
                {PATTERN_NAMES[p]}
              </button>
            ))}
          </div>
          {[0, 1].map((k) => (
            <div
              key={k}
              className="fw-swatches"
              role="group"
              aria-label={k ? 'Second colour' : 'Colour'}
            >
              <span className="fw-label">{k ? 'Tips' : 'Colour'}</span>
              {COLOURS.map((c, i) => (
                <button
                  key={c.name}
                  className="fw-swatch"
                  aria-label={c.name}
                  aria-pressed={shell.colours[k] === i}
                  style={{
                    background:
                      i === RAINBOW
                        ? 'conic-gradient(red, orange, yellow, lime, cyan, blue, violet, red)'
                        : rgb(i, 0),
                  }}
                  onClick={() =>
                    set({
                      colours: (k ? [shell.colours[0], i] : [i, shell.colours[1]]) as [
                        number,
                        number,
                      ],
                    })
                  }
                />
              ))}
            </div>
          ))}
          <div className="lab-controls">
            <div className="lab-group" role="group" aria-label="Size">
              {(['Small', 'Medium', 'Large'] as const).map((n, i) => (
                <button
                  key={n}
                  className="btn btn-ghost"
                  aria-pressed={shell.size === i}
                  onClick={() => set({ size: i as 0 | 1 | 2 })}
                >
                  {n}
                </button>
              ))}
            </div>
            <label className="fw-height">
              <span>Height</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={shell.height}
                onChange={(e) => set({ height: Number(e.target.value) })}
              />
            </label>
            <button
              className="btn btn-ghost"
              aria-pressed={shell.trail}
              onClick={() => set({ trail: !shell.trail })}
            >
              Trails
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={shell.crackle}
              onClick={() => set({ crackle: !shell.crackle })}
            >
              Crackle
            </button>
            <button className="btn" onClick={tryIt}>
              🎆 Try it
            </button>
          </div>
        </section>

        <section aria-label="The show">
          <h3 className="fw-h">Show</h3>
          <div className="lab-controls">
            <div className="lab-group" role="group" aria-label="Scene">
              {SCENES.map((s) => (
                <button
                  key={s}
                  className="btn btn-ghost"
                  aria-pressed={show.scene === s}
                  onClick={() => {
                    setShow({ ...show, scene: s })
                    setFromLink(false)
                  }}
                >
                  {SCENE_NAMES[s]}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost" onClick={undo} disabled={!show.cues.length}>
              ↶ Undo shell
            </button>
            <button className="btn btn-ghost" onClick={clear} disabled={!show.cues.length}>
              {sure ? 'Really clear it?' : 'Clear show'}
            </button>
          </div>
          <div className="lab-controls">
            <span className="fw-label">Start from</span>
            {PRESETS.map((p) => (
              <button key={p.name} className="btn btn-ghost" onClick={() => open(encode(p.show))}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <label className="fw-name">
              <span className="sr-only">Name this show</span>
              <input
                value={name}
                maxLength={40}
                placeholder="Name this show"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="btn btn-ghost" onClick={keep} disabled={!show.cues.length}>
              Keep it
            </button>
            {saved.shows.map((s) => (
              <span key={s.name} className="fw-kept">
                <button className="btn btn-ghost" onClick={() => open(s.show)}>
                  {s.name}
                </button>
                <button
                  className="btn btn-ghost"
                  aria-label={`Forget ${s.name}`}
                  onClick={() =>
                    setSaved((v) => ({ ...v, shows: v.shows.filter((x) => x.name !== s.name) }))
                  }
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          {show.cues.length > 0 && (
            <CopyLink
              text={`🎆 Watch my fireworks show:\n${link}`}
              label="🔗 Copy a link to this show"
            />
          )}
        </section>
      </div>
      <p className="muted lab-hint">
        Design a shell, then tap the sky to set it off: it goes into the show at the playhead, which
        then moves on {STEP} s, so tapping across the sky lays a show out in order. Press Play while
        it runs and your taps land in time with it. Keys: 1–9 set a shell off from left to right,
        Space plays and pauses, ← → move the playhead. Up to {MAX_CUES} shells in {MAX_SECONDS} s.
        Every shell bursts the same way each time, so the show you send is the show they see.
      </p>
    </div>
  )
}

/* ---------------------------------------------------------------------------- the night */

function draw(ctx: CanvasRenderingContext2D, W: number, H: number, scene: Scene, ground: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#03030d')
  sky.addColorStop(1, scene === 'city' ? '#1a1430' : '#0b1430')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)
  // the same stars every frame
  const r = seeded(7)
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  for (let i = 0; i < 90; i++) {
    const x = r() * W
    const y = r() * H * (1 - ground) * 0.9
    const s = r() < 0.1 ? 1.6 : 1
    ctx.fillRect(x, y, s, s)
  }
  const top = H - ground * H
  if (scene === 'city') {
    const b = seeded(11)
    let x = 0
    while (x < W) {
      const w = W * (0.03 + b() * 0.06)
      const h = H * (0.05 + b() * 0.14)
      ctx.fillStyle = '#07070f'
      ctx.fillRect(x, H - h, w + 1, h)
      ctx.fillStyle = 'rgba(255, 214, 120, 0.55)'
      for (let wy = H - h + 6; wy < H - 6; wy += 9)
        for (let wx = x + 4; wx < x + w - 4; wx += 8) if (b() < 0.22) ctx.fillRect(wx, wy, 3, 4)
      x += w
    }
  } else if (scene === 'hills') {
    for (const [tone, amp, off] of [
      ['#0b1022', 0.09, 0.3],
      ['#05070f', 0.06, 1.7],
    ] as const) {
      ctx.fillStyle = tone
      ctx.beginPath()
      ctx.moveTo(0, H)
      for (let x = 0; x <= W; x += W / 60)
        ctx.lineTo(
          x,
          top - H * amp * (0.6 + 0.4 * Math.sin((x / W) * 5 + off) * Math.cos((x / W) * 2.3 + off)),
        )
      ctx.lineTo(W, H)
      ctx.fill()
    }
  } else {
    // the lake: dark water, a far shore
    ctx.fillStyle = '#04060c'
    ctx.fillRect(0, top, W, H - top)
    ctx.fillStyle = '#070b18'
    ctx.beginPath()
    ctx.moveTo(0, top)
    for (let x = 0; x <= W; x += W / 40) ctx.lineTo(x, top - H * 0.03 * (1 + Math.sin((x / W) * 9)))
    ctx.lineTo(W, top)
    ctx.fill()
  }
}
