import { useEffect, useRef, useState } from 'react'
import { Resume } from './sections/Resume'
import { SnakeGame } from './sections/SnakeGame'
import { ContactForm } from './sections/ContactForm'
import { Projects } from './sections/Projects'

export default function App() {
  type Section = 'home' | 'projects' | 'resume' | 'snake' | 'contact'
  const [active, setActive] = useState<Section>('home')
  const topRef = useRef<HTMLDivElement>(null)
  // Scroll to top when changing sections
  useEffect(() => { topRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [active])

  // Read hash on load and when it changes (deep links + back/forward)
  useEffect(() => {
    const parseHash = (): Section => {
      const h = (window.location.hash || '#home').replace('#', '') as Section
  return (['home', 'projects', 'resume', 'snake', 'contact'] as Section[]).includes(h) ? h : 'home'
    }
    // set initial
    setActive(parseHash())
    const onHash = () => setActive(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div>
      <nav className="nav">
        <div className="container nav-inner">
          <a className="brand" href="#home" aria-label="Home">Evan Cook</a>
          <div>
            <a href="#home" onClick={() => setActive('home')} aria-current={active==='home' ? 'page' : undefined}>Home</a>
            <a href="#projects" onClick={() => setActive('projects')} aria-current={active==='projects' ? 'page' : undefined}>Projects</a>
            <a href="#resume" onClick={() => setActive('resume')} aria-current={active==='resume' ? 'page' : undefined}>Resume</a>
            <a href="#snake" onClick={() => setActive('snake')} aria-current={active==='snake' ? 'page' : undefined}>Snake</a>
            <a href="#contact" onClick={() => setActive('contact')} aria-current={active==='contact' ? 'page' : undefined}>Contact</a>
          </div>
        </div>
      </nav>
      <div ref={topRef} />
      <main className="container">
        {active === 'home' && (
          <section id="home" className="card">
            <h1 style={{marginTop:0}}>Welcome!</h1>
            <p className="muted">This is a portfolio site with a built-in Snake game and a simple contact form.</p>
            <p>Use the navigation to explore each section. Customize content in <code>src/sections</code>.</p>
          </section>
        )}
        {active === 'projects' && <section id="projects"><Projects /></section>}
        {active === 'resume' && <section id="resume"><Resume /></section>}
        {active === 'snake' && <section id="snake"><SnakeGame /></section>}
        {active === 'contact' && <section id="contact"><ContactForm /></section>}
      </main>
      <footer className="container" style={{opacity:.9, paddingTop:'1rem', paddingBottom:'2rem'}}>
        <div className="muted">© {new Date().getFullYear()} Evan Cook • <a href="https://github.com/justanothertree" target="_blank" rel="noreferrer">GitHub</a></div>
      </footer>
    </div>
  )
}
