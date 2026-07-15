// The unified "Evan Cook" page — portfolio-first public face that merges the old
// Home, Projects, and Resume sections. Each project has a click-through slideshow
// of slides (real screenshots when present, themed poster tiles otherwise) plus an
// informational write-up. Résumé content folds in as About / Skills, with a PDF link.
import { useState, type ReactNode } from 'react'
import { site } from '../config/site'
import { IconGitHub, IconLinkedIn } from '../components/Icons'
import { projects, skills, type Project, type Shot } from './work'

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
  const shots = project.shots.length ? project.shots : ([{ label: project.title }] as Shot[])
  const shot = shots[i]
  const go = (d: number) => setI((p) => (p + d + shots.length) % shots.length)

  return (
    <div>
      <div
        style={{
          position: 'relative',
          aspectRatio: '16 / 10',
          // cap the width (keeps the 16:10 ratio, centered) so a wide window / big monitor
          // doesn't stretch the media tall and force a scroll for the text below it
          width: '100%',
          maxWidth: 560,
          margin: '0 auto',
          borderRadius: 12,
          overflow: 'hidden',
          border: `1px solid ${project.accent}44`,
          background: 'var(--b1, rgba(127,127,127,0.06))',
        }}
      >
        {shot.src ? (
          <img
            src={shot.src}
            alt={shot.label}
            onClick={() => setZoom(true)}
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
                aria-label={`Go to slide ${di + 1}`}
                onClick={() => setI(di)}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  background: di === i ? project.accent : 'var(--border, rgba(127,127,127,0.35))',
                }}
              />
            ))}
          </span>
        )}
      </div>

      {zoom && shot.src && (
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
          <img
            src={shot.src}
            alt={shot.label}
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
                        ? { background: project.accent, color: '#fff', borderColor: 'transparent' }
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
                        ? { background: project.accent, color: '#fff', borderColor: 'transparent' }
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
          <h1 style={{ margin: '0.3rem 0 0.5rem', lineHeight: 1.1 }}>
            I design and build fast, playful web apps end to end.
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: '1.02rem' }}>
            Frontend-focused full-stack developer. This site is my playground — a single platform
            where each project is a live, working module. React · TypeScript · Supabase.
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
  return (
    <div className="card">
      <h2 className="section-title">About</h2>
      <p className="muted" style={{ lineHeight: 1.6 }}>
        I like turning ideas into things you can actually use. Most of what I build lives right here
        — a fitness-and-movies tracker my friends use daily, a multiplayer take on Snake, a private
        finance tool for my family — all running on one React + Supabase platform I keep sharpening.
      </p>
      <p className="muted" style={{ lineHeight: 1.6, marginBottom: 0 }}>
        I care about the details: smooth interactions, fast loads, accessible layouts, and code
        that’s tidy enough to move quickly in. Portfolio on the outside, personal toolkit on the
        inside.
      </p>
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
  return (
    <section id="projects-showcase" style={{ scrollMarginTop: 'var(--nav-h)' }}>
      <h2 className="section-title" style={{ marginBottom: '0.25rem' }}>
        Selected work
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Each of these is live or in progress on this site. Click through the slides.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1rem' }}>
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </section>
  )
}

export function EvanCook() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <Hero />
      <section className="grid grid-2" style={{ gap: '1rem' }}>
        <AboutCard />
        <SkillsCard />
      </section>
      <Work />
    </div>
  )
}

// Home as a set of canvas windows (used by the banner's optional canvas mode). Reuses this
// file's section components, so it lives here despite the fast-refresh lint preference.
export type HomePane = { id: string; title: string; node: ReactNode }
// eslint-disable-next-line react-refresh/only-export-components
export function homePanes(): HomePane[] {
  return [
    { id: 'home:hero', title: '👋 Intro', node: <Hero /> },
    { id: 'home:about', title: 'About', node: <AboutCard /> },
    { id: 'home:skills', title: 'Skills', node: <SkillsCard /> },
    ...projects.map((p) => ({
      id: `home:proj:${p.id}`,
      title: p.title,
      node: <ProjectCard project={p} />,
    })),
  ]
}
