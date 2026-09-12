// The unified "Evan Cook" page — portfolio-first public face that merges the old
// Home, Projects, and Resume sections. Each project has a click-through slideshow
// of slides (real screenshots when present, themed poster tiles otherwise) plus an
// informational write-up. Résumé content folds in as About / Skills, with a PDF link.
import { useState, type ReactNode } from 'react'
import { site } from '../config/site'
import { DEMOS_LEAD, GROUPS, TRY_THESE, type Invite } from '../site/tryThese'
import { PLACES } from '../nav/places'
import { HomeScribble } from '../site/HomeScribble'
import { HomeSnake } from '../site/HomeSnake'
import { HomeSequencer } from '../site/HomeSequencer'
import { HomeViz } from '../site/HomeViz'
import { TileArt } from '../site/TileArt'
import { IconGitHub, IconLinkedIn } from '../components/Icons'
import { projects, skills, SKILL_NOTES, type Project } from './work'
import { HOME } from '../site/homeContent'
import { HeroPlay } from '../site/HeroPlay'

/** the invitations that belong to the hero rather than to the grid — see the note in Hero() */
const HERO_SLOT = TRY_THESE.filter((t) => t.slot === 'hero')

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
      {/**
       * ⚠️ THE VISUALISER BELONGS TO THE HERO, not to the grid below. Down there it competed
       * with this for the same job — both were "here is a tool, have a go" — and the hero won, so
       * it read as a lesser repeat of the thing four inches above it. It is not a separate demo:
       * it is the other half of this one. Press a key, the strings ring, the line plays, and this
       * is what the visualiser does with it. Which is also why it needed no play button of its own.
       */}
      {HERO_SLOT.map((t) => (
        <div key={t.id} className="hero-seen">
          <div className="demo-art">
            <DemoArt t={t} />
          </div>
          <p className="muted hero-seen-line">{t.line}</p>
          <DemoFoot t={t} />
        </div>
      ))}
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

/**
 * The chips say what they were actually for.
 *
 * ⚠️ A ROW OF CHIPS IS A CLAIM WITH NO EVIDENCE. "React 19" in a rounded rectangle tells a
 * reader nothing they could not guess from the page being a website, and every portfolio on earth
 * has the same row. Pressing one now says where it is used HERE — which is checkable, because
 * the repository is public and they can go and look.
 *
 * ⚠️ Buttons, not spans. They do something, so they have to be reachable by a keyboard and
 * announce themselves as pressable; a clickable <span> is the single most common way a page
 * becomes unusable without a mouse.
 */
function SkillsCard() {
  const [open, setOpen] = useState<string | null>(null)
  const note = open ? SKILL_NOTES[open] : null
  return (
    <div className="card skills-card">
      <h2 className="section-title" style={{ marginBottom: '0.15rem' }}>
        Skills
      </h2>
      <p className="muted skills-lede">Press one to see what it actually did here.</p>
      <div className="skills-groups">
        {skills.map((s) => (
          <div key={s.group}>
            <div className="skills-group-name muted">{s.group}</div>
            <div className="skills-chips">
              {s.items.map((it) => (
                <button
                  key={it}
                  type="button"
                  className={'skill-chip' + (open === it ? ' is-on' : '')}
                  aria-pressed={open === it}
                  onClick={() => setOpen((cur) => (cur === it ? null : it))}
                >
                  {it}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* ⚠️ Keyed on the chip, so React replaces the paragraph rather than editing the old one
          in place — which is what lets it fade in, and makes the change legible instead of the
          text silently becoming different text. */}
      {note && (
        <p className="muted skill-note" key={open}>
          <strong>{open}</strong> — {note}
        </p>
      )}
    </div>
  )
}

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
 * What the nav calls each room.
 *
 * ⚠️ TAKEN FROM PLACES RATHER THAN WRITTEN OUT. Every demo used to carry its own `open`
 * phrase — "Open the studio", "Put a song on", "Play it properly" — which read nicely and named
 * nothing a visitor could then go and find. The tab along the top says Paint; the link under the
 * pad said "Open the studio"; connecting the two was left to the reader. Now the link IS the tab's
 * own word, so a demo and its room cannot drift apart and there is no second place to keep in step.
 */
const TAB_LABEL: Record<string, string> = Object.fromEntries(PLACES.map((p) => [p.id, p.label]))

function DemoArt({ t }: { t: Invite }) {
  return t.live === 'scribble' ? (
    <HomeScribble />
  ) : t.live === 'snake' ? (
    <HomeSnake />
  ) : t.live === 'keys' ? (
    <HomeSequencer />
  ) : t.live === 'viz' ? (
    <HomeViz />
  ) : t.live ? (
    <TileArt kind={t.live} />
  ) : null
}

/**
 * The door out of a demo, and the admission that it is one.
 *
 * ⚠️ THE TASTE MUST NOT BE MISTAKEN FOR THE MEAL. These work, which is the risk: somebody
 * plays the snake board for a minute, decides they have seen Snake, and never opens the room with
 * the scores and the other people in it. So every one says `preview` out loud, in the same place,
 * every time — the repetition is the feature, because a label you only notice sometimes is a
 * label nobody relies on.
 *
 * ⚠️ AND THE DOOR IS NAMED AFTER THE TAB. "Open 🎨 Paint" is the word on the nav strip and
 * the icon from the invitation, so pressing it lands somewhere the reader has already seen the
 * name of — and they can get back without this page.
 */
function DemoFoot({ t }: { t: Invite }) {
  const href = t.href ?? `#${t.id}`
  const go = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    /* the whole target, not just the room — the profile invitation carries ?demo=1 */
    window.location.hash = href.replace(/^#/, '')
  }
  return (
    <p className="demo-foot">
      <span className="demo-preview">preview</span>
      <a className="demo-go" href={href} onClick={go}>
        Open{' '}
        <span aria-hidden className="demo-go-ic">
          {t.icon}
        </span>
        {TAB_LABEL[t.id] ?? t.title} <span aria-hidden>→</span>
      </a>
    </p>
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
 * ⚠️ WIDTH COMES FROM THE DEMO, NOT ITS POSITION. It used to be a 2,1,1,2 cycle keyed on the
 * index, so what sat beside what was an accident of ordering — a big drawing pad next to a small
 * ring of circles, two different kinds of thing at two different sizes. That is most of what
 * "slapped together" was pointing at. Two columns now: the ones you can touch and the one showing
 * a whole page take a row to themselves, and the ambient ones pair off against each other at
 * equal width, which is the only pairing that ever looks deliberate.
 */
function Demos({ authed }: { authed: boolean }) {
  const items = TRY_THESE.filter((t) => (!t.members || authed) && !t.slot)
  const shown = new Set(items.map((t) => t.project).filter(Boolean))
  const leftovers = projects.filter((p) => p.id !== 'platform' && !shown.has(p.id))
  return (
    <section className="demos" id="projects-showcase" style={{ scrollMarginTop: 'var(--nav-h)' }}>
      <h2 className="section-title" style={{ marginBottom: '0.2rem' }}>
        What I have built
      </h2>
      {/* ⚠️ SAYS THESE ARE PREVIEWS, because that is the one thing a visitor can get wrong
          here. They work, which is the risk — somebody plays the snake board for a minute, decides
          they have seen Snake, and never opens the room with the scores and the other people in it.
          (This used to be evancook.dev's tagline, which said what the hero and About both already
          say: one app, everything live.) */}
      <p className="muted demos-lede">{DEMOS_LEAD}</p>

      {GROUPS.map((g) => {
        const run = items.filter((t) => t.group === g.id)
        if (!run.length) return null
        return (
          <div key={g.id} className="demo-run">
            <h3 className="demo-run-title">{g.title}</h3>
            <p className="muted demo-run-lead">{g.lead}</p>
            <div className="demos-grid">
              {run.map((t) => (
                <div key={t.id} className="demo">
                  {/**
                   * ⚠️ A DEMO IS A DIV, NOT A LINK. An <a> wrapping a drawing surface is
                   * broken twice over: every stroke ends in a navigation, and a control nested
                   * inside a link is not reachable on its own by a keyboard or screen reader.
                   */}
                  <div className="demo-art">
                    <DemoArt t={t} />
                  </div>
                  <p className="demo-title">
                    <span aria-hidden className="demo-ic">
                      {t.icon}
                    </span>
                    <strong>{t.title}</strong>
                  </p>
                  <p className="muted demo-line">{t.line}</p>
                  <DemoFoot t={t} />
                  {t.project && <ProjectNotes id={t.project} />}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/**
       * ⚠️ A PROJECT WITH NO DEMO STILL NEEDS SOMEWHERE TO LIVE, and it is not a dropdown.
       * Dollar-a-Day is real money in real accounts so there is no honest public demo, and signed
       * here, titled, rather than hidden behind a label saying "it".
       *
       * ⚠️ AND THE REASON GIVEN WAS WRONG. It said "you would need an account", which was only
       * ever true of the Circuit — and not even of that: signed out, the Circuit wires a
       * localStorage sandbox seeded from publicSeed and renders with `demo={!authed}`, so a visitor
       * gets real numbers to drag about that never leave their browser. The one project genuinely
       * left is Dollar-a-Day, and the reason is not accounts, it is that faking money is dishonest.
       */}
      {leftovers.length > 0 && (
        <div className="demo-run">
          <h3 className="demo-run-title">Also here</h3>
          <p className="muted demo-run-lead">Nothing to press — these are written up instead.</p>
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
