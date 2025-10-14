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
  const topRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLDivElement>(null)
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Apply reveal-on-scroll to tagged elements
  useReveal('.reveal', active)

  // Edge-swipe navigation on touch devices
  useEffect(() => {
    let startX = 0
    let startY = 0
    let startTarget: EventTarget | null = null
    const EDGE = 24 // px from left/right to qualify as edge gesture
    const THRESH = 60 // min horizontal movement
    const onTouchStart = (e: TouchEvent) => {
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
      const atLeft = startX <= EDGE
      const atRight = startX >= window.innerWidth - EDGE
      const mostlyHorizontal = Math.abs(dx) > Math.abs(dy)
      if (!mostlyHorizontal) return
      if ((atLeft && dx > THRESH) || (atRight && dx < -THRESH)) {
        // determine next/prev section
        const order: Section[] = ['home', 'projects', 'resume', 'snake', 'contact']
        const idx = order.indexOf(active)
        if (atLeft && dx > THRESH && idx > 0) setActive(order[idx - 1])
        if (atRight && dx < -THRESH && idx < order.length - 1) setActive(order[idx + 1])
      }
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [active])

  return (
    <div>
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <nav className="nav" aria-label="Primary">
        <div className="container nav-inner">
          <a className="brand" href="#home" aria-label="Home">
            {site.name}
          </a>
          <div>
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
          </div>
        </div>
      </nav>
      <div ref={topRef} />
      <main id="content" className="container" tabIndex={-1}>
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
          <section id="snake" className="card reveal">
            <SnakeGame />
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
    </div>
  )
}
