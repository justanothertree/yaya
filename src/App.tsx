import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { ContactForm } from './sections/ContactForm'
import { EvanCook, homePanes } from './sections/EvanCook'
import { site } from './config/site'
import { IconGitHub, IconLinkedIn } from './components/Icons'
import { SettingsMenu } from './components/SettingsMenu'
import { MobileNav } from './components/MobileNav'
import { AmbientBackdrop } from './components/AmbientBackdrop'
import { installClickFx, setClickFxEnabled, setClickFxStyle, type FxStyle } from './ui/clickFx'
import { FX_STYLES } from './ui/fxStyles'
import { AppearanceDialog } from './components/AppearanceDialog'
import { installMouseTrail, isTrailStyle, setTrailStyle, type TrailStyle } from './ui/mouseTrail'

import { ShareStage } from './voice/ShareStage'
import { UsagePanel } from './components/UsagePanel'
import { voiceSession } from './voice/voiceSession'
import { CallDock } from './voice/CallDock'
import { useReveal } from './hooks/useReveal'
import { useNotifications, type Notice } from './hooks/useNotifications'
import { useVoicePresence } from './voice/useVoicePresence'
import { armRingtone, playCallSound } from './voice/ringtone'
import { useVoiceSession } from './voice/useVoiceSession'
import { NotificationBell } from './components/NotificationBell'
import { hasFinanceSupabaseEnv } from './finance/env'
import { getSessionUser, onAuthStateChange, peekPersistedUserId, signOut } from './finance/auth'
import { getSupabaseClient } from './finance/client'
import { previewMember, PREVIEW_ME, PREVIEW_VOICE_IN } from './dev/previewMember'

// Lazy-load heavier sections (declared at module scope so they don't remount on each App render)
/**
 * Snake was the site's first feature and stayed an EAGER import while every other section became
 * lazy — so a 4,000-line game manager, its Supabase leaderboard client and the `bad-words` list
 * all rode in the main bundle that every visitor downloads, including the ones who never open it.
 * Both render sites are gated on `active === 'snake'`, so there was nothing keeping it there.
 */
const SnakeGame = lazy(() => import('./sections/SnakeGame').then((m) => ({ default: m.SnakeGame })))
const SignIn = lazy(() => import('./sections/SignIn').then((m) => ({ default: m.SignIn })))
const Investments = lazy(() =>
  import('./sections/Investments').then((m) => ({ default: m.Investments })),
)
const AccountSettings = lazy(() =>
  import('./sections/AccountSettings').then((m) => ({ default: m.AccountSettings })),
)
const Circuit = lazy(() => import('./sections/Circuit').then((m) => ({ default: m.Circuit })))
// Generic window-manager (the Circuit's "canvas"), reused for the optional site-wide
// canvas mode that turns a page into draggable/resizable/minimizable windows.
const PageCanvas = lazy(() =>
  import('./circuit/ui/CircuitCanvas').then((m) => ({ default: m.CircuitCanvas })),
)
import type { CanvasPane, LaunchableWindow } from './circuit/ui/CircuitCanvas'
import { applyPalette, loadPalette } from './theme/customTheme'
import {
  applyMotionAttr,
  motionPreferenceStored,
  motionReduced,
  motionReducedBySystem,
  onMotionChange,
  setMotionReduced,
} from './ui/motion'
import {
  backdropOverride,
  isBackdropId,
  onBackdropOverrideChange,
  type BackdropId,
} from './profile/backdrops'
import { SiteBackdrop } from './profile/SiteBackdrop'
const AdminPanel = lazy(() =>
  import('./sections/AdminPanel').then((m) => ({ default: m.AdminPanel })),
)
/**
 * DEV-only workbench. The conditional wraps the dynamic import itself, not just the render:
 * `import.meta.env.DEV` is substituted with `false` at build time, so the whole branch — and the
 * chunk it would have pulled in — is eliminated rather than shipped as an orphan nobody fetches.
 */
const ProfileLookPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/ProfileLookPreview').then((m) => ({ default: m.ProfileLookPreview })))
  : null

/** The one-account path a family member takes — see the file header for why it needs a route. */
const InvestmentsMemberPreview = import.meta.env.DEV
  ? lazy(() =>
      import('./dev/InvestmentsMemberPreview').then((m) => ({
        default: m.InvestmentsMemberPreview,
      })),
    )
  : null
const AcceptInvite = lazy(() =>
  import('./sections/AcceptInvite').then((m) => ({ default: m.AcceptInvite })),
)
const Profile = lazy(() => import('./sections/Profile').then((m) => ({ default: m.Profile })))
const Ratings = lazy(() => import('./sections/Ratings').then((m) => ({ default: m.Ratings })))
const ChatPage = lazy(() => import('./sections/ChatPage').then((m) => ({ default: m.ChatPage })))
const People = lazy(() => import('./sections/People').then((m) => ({ default: m.People })))

if (import.meta.env.DEV) {
  import('./dev/supabaseDebug')
}

type Section =
  | 'home'
  | 'circuit'
  | 'ratings'
  | 'chat'
  | 'people'
  | 'signin'
  | 'investments'
  | 'account-settings'
  | 'snake'
  | 'contact'
  | 'admin'
  | 'invite'
  | 'profile'

/**
 * What each page is called, for the browser tab and for the page's own <h1>.
 *
 * Both were missing. The tab title came from index.html and never changed, so every history
 * entry and bookmark read identically and a screen reader announced the same title after every
 * navigation. And only the home page had an <h1> at all — every other route's top heading was an
 * <h2>, so heading-based navigation found no page title to land on.
 */
const SECTION_TITLES: Record<Section, string> = {
  home: 'Home',
  circuit: 'The Circuit',
  ratings: 'Ratings',
  chat: 'Chat',
  people: 'People',
  signin: 'Sign in',
  investments: 'Investments',
  'account-settings': 'Account settings',
  snake: 'Snake',
  contact: 'Contact',
  admin: 'Admin',
  invite: 'Accept invite',
  profile: 'Profile',
}

// Every routable section — the single source of truth for hash validation (initial load +
// hashchange). Keep in sync with the Section type above; a missing entry silently routes home.
const ALL_SECTIONS: Section[] = [
  'home',
  'circuit',
  'ratings',
  'chat',
  'people',
  'signin',
  'investments',
  'account-settings',
  'snake',
  'contact',
  'admin',
  'invite',
  'profile',
]

// Single source of truth for left/right section order (keyboard shortcuts and the nav).
// No longer drives a swipe gesture — see the note where that was removed.
// Home is the unified Evan Cook page (portfolio + about + projects). Circuit is featured
// as a project on Home and appears in nav only for signed-in members.
// 'invite' and 'admin' are not in the arrow-key order — accessed via direct link or nav only.
const navOrder = (
  financeOn: boolean,
  authed: boolean,
  isAdmin: boolean,
  canFinance: boolean,
): Section[] =>
  financeOn
    ? authed
      ? [
          'home',
          'circuit',
          'ratings',
          'chat',
          'people',
          ...(canFinance ? (['investments'] as Section[]) : []),
          'account-settings',
          ...(isAdmin ? (['admin'] as Section[]) : []),
          'snake',
          'contact',
        ]
      : ['home', 'signin', 'snake', 'contact']
    : ['home', 'snake', 'contact']

// ── optimistic boot: what the browser already knows about this user ──
// The persisted Supabase session is peeked synchronously (peekPersistedUserId) so a
// returning user boots signed-in on the very first paint instead of flashing "Sign in"
// until a network round-trip confirms. Same for the gated tabs: the last confirmed
// admin/finance flags are cached per user and re-verified in the background.
type NavFlags = { uid: string; admin: boolean; finance: boolean; suspended: boolean }
const NAV_FLAGS_KEY = 'nav_flags_v1'
function readNavFlags(uid: string): NavFlags | null {
  try {
    const f = JSON.parse(localStorage.getItem(NAV_FLAGS_KEY) || 'null') as NavFlags | null
    return f && f.uid === uid ? f : null
  } catch {
    return null
  }
}
function writeNavFlags(patch: Partial<NavFlags> & { uid: string }) {
  try {
    const cur = readNavFlags(patch.uid) ?? {
      uid: patch.uid,
      admin: false,
      finance: false,
      suspended: false,
    }
    localStorage.setItem(NAV_FLAGS_KEY, JSON.stringify({ ...cur, ...patch }))
  } catch {
    /* ignore */
  }
}

// remembers whether this visitor chose canvas mode last time
const CANVAS_PREF = 'canvas_mode_v1'
/**
 * Dev-only preview of admin surfaces, read at MODULE LOAD.
 *
 * Reading it during render was too late: the router normalises an unrecognised hash on mount,
 * so `#dev-usage` had already been cleared by the time the component looked. Module scope runs
 * before React does.
 */
const DEV_PREVIEW = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#dev-/, '')

export default function App() {
  const initialSection: Section = (() => {
    const raw = (window.location.hash || '#home').replace('#', '')
    const base = (raw.split('?')[0] || 'home') as Section
    return ALL_SECTIONS.includes(base) ? base : 'home'
  })()
  const [active, setActive] = useState<Section>(initialSection)
  // boot from the persisted session + last-confirmed flags (verified in the background)
  const [boot] = useState(() => {
    const uid = hasFinanceSupabaseEnv() ? peekPersistedUserId() : null
    return { uid, flags: uid ? readNavFlags(uid) : null }
  })
  const uidRef = useRef<string | null>(boot.uid)
  // DEV member preview (previewMember): render the signed-in UI with fake data, no login
  const [isFinanceAuthed, setIsFinanceAuthed] = useState(!!boot.uid || previewMember)
  const [isAdmin, setIsAdmin] = useState(boot.flags?.admin ?? false)
  // 'finance' feature flag for this account: null = still loading (don't redirect yet).
  // A cached true paints the tab immediately; a cached false stays "loading" so a
  // deep link to #investments can't be bounced before the server weighs in.
  const [canFinance, setCanFinance] = useState<boolean | null>(
    previewMember ? true : boot.flags?.finance ? true : null,
  )
  const [suspended, setSuspended] = useState(boot.flags?.suspended ?? false)
  const [theme, setTheme] = useState<'light' | 'dark' | 'alt'>(() => {
    const saved = localStorage.getItem('theme') as 'light' | 'dark' | 'alt' | null
    if (saved) return saved
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  })
  // Site-wide UI scale (the "+ / −" zoom in the banner). Applies to everything,
  // modals and overlays included, via CSS zoom. Persisted across sessions.
  // Range is deliberately modest. The old 0.5x-2.5x could push the layout past the edge of
  // a phone with no way to scroll to what fell off; text stays readable and everything still
  // fits across this range. Verified on a 375px screen at each step.
  const SCALE_MIN = 0.85
  const SCALE_MAX = 1.3
  const [uiScale, setUiScale] = useState<number>(() => {
    const s = parseFloat(localStorage.getItem('ui_scale') || '1')
    return Number.isFinite(s) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, s)) : 1
  })
  useEffect(() => {
    localStorage.setItem('ui_scale', String(uiScale))
  }, [uiScale])
  const bumpScale = (d: number) =>
    setUiScale((s) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round((s + d) * 100) / 100)))
  // Optional canvas mode (desktop): turn the current page into draggable/resizable windows.
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 820,
  )
  // Canvas is opt-in, but it REMEMBERS: someone who likes it lands in it every visit,
  // while a first-timer still meets the plain page. Only an explicit toggle writes the
  // preference — the desktop-only auto-close below must not erase it on a phone.
  const [canvasOpen, setCanvasOpen] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.innerWidth >= 820 &&
      localStorage.getItem(CANVAS_PREF) === '1',
  )
  // windows the user pinned — they ride along onto every tab's canvas. In the merged
  // single-canvas model this doubles as "the open set": everything visible on the shared
  // canvas is, definitionally, persistent across navigation, so there's no more separate
  // "this tab's own transient panes" concept to track alongside it.
  const [pinned, setPinned] = useState<CanvasPane[]>([])
  // bumps whenever nav should bring a specific pane to the front of the shared canvas
  // (see the effect below) — same shape/mechanism Circuit already uses for "Log today"
  const [focusPane, setFocusPane] = useState<{ id: string; nonce: number } | null>(null)
  /**
   * Bumped on every nav click, INCLUDING a click on the tab you're already on.
   *
   * On the canvas, "go to Chat" means "pan the camera to the Chat window". Once you're on
   * Chat and have panned away, clicking Chat again is the obvious way back — but `active`
   * never changes, so nothing downstream re-ran and the click did nothing at all. This is the
   * signal that a navigation was REQUESTED, as opposed to the destination having changed.
   */
  const [navPing, setNavPing] = useState(0)
  const goTo = (s: Section) => {
    setActive(s)
    setNavPing((n) => n + 1)
  }
  /**
   * The Circuit's own sub-tab windows (Board/Log/Feed/...), reported up by <Circuit> itself
   * whenever what they'd render changes. Circuit stays mounted (see its render condition below)
   * whenever the shared canvas is on, even on a different page, specifically so these stay
   * available to open from anywhere — same as the 10 single-page windows already are, just
   * sourced from a component instead of a static factory since they need Circuit's own live
   * data (which circuit filter, which log entry, etc).
   */
  const [circuitCanvasPanes, setCircuitCanvasPanes] = useState<CanvasPane[]>([])
  const [circuitToolbar, setCircuitToolbar] = useState<ReactNode | null>(null)
  /**
   * The background behind the page: one setting, one answer.
   *
   * ⚠️ The ambient glow used to be its own on/off switch beside the backdrop picker, which meant
   * "what is behind the page" had two controls that could disagree — glow on AND waves on was
   * reachable, and drew two animated layers for one slot. Glow is an option in the list now.
   *
   * Migrated from ambient_v1 so nobody's existing choice is silently thrown away: the glow was
   * on by default and stays on unless they had turned it off, in which case they get None.
   */
  const [background, setBackground] = useState<BackdropId>(() => {
    if (typeof window === 'undefined') return 'glow'
    try {
      const saved = localStorage.getItem('background_v1')
      if (isBackdropId(saved)) return saved
      return localStorage.getItem('ambient_v1') === '0' ? 'none' : 'glow'
    } catch {
      return 'glow'
    }
  })
  const chooseBackground = (b: BackdropId) => {
    setBackground(b)
    try {
      localStorage.setItem('background_v1', b)
    } catch {
      /* private mode — applies for this visit */
    }
  }
  // what is actually drawn: a profile being viewed in its owner's look takes the layer over
  const [bgOverride, setBgOverride] = useState<BackdropId | null>(() => backdropOverride())
  useEffect(() => onBackdropOverrideChange(() => setBgOverride(backdropOverride())), [])
  const shownBackground = bgOverride ?? background
  /** click flair — same shape as the ambient glow: pure taste, remembered, on by default */
  const [sparksOn, setSparksOn] = useState(
    () => typeof window === 'undefined' || localStorage.getItem('click_fx_v1') !== '0',
  )
  const [sparksStyle, setSparksStyle] = useState<FxStyle>(() => {
    if (typeof window === 'undefined') return 'sparks'
    const v = localStorage.getItem('click_fx_style_v1')
    // A stored 'ripple'/'confetti'/'fireworks' from before those styles were reworked falls
    // through to the default rather than erroring — those ids just don't exist any more.
    return (FX_STYLES as string[]).includes(v ?? '') ? (v as FxStyle) : 'sparks'
  })
  useEffect(() => installClickFx(), [])
  useEffect(() => installMouseTrail(), [])
  const [appearanceOpen, setAppearanceOpen] = useState(false)

  /**
   * Mouse trail — its own setting, alongside the click flair rather than inside it.
   *
   * They answer different questions: one is what a CLICK does, the other is what MOVING does,
   * and someone can reasonably want sparks on click and nothing following their cursor. Local
   * for now and not part of the published profile look — worth seeing which of these survive
   * being lived with before giving them a column.
   */
  const [trailStyle, setTrailStyleState] = useState<TrailStyle>(() => {
    try {
      const v = localStorage.getItem('mouse_trail_v1')
      return isTrailStyle(v) ? v : 'none'
    } catch {
      return 'none'
    }
  })
  useEffect(() => setTrailStyle(trailStyle), [trailStyle])
  const chooseTrail = (t: TrailStyle) => {
    setTrailStyleState(t)
    try {
      localStorage.setItem('mouse_trail_v1', t)
    } catch {
      /* private mode — applies for this visit */
    }
  }
  // Wake the call relay early: it sleeps when idle, and the first call of the day should not
  // be the one that pays for the cold start. One request, on load, then never again.
  useEffect(() => voiceSession.pingRelay(), [])

  useEffect(() => {
    setClickFxEnabled(sparksOn)
    try {
      localStorage.setItem('click_fx_v1', sparksOn ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [sparksOn])
  const toggleSparks = () => setSparksOn((v) => !v)
  useEffect(() => {
    setClickFxStyle(sparksStyle)
    try {
      localStorage.setItem('click_fx_style_v1', sparksStyle)
    } catch {
      /* ignore */
    }
  }, [sparksStyle])

  /**
   * The user's own palette, if they made one. Kept separate from `theme` rather than being a
   * fourth value of it: the palette is a set of inline custom properties on <html>, so it
   * layers over whichever built-in theme is selected instead of replacing the concept. That
   * also means everything downstream that reads `theme` — the ambient backdrop, Snake's
   * renderer watching the attribute — keeps working untouched.
   */
  const [customPalette, setCustomPalette] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem('theme.custom.on') === '1',
  )
  // bumped by PalettePicker's 'yaya:palette' event — see the publish effect below for why
  const [paletteTick, setPaletteTick] = useState(0)
  useEffect(() => {
    const onPalette = () => setPaletteTick((n) => n + 1)
    window.addEventListener('yaya:palette', onPalette)
    return () => window.removeEventListener('yaya:palette', onPalette)
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('theme.custom.on', customPalette ? '1' : '0')
    } catch {
      /* ignore */
    }
    // Applying (and clearing) lives here so it survives a reload and so turning it off from
    // anywhere puts the built-in theme straight back.
    applyPalette(customPalette ? loadPalette() : null)
  }, [customPalette])

  /**
   * Publish the look you actually use, so your profile can wear it.
   *
   * Deliberately NOT a settings screen. Evan's ask was that a profile carry "the theme and flair
   * that they use for the site" — which is a thing you've already chosen, so asking you to choose
   * it a second time (and keep the two in step forever) would be the wrong shape entirely. This
   * mirrors the existing choices up whenever they change.
   *
   * `paletteTick` exists because the palette itself lives in localStorage, not in React state:
   * `customPalette` only says whether it's ON, so editing the colours while it's already on
   * changes nothing this effect can see. PalettePicker bumps the tick when it writes.
   */
  useEffect(() => {
    if (!isFinanceAuthed) return
    const t = setTimeout(() => {
      void getSupabaseClient()
        .rpc('set_my_profile_look', {
          p_theme: theme,
          p_palette: customPalette ? loadPalette() : null,
          p_flair: sparksOn ? sparksStyle : null,
          p_backdrop: background === 'none' ? null : background,
        })
        .then(() => {})
    }, 600) // dragging a colour picker shouldn't be one write per frame
    return () => clearTimeout(t)
  }, [isFinanceAuthed, theme, customPalette, paletteTick, sparksOn, sparksStyle, background])

  // Who the cog menu greets. The email is peeked from the LOCAL session so it paints
  // instantly and can never flash or gate anything; the real name follows from the profile
  // a moment later. An address is not a name — an address starting with an initial made the
  // avatar the wrong letter for the person it belonged to.
  /**
   * Reduce motion, as a site setting.
   *
   * Effective = the OS asked, or you asked here. Kept in state as well as on <html> so the cog
   * can show it, and re-read on change because the OS half can flip while the tab is open —
   * someone turning the system setting on mid-visit is asking for it to stop NOW.
   */
  const [motionOff, setMotionOff] = useState(() => motionReduced())
  useEffect(() => {
    applyMotionAttr()
    return onMotionChange(() => setMotionOff(motionReduced()))
  }, [])

  const [me, setMe] = useState<{
    name: string | null
    email: string | null
    username: string | null
  }>({ name: null, email: null, username: null })
  useEffect(() => {
    if (previewMember) {
      setMe({ name: PREVIEW_ME.name, email: PREVIEW_ME.email, username: PREVIEW_ME.username })
      return
    }
    if (!hasFinanceSupabaseEnv() || !isFinanceAuthed) {
      setMe({ name: null, email: null, username: null })
      return
    }
    let live = true
    void (async () => {
      const u = await getSessionUser().catch(() => null)
      if (!live) return
      setMe((m) => ({ ...m, email: u?.email ?? null }))
      try {
        const { data } = await getSupabaseClient().rpc('get_my_profile')
        const row = (Array.isArray(data) ? data[0] : data) as {
          username?: string | null
          first_name?: string | null
          last_name?: string | null
        } | null
        if (!live || !row) return
        const full = [row.first_name, row.last_name].filter(Boolean).join(' ')
        setMe((m) => ({ ...m, name: full || row.username || null, username: row.username ?? null }))
      } catch {
        // no profile row (not a member yet) — the email still greets them
      }
    })()
    return () => {
      live = false
    }
  }, [isFinanceAuthed])
  // ANY mounted canvas (home's or the Circuit's own) announces itself; the global zoom
  // is suspended while one is up — CSS zoom fights the fixed full-screen surface and
  // used to push a "full screen" window past the viewport (scroll to see it all).
  const [canvasMounted, setCanvasMounted] = useState(false)
  const notifications = useNotifications(isFinanceAuthed || previewMember)

  /**
   * Who is in a call, anywhere you can see — subscribed ONCE, here, for the whole site.
   *
   * It used to live inside Chat, which meant the only way to find out somebody was calling
   * you was to already be looking at the conversation. It can't simply be subscribed in both
   * places either: realtime-js dedupes channels by topic, so a second `vp:<room>` isn't a
   * second channel, and whichever consumer unmounts first tears down the other's
   * subscription. One owner, handed down to everything that needs it.
   */
  const voice = useVoiceSession()
  const livePresence = useVoicePresence(
    previewMember ? [] : notifications.rooms.map((r) => r.id),
    peekPersistedUserId(),
    me.name ?? 'Someone',
    // the room the CALL is in, which is not necessarily the one on screen — you can browse
    // other conversations, or other pages entirely, without leaving the call
    voice.inCall ? voice.roomId : null,
  )
  const voiceIn = previewMember ? PREVIEW_VOICE_IN : livePresence
  /**
   * "Someone is in a call you can join" as a bell notice.
   *
   * Built here rather than inside useNotifications because it's live presence, not something
   * fetched: it appears and disappears on its own, so it must NOT be silenced by the bell's
   * seen-marker the way an activity notice is. A call you're already in is left out — you
   * don't need telling about the room you're sitting in.
   */
  const liveCalls = notifications.rooms.filter(
    (r) => (voiceIn[r.id]?.length ?? 0) > 0 && !(voice.inCall && voice.roomId === r.id),
  )
  /** room id -> which sound it deserves, so the ring effect never has to read the copy */
  const callKinds: Record<string, 'ring' | 'joined'> = Object.fromEntries(
    liveCalls.map((r) => ['call-' + r.id, r.kind === 'dm' ? 'ring' : 'joined']),
  )
  const callNotices: Notice[] = liveCalls.map((r) => {
    const who = voiceIn[r.id]
    return {
      id: 'call-' + r.id,
      kind: 'call' as const,
      // a DM has exactly one other person in it, so it really is them calling YOU
      text: r.kind === 'dm' ? `${who[0]} is calling you` : `${who.length} in the call in ${r.name}`,
      detail: who.join(', '),
      href: '#chat?room=' + r.id,
    }
  })
  const withCalls = {
    ...notifications,
    items: [...callNotices, ...notifications.items],
    total: notifications.total + callNotices.length,
  }

  /**
   * Make a noise when a call STARTS being joinable — the rising edge only.
   *
   * callNotices is derived every render from live presence, so reacting to its contents would
   * ring on every re-render for as long as anyone stayed in the room. Keyed on room id in a ref:
   * a room rings once when it appears and can only ring again after it has gone quiet.
   *
   * A DM gets the phone-like ring because that is someone calling YOU; a group call gets one
   * soft note, because "three people are chatting in General" is news, not a summons.
   */
  const rangFor = useRef<Set<string>>(new Set())
  useEffect(() => armRingtone(), [])
  useEffect(() => {
    const live = new Set(callNotices.map((n) => n.id))
    for (const n of callNotices) {
      if (rangFor.current.has(n.id)) continue
      rangFor.current.add(n.id)
      playCallSound(callKinds[n.id] ?? 'joined')
    }
    // forget rooms that emptied, so the next call there rings again
    for (const id of [...rangFor.current]) if (!live.has(id)) rangFor.current.delete(id)
    // callNotices is rebuilt each render; its ids are the stable part
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callNotices.map((n) => n.id).join('|')])

  // Drives the root font-size (see index.css). Canvas mode opts out: it positions windows
  // in its own coordinate space and a scaled root fights it.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--ui-scale',
      String(canvasOpen || canvasMounted ? 1 : uiScale),
    )
  }, [uiScale, canvasOpen, canvasMounted])
  useEffect(() => {
    const onCanvas = (e: Event) => setCanvasMounted(!!(e as CustomEvent).detail)
    window.addEventListener('yaya:canvas', onCanvas)
    return () => window.removeEventListener('yaya:canvas', onCanvas)
  }, [])
  useEffect(() => {
    const onResize = () => setDesktop(window.innerWidth >= 820)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // Canvas is desktop-only, but that's enforced where it RENDERS (canvasOpen && desktop)
  // — never by flipping the state. Auto-closing on !desktop kicked Evan out of canvas
  // when dragging the browser between monitors (the drag fires transient resizes); now a
  // narrow moment just renders the normal page and canvas is still there on the far side.
  // Prefetch every lazy section once the first page has settled — clicking a new tab
  // used to pay its chunk fetch right then (the "small load times" on each first visit).
  // Now the code is already in the browser and navigation is instant.
  useEffect(() => {
    const warm = () => {
      void import('./sections/SignIn')
      void import('./sections/Investments')
      void import('./sections/AccountSettings')
      void import('./sections/Circuit')
      void import('./circuit/ui/CircuitCanvas')
      void import('./sections/AdminPanel')
      void import('./sections/Profile')
    }
    if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 4000 })
    else setTimeout(warm, 1500)
  }, [])
  const liveRef = useRef<HTMLDivElement>(null)
  const navLinksRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const [snakeHasControl, setSnakeHasControl] = useState(false)
  // True while Snake is connected to a multiplayer room. Toggling canvas re-mounts the
  // section, which drops the socket mid-round — and a round's results live only in the
  // ws-server's memory until every participant finishes, so leaving can cost the whole
  // room its scores. Canvas is a nice-to-have; a live match isn't ours to interrupt.
  const [snakeLive, setSnakeLive] = useState(false)
  // Keep banner persistent; auto-hide disabled for reliability
  const [showTop, setShowTop] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [buildInfo] = useState(() => {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env
    const ver = env?.VITE_APP_VERSION || ''
    return ver ? `build ${ver}` : ''
  })

  // Finance nav gating: show Investments only when Supabase is configured AND a user is signed in.
  useEffect(() => {
    // DEV member preview: skip all real-auth resolution — stay the forced signed-in member
    if (previewMember) return
    if (!hasFinanceSupabaseEnv()) {
      setIsFinanceAuthed(false)
      return
    }
    let alive = true

    // Admin = the server's source of truth (is_admin() → admin_users), so the client
    // never disagrees with the security-definer RPCs the Admin panel calls. Each check
    // also refreshes the per-user cache the next boot paints from.
    async function checkAdmin() {
      const { data } = await getSupabaseClient().rpc('is_admin')
      if (!alive) return
      setIsAdmin(data === true)
      if (uidRef.current) writeNavFlags({ uid: uidRef.current, admin: data === true })
    }
    // Feature flags: only show Investments if the 'finance' feature is on for this account.
    async function checkFeatures() {
      const { data } = await getSupabaseClient().rpc('my_features')
      if (!alive) return
      const fin = !!(data as { feature: string; enabled: boolean }[] | null)?.find(
        (f) => f.feature === 'finance',
      )?.enabled
      setCanFinance(fin)
      if (uidRef.current) writeNavFlags({ uid: uidRef.current, finance: fin })
    }
    // Account status: an admin can pause (suspend) a member's access.
    async function checkAccount() {
      const { data } = await getSupabaseClient().rpc('my_account')
      if (!alive) return
      const sus = !!(data as { suspended: boolean }[] | null)?.[0]?.suspended
      setSuspended(sus)
      if (uidRef.current) writeNavFlags({ uid: uidRef.current, suspended: sus })
    }
    const onSignedIn = () => {
      void checkAdmin()
      void checkFeatures()
      void checkAccount()
    }
    const onSignedOut = () => {
      uidRef.current = null
      setIsAdmin(false)
      setCanFinance(null)
      setSuspended(false)
      try {
        localStorage.removeItem(NAV_FLAGS_KEY)
      } catch {
        /* ignore */
      }
    }

    // The auth library emits transient null-session events while a token refresh is in
    // flight (cold loads, returning to the tab) — treating those as sign-outs is what
    // flashed "Sign in"/read-only at signed-in users. Only an EXPLICIT sign-out (or a
    // null session with no persisted token left) may flip the UI to signed-out.
    const confirmSignedOut = () => {
      if (peekPersistedUserId()) return // refresh in flight — events will settle it
      uidRef.current = null
      setIsFinanceAuthed(false)
      onSignedOut()
    }

    // local session read (no network) — near-instant confirm of the optimistic boot
    void getSessionUser()
      .then((u) => {
        if (!alive) return
        if (u) {
          uidRef.current = u.id
          setIsFinanceAuthed(true)
          onSignedIn()
        } else confirmSignedOut()
      })
      .catch(() => {
        if (alive) confirmSignedOut()
      })

    const { data } = onAuthStateChange((event, session) => {
      if (session?.user) {
        uidRef.current = session.user.id
        setIsFinanceAuthed(true)
        onSignedIn()
      } else if (event === 'SIGNED_OUT') {
        uidRef.current = null
        setIsFinanceAuthed(false)
        onSignedOut()
      }
      // other null-session events (INITIAL_SESSION mid-refresh etc.) change nothing
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])
  // Keep CSS var --nav-h in sync with the actual nav height (drives content offset + anchor
  // scroll-margin). Reads on the next frame so it measures the settled layout, not a
  // mid-resize/mid-reflow height — that lag briefly left a gap/overlap under the bar.
  useEffect(() => {
    const el = navRef.current
    if (!el) return
    let raf = 0
    const apply = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const h = el.offsetHeight
        if (h > 0) document.documentElement.style.setProperty('--nav-h', h + 'px')
      })
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    window.addEventListener('resize', apply)
    // the nav grows a few px when the web font swaps in — re-measure once that lands so the
    // reserved offset matches (otherwise the bar overlaps the first line of content)
    document.fonts?.ready.then(apply).catch(() => undefined)
    // settle insurance: catch any late layout shift (font swap, slow device, async
    // viewport settle) that a single observer callback can miss
    const t1 = setTimeout(apply, 250)
    const t2 = setTimeout(apply, 900)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t1)
      clearTimeout(t2)
      ro.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [])
  // Ensure theme applies at the root so body/background use the same tokens
  useEffect(() => {
    /**
     * `custom` on purpose, and it must match the value on the wrapper div below.
     *
     * `data-theme` lives on BOTH <html> and a div inside body, and each `[data-theme='…']`
     * block re-declares all 21 tokens. The div is the closer ancestor, so its values won for
     * the entire visible tree — which meant the custom palette, written as inline properties on
     * <html>, reached almost nothing. Measured: `--bg` was the custom colour at <html> and the
     * light theme's #ffffff two elements down.
     *
     * Naming it something no stylesheet block matches means nothing re-declares the tokens
     * below <html>, so the inline values inherit the whole way down.
     */
    document.documentElement.setAttribute('data-theme', customPalette ? 'custom' : theme)
    // Update theme-color meta to match current theme background
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
    if (meta) {
      const styles = getComputedStyle(document.documentElement)
      const bg =
        styles.getPropertyValue('--bg').trim() || (theme === 'light' ? '#ffffff' : '#0b0f19')
      meta.setAttribute('content', bg)
    }
    // `customPalette` is in here so the phone's browser chrome follows a custom background too.
    // It reads the COMPUTED --bg, which already accounts for the inline palette — the dependency
    // is only needed to re-run it, since switching palette doesn't change `theme`.
  }, [theme, customPalette])
  // Log build info for quick verification
  useEffect(() => {
    if (import.meta.env.DEV && buildInfo) console.log(`%c${buildInfo}`, 'color:#22c55e')
  }, [buildInfo])
  // Scroll to top when changing sections.
  // Deliberately scrolls the window to absolute zero rather than scrolling an element into
  // view: the old target sat below body's padding-top (nav height, plus the safe-area inset
  // on a notched phone), and a smooth animation could also land short when a lazy-loaded
  // section resolved and shifted the layout mid-scroll — either way you arrived a little
  // way down the page. Position zero can't drift, and an instant jump reads as a new page
  // rather than a scroll you didn't ask for.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [active])

  // Read hash when it changes (deep links + back/forward)
  useEffect(() => {
    const parseHash = (): Section => {
      const raw = (window.location.hash || '#home').replace('#', '')
      const base = (raw.split('?')[0] || 'home') as Section
      // chat used to live as a Circuit tab; keep those links working
      if (base === 'circuit' && new URLSearchParams(raw.split('?')[1] ?? '').get('tab') === 'chat')
        return 'chat'
      return ALL_SECTIONS.includes(base) ? base : 'home'
    }
    const onHash = () => setActive(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Announce section and sync hash when active changes
  useEffect(() => {
    // The real page name, not a capitalised route id — this is read aloud, and "Signin" and
    // "Account-settings" are not words. SECTION_TITLES already holds what each page is called
    // for the tab title and its <h1>, so all three now agree.
    if (liveRef.current) liveRef.current.textContent = `Section: ${SECTION_TITLES[active]}`
    const raw = (window.location.hash || '#').replace('#', '')
    const [base, query] = raw.split('?')
    if (base !== active) {
      // Preserve query for snake deep-links (e.g., room=...)
      const suffix = active === 'snake' && base === 'snake' && query ? `?${query}` : ''
      window.location.hash = active + suffix
    }
  }, [active])

  // Hard-gate finance sections: if a user deep-links to them while signed out,
  // redirect to Sign in (when finance is configured).
  useEffect(() => {
    const financeConfigured = hasFinanceSupabaseEnv()
    const isFinanceSection =
      active === 'investments' || active === 'account-settings' || active === 'admin'

    // account-settings/admin require a login; investments falls back to a public
    // demo when signed out, so it isn't bounced to sign-in.
    if (
      financeConfigured &&
      (active === 'account-settings' || active === 'admin') &&
      !isFinanceAuthed
    ) {
      setActive('signin')
      return
    }
    // A suspended account loses access to all member areas.
    if (suspended && (active === 'circuit' || isFinanceSection)) {
      setActive('home')
      return
    }
    // Investments also requires the 'finance' feature. Only redirect once we KNOW
    // it's off (canFinance === false); while loading (null) we wait.
    if (financeConfigured && active === 'investments' && isFinanceAuthed && canFinance === false) {
      setActive('home')
      return
    }

    if (financeConfigured && active === 'signin' && isFinanceAuthed) {
      setActive('home')
    }
  }, [active, isFinanceAuthed, canFinance, suspended])

  /**
   * Arrow keys move between sections.
   *
   * There were number keys too — 1-5 jumped straight to a section. Removed: the map was written
   * when there were five tabs and never grew with chat, ratings, people or profile, and it
   * renumbered itself depending on whether you were signed in and whether you had Investments,
   * so the same key went somewhere different for different people and for the same person on
   * different days. Nobody was reaching for them on purpose; the only time they fired was by
   * accident, and an accident that teleports you off the page you were reading is worse than
   * no shortcut at all.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTyping =
        tag === 'input' || tag === 'textarea' || (target as HTMLElement)?.isContentEditable
      if (isTyping || e.altKey || e.ctrlKey || e.metaKey) return
      const key = e.key
      // Arrow navigation across sections — but never while the snake game has control.
      // The game can live anywhere now (its page, or a pinned canvas window over any
      // tab), so the guard follows the GAME, not the page.
      const allowPageNav = !snakeHasControl
      if (allowPageNav) {
        const order = navOrder(
          hasFinanceSupabaseEnv(),
          isFinanceAuthed,
          isAdmin,
          canFinance === true,
        )
        const idx = order.indexOf(active)
        if (key === 'ArrowLeft' && idx > 0) {
          setActive(order[idx - 1])
          e.preventDefault()
        }
        if (key === 'ArrowRight' && idx < order.length - 1) {
          setActive(order[idx + 1])
          e.preventDefault()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, snakeHasControl, isFinanceAuthed, isAdmin, canFinance])

  // Keep the tab in step with the route. Home keeps the full descriptive title (it is what gets
  // shared and indexed); everywhere else is prefixed so history and bookmarks are told apart.
  useEffect(() => {
    document.title = active === 'home' ? site.title : `${SECTION_TITLES[active]} · ${site.name}`
  }, [active])

  /**
   * Move focus to the new page when the route changes.
   *
   * Without this, navigating left focus on the nav link you clicked — measured: #contact and
   * #home both kept it there, #circuit dropped it to <body>. Either way a keyboard or
   * screen-reader user was never taken to the content they asked for; they had to Tab back
   * across the whole header to reach it, with no announcement that the page had changed.
   * <main> already carried tabIndex={-1} for the skip link, so it was always the right target.
   *
   * ⚠️ Skips the FIRST render. Stealing focus on load fights deep links and is startling when
   * nobody navigated. And it yields to sections that focus something themselves — Snake's
   * canvas has autoFocus — by checking first whether focus already landed inside the content.
   */
  const prevActive = useRef<Section | null>(null)
  useEffect(() => {
    const prev = prevActive.current
    prevActive.current = active
    /**
     * ⚠️ Compares the PREVIOUS route rather than tracking "have I run before".
     *
     * A boolean first-render flag looks equivalent and isn't: StrictMode double-invokes
     * effects in development, so the first run sets the flag and the second sails straight
     * past it and steals focus on arrival. Measured — a fresh load of #circuit put focus on
     * <main> before the visitor had done anything.
     *
     * Comparing values is immune to being run twice: the second invocation sees prev ===
     * active and does nothing, while a real navigation still differs.
     */
    if (prev === null || prev === active) return
    // Synchronous on purpose. React applies a child's autoFocus during commit, which is
    // BEFORE passive effects run — so by now Snake's canvas has already taken focus and the
    // check below sees it. Deferring a frame to "let autoFocus win" was solving a race that
    // does not exist, and requestAnimationFrame does not fire at all while the tab is hidden.
    const main = document.getElementById('content')
    if (!main || main.contains(document.activeElement)) return
    main.focus({ preventScroll: true })
  }, [active])

  // Apply reveal-on-scroll to tagged elements
  // canvas exit re-mounts the page's sections without changing tabs — they need a
  // fresh reveal pass too, or they mount opacity-0 and stay invisible
  useReveal('.reveal', `${active}:${canvasOpen}`)

  /**
   * Chat is pinned to the viewport with nothing to scroll, but a touch-drag still
   * rubber-banded the whole document — which reads as "it scrolls a little when it
   * shouldn't". Measuring found no overflow anywhere (html 0, body 0, no inner scroller), so
   * it's overscroll bounce rather than content.
   *
   * Done here rather than in CSS because the bounce belongs to the document element, and
   * `data-page` lives on a div inside body — a descendant selector can't reach up to <html>.
   * Scoped to chat so the rest of the site keeps pull-to-refresh.
   */
  useEffect(() => {
    if (active !== 'chat') return
    const el = document.documentElement
    const prev = el.style.overscrollBehavior
    el.style.overscrollBehavior = 'none'
    return () => {
      el.style.overscrollBehavior = prev
    }
  }, [active])

  /**
   * Keep the message box above the on-screen keyboard.
   *
   * The chat panel is `position: fixed`, which anchors it to the LAYOUT viewport — and the
   * keyboard doesn't shrink that. So the panel keeps its full height, the keyboard slides up
   * over the bottom of it, and the composer you were about to type into is behind the keys.
   *
   * `visualViewport` is the part actually visible, so its height plus offset against the
   * window height is the keyboard's inset. Published as a CSS var the chat rule adds to its
   * own bottom. Guarded at 80px so a URL bar hiding or a rotation doesn't count as a keyboard.
   */
  useEffect(() => {
    const vv = window.visualViewport
    if (active !== 'chat' || !vv) return
    const el = document.documentElement
    const apply = () => {
      const inset = window.innerHeight - vv.height - vv.offsetTop
      el.style.setProperty('--kb', inset > 80 ? `${Math.round(inset)}px` : '0px')
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      el.style.removeProperty('--kb')
    }
  }, [active])

  // REMOVED: swipe-to-change-page.
  //
  // It was tuned hard against false positives — flick distance, vertical drift, duration,
  // and exemptions for canvases, charts, form fields and horizontal scrollers. None of that
  // was enough: Evan only ever triggered it by accident, and it moved the page out from
  // under whatever he was doing. The bottom bar and launcher made it redundant anyway, so
  // the gesture was pure downside.
  //
  // Note this was a WINDOW-level listener, which is why it could fire over almost anything.
  // Swipe still works where it's asked for and scoped to an element: Snake's controls, the
  // nav link strip, the sub-tab strips.

  // Keep active nav link visible in the top bar on section change
  useEffect(() => {
    const el = document.querySelector('.nav-links a[aria-current="page"]') as HTMLElement | null
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [active])

  // Which way is there more nav to see? Drives the edge fade AND the arrows: a phone can
  // swipe the strip, but on a mouse there was nothing to tell you links existed off the
  // edge, let alone a way to reach them. Directional on purpose — fading the left edge
  // while you're scrolled hard-left dims a link that isn't cut off.
  const [navMore, setNavMore] = useState({ l: false, r: false })
  useEffect(() => {
    const el = navLinksRef.current
    if (!el) return
    const check = () => {
      const l = el.scrollLeft > 2
      const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
      setNavMore((p) => (p.l === l && p.r === r ? p : { l, r }))
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    // the link set itself changes on sign-in / admin, not just on resize
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true })
    el.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => {
      ro.disconnect()
      mo.disconnect()
      el.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
  }, [])
  const nudgeNav = (dir: 1 | -1) =>
    navLinksRef.current?.scrollBy({
      left: dir * navLinksRef.current.clientWidth * 0.75,
      behavior: 'smooth',
    })

  // Back-to-top visibility on scroll
  useEffect(() => {
    // Only touch state when the answer actually changes. This fires on every scroll
    // frame, and on a phone that's the frame budget scrolling is already competing for.
    let shown = window.scrollY > 200
    setShowTop(shown)
    const onScroll = () => {
      const next = window.scrollY > 200
      if (next !== shown) {
        shown = next
        setShowTop(next)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Keyboard help overlay: open with '?' or Shift+/, close with Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore while typing in inputs/textareas/contenteditable to avoid annoyance
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTyping =
        tag === 'input' || tag === 'textarea' || target?.isContentEditable || tag === 'select'
      if (isTyping) return
      if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !helpOpen) {
        setHelpOpen(true)
        e.preventDefault()
      } else if (e.key === 'Escape' && helpOpen) {
        setHelpOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [helpOpen])

  // (Auto-hide removed)

  // ── canvas on every tab ──
  // Home shows as several panes at once on the shared canvas; the Circuit still has its own
  // separate canvas for now (folding it into this one is the next step). Every other content
  // tab floats as a single window. signin / invite (auth flows) don't get canvas -- invite
  // never has.
  // NOTE: this list, canvasTitleFor and singleCanvasNode below must all gain an entry
  // together, and the section's normal render must be guarded with !sharedCanvasShowing or it
  // draws twice. chat/ratings/people/profile arrived with the mobile restructure and were
  // missed here, so the canvas button did nothing on them.
  /**
   * Pages that have nothing to show a signed-out visitor but a sign-in prompt. Kept next to
   * singleCanvasTabs because the two have to be read together — see the launcher filter below.
   */
  const MEMBER_ONLY_TABS: Section[] = ['account-settings', 'chat', 'ratings', 'people', 'profile']
  const singleCanvasTabs: Section[] = [
    'investments',
    'account-settings',
    'snake',
    'contact',
    'admin',
    'signin',
    'chat',
    'ratings',
    'people',
    'profile',
  ]
  const canvasCapable =
    (active === 'home' || active === 'circuit' || singleCanvasTabs.includes(active)) &&
    // …except Snake while a multiplayer room is connected — see snakeLive above.
    !(active === 'snake' && snakeLive)
  /**
   * True whenever the ONE shared canvas is covering the normal page for whatever `active`
   * currently is — every page except `invite`, which was never canvas-capable at all. Replaces
   * the old per-page `inGenericCanvas` now that there's a single instance instead of three:
   * Home used to get its own dedicated mount, Circuit had a wholly separate canvas of its own,
   * and every other single-window page unmounted-and-remounted a fresh one on every tab switch.
   */
  const sharedCanvasShowing =
    desktop &&
    canvasOpen &&
    (active === 'home' || active === 'circuit' || singleCanvasTabs.includes(active))
  const canvasTitleFor: Partial<Record<Section, string>> = {
    investments: '📈 Investments',
    'account-settings': '👤 Account',
    snake: '🐍 Snake',
    contact: '✉️ Contact',
    admin: '🛠 Admin',
    signin: '🔑 Sign in',
    chat: '💬 Chat',
    ratings: '📝 Ratings',
    people: '🧑‍🤝‍🧑 People',
    profile: '🪪 Profile',
  }
  /**
   * The inner content for a single-window tab (mirrors the section body).
   *
   * Takes the section rather than reading `active`, which is what lets a window be summoned
   * from anywhere. Building a workspace used to mean visiting every tab in turn and pinning
   * each one, purely because this function could only ever build the tab you were already on.
   */
  const canvasNodeFor = (sec: Section) => {
    switch (sec) {
      case 'investments':
        return isFinanceAuthed && canFinance === true ? (
          <Investments />
        ) : !isFinanceAuthed ? (
          <Investments demo />
        ) : (
          <p className="muted">Investments aren’t enabled for your account.</p>
        )
      case 'account-settings':
        return isFinanceAuthed ? (
          <AccountSettings />
        ) : (
          <p className="muted">Sign in to manage your account.</p>
        )
      case 'snake':
        return (
          <SnakeGame onControlChange={setSnakeHasControl} onLiveChange={setSnakeLive} autoFocus />
        )
      case 'contact':
        return <ContactForm />
      case 'admin':
        return isAdmin ? <AdminPanel /> : <p className="muted">Admin access required.</p>
      case 'signin':
        return <SignIn />
      case 'chat':
        return <ChatPage authed={isFinanceAuthed || previewMember} voiceIn={voiceIn} />
      case 'ratings':
        return <Ratings authed={isFinanceAuthed || previewMember} />
      case 'people':
        return <People authed={isFinanceAuthed || previewMember} />
      case 'profile':
        return <Profile authed={isFinanceAuthed} />
      default:
        return null
    }
  }
  // one launcher for the whole site; canvas state lives here and persists across tabs
  // every explicit open/exit is a preference — the auto-close on narrow viewports isn't
  const setCanvasChoice = (open: boolean) => {
    setCanvasOpen(open)
    try {
      localStorage.setItem(CANVAS_PREF, open ? '1' : '0')
    } catch {
      /* ignore quota / private mode */
    }
  }
  const toggleCanvas = () => setCanvasChoice(!canvasOpen)
  /**
   * Whether the Circuit section is mounted at all — on its own tab, or because the canvas is
   * hosting its panes. ⚠️ NOT a test of whether the canvas overlay is up: that is
   * sharedCanvasShowing, which also requires canvasOpen. Confusing the two meant the background
   * layer was skipped on the Circuit tab with the canvas CLOSED, where nothing else draws it.
   */
  const circuitMounted = active === 'circuit' || (canvasOpen && desktop)

  // one navigator for the mobile bar/launcher — sets the hash (with an optional Circuit
  // sub-tab) and the active section, matching how the nav links move around
  const go = (section: Section, tab?: string) => {
    window.location.hash = tab ? `#${section}?tab=${tab}` : `#${section}`
    setActive(section)
  }
  const cycleTheme = () => {
    const next = theme === 'dark' ? 'light' : theme === 'light' ? 'alt' : 'dark'
    setTheme(next)
    localStorage.setItem('theme', next)
    // Asking for a built-in theme means you want that theme. The custom palette is inline
    // styles on <html>, so leaving it on would win and the button would appear to do nothing.
    if (customPalette) setCustomPalette(false)
  }

  // Pinned windows follow you across tabs. We keep the pane OBJECTS (not just ids) so a
  // window pinned on one tab can still render on another after its own page unmounted —
  // the node re-mounts and reads the same live store.
  const pinnedIds = pinned.map((p) => p.id)
  const togglePin = (pane: CanvasPane) =>
    setPinned((prev) =>
      prev.some((p) => p.id === pane.id) ? prev.filter((p) => p.id !== pane.id) : [...prev, pane],
    )
  /**
   * Page windows have their content rebuilt EVERY RENDER rather than kept from the moment they
   * were opened.
   *
   * A pane carries a React ELEMENT, so a window opened while signed out held
   * `<ChatPage authed={false} />` for good: sign in, and every one of those windows still said
   * "Sign in to…" while the header showed you already had. Home's cards and the Circuit's panes
   * are handed back fresh by the pages that own them (refreshPinned below); nothing owned these,
   * because the page they came from had unmounted. Same element type in the same position, so
   * React updates props rather than remounting — whatever is on screen keeps its state.
   */
  const livePanes = pinned.map((p) =>
    singleCanvasTabs.includes(p.id as Section) ? { ...p, node: canvasNodeFor(p.id as Section) } : p,
  )

  /** this tab's panes plus any pinned ones it doesn't already own */
  // A tab's own panes are rebuilt every render, but pinned copies are frozen at pin time —
  // so the page that owns them hands back fresh ones when what they render changes.
  const refreshPinned = (fresh: CanvasPane[]) =>
    setPinned((prev) => prev.map((p) => fresh.find((f) => f.id === p.id) ?? p))

  /**
   * Every window that can go on the canvas, for the launcher. Built from the same list and the
   * same node factory the tabs use, so a window can never appear here and fail to open.
   */
  const launchableWindows = (): LaunchableWindow[] => [
    // The Circuit's own sub-tabs, reported by <Circuit> itself (see circuitCanvasPanes above) --
    // always included now, not just while active === 'circuit'. Circuit stays mounted whenever
    // the shared canvas is on specifically so this list stays populated from anywhere.
    ...circuitCanvasPanes.map((p) => ({ id: p.id, title: p.title, group: 'The Circuit' })),
    // Home's cards are windows in their own right — they were missing from the first pass, so
    // the one page that is ALREADY several windows was the one you couldn't compose from.
    ...homePanes().map((p) => ({
      id: p.id,
      title: p.title,
      group: 'Home',
    })),
    ...singleCanvasTabs
      .filter((sec) =>
        sec === 'admin'
          ? isAdmin
          : sec === 'signin'
            ? !isFinanceAuthed
            : /**
               * Member pages are hidden from signed-out visitors, the same way the nav hides
               * them. They were all listed, so opening the canvas signed out revealed the whole
               * members area as a row of windows whose only content was "sign in to…". Nothing
               * leaked — but the launcher and the nav disagreeing about what exists is the bug,
               * and a window that can only turn you away is not worth offering.
               *
               * Investments stays: signed out it shows the sample dashboard, which is a real
               * thing to look at rather than a locked door.
               */
              MEMBER_ONLY_TABS.includes(sec)
              ? isFinanceAuthed || previewMember
              : true,
      )
      .map((sec) => ({
        id: sec,
        title: canvasTitleFor[sec] ?? sec,
        group: 'Pages',
        // Snake holds a live relay connection; floating a second copy mid-round is the one
        // case the canvas has always refused, so the launcher refuses it in the same words.
        // (No more "this tab" disabled reason: on the one shared canvas, closing the page
        // you're nominally "on" is just closing a window, same as any other.)
        disabled: sec === 'snake' && snakeLive ? 'in a live round' : undefined,
      })),
  ]

  /** Toggle a window on the canvas from the launcher — the same pin the title bar toggles. */
  const toggleWindow = (id: string) => {
    const existing = pinned.find((p) => p.id === id)
    if (existing) {
      togglePin(existing)
      return
    }
    const home = id.startsWith('home:') ? homePanes().find((p) => p.id === id) : null
    if (home) {
      togglePin(home)
      return
    }
    const circuitPane = circuitCanvasPanes.find((p) => p.id === id)
    if (circuitPane) {
      togglePin(circuitPane)
      return
    }
    const sec = id as Section
    togglePin({ id, title: canvasTitleFor[sec] ?? id, node: canvasNodeFor(sec) })
  }

  /** Ensure a specific pane is open (adding it if it wasn't) and bring it to front. Nav uses
   * this for "go to this page"; Circuit uses the same function (passed down as a prop) for its
   * own "open Board" / "Log today" moments, so there's one add-and-focus behaviour, not two. */
  const openAndFocus = (pane: CanvasPane) => {
    setPinned((prev) => (prev.some((p) => p.id === pane.id) ? prev : [...prev, pane]))
    setFocusPane({ id: pane.id, nonce: Date.now() })
  }

  /**
   * Nav's remaining job on the shared canvas: clicking a link (or a deep link landing) opens
   * that page's window if it isn't already there, and brings it to front either way. This is
   * what makes nav still mean something once the Windows menu can open anything from anywhere
   * — nav is the fast path for the pages people actually navigate to; the Windows menu is the
   * full catalog + search for everything else.
   *
   * Circuit is excluded — it drives its own "open Board" moment internally (see
   * onOpenCanvasPane below), since it needs its OWN pane data, which isn't ready here the first
   * frame Circuit mounts. `invite` is excluded because it was never canvas-capable at all.
   */
  useEffect(() => {
    if (!desktop || !canvasOpen) return
    if (active === 'circuit' || active === 'invite') return
    if (active === 'home') {
      const fresh = homePanes()
      setPinned((prev) => {
        const missing = fresh.filter((p) => !prev.some((x) => x.id === p.id))
        return missing.length ? [...prev, ...missing] : prev
      })
      setFocusPane({ id: 'home:hero', nonce: Date.now() })
    } else if (singleCanvasTabs.includes(active)) {
      openAndFocus({
        id: active,
        title: canvasTitleFor[active] ?? active,
        node: canvasNodeFor(active),
      })
    }
    // navPing is in here so re-clicking the tab you're already on pans back to its window;
    // homePanes/canvasNodeFor/canvasTitleFor are recreated every render and deliberately left out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, desktop, canvasOpen, navPing])

  return (
    <div data-theme={customPalette ? 'custom' : theme} data-page={active}>
      {/* the effective name, not the built-in one: this prop exists only to re-read the CSS
          vars when they change, and a palette switch changes them without changing `theme` */}
      <AmbientBackdrop
        section={active}
        theme={customPalette ? 'custom' : theme}
        enabled={shownBackground === 'glow' && !sharedCanvasShowing}
      />
      {/**
       * ⚠️ Not while the canvas is up, because the canvas draws its own copy INSIDE its surface.
       * The canvas overlay paints an opaque ground at z-index 50, so this fixed layer would be
       * invisible behind it AND still simulating — two loops for one visible result, which is
       * the thing the whole budget exists to prevent.
       */}
      {!sharedCanvasShowing && <SiteBackdrop id={shownBackground} />}
      {/* One dialog for colour, background, click and trail. Rendered at app level rather than
          inside the cog: the cog CLOSES when it opens, and a dialog owned by a component that has
          just unmounted itself is a dialog that closes with it. */}
      {appearanceOpen && (
        <AppearanceDialog
          onClose={() => setAppearanceOpen(false)}
          controls={{
            theme,
            onTheme: setTheme,
            customPalette,
            onCustomPalette: setCustomPalette,
            background,
            onBackground: chooseBackground,
            sparksOn,
            onToggleSparks: toggleSparks,
            sparksStyle,
            onSparksStyle: setSparksStyle,
            trailStyle,
            onTrailStyle: chooseTrail,
          }}
        />
      )}
      {/* A call outlives the screen it started on, so its controls and its audio live at app
          level — otherwise you'd navigate away and be stuck in a call you can't hear or end. */}
      <CallDock />
      <ShareStage />
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <a href="#snake" className="skip-link">
        Skip to Snake game
      </a>
      <nav className={'nav'} aria-label="Primary" ref={navRef}>
        <div className="container nav-inner">
          <a className="brand" href="#home" aria-label="Home">
            {site.name}
          </a>
          {/* the arrows are a pointer affordance: touch already swipes this strip, and the
              keyboard reaches the links by tabbing (which scrolls them into view), so they
              stay out of the tab order rather than adding two dead stops to it */}
          <div className="nav-right">
            <div
              className={'nav-scroll' + (navMore.l ? ' can-l' : '') + (navMore.r ? ' can-r' : '')}
            >
              <button
                className="nav-arrow nav-arrow-l"
                onClick={() => nudgeNav(-1)}
                tabIndex={-1}
                aria-hidden
                title="More"
              >
                ‹
              </button>
              <div className="nav-links" ref={navLinksRef}>
                <a
                  href="#home"
                  onClick={() => goTo('home')}
                  aria-current={active === 'home' ? 'page' : undefined}
                >
                  Home
                </a>
                {isFinanceAuthed && !suspended && (
                  <a
                    href="#circuit"
                    onClick={() => goTo('circuit')}
                    aria-current={active === 'circuit' ? 'page' : undefined}
                  >
                    Circuit
                  </a>
                )}
                {isFinanceAuthed && !suspended && (
                  <a
                    href="#ratings"
                    onClick={() => goTo('ratings')}
                    aria-current={active === 'ratings' ? 'page' : undefined}
                  >
                    Ratings
                  </a>
                )}
                {isFinanceAuthed && !suspended && (
                  <a
                    href="#chat"
                    onClick={() => goTo('chat')}
                    aria-current={active === 'chat' ? 'page' : undefined}
                  >
                    Chat
                  </a>
                )}
                {isFinanceAuthed && !suspended && (
                  <a
                    href="#people"
                    onClick={() => goTo('people')}
                    aria-current={active === 'people' ? 'page' : undefined}
                  >
                    People
                  </a>
                )}
                {hasFinanceSupabaseEnv() && !isFinanceAuthed && (
                  <a
                    href="#signin"
                    onClick={() => goTo('signin')}
                    aria-current={active === 'signin' ? 'page' : undefined}
                  >
                    Sign in
                  </a>
                )}
                {isFinanceAuthed && canFinance === true && !suspended && (
                  <a
                    href="#investments"
                    onClick={() => goTo('investments')}
                    aria-current={active === 'investments' ? 'page' : undefined}
                  >
                    Investments
                  </a>
                )}
                {isFinanceAuthed && !suspended && (
                  <a
                    href="#account-settings"
                    onClick={() => goTo('account-settings')}
                    aria-current={active === 'account-settings' ? 'page' : undefined}
                  >
                    Account
                  </a>
                )}
                {isAdmin && (
                  <a
                    href="#admin"
                    onClick={() => goTo('admin')}
                    aria-current={active === 'admin' ? 'page' : undefined}
                  >
                    Admin
                  </a>
                )}
                <a
                  href="#snake"
                  onClick={() => goTo('snake')}
                  aria-current={active === 'snake' ? 'page' : undefined}
                >
                  Snake
                </a>
                <a
                  href="#contact"
                  onClick={() => goTo('contact')}
                  aria-current={active === 'contact' ? 'page' : undefined}
                >
                  Contact
                </a>
              </div>
              <button
                className="nav-arrow nav-arrow-r"
                onClick={() => nudgeNav(1)}
                tabIndex={-1}
                aria-hidden
                title="More"
              >
                ›
              </button>
            </div>
            {(isFinanceAuthed || previewMember) && !suspended && (
              <NotificationBell notifications={withCalls} />
            )}
            <SettingsMenu
              theme={theme}
              onTheme={(t) => {
                setTheme(t)
                localStorage.setItem('theme', t)
                // same reason as cycleTheme: the inline palette would override the theme you
                // just asked for, so choosing one steps out of the custom palette
                setCustomPalette(false)
              }}
              uiScale={uiScale}
              onScale={(d) => (d === 0 ? setUiScale(1) : bumpScale(d))}
              canvasOpen={canvasOpen}
              onToggleCanvas={toggleCanvas}
              canvasCapable={canvasCapable}
              canvasReason={
                active === 'snake' && snakeLive
                  ? 'Not while you’re in a multiplayer room — switching would drop you from the round'
                  : undefined
              }
              desktop={desktop}
              authed={hasFinanceSupabaseEnv() && isFinanceAuthed}
              isAdmin={isAdmin}
              motionOff={motionOff}
              motionBySystem={motionReducedBySystem()}
              onToggleMotion={() => setMotionReduced(!motionPreferenceStored())}
              customPalette={customPalette}
              onCustomPalette={setCustomPalette}
              name={me.name}
              email={me.email}
              onAppearance={() => setAppearanceOpen(true)}
              onAccount={() => goTo('account-settings')}
              onProfile={
                me.username
                  ? () => {
                      window.location.hash = '#profile?u=' + encodeURIComponent(me.username!)
                      goTo('profile')
                    }
                  : undefined
              }
              onSignIn={() => goTo('signin')}
              onSignOut={() => {
                void signOut().catch(() => {
                  /* ignore */
                })
              }}
            />
          </div>
        </div>
      </nav>
      {/* canvas mode has its own per-window scaling; the global zoom fights its fixed
          full-screen surface (footer teleporting on big zoom), so suspend it while it's on */}
      <main
        id="content"
        className="container"
        tabIndex={-1}
        style={{
          // The footer below carries the clearance for the fixed bottom bar now, so main
          // only needs normal breathing room — it used to add its own 74px on top, which
          // stacked into a large dead gap between the content and the footer.
          paddingBottom: !desktop ? '1rem' : 'env(safe-area-inset-bottom)',
        }}
      >
        {/* The page's heading, for anyone navigating by headings. Home already renders a real
            visible <h1>, so adding one here would give that route two. Everywhere else the top
            heading is an <h2> and there was no <h1> at all. Visually hidden rather than shown:
            the visible design already names the page, and this is about the accessibility tree
            rather than the layout. */}
        {active !== 'home' && <h1 className="sr-only">{SECTION_TITLES[active]}</h1>}
        {suspended && (
          <div
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              padding: '0.7rem 1rem',
              marginBottom: '1rem',
              borderRadius: 12,
              background: 'rgba(244,107,107,0.1)',
              border: '1px solid rgba(244,107,107,0.4)',
              fontSize: '0.92rem',
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>⏸</span>
            <span>
              <strong>Your member access is paused.</strong>{' '}
              <span className="muted">
                You can still browse the site — reach out to Evan to restore access.
              </span>
            </span>
          </div>
        )}
        {/**
         * Dev-only preview of admin surfaces.
         *
         * Anything behind the admin gate can't be checked without signing in, so it shipped
         * unverified. `import.meta.env.DEV` means this never exists in a production build — a
         * workbench, not a back door.
         */}
        {import.meta.env.DEV && DEV_PREVIEW === 'usage' && (
          <section className="card">
            <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
              dev preview — #dev-usage
            </p>
            <UsagePanel />
          </section>
        )}
        {/* The whole panel, not one card: its tabs (invites / members / snake names) are the
            part that can't otherwise be seen without an admin session. The RPCs behind it still
            enforce `is_admin()` server-side, so this renders empty rather than privileged data
            unless the viewer really is an admin — it's a layout workbench, not an access grant. */}
        {import.meta.env.DEV && DEV_PREVIEW === 'admin' && (
          <section className="card">
            <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
              dev preview — #dev-admin
            </p>
            <Suspense fallback={<div aria-busy>Loading…</div>}>
              <AdminPanel />
            </Suspense>
          </section>
        )}
        {/* How a profile LOOKS can't be seen without a session (the page needs one, and the
            customiser needs it to be YOUR page on top of that). Same workbench reasoning as
            #dev-admin — invented people, real components. */}
        {ProfileLookPreview && DEV_PREVIEW === 'profile' && (
          <Suspense fallback={<div aria-busy>Loading…</div>}>
            <ProfileLookPreview />
          </Suspense>
        )}
        {/* The family member's own card. Same workbench reasoning as #dev-profile, and the same
            privacy rule: every person in it is invented. */}
        {InvestmentsMemberPreview && DEV_PREVIEW === 'investments' && (
          <Suspense fallback={<div aria-busy>Loading…</div>}>
            <InvestmentsMemberPreview />
          </Suspense>
        )}
        {/* ONE shared canvas instance — mounted whenever desktop+canvas are on, for every page
            except Circuit (still separate, see the next step) and invite (never canvas-capable).
            No more `key={active}`: there's nothing to remount between pages any more, that was
            only ever needed because three separate mount points meant three separate instances.
            What's actually open (`pinned`) and which one is in front (`focusPane`) are both
            driven by the nav effect above, not by which page happens to be `active`. */}
        {sharedCanvasShowing && (
          <Suspense
            fallback={
              <div className="card" aria-busy>
                Loading…
              </div>
            }
          >
            <PageCanvas
              panes={livePanes}
              pinnedIds={pinnedIds}
              onTogglePin={togglePin}
              background={shownBackground}
              focusPane={focusPane}
              toolbar={circuitToolbar}
              launchableWindows={launchableWindows()}
              launcherOpenIds={pinnedIds}
              onToggleWindow={toggleWindow}
            />
          </Suspense>
        )}
        {active === 'home' && !sharedCanvasShowing && (
          <section id="home">
            <EvanCook />
          </section>
        )}
        {/* Circuit stays mounted whenever the shared canvas is on, even on another page --
            not to show anything (it renders its own tabbed page only when it's the active tab
            AND the canvas is off), but so its sub-tab windows keep reporting into
            circuitCanvasPanes/circuitToolbar and stay openable from anywhere, the same way
            Home's cards and the 10 single-page windows already are. The Suspense fallback only
            shows while actually viewing Circuit -- background-loading its chunk from another
            page shouldn't flash a loading card on screen. */}
        {circuitMounted && (
          <Suspense
            fallback={
              active === 'circuit' ? (
                <div className="card" aria-busy>
                  Loading Circuit…
                </div>
              ) : null
            }
          >
            <Circuit
              authed={isFinanceAuthed || !hasFinanceSupabaseEnv()}
              canvasMode={canvasOpen && desktop}
              isActiveTab={active === 'circuit'}
              // re-clicking Circuit in the nav pans back to its Board, same as every other tab
              focusPing={navPing}
              voiceIn={voiceIn}
              onCanvasPanesChange={(panes, toolbar) => {
                setCircuitCanvasPanes(panes)
                setCircuitToolbar(toolbar)
                refreshPinned(panes)
              }}
              onOpenCanvasPane={openAndFocus}
            />
          </Suspense>
        )}
        {!sharedCanvasShowing && active === 'people' && (
          <section id="people" className="card reveal">
            <Suspense
              fallback={
                <div className="card" aria-busy>
                  Loading People…
                </div>
              }
            >
              <People authed={isFinanceAuthed || previewMember} />
            </Suspense>
          </section>
        )}
        {!sharedCanvasShowing && active === 'chat' && (
          <section id="chat" className="card reveal">
            <Suspense
              fallback={
                <div className="card" aria-busy>
                  Loading Chat…
                </div>
              }
            >
              <ChatPage authed={isFinanceAuthed || previewMember} voiceIn={voiceIn} />
            </Suspense>
          </section>
        )}
        {!sharedCanvasShowing && active === 'ratings' && (
          <section id="ratings" className="card reveal">
            <Suspense
              fallback={
                <div className="card" aria-busy>
                  Loading Ratings…
                </div>
              }
            >
              <Ratings authed={isFinanceAuthed || previewMember} />
            </Suspense>
          </section>
        )}
        {!sharedCanvasShowing && active === 'signin' && (
          <section id="signin" className="card reveal">
            <Suspense
              fallback={
                <div className="card" aria-busy>
                  Loading sign-in…
                </div>
              }
            >
              <SignIn />
            </Suspense>
          </section>
        )}
        {!sharedCanvasShowing && active === 'investments' && (
          <section id="investments" className="card reveal">
            {isFinanceAuthed && canFinance === true ? (
              <Suspense
                fallback={
                  <div className="card" aria-busy>
                    Loading investments…
                  </div>
                }
              >
                <Investments />
              </Suspense>
            ) : !isFinanceAuthed ? (
              <Suspense
                fallback={
                  <div className="card" aria-busy>
                    Loading investments…
                  </div>
                }
              >
                <Investments demo />
              </Suspense>
            ) : (
              <div className="card">
                <h2 className="section-title" style={{ marginTop: 0 }}>
                  Investments
                </h2>
                <p className="muted" style={{ marginBottom: 0 }}>
                  Investments aren’t enabled for your account.
                </p>
              </div>
            )}
          </section>
        )}
        {!sharedCanvasShowing && active === 'account-settings' && (
          <section id="account-settings" className="card reveal">
            {isFinanceAuthed ? (
              <Suspense
                fallback={
                  <div className="card" aria-busy>
                    Loading account settings…
                  </div>
                }
              >
                <AccountSettings />
              </Suspense>
            ) : (
              <div className="card">
                <h2 className="section-title" style={{ marginTop: 0 }}>
                  Account settings
                </h2>
                <p className="muted" style={{ marginBottom: 0 }}>
                  Sign in to manage your account.
                </p>
              </div>
            )}
          </section>
        )}
        {!sharedCanvasShowing && active === 'admin' && (
          <section id="admin" className="card reveal">
            {isAdmin ? (
              <Suspense
                fallback={
                  <div className="card" aria-busy>
                    Loading…
                  </div>
                }
              >
                <AdminPanel />
              </Suspense>
            ) : (
              <p className="muted">Admin access required.</p>
            )}
          </section>
        )}
        {active === 'invite' && (
          <section id="invite" className="card reveal">
            <Suspense
              fallback={
                <div className="card" aria-busy>
                  Loading…
                </div>
              }
            >
              <AcceptInvite />
            </Suspense>
          </section>
        )}
        {!sharedCanvasShowing && active === 'profile' && (
          <section id="profile" className="reveal">
            <Suspense
              fallback={
                <div className="card" aria-busy>
                  Loading…
                </div>
              }
            >
              <Profile authed={isFinanceAuthed} />
            </Suspense>
          </section>
        )}
        {!sharedCanvasShowing && active === 'snake' && (
          <section id="snake" className="card reveal show-dpad">
            {/* Its own boundary, not the page-wide one: a shared fallback would blank whatever
                else is mounted while the game chunk arrives. */}
            <Suspense fallback={<div aria-busy>Loading the game…</div>}>
              <SnakeGame
                onControlChange={setSnakeHasControl}
                onLiveChange={setSnakeLive}
                autoFocus
              />
            </Suspense>
          </section>
        )}
        {!sharedCanvasShowing && active === 'contact' && (
          <section id="contact" className="card reveal">
            <ContactForm />
          </section>
        )}
      </main>
      <div
        ref={liveRef}
        aria-live="polite"
        role="status"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(1px,1px,1px,1px)',
        }}
      />
      <footer
        className="container"
        style={{
          opacity: 0.9,
          paddingTop: '1rem',
          // The footer sits OUTSIDE main, so main's bottom padding never protected it: on
          // any page long enough to scroll, the fixed bottom bar covered the last ~60px —
          // the copyright line and the GitHub/LinkedIn icons. It carries its own clearance
          // now: just the bar's height plus a little, not a whole extra screenful.
          paddingBottom: !desktop ? 'calc(0.75rem + 66px + env(safe-area-inset-bottom))' : '2rem',
        }}
      >
        <div
          className="muted"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <span>
            © {new Date().getFullYear()} {site.name}
            {buildInfo && <span style={{ marginLeft: 8 }}>· {buildInfo}</span>}
          </span>
          <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center' }}>
            <a
              href={site.socials.github}
              className="icon-link"
              aria-label="GitHub"
              target="_blank"
              rel="noreferrer"
            >
              <IconGitHub />
            </a>
            <a
              href={site.socials.linkedin}
              className="icon-link"
              aria-label="LinkedIn"
              target="_blank"
              rel="noreferrer"
            >
              <IconLinkedIn />
            </a>
          </span>
        </div>
      </footer>
      {/* The floating prev/next section arrows are gone — the top nav (desktop) and the
          bottom bar + launcher (mobile) are the navigation now; the arrows just hovered
          awkwardly over the content. Keyboard Left/Right section nav is kept (invisible). */}
      {showTop && (
        <button
          className="back-to-top"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          ↑
        </button>
      )}

      {/* The phone's whole navigation: a thumb-zone bottom bar + a full-screen launcher.
          Desktop keeps the top nav; this only renders below the desktop breakpoint. */}
      {!desktop && (
        <MobileNav
          active={active}
          go={go}
          authed={hasFinanceSupabaseEnv() && isFinanceAuthed}
          hasAuth={hasFinanceSupabaseEnv()}
          canFinance={canFinance === true}
          isAdmin={isAdmin}
          suspended={suspended}
          theme={theme}
          onCycleTheme={cycleTheme}
          onSignOut={() => {
            void signOut().catch(() => {
              /* ignore */
            })
          }}
          unreadChats={notifications.unreadChats}
          friendRequests={notifications.friendRequests}
          onProfile={
            me.username
              ? () => {
                  window.location.hash = '#profile?u=' + encodeURIComponent(me.username!)
                  goTo('profile')
                }
              : undefined
          }
        />
      )}

      {/* Keyboard help overlay */}
      {helpOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          onClick={() => setHelpOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 200,
          }}
        >
          <div
            className="card"
            style={{ maxWidth: 480, width: '90%', cursor: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="section-title" style={{ marginTop: 0 }}>
              Keyboard shortcuts
            </h2>
            <ul style={{ margin: 0, paddingLeft: '1rem' }}>
              <li>Arrow Left/Right: Previous/Next section</li>
              <li>Snake: Arrow keys, swipe, or on-screen controls</li>
              <li>?: Open this help, Esc: Close</li>
            </ul>
            <div style={{ marginTop: '0.75rem', textAlign: 'right' }}>
              <button className="btn" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
