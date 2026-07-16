import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { ContactForm } from './sections/ContactForm'
import { EvanCook, homePanes } from './sections/EvanCook'
import { SnakeGame } from './sections/SnakeGame'
import { site } from './config/site'
import { IconGitHub, IconLinkedIn } from './components/Icons'
import { useReveal } from './hooks/useReveal'
import { hasFinanceSupabaseEnv } from './finance/env'
import { getSessionUser, onAuthStateChange, peekPersistedUserId, signOut } from './finance/auth'
import { getSupabaseClient } from './finance/client'

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

if (import.meta.env.DEV) {
  import('./dev/supabaseDebug')
}

type Section =
  | 'home'
  | 'circuit'
  | 'signin'
  | 'investments'
  | 'account-settings'
  | 'snake'
  | 'contact'
  | 'admin'
  | 'invite'

// Single source of truth for left/right section order (keyboard, swipe, edge buttons).
// Home is the unified Evan Cook page (portfolio + about + projects). Circuit is featured
// as a project on Home and appears in nav only for signed-in members.
// 'invite' and 'admin' are not in the arrow/swipe order — accessed via direct link or nav only.
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

export default function App() {
  const initialSection: Section = (() => {
    const raw = (window.location.hash || '#home').replace('#', '')
    const base = (raw.split('?')[0] || 'home') as Section
    return (
      [
        'home',
        'circuit',
        'signin',
        'investments',
        'account-settings',
        'snake',
        'contact',
        'admin',
        'invite',
      ] as Section[]
    ).includes(base)
      ? base
      : 'home'
  })()
  const [active, setActive] = useState<Section>(initialSection)
  // boot from the persisted session + last-confirmed flags (verified in the background)
  const [boot] = useState(() => {
    const uid = hasFinanceSupabaseEnv() ? peekPersistedUserId() : null
    return { uid, flags: uid ? readNavFlags(uid) : null }
  })
  const uidRef = useRef<string | null>(boot.uid)
  const [isFinanceAuthed, setIsFinanceAuthed] = useState(!!boot.uid)
  const [isAdmin, setIsAdmin] = useState(boot.flags?.admin ?? false)
  // 'finance' feature flag for this account: null = still loading (don't redirect yet).
  // A cached true paints the tab immediately; a cached false stays "loading" so a
  // deep link to #investments can't be bounced before the server weighs in.
  const [canFinance, setCanFinance] = useState<boolean | null>(boot.flags?.finance ? true : null)
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
  const [uiScale, setUiScale] = useState<number>(() => {
    const s = parseFloat(localStorage.getItem('ui_scale') || '1')
    return Number.isFinite(s) ? Math.min(2.5, Math.max(0.5, s)) : 1
  })
  useEffect(() => {
    localStorage.setItem('ui_scale', String(uiScale))
  }, [uiScale])
  const bumpScale = (d: number) =>
    setUiScale((s) => Math.min(2.5, Math.max(0.5, Math.round((s + d) * 100) / 100)))
  // Optional canvas mode (desktop): turn the current page into draggable/resizable windows.
  // Per-page, so it resets on navigation. Starting with Home; expands to other pages next.
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= 820,
  )
  const [canvasOpen, setCanvasOpen] = useState(false)
  // windows the user pinned — they ride along onto every tab's canvas
  const [pinned, setPinned] = useState<CanvasPane[]>([])
  // ANY mounted canvas (home's or the Circuit's own) announces itself; the global zoom
  // is suspended while one is up — CSS zoom fights the fixed full-screen surface and
  // used to push a "full screen" window past the viewport (scroll to see it all).
  const [canvasMounted, setCanvasMounted] = useState(false)
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
  // Canvas mode now PERSISTS across tab navigation — clicking another tab keeps you in
  // canvas (each tab swaps in its own windows). It only auto-closes when the viewport
  // drops below desktop (canvas is desktop-only).
  useEffect(() => {
    if (!desktop) setCanvasOpen(false)
  }, [desktop])
  const topRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLDivElement>(null)
  const navLinksRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const [hasInputFocus, setHasInputFocus] = useState(false)
  const [snakeHasControl, setSnakeHasControl] = useState(false)
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
  // Scroll to top when changing sections
  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active])

  // Read hash when it changes (deep links + back/forward)
  useEffect(() => {
    const parseHash = (): Section => {
      const raw = (window.location.hash || '#home').replace('#', '')
      const base = (raw.split('?')[0] || 'home') as Section
      return (
        [
          'home',
          'circuit',
          'signin',
          'investments',
          'account-settings',
          'snake',
          'contact',
          'admin',
          'invite',
        ] as Section[]
      ).includes(base)
        ? base
        : 'home'
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
      // Arrow navigation across sections
      // On Snake page, Arrow keys control page nav unless the game has control (focused/playing)
      const onSnake = active === 'snake'
      const allowPageNav = !onSnake || (onSnake && !snakeHasControl)
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
  useReveal('.reveal', active)

  // Swipe navigation on touch devices. Deliberately strict: page changes are jarring when
  // accidental, so only a quick, clearly-horizontal flick navigates — a scroll that wobbles
  // sideways, a slow drag, or a gesture on charts/scrollable rows must never flip the page.
  useEffect(() => {
    let startX = 0
    let startY = 0
    let startAt = 0
    let startTarget: EventTarget | null = null
    const THRESH = 90 // a real flick, not scroll drift
    const MAX_DRIFT = 70 // too much vertical movement = it was a scroll
    const MAX_MS = 600 // flicks are fast; slow drags don't navigate
    const inHorizontalScroller = (el: HTMLElement | null): boolean => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 4) {
          const ox = getComputedStyle(n).overflowX
          if (ox === 'auto' || ox === 'scroll') return true
        }
      }
      return false
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return // ignore multi-touch
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      startAt = e.timeStamp
      startTarget = e.target
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (!startTarget) return
      // ignore gestures that start on interactive things: canvas (snake), charts (svg),
      // form fields, links/buttons, or anything horizontally scrollable (tables, chips)
      const node = startTarget as HTMLElement
      if (node.closest('canvas, svg, input, textarea, button, a, select, [data-noswipe]')) return
      if (inHorizontalScroller(node)) return
      if (e.timeStamp - startAt > MAX_MS) return
      const t = e.changedTouches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      const clearlyHorizontal = Math.abs(dx) > Math.abs(dy) * 2 && Math.abs(dy) < MAX_DRIFT
      if (!clearlyHorizontal) return
      const order = navOrder(hasFinanceSupabaseEnv(), isFinanceAuthed, isAdmin, canFinance === true)
      const idx = order.indexOf(active)
      if (dx > THRESH && idx > 0) setActive(order[idx - 1]) // swipe right -> previous
      if (dx < -THRESH && idx < order.length - 1) setActive(order[idx + 1]) // swipe left -> next
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [active, isFinanceAuthed, isAdmin, canFinance])

  // Keep active nav link visible in the top bar on section change
  useEffect(() => {
    const el = document.querySelector('.nav-links a[aria-current="page"]') as HTMLElement | null
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [active])

  // Add fade only when nav links actually overflow
  useEffect(() => {
    const el = navLinksRef.current
    if (!el) return
    const check = () => {
      const hasOverflow = el.scrollWidth > el.clientWidth + 2
      el.classList.toggle('has-overflow', hasOverflow)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    window.addEventListener('resize', check)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [])

  // Back-to-top visibility on scroll
  useEffect(() => {
    const onScroll = () => {
      setShowTop(window.scrollY > 200)
    }
    onScroll()
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

  // Track if an input/textarea/select has focus to adjust UI (hide edge arrows)
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const node = e.target as HTMLElement
      if (node.closest('input, textarea, select, [contenteditable="true"]')) setHasInputFocus(true)
    }
    const onFocusOut = () => {
      const a = document.activeElement as HTMLElement | null
      const stillIn = a?.closest?.('input, textarea, select, [contenteditable="true"]')
      if (!stillIn) setHasInputFocus(false)
    }
    window.addEventListener('focusin', onFocusIn)
    window.addEventListener('focusout', onFocusOut)
    return () => {
      window.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  // ── canvas on every tab ──
  // Home splits into its own multi-pane layout; the Circuit has its own internal canvas
  // (the nav button routes to it by event). Every other content tab floats as a single
  // window. signin / invite (auth flows) don't get canvas.
  const singleCanvasTabs: Section[] = [
    'investments',
    'account-settings',
    'snake',
    'contact',
    'admin',
    'signin',
  ]
  const canvasCapable =
    active === 'home' || active === 'circuit' || singleCanvasTabs.includes(active)
  const inGenericCanvas = desktop && canvasOpen && singleCanvasTabs.includes(active)
  const canvasTitleFor: Partial<Record<Section, string>> = {
    investments: '📈 Investments',
    'account-settings': '👤 Account',
    snake: '🐍 Snake',
    contact: '✉️ Contact',
    admin: '🛠 Admin',
    signin: '🔑 Sign in',
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
        return <SnakeGame onControlChange={setSnakeHasControl} autoFocus />
      case 'contact':
        return <ContactForm />
      case 'admin':
        return isAdmin ? <AdminPanel /> : <p className="muted">Admin access required.</p>
      case 'signin':
        return <SignIn />
      default:
        return null
    }
  }
  // one launcher for the whole site; canvas state lives here and persists across tabs
  const toggleCanvas = () => setCanvasOpen((o) => !o)

  // Pinned windows follow you across tabs. We keep the pane OBJECTS (not just ids) so a
  // window pinned on one tab can still render on another after its own page unmounted —
  // the node re-mounts and reads the same live store.
  const pinnedIds = pinned.map((p) => p.id)
  const togglePin = (pane: CanvasPane) =>
    setPinned((prev) =>
      prev.some((p) => p.id === pane.id) ? prev.filter((p) => p.id !== pane.id) : [...prev, pane],
    )
  /** this tab's panes plus any pinned ones it doesn't already own */
  const withPinned = (tabPanes: CanvasPane[]) => [
    ...tabPanes,
    ...pinned.filter((p) => !tabPanes.some((t) => t.id === p.id)),
  ]

  return (
    <div data-theme={theme} data-page={active}>
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
            <span
              className="nav-zoom"
              style={{
                // canvas windows scale to their own size, so the global zoom does nothing
                // there — hide the A− / A+ cluster while a canvas is open to avoid dead controls
                display: canvasOpen || canvasMounted ? 'none' : 'inline-flex',
                alignItems: 'center',
                gap: '0.15rem',
                marginLeft: '0.75rem',
              }}
              title={`UI scale ${Math.round(uiScale * 100)}%`}
            >
              <button
                className="btn"
                aria-label="Zoom out"
                onClick={() => bumpScale(-0.1)}
                disabled={uiScale <= 0.5}
                style={{ padding: '0.5rem 0.6rem' }}
              >
                A−
              </button>
              <button
                className="btn"
                aria-label="Reset zoom"
                onClick={() => setUiScale(1)}
                style={{
                  padding: '0.5rem 0.4rem',
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: '3.1rem',
                  textAlign: 'center',
                }}
              >
                {Math.round(uiScale * 100)}%
              </button>
              <button
                className="btn"
                aria-label="Zoom in"
                onClick={() => bumpScale(0.1)}
                disabled={uiScale >= 2.5}
                style={{ padding: '0.5rem 0.6rem' }}
              >
                A+
              </button>
            </span>
            {desktop && (
              // always rendered on desktop so the nav width doesn't jump; visible on any
              // canvas-capable tab, hidden-but-space-reserved on the auth flows
              <button
                className="btn"
                style={{
                  marginLeft: '0.5rem',
                  visibility: canvasCapable ? 'visible' : 'hidden',
                  pointerEvents: canvasCapable ? 'auto' : 'none',
                }}
                aria-hidden={!canvasCapable}
                tabIndex={canvasCapable ? 0 : -1}
                aria-pressed={canvasOpen}
                title="Canvas mode — float this page as draggable windows"
                onClick={toggleCanvas}
              >
                ⛶ Canvas
              </button>
            )}
            <button
              className="btn"
              style={{ marginLeft: '0.5rem' }}
              aria-label="Toggle theme"
              onClick={() => {
                const next = theme === 'dark' ? 'light' : theme === 'light' ? 'alt' : 'dark'
                setTheme(next)
                localStorage.setItem('theme', next)
              }}
            >
              {theme === 'dark' ? 'Light' : theme === 'light' ? 'Alt' : 'Dark'}
            </button>
            {hasFinanceSupabaseEnv() && isFinanceAuthed && (
              <button
                className="btn"
                style={{ marginLeft: '0.5rem' }}
                onClick={() => {
                  void signOut().catch(() => {
                    /* ignore */
                  })
                }}
                aria-label="Sign out"
              >
                Sign out
              </button>
            )}
          </div>
        </div>
      </nav>
      {/* Mobile: reveal hit area removed; banner stays visible */}
      <div ref={topRef} />
      {/* canvas mode has its own per-window scaling; the global zoom fights its fixed
          full-screen surface (footer teleporting on big zoom), so suspend it while it's on */}
      <main
        id="content"
        className="container"
        tabIndex={-1}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          zoom: canvasOpen || canvasMounted ? 1 : uiScale,
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
              onExit={() => setCanvasOpen(false)}
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
                onExit={() => setCanvasOpen(false)}
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
                onExitCanvas={() => setCanvasOpen(false)}
                pinnedPanes={pinned}
                pinnedIds={pinnedIds}
                onTogglePin={togglePin}
              />
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
        {!inGenericCanvas && active === 'snake' && (
          <section id="snake" className="card reveal show-dpad">
            <SnakeGame onControlChange={setSnakeHasControl} autoFocus />
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
        style={{ opacity: 0.9, paddingTop: '1rem', paddingBottom: '2rem' }}
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
      {/* Edge arrow buttons for desktop/touch (hidden while typing) */}
      {!hasInputFocus && (
        <button
          className={`edge-btn edge-left`}
          aria-label="Previous section"
          onClick={() => {
            const order = navOrder(
              hasFinanceSupabaseEnv(),
              isFinanceAuthed,
              isAdmin,
              canFinance === true,
            )
            const idx = order.indexOf(active)
            if (idx > 0) setActive(order[idx - 1])
          }}
          disabled={active === 'home'}
        >
          ◀
        </button>
      )}
      {!hasInputFocus && (
        <button
          className={`edge-btn edge-right`}
          aria-label="Next section"
          onClick={() => {
            const order = navOrder(
              hasFinanceSupabaseEnv(),
              isFinanceAuthed,
              isAdmin,
              canFinance === true,
            )
            const idx = order.indexOf(active)
            if (idx < order.length - 1) setActive(order[idx + 1])
          }}
          disabled={active === 'contact'}
        >
          ▶
        </button>
      )}
      {showTop && (
        <button
          className="back-to-top"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          ↑
        </button>
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
