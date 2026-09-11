// The unified "Evan Cook" page — portfolio-first public face that merges the old
// Home, Projects, and Resume sections. Each project has a click-through slideshow
// of slides (real screenshots when present, themed poster tiles otherwise) plus an
// informational write-up. Résumé content folds in as About / Skills, with a PDF link.
import { useState, type ReactNode } from 'react'
import { site } from '../config/site'
import { TRY_THESE } from '../site/tryThese'
import { HomeScribble } from '../site/HomeScribble'
import { HomeSnake } from '../site/HomeSnake'
import { HomeSequencer } from '../site/HomeSequencer'
import { TileArt } from '../site/TileArt'
import { IconGitHub, IconLinkedIn } from '../components/Icons'
import { projects, skills, type Project } from './work'
import { HOME } from '../site/homeContent'
import { HeroPlay } from '../site/HeroPlay'
import { readableOn } from '../theme/customTheme'

const STATUS_LABEL: Record<Project['status'], string> = {
  live: 'Live',
  building: 'Building',
  planned: 'Planned',
}

/**
 * ⚠️ THE POSTERS ARE GONE, and nothing pretends to be a screenshot in their place.
 *
 * Each project card opened with a slideshow of generated gradient tiles — a purple rectangle
 * with the word "Board" on it standing in for the Circuit — because real screenshots had never
 * been taken. The code said so out loud: "a themed poster used as a slide when no real
 * screenshot is supplied." On the half of the page an employer actually reads, three coloured
 * rectangles with one word each is worse than no picture at all: it looks like a template
 * somebody did not finish.
 *
 * ⚠️ And the page does not need them. Every one of these projects is running LIVE in Have a
 * go, a few hundred pixels up — you can draw in the paint studio and play the snake board
 * before you reach this section. A picture of a thing you have already used is not evidence of
 * anything. So the two halves stop competing, which is the "fighting balance" this fixes: up
 * there the work SHOWS itself, down here it explains itself.
 *
 * What replaces the poster is the project's own accent as a rule down the edge of the card —
 * decoration that is honest about being decoration.
 */
function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="card proj-card" style={{ borderLeft: `3px solid ${project.accent}` }}>
      <div className="proj-body">
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
        All of it runs here — you have already used some of it further up.
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
                ) : t.live === 'keys' ? (
                  <HomeSequencer />
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
