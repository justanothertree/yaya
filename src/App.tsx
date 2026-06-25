import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { ContactForm } from './sections/ContactForm'
import { EvanCook, homePanes } from './sections/EvanCook'
import { SnakeGame } from './sections/SnakeGame'
import { site } from './config/site'
import { IconGitHub, IconLinkedIn } from './components/Icons'
import { useReveal } from './hooks/useReveal'
import { hasFinanceSupabaseEnv } from './finance/env'
import { getUser, onAuthStateChange, signOut } from './finance/auth'
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
  const [isFinanceAuthed, setIsFinanceAuthed] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  // 'finance' feature flag for this account: null = still loading (don't redirect yet)
  const [canFinance, setCanFinance] = useState<boolean | null>(null)
  const [suspended, setSuspended] = useState(false) // admin paused this account's access
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
  useEffect(() => {
    const onResize = () => setDesktop(window.innerWidth >= 820)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => setCanvasOpen(false), [active])
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
    // never disagrees with the security-definer RPCs the Admin panel calls.
    async function checkAdmin() {
      const { data } = await getSupabaseClient().rpc('is_admin')
      if (alive) setIsAdmin(data === true)
    }
    // Feature flags: only show Investments if the 'finance' feature is on for this account.
    async function checkFeatures() {
      const { data } = await getSupabaseClient().rpc('my_features')
      if (!alive) return
      const fin = (data as { feature: string; enabled: boolean }[] | null)?.find(
        (f) => f.feature === 'finance',
      )?.enabled
      setCanFinance(!!fin)
    }
    // Account status: an admin can pause (suspend) a member's access.
    async function checkAccount() {
      const { data } = await getSupabaseClient().rpc('my_account')
      if (!alive) return
      setSuspended(!!(data as { suspended: boolean }[] | null)?.[0]?.suspended)
    }
    const onSignedIn = () => {
      void checkAdmin()
      void checkFeatures()
      void checkAccount()
    }
    const onSignedOut = () => {
      setIsAdmin(false)
      setCanFinance(null)
      setSuspended(false)
    }

    void getUser()
      .then((u) => {
        if (!alive) return
        setIsFinanceAuthed(!!u)
        if (u) onSignedIn()
        else onSignedOut()
      })
      .catch(() => {
        if (!alive) return
        setIsFinanceAuthed(false)
        onSignedOut()
      })

    const { data } = onAuthStateChange((_event, session) => {
      setIsFinanceAuthed(!!session?.user)
      if (session?.user) onSignedIn()
      else onSignedOut()
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])
  // Keep CSS var --nav-h in sync with actual nav height (for padding/offset calculations)
  useEffect(() => {
    const el = navRef.current
    if (!el) return
    const apply = () => {
      const h = el.offsetHeight || 56
      document.documentElement.style.setProperty('--nav-h', h + 'px')
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    window.addEventListener('resize', apply)
    return () => {
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

    if (financeConfigured && isFinanceSection && !isFinanceAuthed) {
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

  // Swipe navigation on touch devices (anywhere, excluding interactive elements/canvas)
  useEffect(() => {
    let startX = 0
    let startY = 0
    let startTarget: EventTarget | null = null
    const THRESH = 50 // a bit lower threshold so it triggers more reliably on mobile
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return // ignore multi-touch
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      startTarget = e.target
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (!startTarget) return
      // ignore if gesture started on interactive or canvas (e.g., snake)
      const node = startTarget as HTMLElement
      if (node.closest('canvas, input, textarea, button, a, select')) return
      const t = e.changedTouches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      // Allow more forgiving horizontal intent
      const mostlyHorizontal = Math.abs(dx) > Math.abs(dy) * 1.2
      if (!mostlyHorizontal) return
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
                display: 'inline-flex',
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
            {active === 'home' && desktop && (
              <button
                className="btn"
                style={{ marginLeft: '0.5rem' }}
                aria-pressed={canvasOpen}
                title="Canvas mode — float this page as draggable windows"
                onClick={() => setCanvasOpen((o) => !o)}
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
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', zoom: canvasOpen ? 1 : uiScale }}
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
        {active === 'home' &&
          (canvasOpen && desktop ? (
            <Suspense fallback={<EvanCook />}>
              <PageCanvas panes={homePanes()} onExit={() => setCanvasOpen(false)} />
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
              <Circuit authed={isFinanceAuthed || !hasFinanceSupabaseEnv()} />
            </Suspense>
          </section>
        )}
        {active === 'signin' && (
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
        {active === 'investments' && (
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
            ) : (
              <div className="card">
                <h2 className="section-title" style={{ marginTop: 0 }}>
                  Investments
                </h2>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {isFinanceAuthed
                    ? 'Investments aren’t enabled for your account.'
                    : 'Sign in to view your investments.'}
                </p>
              </div>
            )}
          </section>
        )}
        {active === 'account-settings' && (
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
        {active === 'admin' && (
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
        {active === 'snake' && (
          <section id="snake" className="card reveal show-dpad">
            <SnakeGame onControlChange={setSnakeHasControl} autoFocus />
          </section>
        )}
        {active === 'contact' && (
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
