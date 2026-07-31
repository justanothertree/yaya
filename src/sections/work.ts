// Portfolio data for the unified "Evan Cook" page. Real projects, written from the
// actual codebase. Each shot is a slide in the project's click-through slideshow:
// it renders `src` (a real screenshot under /shots) when present, otherwise a themed
// poster tile generated from {label, accent} — so the slideshow looks intentional
// before real screenshots are dropped in. Add screenshots by setting `src` on a shot.

export interface Shot {
  /** Short label shown on the generated poster / as the slide caption. */
  label: string
  /** Optional real screenshot path, e.g. "/shots/circuit-board.png". */
  src?: string
  /** Optional longer caption under the slide. */
  caption?: string
}

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
  shots: Shot[]
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
    shots: [
      { label: 'Board', caption: 'Live standings, streaks, and quick-log.' },
      { label: 'Charts', caption: 'Cumulative race + per-category donuts.' },
      { label: 'Movies', caption: 'A sortable leaderboard of every rating.' },
      { label: 'Canvas', caption: 'Pop panels into draggable windows.' },
    ],
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
      'One codebase: Circuit, Snake, chat, investing, accounts',
      'Invite links to join, and per-person permissions on every row',
      'Lints, builds and deploys itself on every push',
    ],
    links: [
      { href: 'https://github.com/justanothertree/yaya', label: 'View the repo', external: true },
    ],
    shots: [
      { label: 'Portfolio', caption: 'The page you’re reading now.' },
      { label: 'Auth + RLS', caption: 'Members-only modules behind sign-in.' },
      { label: 'Themes', caption: 'Dark, light, and alt palettes.' },
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
    shots: [
      { label: 'Snake', caption: 'Canvas game with wrap-around edges.' },
      { label: 'Rooms', caption: 'Share a link, play together.' },
    ],
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
    shots: [
      { label: 'Allocations', caption: 'Split one trade across the family.' },
      { label: 'My slice', caption: 'Each member sees only their own.' },
    ],
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
