// The unified "Evan Cook" page — portfolio-first public face that merges the old
// Home, Projects, and Resume sections. Each project has a click-through slideshow
// of slides (real screenshots when present, themed poster tiles otherwise) plus an
// informational write-up. Résumé content folds in as About / Skills, with a PDF link.
import { useState, type ReactNode } from 'react'
import { site } from '../config/site'
import { TRY_THESE } from '../site/tryThese'
import { HomeScribble } from '../site/HomeScribble'
import { HomeSnake } from '../site/HomeSnake'
import { TileArt } from '../site/TileArt'
import { IconGitHub, IconLinkedIn } from '../components/Icons'
import { projects, skills, type Project, type Shot } from './work'
import { HOME } from '../site/homeContent'
import { HeroPlay } from '../site/HeroPlay'
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

/**
 * ⚠️ NOT A CARD ANY MORE, and that is most of the "squarish" complaint answered.
 *
 * The page was seven bordered rectangles of equal weight stacked down a column, which reads as a
 * form rather than as somebody's front door. The hero now has no box around it: the type is the
 * structure, and the only bordered thing in it is the toy — so the eye lands on the one part that
 * is asking to be touched instead of on a border.
 */
function Hero() {
  return (
    <section className="home-hero">
      <p className="home-eyebrow">{site.name}</p>
      <h1 className="home-h1">{HOME.hero.heading}</h1>
      <p className="home-lede muted">{HOME.hero.blurb}</p>
      <HeroPlay />
      <div className="no-print home-cta">
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
        <span className="home-socials">
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
        </span>
      </div>
    </section>
  )
}

/**
 * About me, as a set of questions you open.
 *
 * ⚠️ TWO PARAGRAPHS OF PROSE WAS THE WRONG SHAPE for the one section a stranger reads about a
 * person. It says everything at once to somebody who wanted one thing, and it cannot grow — a
 * third paragraph makes it a wall, and the fourth means nobody reads any of them. Questions let
 * the reader take only what they came for, and the section stays the same size however much is
 * behind it.
 *
 * ⚠️ THE FIRST ONE IS OPEN. A row of closed questions is a row of buttons, and a section that
 * shows nothing until you press something is a section most people walk past. Something is always
 * being answered.
 */
function AboutMe() {
  const [open, setOpen] = useState(0)
  const thread = HOME.about.threads[open]
  return (
    <div className="card about-me">
      <h2 className="section-title" style={{ marginBottom: '0.2rem' }}>
        {HOME.about.heading}
      </h2>
      <p className="muted about-lede">{HOME.about.lede}</p>
      <div className="about-qs" role="tablist" aria-label="About me">
        {HOME.about.threads.map((t, i) => (
          <button
            key={t.q}
            role="tab"
            aria-selected={i === open}
            /* ⚠️ Ghost when closed, solid when open — the OTHER way round it was unreadable.
               `.btn` is a solid accent button in this codebase, so three questions were three
               loud green chips and the open one was marked by a border colour nobody could pick
               out. The open one should be the one that looks pressed. */
            className={'btn about-q' + (i === open ? ' is-on' : ' btn-ghost')}
            onClick={() => setOpen(i)}
          >
            {t.q}
          </button>
        ))}
      </div>
      {/* ⚠️ Keyed on the question, so React replaces the answer rather than editing the old one
          in place — which is what lets it fade in and makes the switch legible instead of the text
          silently becoming different text. */}
      <div className="about-a" key={thread.q}>
        {thread.a.map((para, i) => (
          <p key={i} className="muted">
            {para}
          </p>
        ))}
        {thread.go && (
          <a
            className="btn btn-ghost about-go"
            href={thread.go.href}
            {...(thread.go.external ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            {thread.go.label} →
          </a>
        )}
      </div>
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
        All of it runs here. Click through the slides.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1rem' }}>
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </section>
  )
}

/**
 * Things you can go and do, right under the hero.
 *
 * ⚠️ THIS IS THE STRONGEST PORTFOLIO ITEM ON THE PAGE, not a concession to non-technical
 * visitors, and it took a while to see that. The worry was that easing friends and family in
 * would cheapen a professional landing page. It is the reverse: anybody hiring has seen a
 * thousand screenshots and almost never "click this, it runs, right now, in this tab". Live
 * things beat case studies at being a portfolio, and they happen to be exactly what an aunt
 * needs too.
 *
 * ⚠️ ABOVE the About and Skills prose. It used to be hero → three sections of writing → project
 * write-ups, so the first clickable thing on a site made of playable rooms was several screens
 * down, and nothing anywhere said you could play a piano here.
 */
function HaveAGo({ authed }: { authed: boolean }) {
  const items = TRY_THESE.filter((t) => !t.members || authed)
  return (
    <section className="have-a-go">
      <h2 className="section-title" style={{ marginBottom: '0.2rem' }}>
        Have a go
      </h2>
      <p className="muted" style={{ margin: '0 0 0.8rem', fontSize: '0.85rem' }}>
        Everything here is live — nothing to install, nothing to sign up for.
      </p>
      {/**
       * ⚠️ WIDTHS RUN 2,1,1,2 AND REPEAT, which is the other half of "squarish" answered.
       *
       * Six identically sized tiles gave every room the same weight and left the eye nowhere to
       * land. The pattern matters more than it looks: each PAIR sums to the three columns, so the
       * rhythm reads as deliberate rather than ragged.
       *
       * ⚠️ AN ODD COUNT CANNOT PAIR UP, so the last card takes a row to itself. This used to
       * be a bare 2,1,1,2 cycle that happened to be safe because both counts were even — four for
       * a visitor, six for a member — which is exactly the kind of thing that breaks silently the
       * next time an invitation is added. Adding the profile (everyone) and calls (members) made
       * it five and eight, and the five left a hole.
       */}
      <div className="hag-grid">
        {items.map((t, i) => {
          const href = t.href ?? `#${t.id}`
          const span =
            items.length % 2 === 1 && i === items.length - 1 ? 'full' : [2, 1, 1, 2][i % 4]
          const go = (e: { preventDefault: () => void }) => {
            e.preventDefault()
            /* the whole target, not just the room — the profile invitation carries ?demo=1 */
            window.location.hash = href.replace(/^#/, '')
          }
          /* texture, not information: the same glyph blown up and running off the corner, so a
             card is a shape rather than a rectangle of text */
          const bleed = (
            <span className="hag-bleed" aria-hidden>
              {t.icon}
            </span>
          )
          const head = (
            <span className="hag-top">
              <span aria-hidden className="hag-ic">
                {t.icon}
              </span>
              <strong>{t.title}</strong>
            </span>
          )

          /**
           * ⚠️ A LIVE TILE IS A DIV, NOT A LINK. An <a> that contains a drawing surface is
           * broken twice over: every stroke ends in a navigation, and a control nested inside a
           * link is not something a keyboard or a screen reader can reach on its own. So the card
           * stops being the link and grows a real one, which is also the honest shape — the pad
           * is the invitation now, and "open the studio" is a separate thing you may want next.
           */
          if (t.live) {
            return (
              <div key={t.id} className="hag-card is-live" data-span={span}>
                {bleed}
                {head}
                {t.live === 'scribble' ? (
                  <HomeScribble />
                ) : t.live === 'snake' ? (
                  <HomeSnake />
                ) : (
                  <TileArt kind={t.live} />
                )}
                <span className="muted hag-line">{t.line}</span>
                <a className="hag-open" href={href} onClick={go}>
                  {t.open ?? 'Open it'} →
                </a>
              </div>
            )
          }

          return (
            <a
              key={t.id}
              className={'hag-card' + (i === 0 ? ' is-feature' : '')}
              data-span={span}
              href={href}
              onClick={go}
            >
              {bleed}
              {head}
              <span className="muted hag-line">{t.line}</span>
              <span className="hag-go" aria-hidden>
                →
              </span>
            </a>
          )
        })}
      </div>
    </section>
  )
}

export function EvanCook({ authed = false }: { authed?: boolean } = {}) {
  return (
    <div className="home-page">
      <Hero />
      <HaveAGo authed={authed} />
      {/* ⚠️ 3fr/2fr rather than the old equal halves. Two identical columns of prose is the same
          symmetry problem as the tiles, and these two are not equally interesting. */}
      <section className="home-split">
        <AboutMe />
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
    { id: 'home:about', title: 'About', node: <AboutMe /> },
    { id: 'home:skills', title: 'Skills', node: <SkillsCard /> },
    ...projects.map((p) => ({
      id: `home:proj:${p.id}`,
      title: p.title,
      node: <ProjectCard project={p} />,
    })),
  ]
}
