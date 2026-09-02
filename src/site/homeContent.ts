import { projects as builtInProjects, type Project } from '../sections/work'

/**
 * What the home page says, as data rather than as markup.
 *
 * ⚠️ THE DEFAULTS ARE THE CURRENT PAGE, WORD FOR WORD. Nothing here changes what a visitor sees
 * until somebody edits it: an empty document renders exactly the page that was hard-coded before.
 * That matters because this loads over the network — a slow, blocked or failed fetch has to leave
 * a complete home page behind, not a set of empty headings.
 *
 * ⚠️ Projects are an ORDER, a HIDDEN list and a set of OVERRIDES, not copies of the projects
 * themselves. Copying them into the document would freeze whatever work.ts said on the day it was
 * first saved: add a project in the repo later and it would never appear, because the stored copy
 * of the list has no idea it exists. Storing only the differences means the code stays the source
 * of what a project IS, and the document only says what has been changed about it.
 */

export type HomeText = {
  heading: string
  blurb: string
}

export type ProjectEdit = {
  title?: string
  tagline?: string
  /** one entry per paragraph, same as Project.blurb */
  blurb?: string[]
  /** a real screenshot per slide, keyed by the slide's position */
  shots?: Array<{ src?: string; caption?: string }>
}

export type HomeDoc = {
  v: 1
  hero: HomeText
  about: { heading: string; paragraphs: string[] }
  projects: {
    /** project ids, in the order they should appear. Anything missing keeps its built-in place. */
    order: string[]
    /** project ids not to show at all */
    hidden: string[]
    edits: Record<string, ProjectEdit>
  }
}

/** The page as it reads today, so an unedited site is byte-for-byte the page that was here. */
export const DEFAULT_HOME: HomeDoc = {
  v: 1,
  hero: {
    heading: 'I build tools for the people around me.',
    blurb:
      'A workout tracker my friends use every day. An investing tracker for my family. Games I wanted to exist. It all runs here, and I build it with AI.',
  },
  about: {
    heading: 'About',
    paragraphs: [
      'The Circuit started as a spreadsheet my friends and I used to score our workouts. Then a single HTML file. Now it’s the biggest thing on this site and they still use it daily.',
      'That’s how all of it goes — something small that a few people actually want, rebuilt properly. I work with AI the whole way through, so this site is also a record of what building that way is like. Still prototyping. Always adding.',
    ],
  },
  projects: { order: [], hidden: [], edits: {} },
}

const MAX_HEADING = 200
const MAX_BLURB = 2000
const MAX_PARAGRAPHS = 8
/** Matches the cap the server enforces, so the editor can warn before a save can fail. */
export const HOME_DOC_LIMIT = 40000

const str = (v: unknown, max: number, fallback: string) =>
  typeof v === 'string' && v.trim() ? v.slice(0, max) : fallback

const strList = (v: unknown, max: number, fallback: string[]) =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string')
        .slice(0, MAX_PARAGRAPHS)
        .map((x) => x.slice(0, max))
    : fallback

const idList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && /^[a-z0-9_-]{1,40}$/i.test(x))
        .slice(0, 40)
    : []

/**
 * Read a document from anywhere — the server, a draft in this browser — and never throw.
 *
 * ⚠️ Everything is clamped and everything falls back, because this text is rendered on the public
 * front page. The write path is admin-only, but a reader that trusts its input is one compromised
 * write away from being the thing that publishes it.
 */
export function readHomeDoc(v: unknown): HomeDoc {
  if (!v || typeof v !== 'object') return DEFAULT_HOME
  const o = v as Record<string, unknown>
  const hero = (o.hero ?? {}) as Record<string, unknown>
  const about = (o.about ?? {}) as Record<string, unknown>
  const projects = (o.projects ?? {}) as Record<string, unknown>
  const rawEdits = (projects.edits ?? {}) as Record<string, unknown>

  const edits: Record<string, ProjectEdit> = {}
  for (const [id, raw] of Object.entries(rawEdits).slice(0, 40)) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(id) || !raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    const shots = Array.isArray(e.shots)
      ? e.shots.slice(0, 12).map((s) => {
          const shot = (s ?? {}) as Record<string, unknown>
          return {
            /* ⚠️ a PATH on this site, not an arbitrary url — see safeShotSrc */
            src: safeShotSrc(shot.src),
            caption: typeof shot.caption === 'string' ? shot.caption.slice(0, 200) : undefined,
          }
        })
      : undefined
    edits[id] = {
      title: typeof e.title === 'string' ? e.title.slice(0, MAX_HEADING) : undefined,
      tagline: typeof e.tagline === 'string' ? e.tagline.slice(0, MAX_HEADING) : undefined,
      blurb: Array.isArray(e.blurb) ? strList(e.blurb, MAX_BLURB, []) : undefined,
      shots,
    }
  }

  return {
    v: 1,
    hero: {
      heading: str(hero.heading, MAX_HEADING, DEFAULT_HOME.hero.heading),
      blurb: str(hero.blurb, MAX_BLURB, DEFAULT_HOME.hero.blurb),
    },
    about: {
      heading: str(about.heading, MAX_HEADING, DEFAULT_HOME.about.heading),
      paragraphs: strList(about.paragraphs, MAX_BLURB, DEFAULT_HOME.about.paragraphs),
    },
    projects: {
      order: idList(projects.order),
      hidden: idList(projects.hidden),
      edits,
    },
  }
}

/**
 * Where a slide's picture may come from.
 *
 * ⚠️ SAME-SITE PATHS ONLY. This value ends up in an <img src>, and the page it renders on is the
 * public front door. Allowing a full url would let whatever wrote it point the front page at
 * another server — which leaks every visitor's IP and referrer to it, and hands a third party
 * control of what a visitor believes is my work. A leading-slash path can only ever address this
 * site. `//host` is rejected for the same reason: it is a url wearing a path's clothes.
 */
export function safeShotSrc(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  if (!s.startsWith('/') || s.startsWith('//')) return undefined
  if (s.includes('..')) return undefined
  return s.slice(0, 300)
}

/** The projects to render, with the document's order, hiding and text applied. */
export function projectsFor(doc: HomeDoc): Project[] {
  const hidden = new Set(doc.projects.hidden)
  const rank = new Map(doc.projects.order.map((id, i) => [id, i]))
  return builtInProjects
    .filter((p) => !hidden.has(p.id))
    .map((p) => {
      const e = doc.projects.edits[p.id]
      if (!e) return p
      return {
        ...p,
        title: e.title ?? p.title,
        tagline: e.tagline ?? p.tagline,
        blurb: e.blurb?.length ? e.blurb : p.blurb,
        /* a shot's picture and caption can be set; its label stays with the code that made it */
        shots: p.shots.map((s, i) => ({
          ...s,
          src: e.shots?.[i]?.src ?? s.src,
          caption: e.shots?.[i]?.caption ?? s.caption,
        })),
      }
    })
    .sort((a, b) => {
      /* ⚠️ anything the document does not mention keeps its built-in position, at the end rather
         than at the front — a project added in the repo should appear, not push everything down */
      const ra = rank.has(a.id) ? (rank.get(a.id) as number) : Number.MAX_SAFE_INTEGER
      const rb = rank.has(b.id) ? (rank.get(b.id) as number) : Number.MAX_SAFE_INTEGER
      return ra - rb
    })
}
