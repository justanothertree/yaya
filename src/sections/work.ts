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
    tagline: 'A group fitness + movie-night tracker for me and my friends.',
    period: '2026 — ongoing',
    status: 'live',
    tags: ['React', 'TypeScript', 'Supabase', 'Realtime', 'PWA'],
    accent: '#7c6af7',
    blurb: [
      'The Circuit started as a single HTML file my friends and I used to score daily workouts and rate the movies we watched together. I rebuilt it as a real module inside this site — same data, far more polish — backed by Supabase so everyone’s entries sync live across devices.',
      'It’s equal parts leaderboard, journal, and toy. A custom scoring engine turns reps, miles, and time into points; a free-canvas mode lets you pop every panel into draggable, resizable windows like a little desktop OS.',
    ],
    highlights: [
      'Live standings with streaks, per-day averages, and quick-log',
      'Activity feed with month / week / day / table calendar views',
      'Movie leaderboard with reviews, vibes, stats, and a watchlist',
      'Charts with hover tooltips that jump you straight to that day’s log',
      'Free-canvas window manager, 30-step undo/redo, drag-to-scrub inputs',
      'Realtime sync over Supabase with row-level security per member',
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
    tagline: 'This site — a personal platform that doubles as my portfolio.',
    period: '2025 — ongoing',
    status: 'live',
    tags: ['React 19', 'Vite', 'TypeScript', 'Supabase', 'GitHub Actions'],
    accent: '#22c55e',
    blurb: [
      'Rather than a static résumé, my site is one app where each project is a live module on a shared Supabase backend with real auth and row-level security. The public face is a portfolio; signed-in members get the tools.',
      'It’s a single-page React app with hash routing, keyboard and swipe navigation, three themes, scroll-reveal animations, and a CI/CD pipeline that lints, builds, and ships to GitHub Pages on every push.',
    ],
    highlights: [
      'One codebase, many modules: Circuit, Snake, finance, account system',
      'Supabase auth + RLS; invite-link onboarding for friends and family',
      'Three themes, full keyboard/swipe nav, accessible and responsive',
      'Conventional-commit CI with lint + build gates, Pages deploy',
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
    tagline: 'The classic, rebuilt on canvas — now with online rooms.',
    period: '2025',
    status: 'live',
    tags: ['Canvas', 'WebSockets', 'React', 'TypeScript'],
    accent: '#2ec4b6',
    blurb: [
      'A from-scratch Snake on an HTML canvas with crisp devicePixelRatio scaling, wrap-around edges, swipe gestures, and an on-screen D-pad for touch. A lightweight WebSocket relay adds shareable multiplayer rooms.',
    ],
    highlights: [
      'Canvas rendering tuned for sharpness on every display',
      'Keyboard, swipe, and D-pad controls',
      'Shareable online rooms via a WebSocket relay',
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
    tagline: 'A family portfolio that splits my trades into everyone’s share.',
    period: '2026 — building',
    status: 'building',
    tags: ['Supabase', 'Postgres', 'RLS', 'React'],
    accent: '#f5c060',
    blurb: [
      'A private, family-only module where I log trades — ticker, shares, date, price — and allocate them evenly or by custom split across the family. Each person signs in to see only their own slice of the portfolio, updated against live prices.',
      'It’s the most security-sensitive part of the platform, so every row is locked down with strict per-user policies and nothing sensitive ever touches the public surface.',
    ],
    highlights: [
      'Trade entry with even, share-based, or percentage allocation',
      'Per-member portfolios behind strict row-level security',
      'Recurring orders and live price updates (in progress)',
    ],
    links: [],
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
