import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { ContactForm } from './sections/ContactForm'
import { EvanCook, homePanes } from './sections/EvanCook'
import { SnakeGame } from './sections/SnakeGame'
import { site } from './config/site'
import { IconGitHub, IconLinkedIn } from './components/Icons'
import { SettingsMenu } from './components/SettingsMenu'
import { MobileNav } from './components/MobileNav'
import { AmbientBackdrop } from './components/AmbientBackdrop'
import { CallDock } from './voice/CallDock'
import { useReveal } from './hooks/useReveal'
import { useNotifications } from './hooks/useNotifications'
import { NotificationBell } from './components/NotificationBell'
import { hasFinanceSupabaseEnv } from './finance/env'
import { getSessionUser, onAuthStateChange, peekPersistedUserId, signOut } from './finance/auth'
import { getSupabaseClient } from './finance/client'
import { previewMember, PREVIEW_ME } from './dev/previewMember'

// Lazy-load heavier sections (declared at module scope so they don't remount on each App render)
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
import type { CanvasPane } from './circuit/ui/CircuitCanvas'
const AdminPanel = lazy(() =>
  import('./sections/AdminPanel').then((m) => ({ default: m.AdminPanel })),
)
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
  // windows the user pinned — they ride along onto every tab's canvas
  const [pinned, setPinned] = useState<CanvasPane[]>([])
  // the ambient glow behind the page — on by default, but it's a taste thing, so the
  // cog remembers whoever turns it off
  const [ambientOn, setAmbientOn] = useState(
    () => typeof window === 'undefined' || localStorage.getItem('ambient_v1') !== '0',
  )
  const toggleAmbient = () => {
    setAmbientOn((v) => {
      try {
        localStorage.setItem('ambient_v1', v ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !v
    })
  }
  // Who the cog menu greets. The email is peeked from the LOCAL session so it paints
  // instantly and can never flash or gate anything; the real name follows from the profile
  // a moment later. An address is not a name — "cvaneook@outlook.com" made the avatar a
  // "C" for a man called Evan.
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
    document.documentElement.setAttribute('data-theme', theme)
    // Update theme-color meta to match current theme background
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
    if (meta) {
      const styles = getComputedStyle(document.documentElement)
      const bg =
        styles.getPropertyValue('--bg').trim() || (theme === 'light' ? '#ffffff' : '#0b0f19')
      meta.setAttribute('content', bg)
    }
  }, [theme])
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
    const label = active.charAt(0).toUpperCase() + active.slice(1)
    if (liveRef.current) liveRef.current.textContent = `Section: ${label}`
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

  // Keyboard shortcuts: numeric keys jump to sections
  useEffect(() => {
    const map: Record<string, Section> = {
      '1': 'home',
      ...(hasFinanceSupabaseEnv()
        ? isFinanceAuthed
          ? canFinance === true
            ? { '2': 'circuit', '3': 'investments', '4': 'snake', '5': 'contact' }
            : { '2': 'circuit', '3': 'snake', '4': 'contact' }
          : { '2': 'signin', '3': 'snake', '4': 'contact' }
        : { '2': 'snake', '3': 'contact' }),
    }
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      const isTyping =
        tag === 'input' || tag === 'textarea' || (target as HTMLElement)?.isContentEditable
      if (isTyping || e.altKey || e.ctrlKey || e.metaKey) return
      const key = e.key
      if (map[key]) {
        setActive(map[key])
        e.preventDefault()
        return
      }
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

  // Apply reveal-on-scroll to tagged elements
  // canvas exit re-mounts the page's sections without changing tabs — they need a
  // fresh reveal pass too, or they mount opacity-0 and stay invisible
  useReveal('.reveal', `${active}:${canvasOpen}`)

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
  // Home splits into its own multi-pane layout; the Circuit has its own internal canvas
  // (the nav button routes to it by event). Every other content tab floats as a single
  // window. signin / invite (auth flows) don't get canvas.
  // NOTE: this list, canvasTitleFor and singleCanvasNode below must all gain an entry
  // together, and the section's normal render must be guarded with !inGenericCanvas or it
  // draws twice. chat/ratings/people/profile arrived with the mobile restructure and were
  // missed here, so the canvas button did nothing on them.
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
  const inGenericCanvas = desktop && canvasOpen && singleCanvasTabs.includes(active)
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
  // the inner content for whichever single-window tab is active (mirrors the section body)
  const singleCanvasNode = () => {
    switch (active) {
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
        return <ChatPage authed={isFinanceAuthed || previewMember} />
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
  }

  // Pinned windows follow you across tabs. We keep the pane OBJECTS (not just ids) so a
  // window pinned on one tab can still render on another after its own page unmounted —
  // the node re-mounts and reads the same live store.
  const pinnedIds = pinned.map((p) => p.id)
  const togglePin = (pane: CanvasPane) =>
    setPinned((prev) =>
      prev.some((p) => p.id === pane.id) ? prev.filter((p) => p.id !== pane.id) : [...prev, pane],
    )
  /** this tab's panes plus any pinned ones it doesn't already own */
  // A tab's own panes are rebuilt every render, but pinned copies are frozen at pin time —
  // so the page that owns them hands back fresh ones when what they render changes.
  const refreshPinned = (fresh: CanvasPane[]) =>
    setPinned((prev) => prev.map((p) => fresh.find((f) => f.id === p.id) ?? p))

  const withPinned = (tabPanes: CanvasPane[]) => [
    ...tabPanes,
    ...pinned.filter((p) => !tabPanes.some((t) => t.id === p.id)),
  ]

  return (
    <div data-theme={theme} data-page={active}>
      <AmbientBackdrop section={active} theme={theme} enabled={ambientOn} />
      {/* A call outlives the screen it started on, so its controls and its audio live at app
          level — otherwise you'd navigate away and be stuck in a call you can't hear or end. */}
      <CallDock />
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
                  onClick={() => setActive('home')}
                  aria-current={active === 'home' ? 'page' : undefined}
                >
                  Home
                </a>
                {isFinanceAuthed && !suspended && (
                  <a
                    href="#circuit"
                    onClick={() => setActive('circuit')}
                    aria-current={active === 'circuit' ? 'page' : undefined}
                  >
                    Circuit
                  </a>
                )}
                {isFinanceAuthed && !suspended && (
                  <a
                    href="#ratings"
                    onClick={() => setActive('ratings')}
                    aria-current={active === 'ratings' ? 'page' : undefined}
                  >
                    Ratings
                  </a>
                )}
                {isFinanceAuthed && !suspended && (
                  <a
                    href="#chat"
                    onClick={() => setActive('chat')}
                    aria-current={active === 'chat' ? 'page' : undefined}
                  >
                    Chat
                  </a>
                )}
                {isFinanceAuthed && !suspended && (
                  <a
                    href="#people"
                    onClick={() => setActive('people')}
                    aria-current={active === 'people' ? 'page' : undefined}
                  >
                    People
                  </a>
                )}
                {hasFinanceSupabaseEnv() && !isFinanceAuthed && (
                  <a
                    href="#signin"
                    onClick={() => setActive('signin')}
                    aria-current={active === 'signin' ? 'page' : undefined}
                  >
                    Sign in
                  </a>
                )}
                {isFinanceAuthed && canFinance === true && !suspended && (
                  <a
                    href="#investments"
                    onClick={() => setActive('investments')}
                    aria-current={active === 'investments' ? 'page' : undefined}
                  >
                    Investments
                  </a>
                )}
                {isFinanceAuthed && !suspended && (
                  <a
                    href="#account-settings"
                    onClick={() => setActive('account-settings')}
                    aria-current={active === 'account-settings' ? 'page' : undefined}
                  >
                    Account
                  </a>
                )}
                {isAdmin && (
                  <a
                    href="#admin"
                    onClick={() => setActive('admin')}
                    aria-current={active === 'admin' ? 'page' : undefined}
                  >
                    Admin
                  </a>
                )}
                <a
                  href="#snake"
                  onClick={() => setActive('snake')}
                  aria-current={active === 'snake' ? 'page' : undefined}
                >
                  Snake
                </a>
                <a
                  href="#contact"
                  onClick={() => setActive('contact')}
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
              <NotificationBell notifications={notifications} />
            )}
            <SettingsMenu
              theme={theme}
              onTheme={(t) => {
                setTheme(t)
                localStorage.setItem('theme', t)
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
              ambientOn={ambientOn}
              onToggleAmbient={toggleAmbient}
              name={me.name}
              email={me.email}
              onAccount={() => setActive('account-settings')}
              onProfile={
                me.username
                  ? () => {
                      window.location.hash = '#profile?u=' + encodeURIComponent(me.username!)
                      setActive('profile')
                    }
                  : undefined
              }
              onSignIn={() => setActive('signin')}
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
        {inGenericCanvas && (
          <Suspense
            fallback={
              <div className="card" aria-busy>
                Loading…
              </div>
            }
          >
            <PageCanvas
              // key by tab so the window manager re-tiles fresh for each tab's pane
              // (it initialises its layout once per mount) — without this, navigating
              // between two single-window tabs left the canvas empty
              key={active}
              panes={withPinned([
                { id: active, title: canvasTitleFor[active] ?? active, node: singleCanvasNode() },
              ])}
              pinnedIds={pinnedIds}
              onTogglePin={togglePin}
            />
          </Suspense>
        )}
        {!inGenericCanvas &&
          active === 'home' &&
          (canvasOpen && desktop ? (
            <Suspense fallback={<EvanCook />}>
              <PageCanvas
                panes={withPinned(homePanes())}
                pinnedIds={pinnedIds}
                onTogglePin={togglePin}
              />
            </Suspense>
          ) : (
            <section id="home">
              <EvanCook />
            </section>
          ))}
        {active === 'circuit' && (
          <section id="circuit" className="card reveal">
            <Suspense
              fallback={
                <div className="card" aria-busy>
                  Loading Circuit…
                </div>
              }
            >
              <Circuit
                authed={isFinanceAuthed || !hasFinanceSupabaseEnv()}
                canvasMode={canvasOpen && desktop}
                pinnedPanes={pinned}
                pinnedIds={pinnedIds}
                onTogglePin={togglePin}
                onRefreshPinned={refreshPinned}
              />
            </Suspense>
          </section>
        )}
        {!inGenericCanvas && active === 'people' && (
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
        {!inGenericCanvas && active === 'chat' && (
          <section id="chat" className="card reveal">
            <Suspense
              fallback={
                <div className="card" aria-busy>
                  Loading Chat…
                </div>
              }
            >
              <ChatPage authed={isFinanceAuthed || previewMember} />
            </Suspense>
          </section>
        )}
        {!inGenericCanvas && active === 'ratings' && (
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
        {!inGenericCanvas && active === 'signin' && (
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
        {!inGenericCanvas && active === 'investments' && (
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
        {!inGenericCanvas && active === 'account-settings' && (
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
        {!inGenericCanvas && active === 'admin' && (
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
        {!inGenericCanvas && active === 'profile' && (
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
        {!inGenericCanvas && active === 'snake' && (
          <section id="snake" className="card reveal show-dpad">
            <SnakeGame onControlChange={setSnakeHasControl} onLiveChange={setSnakeLive} autoFocus />
          </section>
        )}
        {!inGenericCanvas && active === 'contact' && (
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
                  setActive('profile')
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
              <li>1–5: Jump to sections</li>
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
