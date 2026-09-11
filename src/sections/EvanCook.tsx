// The unified "Evan Cook" page — portfolio-first public face that merges the old
// Home, Projects, and Resume sections. Each project has a click-through slideshow
// of slides (real screenshots when present, themed poster tiles otherwise) plus an
// informational write-up. Résumé content folds in as About / Skills, with a PDF link.
import { useState, type ReactNode } from 'react'
import { site } from '../config/site'
import { GROUPS, TRY_THESE } from '../site/tryThese'
import { HomeScribble } from '../site/HomeScribble'
import { HomeSnake } from '../site/HomeSnake'
import { HomeSequencer } from '../site/HomeSequencer'
import { TileArt } from '../site/TileArt'
import { IconGitHub, IconLinkedIn } from '../components/Icons'
import { projects, skills, type Project } from './work'
import { HOME } from '../site/homeContent'
import { HeroPlay } from '../site/HeroPlay'

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

/**
 * What went into one of these — the case study, folded into the demo it belongs to.
 *
 * ⚠️ A <details>, not a panel with state. It is the one disclosure on this page that nobody
 * needs open to understand what they are looking at: the demo above it has already done that
 * job. Native means it is keyboard reachable, findable by the browser's own in-page search even
 * while shut, and costs no script.
 */
function ProjectNotes({ id, inline = false }: { id: string; inline?: boolean }) {
  const project = projects.find((p) => p.id === id)
  if (!project) return null
  const body = (
    <div className="demo-notes-body" style={{ borderLeft: `3px solid ${project.accent}` }}>
      {project.blurb.map((para, i) => (
        <p key={i} className="muted">
          {para}
        </p>
      ))}
      <ul>
        {project.highlights.map((h, i) => (
          <li key={i} className="muted">
            {h}
          </li>
        ))}
      </ul>
      <p className="demo-tags">
        {project.tags.map((t) => (
          <span key={t} className="demo-tag">
            {t}
          </span>
        ))}
      </p>
      {project.links.some((l) => l.external) && (
        <p className="demo-links">
          {project.links
            .filter((l) => l.external)
            .map((l) => (
              <a
                key={l.href}
                className="btn btn-ghost"
                href={l.href}
                target="_blank"
                rel="noreferrer"
              >
                {l.label} ↗
              </a>
            ))}
        </p>
      )}
    </div>
  )

  const head = (
    <>
      <strong>{project.title}</strong>{' '}
      <span className="muted">
        {STATUS_LABEL[project.status]}
        {project.period ? ` · ${project.period}` : ''}
      </span>
    </>
  )

  /**
   * ⚠️ INLINE WHEN THERE IS NOTHING ABOVE IT TO BE "IT".
   *
   * Every one of these was a <details> labelled "What went into it", and three ended up stacked
   * at the foot of the page with no demo above any of them — three identical dropdowns in a row,
   * each about a thing the reader could not see. Signed out that is exactly what happens: the
   * Circuit's demo is members-only so its write-up falls through to the leftovers beside
   * Dollar-a-Day, and evancook.dev's sat bare at the top for the same reason.
   *
   * So a write-up with nothing above it is not folded at all — it is a titled block that says
   * what it is. Only the ones attached to something visible stay a disclosure, and those NAME the
   * thing now rather than saying "it".
   */
  if (inline) {
    return (
      <article className="demo-solo">
        <p className="demo-notes-head">{head}</p>
        <p className="demo-solo-tagline">{project.tagline}</p>
        {body}
      </article>
    )
  }

  return (
    <details className="demo-notes">
      <summary>What went into {project.title}</summary>
      <p className="demo-notes-head">{head}</p>
      {body}
    </details>
  )
}

/**
 * Everything on this site, running.
 *
 * ⚠️ THEY ARE NOT TILES. Each was a bordered card with a rectangle of art inside it, which is
 * why they read as blocks rather than demos — a box around a live thing says "here is a picture
 * of a feature". The one demo on this page that never had the problem is the hero's keys: a band
 * with a caption under it and no box at all. So these are bands too.
 *
 * ⚠️ AND THEY ARE IN RUNS. Eight in one flat grid was a list — every demo the same weight,
 * each following the last for no reason a reader could see. Two groups with a line each gives the
 * section an argument: what you can do alone, then what needs somebody else. That is the site's
 * thesis rather than a sorting convenience.
 *
 * ⚠️ WIDTHS RUN 2,1,1,2 WITHIN EACH RUN, restarting per group. Each PAIR sums to the three
 * columns and an odd count cannot pair up, so the last of a run takes a row to itself rather than
 * leaving a hole. Restarting matters: carrying the cycle across a heading would drop a stray
 * single at the top of the next run.
 */
function Demos({ authed }: { authed: boolean }) {
  const items = TRY_THESE.filter((t) => !t.members || authed)
  const platform = projects.find((p) => p.id === 'platform')
  const shown = new Set(items.map((t) => t.project).filter(Boolean))
  const leftovers = projects.filter((p) => p.id !== 'platform' && !shown.has(p.id))
  return (
    <section className="demos" id="projects-showcase" style={{ scrollMarginTop: 'var(--nav-h)' }}>
      <h2 className="section-title" style={{ marginBottom: '0.2rem' }}>
        What I have built
      </h2>
      {/* ⚠️ evancook.dev's tagline, and NOT its write-up. That write-up said the same thing as
          the "How is it built?" thread in About, and as a bare dropdown up here it was one of the
          three unlabelled ones. The repository link it carried is already in the hero. */}
      <p className="muted demos-lede">{platform?.tagline}</p>

      {GROUPS.map((g) => {
        const run = items.filter((t) => t.group === g.id)
        if (!run.length) return null
        return (
          <div key={g.id} className="demo-run">
            <h3 className="demo-run-title">{g.title}</h3>
            <p className="muted demo-run-lead">{g.lead}</p>
            <div className="demos-grid">
              {run.map((t, i) => {
                const href = t.href ?? `#${t.id}`
                const span =
                  run.length % 2 === 1 && i === run.length - 1 ? 'full' : [2, 1, 1, 2][i % 4]
                const go = (e: { preventDefault: () => void }) => {
                  e.preventDefault()
                  /* the whole target, not just the room — the profile invitation carries ?demo=1 */
                  window.location.hash = href.replace(/^#/, '')
                }
                return (
                  <div key={t.id} className="demo" data-span={span}>
                    {/**
                     * ⚠️ A DEMO IS A DIV, NOT A LINK. An <a> wrapping a drawing surface is
                     * broken twice over: every stroke ends in a navigation, and a control nested
                     * inside a link is not reachable on its own by a keyboard or screen reader.
                     */}
                    <div className="demo-art">
                      {t.live === 'scribble' ? (
                        <HomeScribble />
                      ) : t.live === 'snake' ? (
                        <HomeSnake />
                      ) : t.live === 'keys' ? (
                        <HomeSequencer />
                      ) : t.live ? (
                        <TileArt kind={t.live} />
                      ) : null}
                    </div>
                    <p className="demo-title">
                      <span aria-hidden className="demo-ic">
                        {t.icon}
                      </span>
                      <strong>{t.title}</strong>
                    </p>
                    <p className="muted demo-line">{t.line}</p>
                    <a className="demo-go" href={href} onClick={go}>
                      {t.open ?? 'Open it'} →
                    </a>
                    {t.project && <ProjectNotes id={t.project} />}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/**
       * ⚠️ A PROJECT WITH NO DEMO STILL NEEDS SOMEWHERE TO LIVE, and it is not a dropdown.
       * Dollar-a-Day is real money in real accounts so there is no honest public demo, and signed
       * out the Circuit has none either — its demo is members-only. Both are written out in full
       * here, titled, rather than hidden behind a label saying "it".
       */}
      {leftovers.length > 0 && (
        <div className="demo-run">
          <h3 className="demo-run-title">Also here</h3>
          <p className="muted demo-run-lead">No demo for these — you would need an account.</p>
          <div className="demo-solos">
            {leftovers.map((o) => (
              <ProjectNotes key={o.id} id={o.id} inline />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

export function EvanCook({ authed = false }: { authed?: boolean } = {}) {
  return (
    <div className="home-page">
      <Hero />
      {/* ⚠️ 3fr/2fr rather than the old equal halves. Two identical columns of prose is the same
          symmetry problem as the tiles, and these two are not equally interesting. */}
      {/* ⚠️ PROOF BEFORE CONTEXT. The hero ends on "everything here is live — press something",
          and what followed was an About card: the page made an offer and then changed the
          subject. The demos answer the sentence directly above them now, and who I am is what you
          read once you have already pressed something. */}
      <Demos authed={authed} />
      <section className="home-split">
        <AboutMe />
        <SkillsCard />
      </section>
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
    /* ⚠️ The write-ups, not the cards — the cards are gone. A project's pane is its notes now,
       which is the same content the demo carries folded up. */
    ...projects.map((p) => ({
      id: `home:proj:${p.id}`,
      title: p.title,
      node: <ProjectNotes id={p.id} />,
    })),
  ]
}
