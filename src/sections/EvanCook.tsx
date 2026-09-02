// The unified "Evan Cook" page — portfolio-first public face that merges the old
// Home, Projects, and Resume sections. Each project has a click-through slideshow
// of slides (real screenshots when present, themed poster tiles otherwise) plus an
// informational write-up. Résumé content folds in as About / Skills, with a PDF link.
import { useEffect, useState, type ReactNode } from 'react'
import { site } from '../config/site'
import { IconGitHub, IconLinkedIn } from '../components/Icons'
import { skills, type Project, type Shot } from './work'
import { projectsFor } from '../site/homeContent'
import { homeStore, loadHome, useHomeDoc } from '../site/homeStore'
import { HomeEditor } from '../site/HomeEditor'
import { readableOn } from '../theme/customTheme'

const STATUS_LABEL: Record<Project['status'], string> = {
  live: 'Live',
  building: 'Building',
  planned: 'Planned',
}

// A themed poster used as a slide when no real screenshot is supplied.
function Poster({ accent, label }: { accent: string; label: string }) {
  return (
    <svg viewBox="0 0 320 200" style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <linearGradient id={`g-${label}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.85" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <rect width="320" height="200" fill={`url(#g-${label})`} />
      <rect width="320" height="200" fill="rgba(0,0,0,0.18)" />
      {/* faint dot grid for texture */}
      <g fill="rgba(255,255,255,0.10)">
        {Array.from({ length: 7 }, (_, r) =>
          Array.from({ length: 11 }, (_, c) => (
            <circle key={`${r}-${c}`} cx={16 + c * 29} cy={20 + r * 28} r={1.5} />
          )),
        )}
      </g>
      <text
        x="160"
        y="108"
        textAnchor="middle"
        fontSize="26"
        fontWeight="800"
        fill="#fff"
        style={{ letterSpacing: '0.5px' }}
      >
        {label}
      </text>
    </svg>
  )
}

function Slideshow({ project }: { project: Project }) {
  const [i, setI] = useState(0)
  const [zoom, setZoom] = useState(false)
  /**
   * Pictures that did not load.
   *
   * ⚠️ A SCREENSHOT PATH IS TYPED BY HAND, so it can be wrong — and the place it would be wrong
   * is the public front page, where a broken-image icon is the first thing a visitor sees. The
   * generated poster was always the fallback for "no picture yet"; a picture that fails to arrive
   * is the same situation, so it falls back the same way instead of leaving a hole.
   */
  const [broken, setBroken] = useState<Set<string>>(() => new Set())
  const shots = project.shots.length ? project.shots : ([{ label: project.title }] as Shot[])
  const shot = shots[i]
  const picture = shot.src && !broken.has(shot.src) ? shot.src : null
  const go = (d: number) => setI((p) => (p + d + shots.length) % shots.length)

  return (
    <div>
      <div
        className="proj-media"
        style={{
          position: 'relative',
          aspectRatio: '16 / 10',
          // natural scale: the shot fills whatever holds it, at its own ratio. Capping it
          // to stop a canvas window from scrolling was the wrong trade — a window that's
          // too short for its content is what ▭ fit-to-content and dragging are for.
          width: '100%',
          borderRadius: 12,
          overflow: 'hidden',
          border: `1px solid ${project.accent}44`,
          background: 'var(--b1, rgba(127,127,127,0.06))',
        }}
      >
        {picture ? (
          <img
            src={picture}
            alt={shot.label}
            onClick={() => setZoom(true)}
            onError={() => setBroken((b) => new Set(b).add(picture))}
            style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }}
          />
        ) : (
          <Poster accent={project.accent} label={shot.label} />
        )}

        {shots.length > 1 && (
          <>
            <button
              className="btn btn-ghost"
              aria-label="Previous slide"
              onClick={() => go(-1)}
              style={{ position: 'absolute', top: '50%', left: 8, transform: 'translateY(-50%)' }}
            >
              ‹
            </button>
            <button
              className="btn btn-ghost"
              aria-label="Next slide"
              onClick={() => go(1)}
              style={{ position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)' }}
            >
              ›
            </button>
          </>
        )}
      </div>

      {/* caption + dots */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          marginTop: '0.5rem',
          minHeight: 22,
        }}
      >
        <span className="muted" style={{ fontSize: '0.8rem', flex: 1 }}>
          {shot.caption || shot.label}
        </span>
        {shots.length > 1 && (
          <span style={{ display: 'inline-flex', gap: 5 }}>
            {shots.map((_, di) => (
              <button
                key={di}
                className="cz-tap"
                aria-label={`Go to slide ${di + 1}`}
                onClick={() => setI(di)}
                style={{
                  // a roomy transparent tap target (thumb-friendly) around a small dot —
                  // 7px buttons were untappable on a phone; .cz-tap grows it again on mobile
                  width: 28,
                  height: 22,
                  display: 'inline-grid',
                  placeItems: 'center',
                  border: 'none',
                  padding: 0,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: di === i ? 9 : 7,
                    height: di === i ? 9 : 7,
                    borderRadius: '50%',
                    transition: 'width 0.15s, height 0.15s',
                    background: di === i ? project.accent : 'var(--border, rgba(127,127,127,0.35))',
                  }}
                />
              </button>
            ))}
          </span>
        )}
      </div>

      {zoom && picture && (
        <div
          onClick={() => setZoom(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            zIndex: 1500,
          }}
        >
          {/* the same picture the slide is showing, so a fallen-back slide cannot open a
              broken one full-screen */}
          <img
            src={picture}
            alt={shot.label}
            onError={() => setBroken((b) => new Set(b).add(picture))}
            style={{ maxWidth: '94vw', maxHeight: '92vh', borderRadius: 10 }}
          />
        </div>
      )}
    </div>
  )
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <article
      className="card"
      style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr', alignItems: 'start' }}
    >
      <div className="proj-grid" style={{ display: 'grid', gap: '1.25rem' }}>
        <Slideshow project={project} />
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '1.3rem' }}>{project.title}</h3>
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '2px 8px',
                borderRadius: 20,
                color: project.accent,
                background: project.accent + '22',
                border: `1px solid ${project.accent}55`,
              }}
            >
              {STATUS_LABEL[project.status]}
            </span>
            {project.period && (
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                {project.period}
              </span>
            )}
          </div>
          <p style={{ margin: '0.5rem 0 0.75rem', fontWeight: 600 }}>{project.tagline}</p>

          {project.blurb.map((para, i) => (
            <p key={i} className="muted" style={{ margin: '0 0 0.6rem', lineHeight: 1.55 }}>
              {para}
            </p>
          ))}

          <ul style={{ margin: '0.4rem 0 0.9rem', paddingLeft: '1.1rem' }}>
            {project.highlights.map((h, i) => (
              <li key={i} className="muted" style={{ marginBottom: 2 }}>
                {h}
              </li>
            ))}
          </ul>

          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
            {project.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  padding: '2px 9px',
                  borderRadius: 8,
                  background: 'var(--b1, rgba(127,127,127,0.1))',
                  border: '1px solid var(--border, rgba(127,127,127,0.18))',
                }}
              >
                {t}
              </span>
            ))}
          </div>

          {project.links.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {project.links.map((l) =>
                l.external ? (
                  <a
                    key={l.href}
                    className="btn"
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    style={
                      l.primary
                        ? {
                            background: project.accent,
                            color: readableOn(project.accent),
                            borderColor: 'transparent',
                          }
                        : undefined
                    }
                  >
                    {l.label} ↗
                  </a>
                ) : (
                  <a
                    key={l.href}
                    className="btn"
                    href={l.href}
                    style={
                      l.primary
                        ? {
                            background: project.accent,
                            color: readableOn(project.accent),
                            borderColor: 'transparent',
                          }
                        : undefined
                    }
                  >
                    {l.label}
                  </a>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function Hero() {
  const doc = useHomeDoc()
  return (
    <section className="card" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <p
            className="muted"
            style={{
              margin: 0,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontSize: '0.74rem',
            }}
          >
            {site.name}
          </p>
          <h1 style={{ margin: '0.3rem 0 0.5rem', lineHeight: 1.1 }}>{doc.hero.heading}</h1>
          <p className="muted" style={{ margin: 0, fontSize: '1.02rem' }}>
            {doc.hero.blurb}
          </p>
          <div
            className="no-print"
            style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}
          >
            <button
              className="btn"
              onClick={() =>
                document
                  .getElementById('projects-showcase')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              See my work
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => window.print()}
              title="Print or save this page as a PDF résumé"
            >
              Résumé (PDF)
            </button>
            <a className="btn btn-ghost" href="#contact">
              Get in touch
            </a>
          </div>
          <div className="no-print" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem' }}>
            <a
              className="icon-link"
              href={site.socials.github}
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
            >
              <IconGitHub />
            </a>
            <a
              className="icon-link"
              href={site.socials.linkedin}
              target="_blank"
              rel="noreferrer"
              aria-label="LinkedIn"
            >
              <IconLinkedIn />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function AboutCard() {
  const doc = useHomeDoc()
  return (
    <div className="card">
      <h2 className="section-title">{doc.about.heading}</h2>
      {doc.about.paragraphs.map((text, i) => (
        <p
          key={i}
          className="muted"
          style={{
            lineHeight: 1.6,
            marginBottom: i === doc.about.paragraphs.length - 1 ? 0 : undefined,
          }}
        >
          {text}
        </p>
      ))}
    </div>
  )
}

function SkillsCard() {
  return (
    <div className="card">
      <h2 className="section-title">Skills</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        {skills.map((s) => (
          <div key={s.group}>
            <div
              className="muted"
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '0.35rem',
              }}
            >
              {s.group}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {s.items.map((it) => (
                <span
                  key={it}
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: 8,
                    background: 'var(--b1, rgba(127,127,127,0.1))',
                    border: '1px solid var(--border, rgba(127,127,127,0.18))',
                  }}
                >
                  {it}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Work() {
  const doc = useHomeDoc()
  return (
    <section id="projects-showcase" style={{ scrollMarginTop: 'var(--nav-h)' }}>
      <h2 className="section-title" style={{ marginBottom: '0.25rem' }}>
        Selected work
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        All of it runs here. Click through the slides.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1rem' }}>
        {projectsFor(doc).map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </section>
  )
}

export function EvanCook({ isAdmin = false }: { isAdmin?: boolean } = {}) {
  /* ⚠️ Asked for here rather than at app start: this is the only page that needs it, and a fetch
     fired on every load of every section would be a request nobody reads. It is a no-op after the
     first call. */
  useEffect(() => loadHome(), [])
  const [editing, setEditing] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* ⚠️ Only for an admin, and the gate is only cosmetic — the server decides who may
          actually write, so this button appearing to anybody else would still change nothing. */}
      {isAdmin && (
        <div className="home-edit-bar">
          <button
            className={'btn' + (editing ? ' is-on' : '')}
            aria-pressed={editing}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? '✓ Done editing' : '✎ Edit this page'}
          </button>
        </div>
      )}
      <Hero />
      <section className="grid grid-2" style={{ gap: '1rem' }}>
        <AboutCard />
        <SkillsCard />
      </section>
      <Work />
      {/* ⚠️ BELOW the page, not above it. The panel writes into the same store the page renders
          from, so everything you change is happening in the real thing directly above — putting
          the controls first would push the page you are editing off the screen. */}
      {isAdmin && editing && <HomeEditor onClose={() => setEditing(false)} />}
    </div>
  )
}

// Home as a set of canvas windows (used by the banner's optional canvas mode). Reuses this
// file's section components, so it lives here despite the fast-refresh lint preference.
export type HomePane = { id: string; title: string; node: ReactNode }
// eslint-disable-next-line react-refresh/only-export-components
export function homePanes({ isAdmin = false }: { isAdmin?: boolean } = {}): HomePane[] {
  return [
    { id: 'home:hero', title: '👋 Intro', node: <Hero /> },
    { id: 'home:about', title: 'About', node: <AboutCard /> },
    { id: 'home:skills', title: 'Skills', node: <SkillsCard /> },
    /* ⚠️ The SAME text the normal page renders. Canvas mode builds its windows from this
       function, outside the React tree, so it reads the store directly — App subscribes so these
       are rebuilt when the document arrives. */
    ...projectsFor(homeStore.getState().doc).map((p) => ({
      id: `home:proj:${p.id}`,
      title: p.title,
      node: <ProjectCard project={p} />,
    })),
    /**
     * ⚠️ The editor is a WINDOW here, not a panel under the page, because in canvas mode there is
     * no page under anything. Without this, turning canvas on hid the only way to edit the very
     * text the canvas is displaying — and canvas is not a mode you leave to do one thing.
     *
     * No Done button in this form: closing the window is how you leave a window, and a second
     * way out inside it would be a button that disagrees with the ✕ in its own title bar.
     */
    ...(isAdmin
      ? [{ id: 'home:edit', title: '✎ Edit this page', node: <HomeEditor /> } as HomePane]
      : []),
  ]
}
