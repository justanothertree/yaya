// Portfolio data for the unified "Evan Cook" page. Real projects, written from the
// actual codebase.
//
// ⚠️ NO SCREENSHOT FIELD, deliberately. There used to be one, with a generated gradient
// "poster" standing in until a real image was supplied — and no real image ever was, so every
// card shipped a coloured rectangle with a word on it. A placeholder that never gets replaced is
// not a placeholder, it is the design. If real captures are ever taken, add the field back and
// render them; until then the live demos further up the page are the pictures.
export interface Project {
  id: string
  title: string
  tagline: string
  period?: string
  status: 'live' | 'building' | 'planned'
  tags: string[]
  /** Informational write-up, one entry per paragraph. */
  blurb: string[]
  highlights: string[]
  links: { href: string; label: string; external?: boolean; primary?: boolean }[]
  accent: string
}

export const projects: Project[] = [
  {
    id: 'circuit',
    title: 'The Circuit',
    tagline: 'A workout and movie-night tracker my friends use every day.',
    period: '2026 — ongoing',
    status: 'live',
    tags: ['React', 'TypeScript', 'Supabase', 'Realtime', 'PWA'],
    accent: '#7c6af7',
    blurb: [
      'Reps, miles and minutes turn into points, so a run and a set of pushups can sit on the same leaderboard. We rate the movies we watch together in the same place. Everyone owns their own board and it syncs across our phones as we log.',
    ],
    highlights: [
      'Standings, streaks and one-tap logging',
      'Reviews and a voting pool for picking movie night',
      'Pop any panel into a draggable window, like a small desktop',
    ],
    links: [{ href: '#circuit', label: 'Open the app', primary: true }],
  },
  {
    id: 'platform',
    title: 'evancook.dev',
    tagline: 'This site — one app, and every project inside it is live.',
    period: '2025 — ongoing',
    status: 'live',
    tags: ['React 19', 'Vite', 'TypeScript', 'Supabase', 'GitHub Actions'],
    accent: '#22c55e',
    blurb: [
      'Nothing here is a screenshot of something that ran once. It’s one React and Supabase app with real accounts, so the outside is a portfolio and the inside is the set of tools my friends and family actually sign in to use.',
    ],
    highlights: [
      'One codebase: the board, reviews, Snake, calls, a synth, a paint studio, a visualiser, profiles',
      'Built to be used together — draw, play and watch the same thing at the same time',
      'Invite links to join, and per-person permissions on every row',
      'Lints, builds and deploys itself on every push',
    ],
    links: [
      { href: 'https://github.com/justanothertree/yaya', label: 'View the repo', external: true },
    ],
  },
  {
    id: 'snake',
    title: 'Multiplayer Snake',
    tagline: 'The classic, rebuilt from scratch — then made multiplayer.',
    period: '2025',
    status: 'live',
    tags: ['Canvas', 'WebSockets', 'React', 'TypeScript'],
    accent: '#2ec4b6',
    blurb: [
      'My first project here, picked because it was small enough to actually finish. Then I added multiplayer rooms anyway. Built from scratch on a canvas — keyboard, swipe, or an on-screen D-pad.',
    ],
    highlights: [
      'Keyboard, swipe and D-pad controls',
      'Share a link and play together',
      'A leaderboard anyone can post to, no account needed',
    ],
    links: [{ href: '#snake', label: 'Play now', primary: true }],
  },
  {
    id: 'finance',
    title: 'Dollar-a-Day',
    tagline: 'A dollar a day, invested for everyone in my family.',
    period: '2026 — ongoing',
    status: 'building',
    tags: ['Supabase', 'Postgres', 'RLS', 'React'],
    accent: '#f5c060',
    blurb: [
      'I put a dollar a day aside for each person in my family. Real buying is lumpy — markets close, and I buy when it makes sense — so one purchase gets split across every account. Each person signs in and sees their own share, and whether it’s ahead of or behind the dollar a day they were promised.',
    ],
    highlights: [
      'One purchase splits across every account',
      'Everyone sees only their own share',
      'Tracks how far ahead or behind schedule each account is',
    ],
    links: [{ href: '#investments', label: 'Try the demo', primary: true }],
  },
]

export const skills: { group: string; items: string[] }[] = [
  { group: 'Frontend', items: ['React 19', 'TypeScript', 'Vite', 'HTML/CSS', 'Canvas', 'PWA'] },
  {
    group: 'Backend & Data',
    items: ['Supabase', 'PostgreSQL', 'Auth & RLS', 'Realtime', 'WebSockets'],
  },
  { group: 'Tooling', items: ['Git', 'GitHub Actions', 'ESLint', 'Prettier', 'CI/CD'] },
]
