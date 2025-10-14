import { useEffect, useRef, useState } from 'react'
import { Resume } from './sections/Resume'
import { SnakeGame } from './sections/SnakeGame'
import { ContactForm } from './sections/ContactForm'
import { Projects } from './sections/Projects'
import { site } from './config/site'
import { IconGitHub, IconLinkedIn } from './components/Icons'
import { useReveal } from './hooks/useReveal'

export default function App() {
  type Section = 'home' | 'projects' | 'resume' | 'snake' | 'contact'
  const [active, setActive] = useState<Section>('home')
  const [theme, setTheme] = useState<'light' | 'dark' | 'alt'>(() => {
    const saved = localStorage.getItem('theme') as 'light' | 'dark' | 'alt' | null
    if (saved) return saved
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
  })
  const topRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLDivElement>(null)
  const navLinksRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const [hasInputFocus, setHasInputFocus] = useState(false)
  const [snakeHasControl, setSnakeHasControl] = useState(false)
  const [hideNav, setHideNav] = useState(false)
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
  }, [theme])
  // Scroll to top when changing sections
  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active])

  // Read hash on load and when it changes (deep links + back/forward)
  useEffect(() => {
    const parseHash = (): Section => {
      const h = (window.location.hash || '#home').replace('#', '') as Section
      return (['home', 'projects', 'resume', 'snake', 'contact'] as Section[]).includes(h)
        ? h
        : 'home'
    }
    // set initial
    setActive(parseHash())
    const onHash = () => setActive(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Announce section and sync hash when active changes
  useEffect(() => {
    const label = active.charAt(0).toUpperCase() + active.slice(1)
    if (liveRef.current) liveRef.current.textContent = `Section: ${label}`
    if (window.location.hash.replace('#', '') !== active) {
      window.location.hash = active
    }
  }, [active])

  // Keyboard shortcuts: 1–5 jump to sections
  useEffect(() => {
    const map: Record<string, Section> = {
      '1': 'home',
      '2': 'projects',
      '3': 'resume',
      '4': 'snake',
      '5': 'contact',
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
        const order: Section[] = ['home', 'projects', 'resume', 'snake', 'contact']
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
  }, [active, snakeHasControl])

  // Apply reveal-on-scroll to tagged elements
  useReveal('.reveal', active)

  // Swipe navigation on touch devices (anywhere, excluding interactive elements/canvas)
  useEffect(() => {
    let startX = 0
    let startY = 0
    let startTarget: EventTarget | null = null
    const THRESH = 80 // slightly higher threshold so it's subtle and not annoying
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
      // Require a clearer horizontal intent
      const mostlyHorizontal = Math.abs(dx) > Math.abs(dy) * 1.5
      if (!mostlyHorizontal) return
      const order: Section[] = ['home', 'projects', 'resume', 'snake', 'contact']
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
  }, [active])

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

  // Mobile: hide nav on scroll down, show on scroll up (debounced and thresholded to reduce jitter)
  useEffect(() => {
    let lastY = window.scrollY
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        const y = window.scrollY
        const dy = y - lastY
        lastY = y
        const isMobile = window.matchMedia('(max-width: 700px)').matches
        if (!isMobile) {
          setHideNav(false)
          return
        }
        const downThresh = 8
        const upThresh = -8
        if (y < 10 || dy <= upThresh) setHideNav(false)
        else if (dy >= downThresh) setHideNav(true)
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

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
    <div data-theme={theme}>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <nav className={`nav ${hideNav ? 'nav-hidden' : ''}`} aria-label="Primary" ref={navRef}>
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
            <a
              href="#projects"
              onClick={() => setActive('projects')}
              aria-current={active === 'projects' ? 'page' : undefined}
            >
              Projects
            </a>
            <a
              href="#resume"
              onClick={() => setActive('resume')}
              aria-current={active === 'resume' ? 'page' : undefined}
            >
              Resume
            </a>
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
            <button
              className="btn"
              style={{ marginLeft: '0.75rem' }}
              aria-label="Toggle theme"
              onClick={() => {
                const next = theme === 'dark' ? 'light' : theme === 'light' ? 'alt' : 'dark'
                setTheme(next)
                localStorage.setItem('theme', next)
              }}
            >
              {theme === 'dark' ? 'Light' : theme === 'light' ? 'Alt' : 'Dark'}
            </button>
          </div>
        </div>
      </nav>
      {/* Mobile: top-edge hit area to reveal nav by tap when hidden */}
      <button
        className="nav-reveal-hit"
        aria-label="Show navigation"
        onClick={() => setHideNav(false)}
      />
      <div ref={topRef} />
      <main
        id="content"
        className="container"
        tabIndex={-1}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {active === 'home' && (
          <section id="home" className="card">
            <h1 style={{ marginTop: 0 }}>Hi, I’m {site.name}.</h1>
            <p className="muted">
              Frontend-focused developer exploring clean interfaces, playful interactions, and fast
              builds.
            </p>
            <p>
              Check out a few small demos and the resume, or say hello via the contact form.
              Projects are easy to expand—this repo is set up for smooth updates.
            </p>
            <p>
              <a className="btn" href="#projects">
                Explore Projects
              </a>
            </p>
          </section>
        )}
        {active === 'projects' && (
          <section id="projects" className="card reveal">
            <Projects />
          </section>
        )}
        {active === 'resume' && (
          <section id="resume" className="card reveal">
            <Resume />
          </section>
        )}
        {active === 'snake' && (
          <section id="snake" className="card reveal show-dpad">
            <SnakeGame onControlChange={setSnakeHasControl} />
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
      {/* Edge arrow buttons for desktop/touch (hidden while typing; on mobile they hide with banner) */}
      {!hasInputFocus && (
        <button
          className={`edge-btn edge-left ${hideNav ? 'edge-hide' : ''}`}
          aria-label="Previous section"
          onClick={() => {
            const order: Section[] = ['home', 'projects', 'resume', 'snake', 'contact']
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
          className={`edge-btn edge-right ${hideNav ? 'edge-hide' : ''}`}
          aria-label="Next section"
          onClick={() => {
            const order: Section[] = ['home', 'projects', 'resume', 'snake', 'contact']
            const idx = order.indexOf(active)
            if (idx < order.length - 1) setActive(order[idx + 1])
          }}
          disabled={false}
        >
          ▶
        </button>
      )}
    </div>
  )
}
