import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  TAPS,
  binCount,
  fftSize,
  liveTaps,
  readSpectrum,
  readSpectrumAll,
  readWaveform,
  readWaveformAll,
  binCountAll,
  fftSizeAll,
  subscribeTaps,
  type TapId,
} from '../audio/audioTap'
import { localMicOn, monitorOn, setMonitor, startLocalMic, stopLocalMic } from '../audio/localMic'
import { playCallSound } from '../voice/ringtone'
import {
  VISUALS,
  ART_STYLES,
  type ArtStyle,
  defaultTrail,
  makeVisual,
  ownsItsBuffer,
  type Ink,
  type VisualId,
} from '../audio/visualModes'
import { makeFeatureReader } from '../audio/audioFeatures'
import { PALETTES, paletteById } from '../audio/palettes'
import { PATHS, pathPoint, type PathId } from '../audio/autoPath'
import { gallery, subscribeGallery } from '../draw/gallery'
import { bakeSize, bakeSprite, type Sprite } from '../audio/artSprite'
import { useSharedWindow } from '../party/useSharedWindow'
import { motionReduced, onMotionChange } from '../ui/motion'
import { InCanvasWindow } from '../circuit/ui/canvasContext'
import { storedNumber } from '../ui/storedNumber'
import {
  musicName,
  playFile,
  sharedOn,
  shareTabAudio,
  stopMusic,
  stopShared,
} from '../audio/musicSource'
import { onMixerChange, setVolume, volume, type Channel } from '../audio/mixer'
import { announceVizPrefs } from '../profile/audioBackdrop'

/**
 * A window that shows you the sound.
 *
 * ⚠️ THE PICTURE IS THE POINT, so it gets the room. This started as a modest canvas over a block
 * of controls, which is the shape of a settings page rather than of something you want to watch.
 * The stage now takes the whole pane and the controls collapse out of the way entirely; there is
 * a fullscreen button because the honest end state of "make the visuals the star" is nothing on
 * screen but the visuals.
 *
 * It never opens an audio graph of its own except for the mic button, which is explicitly asked
 * for. Everything else is read from analysers the call and the ringtone already had — see
 * audioTap.ts. Sources come and go on their own, and the picker subscribes rather than
 * snapshotting, so a call starting mid-frame becomes selectable without a refresh.
 *
 * TWO TOOLS APPLY TO EVERY MODE, which is what stops sixteen modes being sixteen private
 * implementations of the same ideas:
 *
 *   · Trails. Modes draw into an offscreen buffer that is only PARTLY erased each frame, so a
 *     line becomes a smear and a particle becomes a comet. Each mode ships a default, because the
 *     right amount is a property of the drawing (Nebula is nothing without it; Bars is unreadable
 *     with it) — but it is a dial, so any mode can be pushed somewhere its author didn't intend.
 *   · Mirror. The buffer is composited into N kaleidoscope wedges. Sixteen modes times six
 *     symmetries is a lot of pictures for one extra blit per wedge.
 */

const MODE_KEY = 'viz_mode_v1'
const SRC_KEY = 'viz_src_v1'
const GAIN_KEY = 'viz_gain_v1'
const PANEL_KEY = 'viz_panel_v1'
const MIRROR_KEY = 'viz_mirror_v1'
const PALETTE_KEY = 'viz_palette_v1'
const ZOOM_KEY = 'viz_zoom_v1'
const SPIN_KEY = 'viz_spin_v1'
const SHAKE_KEY = 'viz_shake_v1'
const SPLIT_KEY = 'viz_split_v1'
const ANCHOR_KEY = 'viz_anchor_v1'
/** Two taps closer together than this are one gesture. */
const DOUBLE_TAP_MS = 320
/** How long the mouse has to sit still before the controls duck out of the way. */
const IDLE_MS = 2600
const DEPTH_KEY = 'viz_depth_v1'
const PATH_KEY = 'viz_path_v1'
const PATHSPEED_KEY = 'viz_pathspeed_v1'
const BLOOM_KEY = 'viz_bloom_v1'
const BRIGHT_KEY = 'viz_bright_v1'
const ART_KEY = 'viz_art_v1'
const ARTSTYLE_KEY = 'viz_artstyle_v1'
const PUNCH_KEY = 'viz_punch_v1'
const ECHO_KEY = 'viz_echo_v1'
const TRAIL_KEY = 'viz_trail_v1'

const MIRRORS: Array<[number, string]> = [
  [1, 'Off'],
  [2, '2'],
  [3, '3'],
  [4, '4'],
  [6, '6'],
  [8, '8'],
]

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

const VISUAL_IDS = VISUALS.map(([id]) => id)
const PALETTE_IDS = PALETTES.map((p) => p.id)
const PATH_IDS = PATHS.map(([id]) => id)

/**
 * The panel, in four sections.
 *
 * Ordered by how often you reach for them: the mode is the thing you change constantly, the
 * source next, then how it looks, then the dials you set once and leave.
 */
type VizTab = 'modes' | 'sound' | 'look' | 'motion'
const VIZ_TABS: Array<[VizTab, string, string]> = [
  ['modes', '◉', 'Modes'],
  ['sound', '🔊', 'Sound'],
  ['look', '🎨', 'Look'],
  ['motion', '✨', 'Motion'],
]
const TAB_KEY = 'viz_tab_v1'
const TAB_IDS = VIZ_TABS.map(([id]) => id)

/**
 * "All" is a source you can pick, but not a tap that exists.
 *
 * ⚠️ Kept as a separate union rather than added to TapId, because everywhere else in the
 * codebase a TapId names one real analyser somebody registered. Letting a fictional id into that
 * type would mean every consumer — the backdrop, the readers, a future instrument room — has to
 * remember it is not real.
 */
const ALL = 'all' as const
type SrcChoice = TapId | typeof ALL
const TAP_IDS = [ALL, ...TAPS.map((t) => t.id)] as SrcChoice[]

/**
 * One output level.
 *
 * Subscribes to the mixer rather than owning the number, so a level changed anywhere — here, or
 * later from an instrument room or a call — shows up on every slider that displays it.
 */
function VolumeRow({ c, label }: { c: Channel; label: string }) {
  const [v, setV] = useState(() => volume(c))
  useEffect(() => onMixerChange(() => setV(volume(c))), [c])
  return (
    <label className="appearance-slider">
      <span className="muted">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={v}
        onChange={(e) => {
          const next = Number(e.target.value)
          setV(next)
          setVolume(c, next)
        }}
      />
      <span className="appearance-slider-val">{Math.round(v * 100)}%</span>
    </label>
  )
}

export function AudioVisualizer() {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  const [mode, setMode] = useState<VisualId>(() => readStored(MODE_KEY, VISUAL_IDS, 'bars'))
  const [src, setSrc] = useState<SrcChoice>(() => readStored(SRC_KEY, TAP_IDS, ALL))
  const [gain, setGain] = useState(() => {
    const v = Number(localStorage.getItem(GAIN_KEY))
    return Number.isFinite(v) && v >= 0.5 && v <= 4 ? v : 1.5
  })
  /**
   * ⚠️ Persisted, unlike before — and that omission was the bug.
   *
   * Trails lived only in component state, so it reset on every visit AND the site background had
   * no way to read it: the backdrop mirrors the visualiser through localStorage, and a setting
   * that never lands there is a setting the background can never follow. A stored value wins over
   * the mode's default, or picking a mode would silently undo a choice you had made by hand.
   */
  const [trail, setTrail] = useState(
    () =>
      storedNumber(TRAIL_KEY, 0, 0.97) ?? defaultTrail(readStored(MODE_KEY, VISUAL_IDS, 'bars')),
  )
  const [palette, setPalette] = useState(() => readStored(PALETTE_KEY, PALETTE_IDS, 'theme'))
  const [mirror, setMirror] = useState(() => {
    const v = Number(localStorage.getItem(MIRROR_KEY))
    return MIRRORS.some(([n]) => n === v) ? v : 1
  })
  const [panel, setPanel] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [zoom, setZoom] = useState(() => storedNumber(ZOOM_KEY, 0.3, 3) ?? 1)
  const [depth, setDepth] = useState(() => storedNumber(DEPTH_KEY, 0, 1) ?? 0)
  /* signed: negative turns the other way, and 0 in the middle is the off position */
  const [spin, setSpin] = useState(() => storedNumber(SPIN_KEY, -1, 1) ?? 0)
  const [shake, setShake] = useState(() => storedNumber(SHAKE_KEY, 0, 1) ?? 0)
  const [split, setSplit] = useState(() => storedNumber(SPLIT_KEY, 0, 1) ?? 0)
  /**
   * A pinned stand-in for the pointer, kept as FRACTIONS of the surface rather than pixels.
   *
   * ⚠️ Fractions because everything about this surface moves: the window resizes, a canvas pane
   * is dragged wider, and zoom changes what the modes think the canvas measures without a resize
   * happening at all. A remembered pixel would mean the pin drifting off the picture the first
   * time any of those changed — the same mistake that sent nebula into the corner.
   */
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(ANCHOR_KEY)
      if (!raw) return null
      const v = JSON.parse(raw) as { x?: unknown; y?: unknown }
      if (typeof v?.x !== 'number' || typeof v?.y !== 'number') return null
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null
      return { x: Math.max(0, Math.min(1, v.x)), y: Math.max(0, Math.min(1, v.y)) }
    } catch {
      return null
    }
  })
  const [path, setPath] = useState<PathId>(() => readStored(PATH_KEY, PATH_IDS, 'off'))
  const [pathSpeed, setPathSpeed] = useState(() => storedNumber(PATHSPEED_KEY, 0.02, 1) ?? 0.12)
  const [bloom, setBloom] = useState(() => storedNumber(BLOOM_KEY, 0, 1) ?? 0.25)
  /**
   * ⚠️ BRIGHTNESS IS FREE AND BLOOM IS NOT, which is the whole reason this control exists.
   *
   * Both make the picture lighter, but they charge completely differently. This one changes the
   * colour a shape is drawn in - the same pixels, different bytes - so it costs nothing at any
   * size. Bloom blurs a copy of the finished frame and adds it back on top, which is real work
   * per pixel every frame and is what makes a fullscreen visualiser expensive.
   *
   * People were reaching for bloom to fix darkness because it was the only lever there was. With
   * a brightness control the cheap want has a cheap answer, and bloom goes back to being the
   * effect it is rather than a workaround.
   */
  const [bright, setBright] = useState(() => storedNumber(BRIGHT_KEY, 0, 0.6) ?? 0.28)
  /**
   * ⚠️ SHOWN, because a picture that quietly softens itself is worse than one that says so.
   *
   * The governor only moves when frames are genuinely being missed, and it puts the resolution
   * straight back if dropping it did not help - but from the outside that is indistinguishable
   * from the mode just looking worse than you remembered. One honest line means it is never a
   * mystery, and it is the only way to tell "this mode is soft" from "this mode is being held
   * back". Stays hidden at full resolution, which is where it sits in a window.
   */
  const [renderQ, setRenderQ] = useState(1)

  /**
   * ⚠️ WHICH OF YOUR DRAWINGS, and how it is arranged. Only the `art` mode reads either.
   *
   * The drawing is chosen by id rather than copied in, so editing it in the paint room and
   * coming back shows the new version instead of a stale snapshot — and nothing here has to own
   * a second copy of somebody's picture.
   */
  const [artId, setArtId] = useState<string>(() => {
    try {
      return localStorage.getItem(ART_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [artStyle, setArtStyle] = useState<ArtStyle>(() => {
    try {
      const v = localStorage.getItem(ARTSTYLE_KEY)
      return v === 'totem' || v === 'bars' ? v : 'swarm'
    } catch {
      return 'swarm'
    }
  })
  const art = useSyncExternalStore(subscribeGallery, gallery, gallery)
  const chosenArt = art.find((a) => a.id === artId) ?? null
  /* ⚠️ a ref, so choosing a different drawing does not restart the whole render effect */
  const artRef = useRef(chosenArt)
  artRef.current = chosenArt
  const [punch, setPunch] = useState(() => storedNumber(PUNCH_KEY, 0, 1) ?? 0)
  const [echo, setEcho] = useState(() => storedNumber(ECHO_KEY, 0, 1) ?? 0)
  const [tab, setTab] = useState<VizTab>(() => readStored(TAB_KEY, TAB_IDS, 'modes'))
  const [full, setFull] = useState(false)

  /**
   * Looking at the same visualiser together.
   *
   * ⚠️ The DIALS travel, not the picture and not the sound. Everyone renders it themselves from
   * their own audio, which is why it stays sharp and interactive instead of being a video of
   * somebody's window — and in a call the audio is largely the same audio anyway, since the
   * source that matters is everyone in the room.
   *
   * `src` is deliberately part of it and `full` deliberately is not: which sound to watch is the
   * shared decision, whereas whether YOUR window is fullscreen is about your screen and nobody
   * else's. Volume is left out for the same reason — following somebody must never change how
   * loud your machine is.
   */
  const party = useSharedWindow(
    'visualizer',
    'Visualiser',
    () => ({
      mode,
      src,
      gain,
      mirror,
      trail,
      palette,
      zoom,
      depth,
      spin,
      shake,
      split,
      path,
      pathSpeed,
      bloom,
      bright,
      punch,
      echo,
    }),
    (d) => {
      if (!d || typeof d !== 'object') return
      const v = d as Record<string, unknown>
      // everything off the wire is checked against the same tables the UI offers, so a patched
      // peer cannot put this window into a state it has no controls for
      if (typeof v.mode === 'string' && VISUAL_IDS.includes(v.mode as VisualId))
        setMode(v.mode as VisualId)
      if (typeof v.src === 'string' && TAP_IDS.includes(v.src as SrcChoice))
        setSrc(v.src as SrcChoice)
      if (typeof v.palette === 'string' && PALETTE_IDS.includes(v.palette)) setPalette(v.palette)
      if (typeof v.path === 'string' && PATH_IDS.includes(v.path as PathId))
        setPath(v.path as PathId)
      if (typeof v.mirror === 'number' && MIRRORS.some(([n]) => n === v.mirror)) setMirror(v.mirror)
      const num = (k: string, lo: number, hi: number, set: (n: number) => void) => {
        const x = v[k]
        if (typeof x === 'number' && Number.isFinite(x)) set(Math.max(lo, Math.min(hi, x)))
      }
      num('gain', 0.2, 4, setGain)
      num('trail', 0, 0.97, setTrail)
      num('zoom', 0.3, 3, setZoom)
      num('depth', 0, 1, setDepth)
      num('spin', -1, 1, setSpin)
      num('shake', 0, 1, setShake)
      num('split', 0, 1, setSplit)
      num('pathSpeed', 0.02, 1, setPathSpeed)
      num('bloom', 0, 1, setBloom)
      num('bright', 0, 0.6, setBright)
      num('punch', 0, 1, setPunch)
      num('echo', 0, 1, setEcho)
    },
  )

  /**
   * ⚠️ Pulled out of `party` so the effect below depends on VALUES rather than on the object the
   * hook returns. That object is a fresh literal every render, so listing it would run the effect
   * on every render forever — harmless here, since push is a no-op when you are not sharing, but
   * it is the shape of a bug and it costs nothing to not write.
   */
  const sharingViz = party.sharing
  const pushViz = party.push

  /**
   * Push on every change, and let the throttle in shared.ts decide what actually goes out.
   *
   * ⚠️ Depends on the VALUES, not on a handler. Half of these move through paths that never
   * touch a click handler — a stored default, a mode changing its own trail, the background
   * wallpaper syncing — and a push wired to the buttons would silently miss every one of them.
   */
  useEffect(() => {
    if (sharingViz) pushViz()
  }, [
    mode,
    src,
    gain,
    mirror,
    trail,
    palette,
    zoom,
    depth,
    spin,
    shake,
    split,
    path,
    pathSpeed,
    bloom,
    bright,
    punch,
    echo,
    sharingViz,
    pushViz,
  ])
  // a canvas window sizes itself; see the note on the wrapper's class below
  const { inWindow } = useContext(InCanvasWindow)
  const [micBusy, setMicBusy] = useState(false)
  const [micOn, setMicOn] = useState(localMicOn)
  const [micDenied, setMicDenied] = useState(false)
  // ⚠️ Never restored from storage: a playback-of-your-own-mic setting that came back on by
  // itself would greet somebody with feedback on load.
  const [hearing, setHearing] = useState(monitorOn)
  const [track, setTrack] = useState('')
  const [sharing, setSharing] = useState(sharedOn)
  const [srcErr, setSrcErr] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const filePick = useRef<HTMLInputElement>(null)

  /**
   * The pointer, kept in a REF rather than in state.
   *
   * ⚠️ A mousemove that called setState would re-render this component on every pixel of
   * movement, and the render tears down and rebuilds the whole animation effect — the visual
   * would restart continuously and never draw anything. The loop reads the ref instead, so the
   * pointer reaches the canvas without React ever hearing about it.
   */
  /**
   * The dials the animation loop reads every frame.
   *
   * ⚠️ A ref, not the effect's dependency list. Zoom, depth and the auto-path change while you
   * drag a slider or spin a wheel; putting them in the deps would tear down and rebuild the whole
   * visual on every step of that drag — particles reseeded, spectrogram wiped, trails cleared.
   * The loop reads the current value instead, so they take effect instantly without a restart.
   */
  const dials = useRef({
    zoom,
    depth,
    path,
    pathSpeed,
    bloom,
    bright,
    punch,
    echo,
    artStyle,
    spin,
    anchor,
    shake,
    split,
  })
  dials.current = {
    zoom,
    depth,
    path,
    pathSpeed,
    bloom,
    bright,
    punch,
    echo,
    artStyle,
    spin,
    anchor,
    shake,
    split,
  }

  const ptr = useRef({
    x: 0,
    y: 0,
    inside: false,
    vx: 0,
    vy: 0,
    down: false,
    sinceClick: 99,
    clickX: 0,
    clickY: 0,
  })

  const live = useSyncExternalStore(
    subscribeTaps,
    useCallback(() => liveTaps().join(','), []),
    useCallback(() => '', []),
  )
  const liveSet = live ? live.split(',') : []

  const [reduced, setReduced] = useState(motionReduced)
  useEffect(() => onMotionChange(() => setReduced(motionReduced())), [])

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
      localStorage.setItem(SRC_KEY, src)
      localStorage.setItem(GAIN_KEY, String(gain))
      localStorage.setItem(MIRROR_KEY, String(mirror))
      localStorage.setItem(PALETTE_KEY, palette)
      localStorage.setItem(ZOOM_KEY, String(zoom))
      localStorage.setItem(DEPTH_KEY, String(depth))
      localStorage.setItem(SPIN_KEY, String(spin))
      localStorage.setItem(SHAKE_KEY, String(shake))
      localStorage.setItem(SPLIT_KEY, String(split))
      if (anchor) localStorage.setItem(ANCHOR_KEY, JSON.stringify(anchor))
      else localStorage.removeItem(ANCHOR_KEY)
      localStorage.setItem(PATH_KEY, path)
      localStorage.setItem(PATHSPEED_KEY, String(pathSpeed))
      localStorage.setItem(TAB_KEY, tab)
      localStorage.setItem(BLOOM_KEY, String(bloom))
      localStorage.setItem(BRIGHT_KEY, String(bright))
      localStorage.setItem(ART_KEY, artId)
      localStorage.setItem(ARTSTYLE_KEY, artStyle)
      localStorage.setItem(PUNCH_KEY, String(punch))
      localStorage.setItem(ECHO_KEY, String(echo))
      localStorage.setItem(TRAIL_KEY, String(trail))
      localStorage.setItem(PANEL_KEY, panel ? '1' : '0')
    } catch {
      /* private mode — the choices still hold for this visit */
    }
    // the site background mirrors these, so tell it rather than making it poll localStorage
    announceVizPrefs()
  }, [
    mode,
    src,
    gain,
    mirror,
    trail,
    palette,
    zoom,
    depth,
    spin,
    shake,
    split,
    anchor,
    path,
    pathSpeed,
    bloom,
    bright,
    punch,
    echo,
    artId,
    artStyle,
    tab,
    panel,
  ])

  /**
   * ⚠️ Only the MICROPHONE is released on the way out.
   *
   * Music and tab audio deliberately keep playing: stopping them here is what made the player a
   * toy you had to stand still to use, and the AudioDock exists precisely so you can wander off
   * with the sound still going. The mic is different — it is a device with a recording
   * indicator, and leaving that burning because you clicked a link would be indefensible.
   */
  useEffect(
    () => () => {
      stopLocalMic()
    },
    [],
  )

  /**
   * H hides and shows the panel, F goes fullscreen.
   *
   * ⚠️ Ignored while a control has focus, or pressing H after clicking a slider would toggle
   * the panel out from under the thing you were adjusting. Bare keys, no modifiers, for the
   * reason the instrument's layout documents.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      if (e.key === 'h' || e.key === 'H') setPanel((v) => !v)
      // any key is also movement, so the duck-out clears — see the idle watcher
      if (e.key === 'f' || e.key === 'F') goFullRef.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /**
   * The controls step out of the way when you stop moving, and come back the moment you do.
   *
   * ⚠️ A SEPARATE STATE FROM `panel`, not a flip of it. `panel` is your choice and is remembered
   * between visits; this is a temporary duck-out. Folding the two together would mean going idle
   * quietly rewrote a preference — you would come back tomorrow to a panel you never chose to
   * hide — and moving the mouse would then "unhide" a panel you had deliberately put away.
   *
   * ⚠️ Never while the pointer is over the controls, and never while one of them has focus. The
   * whole failure mode of an auto-hiding panel is it vanishing out from under the slider you are
   * reaching for, and stillness is exactly what careful aiming looks like.
   */
  const [ducked, setDucked] = useState(false)
  useEffect(() => {
    if (!panel) return
    let timer = 0
    const overControls = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest('.viz-controls')
    const focusedControl = () => {
      const a = document.activeElement
      return !!a && a !== document.body && !!a.closest?.('.viz-controls')
    }
    const arm = (e?: Event) => {
      setDucked(false)
      window.clearTimeout(timer)
      if (overControls(e?.target ?? null) || focusedControl()) return
      timer = window.setTimeout(() => {
        if (!focusedControl()) setDucked(true)
      }, IDLE_MS)
    }
    arm()
    window.addEventListener('pointermove', arm, { passive: true })
    window.addEventListener('pointerdown', arm, { passive: true })
    window.addEventListener('keydown', arm)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', arm)
      window.removeEventListener('pointerdown', arm)
      window.removeEventListener('keydown', arm)
      setDucked(false)
    }
  }, [panel])
  const showPanel = panel && !ducked

  // fullscreen can also be left with Escape, which fires no click of ours — so track the browser
  // rather than assuming our own button is the only way out
  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === stage.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    if (reduced) return
    const box = host.current
    const cv = canvas.current
    if (!box || !cv) return
    const view = cv.getContext('2d')
    if (!view) return

    /**
     * Modes draw HERE, not onto the visible canvas.
     *
     * ⚠️ The buffer is what makes trails and mirroring possible at all. Persistence needs a
     * surface that survives the frame, and a kaleidoscope needs to composite the drawing several
     * times — neither works if the mode paints straight onto the canvas the viewer sees.
     */
    const buf = document.createElement('canvas')
    const ctx = buf.getContext('2d')
    if (!ctx) return

    /**
     * Where the glow is built, at a THIRD of the size.
     *
     * ⚠️ Downscaling is not a saving here, it is the technique. Blurring a third-size copy and
     * stretching it back gives a blur three times as wide for a ninth of the pixels — and the
     * softness hides the fact that it was ever small.
     *
     * Measured at 2880×1800 (fullscreen on a retina laptop), against the same glow width done
     * at full resolution with blur(15px):
     *
     *   third-size blur(5px)   747µs/frame    4.5% of a 60Hz frame
     *   full-size  blur(15px)  3984µs/frame  24%  of a 60Hz frame
     *
     * Five times cheaper for a picture nobody can tell apart, because the thing being stretched
     * is already a smooth gradient.
     */
    const glow = document.createElement('canvas')
    const gctx = glow.getContext('2d')

    // how hard the last beat hit, decaying — see the punch composite below
    let hit = 0
    // the spin the feedback copy carries, so an echo tunnel turns instead of just receding
    let swirl = 0
    /** how far the picture has turned so far, in radians */
    let spinA = 0
    /** which way the current knock threw the picture, held for its whole decay */
    let shakeDir = 0

    // how far the auto-path has travelled, in turns
    let pathT = 0
    const visual = makeVisual(mode)
    const owns = ownsItsBuffer(mode)
    const features = makeFeatureReader()
    let w = 0
    let h = 0
    let raf = 0
    let last = performance.now()
    let onScreen = true
    let visible = document.visibilityState === 'visible'
    let dpr = 1
    // the element size the canvas was last built for, so a drift can be spotted
    let cssW = -1
    let cssH = -1

    const spec = new Uint8Array(2048)
    const wav = new Uint8Array(2048)
    // a second buffer the mixer folds each source through, allocated once like the others
    const scratch = new Uint8Array(2048)
    // your pointer, converted into the zoomed drawing space — reused rather than rebuilt each
    // frame, for the same reason the buffers are
    const scaled = {
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
    // the pointer turned back out of the spin, reused rather than rebuilt each frame
    const turned = {
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
    // the auto-path's pointer, reused rather than rebuilt each frame
    const auto = {
      x: 0,
      y: 0,
      inside: true,
      vx: 0,
      vy: 0,
      down: false,
      sinceClick: 99,
      clickX: 0,
      clickY: 0,
    }

    const readInk = (): Ink => {
      const s = getComputedStyle(cv)
      const read = (name: string, fallback: [number, number, number]) => {
        const v = s.getPropertyValue(name).trim()
        const m = /^#?([0-9a-f]{6})$/i.exec(v)
        if (!m) return fallback
        const n = parseInt(m[1], 16)
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number]
      }
      return {
        accent: read('--accent', [34, 197, 94]),
        accent2: read('--accent-2', [239, 68, 68]),
        ink: read('--text', [238, 238, 248]),
        // empty for Theme, which is what makes hue() fall back to the accent pair
        stops: paletteById(palette).stops,
        lift: 0, // replaced every frame from the dial below
      }
    }
    let ink = readInk()

    /**
     * ⚠️ BAKED HERE, AND ONLY WHEN IT HAS TO BE. Rasterising a drawing is real work, so it is
     * done when the picture changes or when the canvas has grown enough that the old bake would
     * show — not every frame, and not on every resize nudge. `bakedAt` remembers the size it was
     * made for so a window being dragged does not rebuild it continuously.
     */
    let sprite: Sprite | null = null
    let bakedFor = ''
    let bakedAt = 0
    const freshenSprite = () => {
      const want = bakeSize(w, h)
      const drawing = artRef.current
      if (!drawing) {
        sprite = null
        bakedFor = ''
        return
      }
      const same = bakedFor === drawing.id && Math.abs(want - bakedAt) / Math.max(1, bakedAt) < 0.25
      if (same) return
      sprite = bakeSprite(drawing.art, want)
      bakedFor = drawing.id
      bakedAt = want
    }

    /**
     * ⚠️ HOW MANY PIXELS WE ARE ALLOWED TO DRAW, lowered when the drawing cannot keep up.
     *
     * Fullscreen on a retina laptop is 2880x1800, and a frame is not one pass over it. Trail
     * fades the whole buffer, mirror and echo each copy it back, bloom takes it down and puts it
     * back up: a busy frame writes the full canvas six or seven times, so roughly 35 million
     * pixels at 60Hz. That is what "it lagged my browser in fullscreen" is - fill rate, nothing
     * to do with which colours or how many shapes.
     *
     * Backing scale is the right dial because cost goes with its SQUARE: 0.7 is half the work,
     * 0.5 is a quarter. On a soft, glowing, trailed picture it is close to invisible, which is
     * the same trick the glow buffer already plays at a third size.
     *
     * Measured at 2880x1800, per frame: the whole-canvas compositing is only about 2.2ms, while
     * the aurora mode on its own is 32ms and weave is 26ms. So the expense is the MODE's drawing,
     * not the passes over the finished frame - and backing scale is still the right dial, because
     * that drawing is rasterisation and shrinks with it: aurora 32ms to 10ms at half scale, weave
     * 26ms to 7ms. See the frame loop for how it decides, which is less obvious than it looks.
     */
    let qual = 1
    let pace = 16.7
    let held = 0
    let probe: { before: number; at: number } | null = null

    const resize = () => {
      // clientWidth/Height, not getBoundingClientRect: a rect is the VISUAL size and includes
      // any transform an ancestor applies, so on a scaled page it disagrees with the layout the
      // canvas actually occupies
      cssW = box.clientWidth
      cssH = box.clientHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2) * qual
      w = Math.max(1, cssW)
      h = Math.max(1, cssH)
      for (const c of [cv, buf]) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      glow.width = Math.max(1, Math.round((w * dpr) / 3))
      glow.height = Math.max(1, Math.round((h * dpr) / 3))
      /**
       * ⚠️ THE BACKING BUFFER IS SET HERE; THE CSS SIZE IS NOT.
       *
       * It used to also write cv.style.width/height from this measurement, and inside a canvas
       * window that was wrong. A pane body carries `zoom` between 0.6 and 1 (scaleFor in
       * CircuitCanvas), and getBoundingClientRect reports the VISUAL size — already multiplied by
       * that zoom. Feeding the number back as a CSS length inside the same zoomed box multiplies
       * it again, so at zoom 0.6 the canvas rendered at 0.6 of its container: measured 144px
       * inside a 240px box. A drawing centred on a surface smaller than the space around it sits
       * up in the corner, which is precisely what "off-centre and not properly sizing" looks
       * like.
       *
       * The stylesheet already says width/height 100%. Letting it own the layout and using the
       * measurement only for pixel density is correct at any zoom.
       */
      view.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ink = readInk()
      freshenSprite()
      visual.init(w, h)
    }

    const frame = (now: number) => {
      /**
       * ⚠️ CHECK THE SIZE EVERY FRAME, rather than trusting the ResizeObserver.
       *
       * The panel's height changes when you switch tabs, which changes the surface beneath it —
       * and the observer did not fire for it. The canvas kept a bitmap sized for a 413px surface
       * while the element showed 311, so the drawing was scaled to a box it was not drawn for:
       * a band of the picture that never had anything painted into it. That is the blank
       * rectangle, and it moved with the tabs rather than the zoom, which is why it survived
       * every zoom fix.
       *
       * Two integer reads per frame is nothing next to the drawing, and it cannot miss a resize
       * whatever the cause — a hidden observer, a font load, a scrollbar appearing. The observer
       * stays as the fast path.
       */
      if (box.clientWidth !== cssW || box.clientHeight !== cssH) resize()

      const gap = now - last
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      const {
        zoom: z,
        depth: dep,
        path: pathId,
        pathSpeed: pspeed,
        bloom: blm,
        bright: bri,
        punch: pun,
        echo: ech,
        spin: spn,
        anchor: anc,
        shake: shk,
        split: spl,
      } = dials.current
      // one assignment a frame, rather than rebuilding ink: the modes read it through hue()
      ink.lift = bri
      // cheap: returns immediately unless the chosen drawing actually changed
      freshenSprite()
      const all = src === ALL
      const bins = Math.min(spec.length, all ? binCountAll() : binCount(src))
      const waveN = Math.min(wav.length, all ? fftSizeAll() : fftSize(src))
      const gotSpec = all ? readSpectrumAll(spec, scratch) : readSpectrum(src, spec)
      const gotWave = all ? readWaveformAll(wav, scratch) : readWaveform(src, wav)
      if (!gotSpec) spec.fill(0)
      if (!gotWave) wav.fill(128)
      if (gain !== 1 && gotSpec) {
        for (let i = 0; i < bins; i++) spec[i] = Math.min(255, spec[i] * gain)
      }
      if (gain !== 1 && gotWave) {
        for (let i = 0; i < waveN; i++) {
          wav[i] = Math.max(0, Math.min(255, 128 + (wav[i] - 128) * gain))
        }
      }
      // RMS from the buffer we already have — see the note in audioTap.readLevel about why this
      // is not a second read
      let sum = 0
      for (let i = 0; i < waveN; i++) {
        const v = (wav[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / Math.max(1, waveN)) * 2.5
      const f = features.read(spec, Math.max(1, bins), rms, dt)
      ptr.current.sinceClick += dt

      /**
       * Zoom is a change of SCALE on the drawing, not of the picture afterwards.
       *
       * ⚠️ Scaling the finished buffer would just magnify pixels — blurry going in, and no
       * extra detail coming out. Instead the modes are told the canvas is w/zoom across and the
       * transform is scaled to match, so they lay themselves out for that size and draw at full
       * resolution either way. Zooming out genuinely shows more of the pattern rather than a
       * smaller copy of the same one.
       */
      const vw = w / z
      const vh = h / z
      ctx.setTransform(dpr * z, 0, 0, dpr * z, 0, 0)

      /**
       * Persistence: erase only PART of the last frame.
       *
       * destination-out with a partial alpha subtracts opacity rather than painting over, which
       * keeps the buffer genuinely transparent. Filling with a background colour instead would
       * look identical on a dark page and leave an opaque slab on a light one.
       */
      if (!owns) {
        const fade = 1 - Math.max(0, Math.min(0.97, trail))
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = `rgba(0,0,0,${fade})`
        // ⚠️ vw/vh, not w/h. This runs under the zoom transform, so a rect of w would only
        // reach w×zoom of the way across the bitmap: zoomed out, the outer band of the buffer
        // never got faded and held a ring of stale frame that no trail setting could clear.
        ctx.fillRect(0, 0, vw, vh)
        ctx.globalCompositeOperation = 'source-over'
      }

      /**
       * The pointer the modes see: yours if it is over the canvas, otherwise the auto-path.
       *
       * ⚠️ YOURS HAS TO BE DIVIDED BY THE ZOOM. The modes were just told the canvas is w/zoom
       * across, but pointer events arrive in real CSS pixels — so at 2x every coordinate handed
       * to a mode was double what it should be. The cursor appeared to sit somewhere other than
       * where it was, and the "centre" a mode recentred on was off the canvas entirely. It only
       * lined up at exactly 1x, which is why zoom seemed to work sometimes and not others.
       *
       * Velocity and the click point scale too — they are lengths in the same space.
       */
      let seen = ptr.current
      if (seen.inside && z !== 1) {
        scaled.x = seen.x / z
        scaled.y = seen.y / z
        scaled.vx = seen.vx / z
        scaled.vy = seen.vy / z
        scaled.clickX = seen.clickX / z
        scaled.clickY = seen.clickY / z
        scaled.inside = true
        scaled.down = seen.down
        scaled.sinceClick = seen.sinceClick
        seen = scaled
      }
      /**
       * A pinned pointer, when there is one and your hand is not on the picture.
       *
       * ⚠️ Ranked BELOW your own pointer and ABOVE the auto-path, which is the same order the
       * auto-path already followed: whatever you are actually doing wins, and the fallbacks only
       * fill the gap. Pinning would be worthless if it fought the mouse, and pointless if the
       * path could talk over it.
       *
       * ⚠️ Zero velocity, deliberately. A pin is a place, not a gesture, and modes that read a
       * flick would otherwise inherit whatever speed the pointer happened to have when it left.
       */
      if (!seen.inside && anc) {
        auto.x = anc.x * vw
        auto.y = anc.y * vh
        auto.vx = 0
        auto.vy = 0
        auto.inside = true
        seen = auto
      } else if (!seen.inside && pathId !== 'off') {
        pathT += dt * pspeed
        const [nx, ny] = pathPoint(pathId, pathT)
        const px = vw / 2 + nx * vw * 0.38
        const py = vh / 2 + ny * vh * 0.38
        auto.vx = (px - auto.x) / Math.max(0.008, dt)
        auto.vy = (py - auto.y) / Math.max(0.008, dt)
        auto.x = px
        auto.y = py
        auto.inside = true
        seen = auto
      }

      /**
       * Feedback: the frame drawn into itself, slightly larger and slightly turned.
       *
       * ⚠️ Different in kind from Trails, which only fades what is already there. This COPIES the
       * picture back in transformed, so each repetition is a copy of a copy — which is where
       * infinite tunnels and spiral corridors come from, and why a single dot becomes a
       * receding chain rather than a smear.
       *
       * Drawn BEFORE the mode, so this frame's fresh drawing sits on top of the history rather
       * than being immediately swallowed by it. Scaling slightly above 1 pushes the echo outward
       * — below 1 pulls it into the middle, which reads as falling down a hole instead.
       */
      /**
       * ⚠️ The angle accumulates from ELAPSED TIME, not from a frame count. A dropped frame or a
       * 120Hz screen would otherwise change how fast the picture turns.
       */
      spinA += dt * spn * 1.2

      if (ech > 0.01) {
        swirl += dt * 0.35 * ech
        ctx.save()
        ctx.globalAlpha = 0.28 + ech * 0.5
        ctx.translate(vw / 2, vh / 2)
        ctx.rotate(Math.sin(swirl) * 0.02 * ech)
        const es = 1 + 0.035 * ech
        ctx.scale(es, es)
        ctx.translate(-vw / 2, -vh / 2)
        ctx.drawImage(ctx.canvas, 0, 0, vw, vh)
        ctx.restore()
      }

      /**
       * Spin: the drawing turns, the history does not.
       *
       * ⚠️ Applied around the MODE ONLY, after the trail fade and the feedback copy. Rotating
       * those as well would turn the whole accumulated picture every frame, and a trail that is
       * re-rotated on top of itself smears into a blurred disc within a second — the frames
       * behind are supposed to stay where they were drawn. Turning only the new drawing is what
       * makes a slow spin lay its history down as a spirograph instead.
       *
       * ⚠️ The pointer is turned the OTHER way by the same angle, so a mode still finds it under
       * the actual cursor. Without this, every pointer-driven mode would put its effect somewhere
       * else on the screen the moment the picture was turned, and the further it had spun the
       * further off it would be.
       */
      const turning = Math.abs(spn) > 0.001
      if (turning) {
        if (seen.inside) {
          const ca = Math.cos(-spinA)
          const sa = Math.sin(-spinA)
          const rx = seen.x - vw / 2
          const ry = seen.y - vh / 2
          turned.x = vw / 2 + rx * ca - ry * sa
          turned.y = vh / 2 + rx * sa + ry * ca
          turned.vx = seen.vx * ca - seen.vy * sa
          turned.vy = seen.vx * sa + seen.vy * ca
          const cx2 = seen.clickX - vw / 2
          const cy2 = seen.clickY - vh / 2
          turned.clickX = vw / 2 + cx2 * ca - cy2 * sa
          turned.clickY = vh / 2 + cx2 * sa + cy2 * ca
          turned.inside = true
          turned.down = seen.down
          turned.sinceClick = seen.sinceClick
          seen = turned
        }
        ctx.save()
        ctx.translate(vw / 2, vh / 2)
        ctx.rotate(spinA)
        ctx.translate(-vw / 2, -vh / 2)
      }

      visual.draw({
        ctx,
        w: vw,
        h: vh,
        dt,
        spec,
        bins: Math.max(1, bins),
        wave: wav,
        waveN: Math.max(2, waveN),
        f,
        p: seen,
        ink,
        art: sprite,
        artStyle: dials.current.artStyle,
      })

      if (turning) ctx.restore()

      view.clearRect(0, 0, w, h)

      /**
       * Punch: the whole picture leans toward you on an onset.
       *
       * The beat detector has existed since the first pass and only four modes ever used it.
       * Doing it at composite time means every mode answers the rhythm, including the ones with
       * no notion of a beat at all — a spectrogram cannot punch itself, but it can be punched.
       *
       * ⚠️ It DECAYS rather than switching, and the decay is per second rather than per frame,
       * or the same music would kick differently on a 60Hz screen and a 144Hz one.
       */
      hit = Math.max(0, hit - dt * 3.4)
      if (f.beat) hit = Math.max(hit, 0.35 + f.beatStrength * 0.65)
      const kick = 1 + hit * pun * 0.09
      /**
       * Shake: the same onset that drives Punch, spent on POSITION instead of scale.
       *
       * ⚠️ It reuses `hit` rather than detecting anything of its own, so a beat that punches also
       * shakes and the two stay in step — two independent decays would drift apart and read as
       * one effect being late.
       *
       * ⚠️ The direction is random per beat but HELD for the whole decay, not re-rolled each
       * frame. Re-rolling is a vibration, which looks like a fault; one shove that settles is what
       * a knock looks like.
       */
      if (f.beat) shakeDir = Math.random() * Math.PI * 2
      const shove = hit * shk * Math.min(w, h) * 0.045
      const moved = pun > 0.01 || shove > 0.05
      if (moved) {
        view.save()
        if (shove > 0.05) view.translate(Math.cos(shakeDir) * shove, Math.sin(shakeDir) * shove)
        if (pun > 0.01 && kick !== 1) {
          view.translate((w * (1 - kick)) / 2, (h * (1 - kick)) / 2)
          view.scale(kick, kick)
        }
      }

      /**
       * Depth: the same frame composited again at smaller scales, dimmer, behind itself.
       *
       * ⚠️ Drawn SMALLEST FIRST. These are meant to read as copies receding away from you, so
       * the far ones have to be underneath — painting them after the sharp one would put the
       * haze in front and look like fog on a window instead of distance.
       *
       * A real perspective projection would need every mode to think in three dimensions. This
       * costs one extra blit per layer and gives the eye the cue it actually uses: things further
       * away are smaller, fainter, and behind.
       */
      const echoes = dep > 0.02 ? Math.round(1 + dep * 3) : 0
      for (let e = echoes; e >= 1; e--) {
        const k = e / (echoes + 1)
        const scale = 1 - k * 0.55 * dep
        const alpha = (1 - k) * 0.55 * dep
        if (alpha <= 0.01) continue
        view.save()
        view.globalAlpha = alpha
        view.translate((w * (1 - scale)) / 2, (h * (1 - scale)) / 2)
        view.drawImage(buf, 0, 0, w * scale, h * scale)
        view.restore()
      }

      /**
       * Split: the picture again, twice, nudged apart and hue-shifted the other way.
       *
       * ⚠️ TWO EXTRA COPIES, not a per-pixel filter. A true chromatic aberration separates the
       * colour channels, which canvas cannot do without reading every pixel back — at 60fps on a
       * full-screen canvas that is the one thing certain to make a laptop fan spin. Offsetting the
       * whole frame and rotating its hue produces the same fringe on the edges, which is the part
       * anyone actually sees, for two drawImage calls.
       *
       * ⚠️ Underneath the sharp copy, and additively, so the fringes appear at the EDGES rather
       * than washing over the middle — the same reasoning as Bloom drawing last.
       */
      if (spl > 0.01) {
        const off = spl * Math.min(w, h) * 0.02
        view.save()
        view.globalCompositeOperation = 'lighter'
        view.globalAlpha = 0.4 + spl * 0.35
        view.filter = 'hue-rotate(-28deg)'
        view.drawImage(buf, -off, 0, w, h)
        view.filter = 'hue-rotate(28deg)'
        view.drawImage(buf, off, 0, w, h)
        view.filter = 'none'
        view.restore()
      }

      if (mirror <= 1) {
        view.drawImage(buf, 0, 0, w, h)
      } else {
        // Kaleidoscope: clip to a wedge, draw the whole buffer through it, repeat around the
        // circle. Alternate wedges are flipped so neighbouring edges meet rather than butting.
        const cx = w / 2
        const cy = h / 2
        const seg = (Math.PI * 2) / mirror
        const reach = Math.hypot(w, h)
        for (let i = 0; i < mirror; i++) {
          view.save()
          view.translate(cx, cy)
          view.rotate(i * seg)
          if (i % 2) view.scale(1, -1)
          view.beginPath()
          view.moveTo(0, 0)
          view.arc(0, 0, reach, -seg / 2, seg / 2)
          view.closePath()
          view.clip()
          view.translate(-cx, -cy)
          view.drawImage(buf, 0, 0, w, h)
          view.restore()
        }
      }
      /**
       * Bloom, added LAST and additively.
       *
       * ⚠️ 'lighter' rather than drawing over: glow is light arriving on top of what is already
       * there, so it has to add. Painted normally at partial alpha it would DIM the bright parts
       * it is supposed to be spilling out of, which looks like fog rather than brightness.
       *
       * Built from the composited view, not the buffer, so the mirror wedges and the depth
       * copies glow too — otherwise the sharp original would bloom and its own reflections would
       * not, which reads as a mistake even if you cannot say why.
       */
      if (blm > 0.01 && gctx) {
        gctx.setTransform(1, 0, 0, 1, 0, 0)
        gctx.clearRect(0, 0, glow.width, glow.height)
        gctx.filter = `blur(${(2 + blm * 5).toFixed(1)}px)`
        gctx.drawImage(cv, 0, 0, glow.width, glow.height)
        gctx.filter = 'none'
        view.save()
        view.globalCompositeOperation = 'lighter'
        view.globalAlpha = 0.35 + blm * 0.75
        view.drawImage(glow, 0, 0, w, h)
        view.restore()
      }

      if (moved) view.restore()

      /**
       * ⚠️ TIMING THE DRAWING WITH performance.now() MEASURES ALMOST NOTHING, which is how
       * the first version of this was wrong. Canvas 2D calls queue work and return; they do not
       * wait for it. Measured on the aurora mode at 2880x1800: the draw call takes 0.77ms to
       * return and the frame really costs 39ms. Ninety-seven per cent of the expense is invisible
       * to a clock wrapped around the call, and it is invisible for precisely the modes that
       * cause the problem. The only way to make that clock honest is to read a pixel back, and a
       * readback every frame stalls the pipeline it is trying to measure.
       *
       * So this watches the GAP BETWEEN FRAMES instead. The browser cannot present the next frame
       * until the last one is finished, so the cadence tells the truth about GPU work that no
       * timer in here can see.
       *
       * ⚠️ A SLOW CADENCE IS NOT PROOF THAT WE ARE THE CAUSE - it is also what a 30Hz
       * screen, a throttled tab or a busy machine looks like, and shrinking the canvas would then
       * cost quality for a problem that was never ours. So a step down is treated as an
       * EXPERIMENT: remember the cadence, take the step, and check afterwards whether it actually
       * helped. If it did not, put the resolution back and do not try again for half a minute.
       * Being able to tell "we are slow" from "something else is slow" is worth the one brief
       * probe it costs.
       */
      pace = pace * 0.9 + Math.min(200, gap) * 0.1
      held++
      if (probe) {
        if (held > 45) {
          // no real improvement means the pixels were never the problem: undo it and back off
          if (pace > probe.before * 0.88) {
            qual = probe.at
            resize()
            setRenderQ(qual)
            held = -1500
          } else {
            held = 0
          }
          probe = null
        }
      } else if (pace > 21 && qual > 0.5 && held > 90) {
        probe = { before: pace, at: qual }
        qual = Math.max(0.5, qual - 0.25)
        held = 0
        resize()
        setRenderQ(qual)
      } else if (pace < 17.5 && qual < 1 && held > 720) {
        qual = Math.min(1, qual + 0.25)
        held = 0
        resize()
        setRenderQ(qual)
      }

      raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (raf || !visible || !onScreen) return
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      if (!raf) return
      cancelAnimationFrame(raf)
      raf = 0
    }

    const ro = new ResizeObserver(() => resize())
    ro.observe(box)
    const io = new IntersectionObserver((es) => {
      onScreen = es.some((e) => e.isIntersecting)
      if (onScreen) start()
      else stop()
    })
    io.observe(box)
    const onVis = () => {
      visible = document.visibilityState === 'visible'
      if (visible) start()
      else stop()
    }
    document.addEventListener('visibilitychange', onVis)

    /**
     * Pointer, in the surface's own coordinates.
     *
     * Velocity is worked out here rather than in a mode, because it needs the time between two
     * real events — a mode only sees frames, and two frames can pass with no movement at all.
     */
    let lastMove = performance.now()
    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect()
      const nx = e.clientX - r.left
      const ny = e.clientY - r.top
      const now = performance.now()
      const gap = Math.max(0.008, (now - lastMove) / 1000)
      lastMove = now
      const q = ptr.current
      q.vx = (nx - q.x) / gap
      q.vy = (ny - q.y) / gap
      q.x = nx
      q.y = ny
      q.inside = true
    }
    const onLeave = () => {
      ptr.current.inside = false
      ptr.current.vx = 0
      ptr.current.vy = 0
    }
    const onDown = (e: PointerEvent) => {
      const r = box.getBoundingClientRect()
      const q = ptr.current
      q.down = true
      q.sinceClick = 0
      q.clickX = e.clientX - r.left
      q.clickY = e.clientY - r.top
    }
    /**
     * Double-tap the picture to go fullscreen, and back.
     *
     * ⚠️ TOUCH ONLY. With a mouse there is already a button and the F key, and a stray
     * double-click on the canvas is something people do — several modes answer clicks, so
     * stealing that gesture would fight them. On a phone there is no F key, the button is small,
     * and double-tapping the picture is what every video player has trained people to do.
     *
     * ⚠️ Not on the controls or the pin: tapping twice on a slider is ordinary use of a slider,
     * and a second tap on the pin is how you would grab it again after nudging it.
     */
    let lastTap = 0
    const onUp = (e: PointerEvent) => {
      ptr.current.down = false
      if (e.pointerType !== 'touch') return
      const t = e.target
      if (t instanceof Element && t.closest('.viz-controls, .viz-anchor, .viz-float')) return
      const now = performance.now()
      if (now - lastTap < DOUBLE_TAP_MS) {
        lastTap = 0
        goFullRef.current?.()
      } else lastTap = now
    }
    /**
     * The wheel zooms.
     *
     * ⚠️ preventDefault, or the page scrolls out from under the canvas while you are trying to
     * zoom it. Multiplicative steps rather than additive, because zoom is perceived in ratios: a
     * fixed +0.1 crawls when you are zoomed out and lurches when you are in.
     */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => {
        const next = z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)
        return Math.max(0.3, Math.min(3, Math.round(next * 100) / 100))
      })
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    box.addEventListener('pointermove', onMove)
    box.addEventListener('pointerleave', onLeave)
    box.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)

    resize()
    start()
    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      box.removeEventListener('wheel', onWheel)
      box.removeEventListener('pointermove', onMove)
      box.removeEventListener('pointerleave', onLeave)
      box.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }, [mode, src, gain, reduced, trail, mirror, palette])

  const pickMode = (id: VisualId) => {
    setMode(id)
    // each mode's own default, because the right amount of trail is a property of the drawing —
    // and it stays a dial, so this is a starting point rather than a decision
    setTrail(defaultTrail(id))
  }

  // the key handler is bound once, so it reaches the current goFull through a ref
  const goFullRef = useRef<(() => void) | null>(null)
  const goFull = () => {
    const el = stage.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen?.().catch(() => {})
  }

  const openFile = async (file: File | undefined) => {
    if (!file) return
    setSrcErr(null)
    const err = await playFile(file)
    if (err) {
      setSrcErr(err)
      setTrack('')
      return
    }
    setTrack(musicName())
    setSrc('music')
  }

  // "All" is live whenever anything is; a single source is live only if it is
  goFullRef.current = goFull

  const nothingOn = src === ALL ? liveSet.length === 0 : !liveSet.includes(src)
  const srcLabel = src === ALL ? 'anything' : (TAPS.find((t) => t.id === src)?.label ?? src)

  return (
    /**
     * ⚠️ A canvas window is NOT the viewport.
     *
     * The stage was sized with `62vh`, which is right on a page and meaningless inside a floating
     * window: the window has its own height, so on anything but a full-height window the canvas
     * was taller than the box containing it — overflowing, cropped, and visibly off-centre. In a
     * window the stage fills whatever it is given instead of asking the screen.
     */
    <section
      className={'viz-wrap' + (showPanel ? '' : ' is-bare') + (inWindow ? ' is-inwindow' : '')}
    >
      <div
        className="viz-stage"
        ref={stage}
        data-full={full || undefined}
        onDragOver={(e) => {
          // preventDefault is what MAKES this a drop target; without it the browser navigates
          // away to the file instead, which loses the page
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dragging) setDragging(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void openFile(e.dataTransfer.files?.[0])
        }}
      >
        <div className="viz-surface" ref={host}>
          <canvas ref={canvas} className="viz-canvas" aria-hidden />

          {/**
           * The pin, when there is one — drag it to say where the pointer-driven part of a mode
           * should sit without having to hold the mouse there.
           *
           * ⚠️ Positioned in PERCENTAGES, from the same fractions the loop reads, so the handle
           * and the effect cannot drift apart when the surface resizes or the zoom changes.
           *
           * ⚠️ Arrow keys move it too. It is a control, and a control that can only be dragged
           * cannot be used without a mouse — which on this particular one would be an odd thing
           * to ship, since the whole point is standing in for a pointer.
           */}
          {anchor && (
            <div
              className="viz-anchor"
              style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
              role="application"
              tabIndex={0}
              aria-label="Pinned pointer — drag or use the arrow keys to move it"
              title="Drag to move it. Double-click, or the button in Motion, to remove it."
              onDoubleClick={() => setAnchor(null)}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.08 : 0.02
                const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
                const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
                if (!dx && !dy) return
                e.preventDefault()
                /* ⚠️ and stop it here: the arrow keys page between sections of the site, so
                   nudging the pin one step to the right used to walk you off the visualiser
                   entirely — measured, it landed on the instrument */
                e.stopPropagation()
                setAnchor((a) =>
                  a
                    ? {
                        x: Math.max(0, Math.min(1, a.x + dx)),
                        y: Math.max(0, Math.min(1, a.y + dy)),
                      }
                    : a,
                )
              }}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const el = e.currentTarget
                el.setPointerCapture(e.pointerId)
                const move = (ev: PointerEvent) => {
                  const box = host.current
                  if (!box) return
                  const r = box.getBoundingClientRect()
                  if (r.width < 1 || r.height < 1) return
                  setAnchor({
                    x: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
                    y: Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)),
                  })
                }
                const up = () => {
                  el.removeEventListener('pointermove', move)
                  el.removeEventListener('pointerup', up)
                  el.removeEventListener('pointercancel', up)
                }
                el.addEventListener('pointermove', move)
                el.addEventListener('pointerup', up)
                el.addEventListener('pointercancel', up)
              }}
            />
          )}

          {/* ⚠️ Inside the SURFACE, not the stage. Anchored to the stage they sat at the
              bottom-right of whatever the stage currently contained — which since the panel moved
              in is the panel, so they landed on top of its controls, and below the stage they
              crowded the page's own footer links. Over the picture is the only place they belong,
              and the top corner is the one no mode fills. */}
          <div className="viz-float">
            {/* Reads the EFFECTIVE state, so the arrow always matches what you can see — but
                sets the remembered one. Pressing it while the controls have ducked away brings
                them back rather than telling them to hide, which is what they already are. */}
            <button
              className="btn viz-icon"
              onClick={() => {
                setDucked(false)
                setPanel(!showPanel)
              }}
              aria-expanded={showPanel}
              title={showPanel ? 'Hide the controls (H)' : 'Show the controls (H)'}
            >
              {showPanel ? '▴' : '▾'}
            </button>
            <button
              className="btn viz-icon"
              onClick={goFull}
              title={full ? 'Leave fullscreen (F)' : 'Fullscreen (F)'}
            >
              {full ? '⤡' : '⛶'}
            </button>
          </div>
        </div>

        {reduced && (
          <p className="viz-still muted">
            Paused — animations are off. Turn Reduce motion off in the ⚙ menu to watch it move.
          </p>
        )}
        {!reduced && nothingOn && (
          <p className="viz-still muted">
            Nothing playing on <strong>{srcLabel}</strong> yet.
            {src === ALL
              ? ' Drop a track on this page, use your mic, or play the instrument.'
              : src === 'local'
                ? ' Turn the mic on below.'
                : src === 'ring'
                  ? ' Try the ringtone below.'
                  : src === 'music'
                    ? ' Drop a track anywhere on this page.'
                    : src === 'instrument'
                      ? ' Open the Instrument page and play something.'
                      : ' Join a call and it will appear here.'}
          </p>
        )}

        {/* Floating over the picture rather than below it, so hiding the panel gives the visuals
            the whole pane instead of leaving a gap where the controls were. */}

        {/* Dropping a track anywhere on the picture loads it — the whole stage is the target,
            because aiming at a small strip is a worse experience than the feature is worth. */}
        {dragging && <div className="viz-drop">Drop a track to watch it</div>}

        {/* ⚠️ INSIDE the stage, not below it. Fullscreen shows one element and its
            descendants, so a control panel that is a SIBLING of the stage simply vanishes the
            moment you go fullscreen — which is exactly the state where you most want to change
            mode without leaving. In fullscreen the CSS floats this over the picture. */}
        {/**
         * ⚠️ Touching ANY control below stops you following a shared visualiser — one capture
         * handler on the container, rather than thirteen wrapped setters.
         *
         * Fighting an incoming update is the one behaviour nobody can work with: a slider that
         * springs back a fraction of a second after you move it reads as a broken site, not a
         * shared one. Capture phase so it lands before the control's own handler, and on the
         * container so a control added next year is covered without anyone remembering to wrap
         * it.
         */}
        {showPanel && (
          <div
            className="viz-controls"
            onPointerDownCapture={() => party.following && party.stopFollowing()}
            onKeyDownCapture={() => party.following && party.stopFollowing()}
          >
            {/**
             * ⚠️ TABS, because the panel had grown to nine rows and a sixteen-tile grid.
             *
             * On a page that cost screen space; in fullscreen it was worse than that — the
             * panel is pinned across the bottom there and nearly opaque, so a tall one blanked
             * a rectangle of the picture you had gone fullscreen to look at. One section at a
             * time keeps every control reachable in a strip instead of a wall.
             */}
            <div className="viz-tabs" role="tablist">
              {VIZ_TABS.map(([id, icon, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  className={'viz-tab' + (tab === id ? ' is-on' : '')}
                  onClick={() => setTab(id)}
                >
                  <span aria-hidden>{icon}</span> {label}
                </button>
              ))}
            </div>
            {tab === 'modes' && (
              <div className="viz-modes" role="group" aria-label="Visual style">
                {VISUALS.map(([id, icon, label]) => (
                  <button
                    key={id}
                    className={'fx-style-btn' + (mode === id ? ' is-on' : '')}
                    aria-pressed={mode === id}
                    onClick={() => pickMode(id)}
                  >
                    <span aria-hidden>{icon}</span>
                    <span className="fx-style-label">{label}</span>
                  </button>
                ))}
              </div>
            )}
            {/**
             * ⚠️ Right under the grid and only when Your art is chosen, because these settings
             * are meaningless for the other thirty modes and hiding them elsewhere would mean
             * picking a mode that draws a "pick a drawing" message with no drawing picker in
             * sight. A mode that needs an argument should ask for it where it was chosen.
             */}
            {tab === 'modes' && mode === 'art' && (
              <div className="viz-row viz-art" role="group" aria-label="Your art">
                {art.length === 0 ? (
                  <span className="muted">
                    Nothing in your gallery yet — draw something in Paint and press Keep.
                  </span>
                ) : (
                  <>
                    <span className="muted">Drawing</span>
                    <select
                      className="viz-art-pick"
                      value={artId}
                      onChange={(e) => setArtId(e.target.value)}
                      aria-label="Which drawing"
                    >
                      <option value="">Choose one…</option>
                      {art.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    {ART_STYLES.map(([id, label]) => (
                      <button
                        key={id}
                        className={'btn' + (artStyle === id ? ' is-on' : '')}
                        aria-pressed={artStyle === id}
                        onClick={() => setArtStyle(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            {tab === 'sound' && (
              <div className="viz-row" role="group" aria-label="Sound source">
                {/* Everything at once, and the default. Most of the time the honest answer to
                    "what should this watch" is "whatever is making noise", and singling out one
                    source is the special case rather than the norm. */}
                <button
                  className={'fx-style-btn viz-src' + (src === ALL ? ' is-on' : '')}
                  aria-pressed={src === ALL}
                  onClick={() => setSrc(ALL)}
                  title={
                    liveSet.length
                      ? `Mixing ${liveSet.length} live source${liveSet.length > 1 ? 's' : ''}`
                      : 'Nothing playing yet'
                  }
                >
                  <span className={'viz-dot' + (liveSet.length ? ' is-live' : '')} aria-hidden />
                  <span className="fx-style-label">
                    All{liveSet.length > 1 ? ` (${liveSet.length})` : ''}
                  </span>
                </button>
                {TAPS.map((t) => {
                  const on = liveSet.includes(t.id)
                  return (
                    <button
                      key={t.id}
                      className={'fx-style-btn viz-src' + (src === t.id ? ' is-on' : '')}
                      aria-pressed={src === t.id}
                      onClick={() => setSrc(t.id)}
                      title={on ? 'Live now' : 'Nothing playing'}
                    >
                      <span className={'viz-dot' + (on ? ' is-live' : '')} aria-hidden />
                      <span className="fx-style-label">{t.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {/* Where a track comes from. Both routes end at the same tap, so every mode and every
              tool works on music with no further plumbing. */}
            {tab === 'sound' && (
              <div className="viz-row viz-row-wide">
                <input
                  ref={filePick}
                  type="file"
                  accept="audio/*"
                  hidden
                  onChange={(e) => {
                    void openFile(e.target.files?.[0])
                    // cleared so choosing the SAME file twice still fires a change event
                    e.target.value = ''
                  }}
                />
                <button className="btn" onClick={() => filePick.current?.click()}>
                  🎵 Open a track
                </button>
                {track && (
                  <>
                    <span className="muted viz-track" title={track}>
                      {track}
                    </span>
                    <button
                      className="btn"
                      onClick={() => {
                        stopMusic()
                        setTrack('')
                      }}
                    >
                      ⏹ Stop
                    </button>
                  </>
                )}
                <button
                  className="btn"
                  aria-pressed={sharing}
                  onClick={async () => {
                    if (sharing) {
                      stopShared()
                      setSharing(false)
                      return
                    }
                    setSrcErr(null)
                    const err = await shareTabAudio()
                    if (err) {
                      setSrcErr(err)
                      return
                    }
                    if (sharedOn()) {
                      setSharing(true)
                      setSrc('shared')
                    }
                  }}
                  title="Watch what another tab is playing — Spotify, YouTube, anything"
                >
                  {sharing ? '⏹ Stop tab audio' : '🖥️ Tab audio'}
                </button>
              </div>
            )}
            {tab === 'sound' && srcErr && <p className="muted viz-note viz-warn">{srcErr}</p>}
            {/* ⚠️ These are OUTPUT levels and nothing else — see mixer.ts. They sit after the
              analyser branch, so turning the music down to a comfortable level does not shrink
              the picture, which is what a naive gain in the wrong place would do. */}
            {tab === 'sound' && (
              <div className="viz-row viz-row-wide">
                <VolumeRow c="music" label="🎵 Music" />
                {micOn && hearing && <VolumeRow c="monitor" label="🎧 Yourself" />}
              </div>
            )}
            {tab === 'motion' && (
              <div className="viz-row viz-row-wide">
                <label className="appearance-slider">
                  <span className="muted">Sensitivity</span>
                  <input
                    type="range"
                    min={0.5}
                    max={4}
                    step={0.1}
                    value={gain}
                    onChange={(e) => setGain(Number(e.target.value))}
                  />
                  <span className="appearance-slider-val">{gain.toFixed(1)}×</span>
                </label>
                {/**
                 * ⚠️ Trails is the one shared tool that does not apply to every mode, so it says
                 * so rather than sitting there doing nothing.
                 *
                 * A mode that owns its own buffer (Rain scrolls its history sideways) cannot
                 * have the buffer partly erased under it — the erase IS the trail, and doing it
                 * would eat the picture. Leaving the slider live and inert is the worst version:
                 * you drag it, nothing happens, and you conclude the feature is broken instead
                 * of that it does not apply here.
                 */}
                <label className="appearance-slider">
                  <span
                    className="muted"
                    title={
                      ownsItsBuffer(mode)
                        ? 'This mode keeps its own history, so trails do not apply to it'
                        : 'How much of each frame lingers'
                    }
                  >
                    Trails
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={0.97}
                    step={0.01}
                    value={trail}
                    disabled={ownsItsBuffer(mode)}
                    onChange={(e) => setTrail(Number(e.target.value))}
                  />
                  <span className="appearance-slider-val">
                    {ownsItsBuffer(mode) ? 'n/a' : `${Math.round(trail * 100)}%`}
                  </span>
                </label>
              </div>
            )}
            {/* Sixteen modes drawing two colours look more alike than they are — the eye reads
                the hue before the shape. A ramp changes all of them at once. */}
            {tab === 'look' && (
              <div className="viz-row viz-row-wide">
                <span className="muted viz-tool-label">Colour</span>
                <div className="viz-palettes">
                  {PALETTES.map((p) => (
                    <button
                      key={p.id}
                      className={'viz-swatch' + (palette === p.id ? ' is-on' : '')}
                      aria-pressed={palette === p.id}
                      onClick={() => setPalette(p.id)}
                      title={p.label}
                      style={
                        p.stops.length
                          ? {
                              background: `linear-gradient(90deg, ${p.stops
                                .map((c) => `rgb(${c[0]},${c[1]},${c[2]})`)
                                .join(',')})`,
                            }
                          : // Theme has no colours of its own, so its swatch shows yours
                            { background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }
                      }
                    >
                      <span className="viz-swatch-label">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {tab === 'motion' && (
              <div className="viz-row viz-row-wide">
                <label className="appearance-slider">
                  <span className="muted" title="Or spin the wheel over the picture">
                    Zoom
                  </span>
                  <input
                    type="range"
                    min={0.3}
                    max={3}
                    step={0.01}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                  />
                  <span className="appearance-slider-val">{zoom.toFixed(2)}×</span>
                </label>
                <label className="appearance-slider">
                  <span className="muted" title="The picture is knocked sideways on the beat">
                    Shake
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={shake}
                    onChange={(e) => setShake(Number(e.target.value))}
                  />
                  <span className="appearance-slider-val">{Math.round(shake * 100)}</span>
                </label>
                <label className="appearance-slider">
                  <span className="muted" title="Colour fringes, as if the lens could not agree">
                    Split
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={split}
                    onChange={(e) => setSplit(Number(e.target.value))}
                  />
                  <span className="appearance-slider-val">{Math.round(split * 100)}</span>
                </label>
                <label className="appearance-slider">
                  <span className="muted" title="Copies of the frame receding behind it">
                    Depth
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value))}
                  />
                  <span className="appearance-slider-val">{Math.round(depth * 100)}</span>
                </label>
                {/* ⚠️ Signed, with zero in the middle, so the off position is where a slider
                    naturally rests rather than at one end — and so it can turn either way. A
                    double-click puts it back to still, because finding exact zero by dragging a
                    continuous slider is fiddly. */}
                <label className="appearance-slider">
                  <span
                    className="muted"
                    title="Turn the drawing as it plays. Double-click to stop."
                  >
                    Spin
                  </span>
                  <input
                    className="viz-spin"
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={spin}
                    /**
                     * ⚠️ IT CATCHES AT THE MIDDLE. Still is the one setting on this slider you
                     * reach for deliberately and the only one you cannot see yourself hit — the
                     * picture keeps turning at 0.01 and there is no way to tell that from 0 by
                     * looking. A double-click reset was there and it is not the same thing: it
                     * asks you to know the trick, and it cannot help while you are already
                     * dragging. Anything inside a twentieth of the range snaps home, which is
                     * far too small to get in the way of choosing a slow spin.
                     */
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setSpin(Math.abs(v) < 0.05 ? 0 : v)
                    }}
                    onDoubleClick={() => setSpin(0)}
                  />
                  <span className="appearance-slider-val">
                    {spin === 0
                      ? 'still'
                      : `${spin > 0 ? '↻' : '↺'} ${Math.round(Math.abs(spin) * 100)}`}
                  </span>
                </label>
              </div>
            )}
            {/* The pointer driven by arithmetic instead of a hand — for watching rather than
                playing. Yours takes over the moment it is over the picture. */}
            {tab === 'motion' && (
              <div className="viz-row viz-row-wide">
                <span className="muted viz-tool-label">Motion</span>
                <select
                  className="viz-select"
                  value={path}
                  onChange={(e) => setPath(e.target.value as PathId)}
                >
                  {PATHS.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                {path !== 'off' && (
                  <label className="appearance-slider">
                    <span className="muted">Speed</span>
                    <input
                      type="range"
                      min={0.02}
                      max={1}
                      step={0.01}
                      value={pathSpeed}
                      onChange={(e) => setPathSpeed(Number(e.target.value))}
                    />
                    <span className="appearance-slider-val">{pathSpeed.toFixed(2)}</span>
                  </label>
                )}
                {/* ⚠️ Placed in the MIDDLE, not wherever the pointer happens to be. A pin that
                    appeared under the cursor would land on the button you just pressed, and the
                    first thing you would have to do is drag it off the controls. */}
                <button
                  className={'btn' + (anchor ? ' is-on' : '')}
                  aria-pressed={!!anchor}
                  onClick={() => setAnchor((a) => (a ? null : { x: 0.5, y: 0.5 }))}
                  title={
                    anchor
                      ? 'Remove the pin and let the motion take over again'
                      : 'Pin the pointer somewhere on the picture and leave it there'
                  }
                >
                  📍 {anchor ? 'Unpin' : 'Pin'}
                </button>
              </div>
            )}
            {/**
             * Watching it together.
             *
             * Only rendered inside a call, because that is the only place the party exists —
             * a button whose entire explanation is "start a call first" is a button that
             * should not be there yet.
             */}
            {party.available && (
              <div className="viz-row viz-row-wide viz-party">
                <button
                  className={'btn' + (party.sharing ? ' is-on' : '')}
                  aria-pressed={party.sharing}
                  onClick={() => (party.sharing ? party.stopSharing() : party.share())}
                  title={
                    party.sharing
                      ? 'Stop offering your visualiser to the call'
                      : 'Let the call watch your visualiser — your settings, their audio'
                  }
                >
                  {party.sharing ? '◉ Sharing' : '◎ Share this'}
                </button>

                {party.following ? (
                  <button
                    className="btn is-on"
                    onClick={party.stopFollowing}
                    title="Go back to your own settings"
                  >
                    ✓ Following {party.followingName}
                  </button>
                ) : (
                  party.offers.map((o) => (
                    <button
                      key={o.by}
                      className="btn"
                      onClick={() => party.follow(o.by)}
                      title={`Watch ${o.name}'s visualiser — their settings, your sound`}
                    >
                      Join {o.name}
                    </button>
                  ))
                )}

                {party.following && (
                  <span className="muted viz-party-note">Touch any control to take it back.</span>
                )}
              </div>
            )}

            {/* Three tools that act on the finished frame, so all sixteen modes get them at
                once — the same reason the ramp was worth more than another mode. */}
            {tab === 'look' && (
              <div className="viz-row viz-row-wide">
                {renderQ < 1 && (
                  <span className="muted viz-quality" role="status">
                    Drawing at {Math.round(renderQ * 100)}% resolution to hold the frame rate — it
                    goes back on its own when there is room.
                  </span>
                )}
                {/* ⚠️ before Bloom deliberately: this is the one that costs nothing, so it
                    should be the one you try first when the picture looks dark */}
                <label className="appearance-slider">
                  <span
                    className="muted"
                    title="Lifts the dark end of the palette — costs nothing, unlike Bloom"
                  >
                    Brightness
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={0.6}
                    step={0.01}
                    value={bright}
                    onChange={(e) => setBright(Number(e.target.value))}
                  />
                  <span className="appearance-slider-val">{Math.round((bright / 0.6) * 100)}</span>
                </label>
                <label className="appearance-slider">
                  <span className="muted" title="Bright areas spill light into what is around them">
                    Bloom
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={bloom}
                    onChange={(e) => setBloom(Number(e.target.value))}
                  />
                  <span className="appearance-slider-val">{Math.round(bloom * 100)}</span>
                </label>
                <label className="appearance-slider">
                  <span className="muted" title="The whole picture leans in on every beat">
                    Punch
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={punch}
                    onChange={(e) => setPunch(Number(e.target.value))}
                  />
                  <span className="appearance-slider-val">{Math.round(punch * 100)}</span>
                </label>
                <label className="appearance-slider">
                  <span
                    className="muted"
                    title="The frame drawn back into itself — tunnels and spirals"
                  >
                    Echo
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={echo}
                    onChange={(e) => setEcho(Number(e.target.value))}
                  />
                  <span className="appearance-slider-val">{Math.round(echo * 100)}</span>
                </label>
              </div>
            )}

            {/* ⚠️ Mirror is a LOOK control and lives with Colour. It shared a row with the mic
                buttons purely because they were added on the same day, and the tab split
                inherited that accident — so the kaleidoscope ended up filed under Sound. */}
            {tab === 'look' && (
              <div className="viz-row viz-row-wide">
                <span className="muted viz-tool-label">Mirror</span>
                <div className="viz-mirrors">
                  {MIRRORS.map(([n, label]) => (
                    <button
                      key={n}
                      className={'btn' + (mirror === n ? ' is-on' : '')}
                      aria-pressed={mirror === n}
                      data-active={mirror === n || undefined}
                      onClick={() => setMirror(n)}
                      title={n === 1 ? 'No symmetry' : `${n}-fold kaleidoscope`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tab === 'sound' && (
              <div className="viz-row viz-row-wide">
                <button
                  className="btn"
                  aria-pressed={micOn}
                  disabled={micBusy}
                  onClick={async () => {
                    if (micOn) {
                      stopLocalMic()
                      setMicOn(false)
                      setHearing(false)
                      setMicDenied(false)
                      return
                    }
                    setMicBusy(true)
                    const ok = await startLocalMic()
                    setMicBusy(false)
                    setMicOn(ok)
                    setMicDenied(!ok)
                    if (ok) setSrc('local')
                  }}
                >
                  {micOn ? '⏹ Stop mic' : micBusy ? 'Asking…' : '🎙 Use my mic'}
                </button>

                {micOn && (
                  <button
                    className="btn"
                    aria-pressed={hearing}
                    onClick={() => {
                      const next = !hearing
                      setMonitor(next)
                      setHearing(next)
                    }}
                    title={hearing ? 'Stop playing your mic back' : 'Play your mic back to hear it'}
                  >
                    {hearing ? '🔇 Stop listening' : '🎧 Hear myself'}
                  </button>
                )}

                <button
                  className="btn"
                  onClick={() => {
                    setSrc('ring')
                    playCallSound('ring')
                  }}
                >
                  🔔 Ringtone
                </button>
              </div>
            )}
            {hearing && (
              <p className="muted viz-note viz-warn">
                ⚠️ Headphones — on speakers your mic will hear itself and start to howl.
              </p>
            )}
            {micDenied && (
              <p className="muted viz-note">
                No microphone — the browser said no, or there isn’t one. Nothing was recorded either
                way.
              </p>
            )}
            {/* ⚠️ On the Sound tab only. It is a promise about the microphone and dropped
                files, so it belongs beside those controls — and repeating it under Modes and Look
                cost every tab a couple of lines of height for a sentence that did not apply
                there. The feedback warning above stays unconditional, because that one is about
                what is happening right now. */}
            {tab === 'sound' && (
              <p className="muted viz-note">
                Nothing is recorded or uploaded. A dropped file is played from your own disk, and
                the mic is read on this device and thrown away frame by frame.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
