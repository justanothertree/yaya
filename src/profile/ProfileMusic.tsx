import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { songNotes, type Song } from '../audio/songFile'
import { sharedCtx } from '../audio/context'
import {
  seekSong,
  songLength,
  songPlayerState,
  songPosition,
  playSong,
  stopSong,
  subscribeSongPlayer,
} from '../audio/songPlayer'
import {
  makeVisual,
  defaultTrail,
  readLift,
  VISUALS,
  type Ink,
  type VisualId,
} from '../audio/visualModes'
import { makeFeatureReader } from '../audio/audioFeatures'
import { paletteById } from '../audio/palettes'
import { binCount, fftSize, readSpectrum, readWaveform } from '../audio/audioTap'

/**
 * Somebody's music on their page, and something to watch while it plays.
 *
 * ⚠️ NOTHING IS HOSTED AND NOTHING IS EMBEDDED. A song here is the note events themselves, so
 * pressing play synthesises it in the visitor's own browser — no audio file, no upload, no CDN,
 * and no third party learning that somebody visited this page. That last part is why this is the
 * shape the profile got: an embed from a music service would put another company's scripts and
 * cookies in front of every visitor, which is a decision a profile owner cannot make on their
 * visitors' behalf.
 *
 * It also keeps the standing rule this block system was built on — every block is a fixed shape
 * the CLIENT renders from data, so there is no path from one person's config to another person's
 * markup, and no sanitiser to get wrong.
 */

/**
 * The shape of a song, drawn from the notes themselves.
 *
 * ⚠️ NOT A WAVEFORM, because there is no wave. A song here is notes, not audio — there is
 * nothing recorded to take an envelope from, and faking one would be drawing a picture of a
 * sound that does not exist. What a song DOES have is structure: when the notes fall, how high
 * they sit, how many at once, which layer they belong to. That is more honest than an amplitude
 * blob and, unlike one, it actually tells you where the chorus is.
 *
 * Cheap by construction: one rectangle per note, drawn once per song rather than per frame. The
 * playhead moves over the top of it and never causes a redraw of the notes.
 */
function drawSongMap(
  ctx: CanvasRenderingContext2D,
  song: Song,
  w: number,
  h: number,
  accent: string,
) {
  ctx.clearRect(0, 0, w, h)
  const len = songLength(song)
  if (len <= 0) return
  let lo = 127
  let hi = 0
  for (const l of song.layers)
    for (const e of l.events)
      if (e.on) {
        if (e.midi < lo) lo = e.midi
        if (e.midi > hi) hi = e.midi
      }
  if (hi < lo) return
  // ⚠️ padded, so a song on one note is a line through the middle rather than a bar along the top
  if (hi - lo < 6) {
    const mid = (hi + lo) / 2
    lo = mid - 3
    hi = mid + 3
  }
  const pad = 2
  const rows = Math.max(1, hi - lo)
  for (let li = 0; li < song.layers.length; li++) {
    const layer = song.layers[li]
    if (layer.muted) continue
    /* each layer its own tint of the accent, so parts are told apart without a legend */
    ctx.fillStyle = accent
    ctx.globalAlpha = 0.35 + 0.65 * (1 - li / Math.max(1, song.layers.length))
    const own = Math.max(0.05, layer.len)
    const reps = Math.max(1, Math.floor(len / own + 1e-6))
    const open = new Map<number, number>()
    for (const e of layer.events) {
      if (e.on) open.set(e.midi, e.t)
      else {
        const from = open.get(e.midi)
        if (from == null) continue
        open.delete(e.midi)
        for (let k = 0; k < reps; k++) {
          const a = (from + k * own) / len
          const b = Math.min(1, (e.t + k * own) / len)
          if (a >= 1) continue
          const x = a * w
          const y = pad + (1 - (e.midi - lo) / rows) * (h - pad * 2)
          ctx.fillRect(x, y - 1, Math.max(1.5, (b - a) * w), 2.5)
        }
      }
    }
  }
  ctx.globalAlpha = 1
}

export function SongBlock({
  id,
  songs,
  autoplay,
}: {
  id: string
  /** one song is a loop; several is a playlist — see the note on endOfPass in songPlayer */
  songs: Song[]
  /** start as the page opens, if the browser will allow it — see below */
  autoplay?: boolean
}) {
  const playing = useSyncExternalStore(subscribeSongPlayer, songPlayerState, songPlayerState)
  const [track, setTrack] = useState(0)
  const list = songs.length ? songs : []
  const song = list[Math.min(track, Math.max(0, list.length - 1))]
  const many = list.length > 1
  const isMe = playing.playing === id
  const bar = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const head = useRef<HTMLSpanElement>(null)

  // leaving the page must not leave the song going — this is somebody else's tab
  useEffect(() => () => stopSong(), [])

  /**
   * ⚠️ A BROWSER WILL NOT LET A PAGE MAKE NOISE AT SOMEBODY, and that is not a bug to work
   * around. Audio is blocked until the visitor has interacted with the page at all, so "autoplay"
   * here can only mean "start at the first opportunity" — trying and failing silently would leave
   * a setting that appears to do nothing on some visits and works on others, which is worse than
   * one that plainly waits.
   *
   * So it starts if sound is already allowed, and otherwise ARMS: the next press, tap or key
   * anywhere on the page starts it, once. That is the earliest a browser permits and the latest
   * anybody would call automatic.
   *
   * ⚠️ Once per mount, guarded by a ref. Without it every re-render while playing would try
   * to start the song again, which restarts it — the block re-renders whenever the player's state
   * changes, which is to say whenever it starts.
   */
  /**
   * ⚠️ THE HANDOVER IS RECREATED EACH TIME rather than a loop set up once. Each song is played
   * for a single pass and hands to the next when it ends, so "what plays after this" is decided
   * at the moment it is needed — which is the only way the answer can still be right after
   * somebody has pressed a different track halfway through.
   *
   * A single song keeps looping, because that is what one song on a page has always done.
   */
  const startAt = (n: number) => {
    const next = list[n]
    if (!next) return
    setTrack(n)
    if (!many) {
      playSong(id, next)
      return
    }
    playSong(id, next, () => startAt((n + 1) % list.length))
  }

  const armed = useRef(false)
  useEffect(() => {
    if (!autoplay || armed.current) return
    armed.current = true
    const go = () => {
      if (songPlayerState().playing) return
      startAt(0)
    }
    if (sharedCtx().state === 'running') {
      go()
      return
    }
    const once = () => {
      window.removeEventListener('pointerdown', once)
      window.removeEventListener('keydown', once)
      go()
    }
    window.addEventListener('pointerdown', once, { once: true })
    window.addEventListener('keydown', once, { once: true })
    return () => {
      window.removeEventListener('pointerdown', once)
      window.removeEventListener('keydown', once)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, id])

  /* the map is drawn when the song or the width changes, never per frame */
  useEffect(() => {
    const el = cv.current
    const box = bar.current
    if (!el || !box) return
    let lastW = 0
    const paint = () => {
      const w = Math.round(box.clientWidth)
      if (w < 1) return
      const h = 40
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      /* ⚠️ CSS size set explicitly and height fixed — the profile art block grew without bound
         by letting the backing store decide the layout, and this is the same shape of code */
      el.style.width = w + 'px'
      el.style.height = h + 'px'
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      const ctx = el.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const accent =
        getComputedStyle(el).getPropertyValue('--accent').trim() || 'rgba(124,106,247,1)'
      drawSongMap(ctx, song, w, h, accent)
      lastW = w
    }
    paint()
    const ro = new ResizeObserver(() => {
      if (Math.round(box.clientWidth) !== lastW) paint()
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [song])

  /**
   * ⚠️ The playhead is a transform written by rAF, never React state. It moves sixty times a
   * second; re-rendering a card that often to move one line would be the most expensive thing on
   * the page. Same reasoning as the piano roll's.
   */
  useEffect(() => {
    if (!isMe) {
      if (head.current) head.current.style.transform = 'scaleX(0)'
      return
    }
    let raf = 0
    const len = songLength(song)
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const el = head.current
      if (!el || len <= 0) return
      el.style.transform = `scaleX(${Math.max(0, Math.min(1, songPosition() / len))})`
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isMe, song])

  const scrub = (e: React.PointerEvent) => {
    const box = bar.current?.getBoundingClientRect()
    if (!box || box.width < 1) return
    // ⚠️ the rect's own width, so a scaled canvas window still scrubs where you pressed
    const f = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width))
    if (!isMe) startAt(track)
    seekSong(f * songLength(song))
  }

  if (!song) return null

  return (
    <div className="card profile-block profile-song">
      <div className="profile-song-head">
        <button
          className={'btn profile-song-play' + (isMe ? ' is-on' : '')}
          onClick={() => (isMe ? stopSong() : startAt(track))}
          aria-pressed={isMe}
          title={isMe ? 'Stop' : 'Play this'}
        >
          {isMe ? '⏹' : '▶'}
        </button>
        <span className="profile-song-name">{song.name}</span>
      </div>

      {/* ⚠️ a button, not a div with a click. It is the main control of this card, and it has to
          be reachable by a keyboard and announce itself like the play button does. */}
      <div
        ref={bar}
        className={'profile-song-bar' + (isMe ? ' is-playing' : '')}
        role="button"
        tabIndex={0}
        aria-label={`Scrub ${song.name}`}
        onPointerDown={scrub}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (isMe) stopSong()
            else startAt(track)
          }
        }}
      >
        <canvas ref={cv} aria-hidden />
        <span ref={head} className="profile-song-head-line" aria-hidden />
      </div>

      {many && (
        /* ⚠️ the list is the block's point when there is one, so it sits above the small print
           rather than behind a control — and the playing track is marked, not merely selected */
        <ol className="profile-song-list">
          {list.map((t, n) => (
            <li key={n}>
              <button
                className={'profile-song-track' + (n === track ? ' is-on' : '')}
                aria-current={n === track ? 'true' : undefined}
                onClick={() => startAt(n)}
              >
                <span className="profile-song-tracknum muted">
                  {isMe && n === track ? '▸' : n + 1}
                </span>
                <span className="profile-song-trackname">{t.name}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <span className="muted profile-song-meta">
        {many ? `${list.length} tracks · ` : ''}
        {song.layers.length} layer{song.layers.length === 1 ? '' : 's'} · {songNotes(song)} notes ·{' '}
        {song.bpm}bpm · played by your browser, not streamed
      </span>
    </div>
  )
}

/**
 * A visualiser somebody chose, watching whatever the page is playing.
 *
 * ⚠️ It reads the `instrument` tap, which is where the song player's own output already lands —
 * so the two blocks need nothing wired between them. Put a song block and one of these on a
 * profile and pressing play makes the picture move, because they are looking at the same synth.
 *
 * ⚠️ The loop stops dead when there is no sound and when the tab is hidden. A profile is not the
 * visualiser page; nobody came here to have a canvas repaint sixty times a second behind a bio,
 * and a decorative animation that runs while a laptop is on battery in a background tab is a rude
 * thing to ship.
 */
/** A dial off a stored config, clamped into the range its slider offers. */
const dial = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback

export function VisualBlock({ cfg }: { cfg: Record<string, unknown> }) {
  const box = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)

  const modeId = (
    typeof cfg.mode === 'string' && VISUALS.some(([id]) => id === cfg.mode) ? cfg.mode : 'bars'
  ) as VisualId
  const paletteId = typeof cfg.palette === 'string' ? cfg.palette : 'theme'
  /**
   * The same modifiers the visualiser page has.
   *
   * ⚠️ Every one is clamped here rather than trusted, because this config travels: it is
   * stored on a profile and rendered on a stranger's machine. A mirror count of 9,999 is 9,999
   * clipped composites per frame, which is a page that freezes a visitor's browser rather than
   * a page that looks unusual.
   */
  const mirror = Math.round(dial(cfg.mirror, 1, 8, 1))
  const trailCfg = typeof cfg.trail === 'number' ? dial(cfg.trail, 0, 0.97, 0) : null
  const bloom = dial(cfg.bloom, 0, 1, 0.25)
  const punch = dial(cfg.punch, 0, 1, 0)
  const echo = dial(cfg.echo, 0, 1, 0)

  useEffect(() => {
    const el = cv.current
    const host = box.current
    if (!el || !host) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    const visual = makeVisual(modeId)
    const features = makeFeatureReader()
    const spec = new Uint8Array(2048)
    const wave = new Uint8Array(2048)
    const trail = trailCfg ?? defaultTrail(modeId)
    /**
     * The same three-surface arrangement the visualiser page uses: modes draw into `buf`, the
     * composite lands on the visible canvas, and the glow is built small and stretched back.
     *
     * ⚠️ A mode CANNOT draw straight onto the visible canvas once there are shared tools.
     * Trails need a surface that survives the frame, and a kaleidoscope needs to composite one
     * drawing several times — neither works if the only surface is the one being shown.
     */
    const buf = document.createElement('canvas')
    const bctx = buf.getContext('2d')
    const glow = document.createElement('canvas')
    const gctx = glow.getContext('2d')
    if (!bctx) return
    let hit = 0
    let swirl = 0
    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let last = performance.now()
    let quiet = 0

    const ink = (): Ink => {
      const s = getComputedStyle(el)
      const read = (name: string, fallback: [number, number, number]) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(s.getPropertyValue(name).trim())
        if (!m) return fallback
        const n = parseInt(m[1], 16)
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number]
      }
      return {
        accent: read('--accent', [34, 197, 94]),
        accent2: read('--accent-2', [239, 68, 68]),
        ink: read('--text', [238, 238, 248]),
        stops: paletteById(paletteId).stops,
        lift: readLift(),
      }
    }
    let paint = ink()

    const resize = () => {
      const r = host.getBoundingClientRect()
      if (r.width < 1) return
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.round(r.width)
      h = Math.round(r.height)
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      buf.width = el.width
      buf.height = el.height
      glow.width = Math.max(1, Math.round(el.width / 3))
      glow.height = Math.max(1, Math.round(el.height / 3))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paint = ink()
      visual.init(w, h)
    }
    resize()

    const pointer = {
      x: 0,
      y: 0,
      inside: false,
      vx: 0,
      vy: 0,
      down: false,
      sinceClick: 99,
      clickX: 0,
      clickY: 0,
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      // same per-frame size check as the visualiser: an observer that never fires leaves a canvas
      // sized for a box that no longer exists, and nothing to notice it
      const r = host.getBoundingClientRect()
      if (r.width >= 1 && Math.abs(r.width - w) > 0.5) resize()
      if (w < 1 || h < 1) return

      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now

      const bins = Math.min(spec.length, binCount('instrument'))
      const got = readSpectrum('instrument', spec)
      const gotW = readWaveform('instrument', wave)
      if (!got) spec.fill(0)
      if (!gotW) wave.fill(128)

      let sum = 0
      const n = Math.min(wave.length, fftSize('instrument'))
      for (let i = 0; i < n; i++) {
        const v = (wave[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / Math.max(1, n)) * 2.5

      /**
       * ⚠️ Stop drawing when nothing is playing.
       *
       * Held for a moment rather than cut instantly, so a trail can finish rather than freezing
       * mid-smear — but a silent page settles to a still canvas within a second and stops costing
       * anything.
       */
      quiet = rms > 0.005 ? 0 : quiet + dt
      if (quiet > 1.2) return

      const f = features.read(spec, Math.max(1, bins), rms, dt)

      // trails: erase only part of the last frame, so a line becomes a smear
      bctx.globalCompositeOperation = 'destination-out'
      bctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, Math.min(0.97, trail))})`
      bctx.fillRect(0, 0, w, h)
      bctx.globalCompositeOperation = 'source-over'

      // echo: the frame drawn back into itself, slightly larger and slightly turned
      if (echo > 0.01) {
        swirl += dt * 0.35 * echo
        bctx.save()
        bctx.globalAlpha = 0.28 + echo * 0.5
        bctx.translate(w / 2, h / 2)
        bctx.rotate(Math.sin(swirl) * 0.02 * echo)
        const es = 1 + 0.035 * echo
        bctx.scale(es, es)
        bctx.translate(-w / 2, -h / 2)
        bctx.drawImage(bctx.canvas, 0, 0, w, h)
        bctx.restore()
      }

      visual.draw({
        ctx: bctx,
        w,
        h,
        dt,
        spec,
        bins: Math.max(1, bins),
        wave,
        waveN: Math.max(2, n),
        f,
        p: pointer,
        ink: paint,
      })

      // ── the composite ──────────────────────────────────────────────────
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, el.width, el.height)

      // punch: the whole picture leans in on an onset. Decays per SECOND, not per frame, or
      // the same music kicks differently on a 60Hz screen and a 144Hz one.
      hit = Math.max(0, hit - dt * 3.4)
      if (f.beat) hit = Math.max(hit, 0.35 + f.beatStrength * 0.65)
      const kick = 1 + hit * punch * 0.09
      if (punch > 0.01 && kick !== 1) {
        ctx.save()
        ctx.translate((el.width * (1 - kick)) / 2, (el.height * (1 - kick)) / 2)
        ctx.scale(kick, kick)
      }

      if (mirror <= 1) {
        ctx.drawImage(buf, 0, 0, el.width, el.height)
      } else {
        const cx = el.width / 2
        const cy = el.height / 2
        const seg = (Math.PI * 2) / mirror
        const reach = Math.hypot(el.width, el.height)
        for (let i = 0; i < mirror; i++) {
          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(i * seg)
          if (i % 2) ctx.scale(1, -1)
          ctx.beginPath()
          ctx.moveTo(0, 0)
          ctx.arc(0, 0, reach, -seg / 2, seg / 2)
          ctx.closePath()
          ctx.clip()
          ctx.translate(-cx, -cy)
          ctx.drawImage(buf, 0, 0, el.width, el.height)
          ctx.restore()
        }
      }

      // bloom: built at a third of the size and added with 'lighter', so bright areas spill
      if (bloom > 0.01 && gctx) {
        gctx.setTransform(1, 0, 0, 1, 0, 0)
        gctx.clearRect(0, 0, glow.width, glow.height)
        gctx.filter = `blur(${(2 + bloom * 5).toFixed(1)}px)`
        gctx.drawImage(el, 0, 0, glow.width, glow.height)
        gctx.filter = 'none'
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.35 + bloom * 0.75
        ctx.drawImage(glow, 0, 0, el.width, el.height)
        ctx.restore()
      }

      if (punch > 0.01 && kick !== 1) ctx.restore()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const start = () => {
      if (!raf && document.visibilityState === 'visible') {
        last = performance.now()
        quiet = 0
        raf = requestAnimationFrame(frame)
      }
    }
    const stop = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop())
    document.addEventListener('visibilitychange', onVis)

    // the song player is what wakes it up: subscribing means a silent page never spins the loop
    const offPlayer = subscribeSongPlayer(() => start())
    start()

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      offPlayer()
    }
  }, [modeId, paletteId, mirror, trailCfg, bloom, punch, echo])

  return (
    <div className="card profile-block profile-visual" ref={box}>
      <canvas ref={cv} aria-hidden />
    </div>
  )
}
