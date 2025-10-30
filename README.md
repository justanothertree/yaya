# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

````js
## Portfolio Features (added)

This project has been customized into a personal portfolio with:

- Resume section (`src/sections/Resume.tsx`)
- Snake game (`src/sections/SnakeGame.tsx`)
- Contact form (`src/sections/ContactForm.tsx`) — replace the Formspree endpoint with your own ID

### Run locally (Windows PowerShell)

# Portfolio: React + TypeScript + Vite

[![Deploy](https://github.com/justanothertree/yaya/actions/workflows/deploy.yml/badge.svg)](https://github.com/justanothertree/yaya/actions/workflows/deploy.yml)
[![Lint](https://github.com/justanothertree/yaya/actions/workflows/lint.yml/badge.svg)](https://github.com/justanothertree/yaya/actions/workflows/lint.yml)

A minimal personal site with a Resume section, a playable Snake game, and a simple Contact form.

## Features

# Portfolio: React + TypeScript + Vite

[![Deploy](https://github.com/justanothertree/yaya/actions/workflows/deploy.yml/badge.svg)](https://github.com/justanothertree/yaya/actions/workflows/deploy.yml)
[![Lint](https://github.com/justanothertree/yaya/actions/workflows/lint.yml/badge.svg)](https://github.com/justanothertree/yaya/actions/workflows/lint.yml)

A minimal personal site with a Resume section, a playable Snake game, and a Contact form.

## Features

- Hash-based navigation with keyboard shortcuts (1–5) and swipe
- Resume (`src/sections/Resume.tsx`)
- Projects (`src/sections/Projects.tsx` with `projects.json`)
- Snake game (`src/sections/SnakeGame.tsx`) with keyboard and swipe controls, pause/resume, and online/local leaderboard
- Contact form (`src/sections/ContactForm.tsx`) wired to Formspree
- Accessible: skip links, live region announcements, reduced‑motion support

## Run locally (Windows PowerShell)

```powershell
npm ci
npm run dev
```

Production preview:

```powershell
npm run build
npm run preview
```

Lint and typecheck:

```powershell
npm run lint
npm run typecheck
```

## Deploy

- CI deploys to GitHub Pages on push to `main` via `.github/workflows/deploy.yml`.
- Custom domain is configured with `public/CNAME` and `vite.config.ts` has `base: '/'`.
- If deploying to a project page (e.g., `/yaya/`), set `base: '/yaya/'` and adjust links.

## Customize

- Brand text: `src/App.tsx`
- Resume content: `src/sections/Resume.tsx`
- Projects list: `src/sections/projects.json`
- Contact endpoint: `src/sections/ContactForm.tsx` (Formspree ID)
- Styling and themes: `src/index.css`

## Notes

- Open Graph image lives in `public/` and is referenced from `index.html`.
- The footer can show a build label; it’s injected via `VITE_APP_VERSION` from the CI SHA or `package.json` version.

### Snake leaderboard (Supabase)

The Snake game can use a hosted leaderboard via Supabase REST. Configure these environment variables (e.g., in a `.env` file at the project root):

- `VITE_SUPABASE_URL` — your Supabase project URL (https://xxxxx.supabase.co)
- `VITE_SUPABASE_ANON_KEY` — your Supabase anon public API key
- `VITE_LEADERBOARD_TABLE` — optional, defaults to `scores`
- `VITE_LEADERBOARD_NAME_COLUMN` — optional, defaults to `username` (set to `player_name` if your column is named that)

Recommended table schema (SQL):

```sql
create table if not exists public.scores (
	id uuid primary key default gen_random_uuid(),
	username text not null,
	score int not null check (score >= 0),
	created_at timestamptz not null default now()
);

alter table public.scores enable row level security;

-- Allow public read (top scores)
create policy "Public read leaderboard" on public.scores
	for select using (true);

-- Allow anonymous inserts (optional for public write)
create policy "Public submit score" on public.scores
	for insert with check (true);
```

The app writes with the anon key via the Supabase REST endpoint and reads the top 15 scores ordered by `score desc, created_at asc`. If the env vars aren’t set or the request fails, it falls back to a local (browser) leaderboard.

Realtime updates and best-by-name:

- Enable Realtime for the `scores` table (Database → Replication → Supabase Realtime → Add table).
- Allow `update` in RLS if you want client-side “replace best score by name”. Example (public update):

```sql
create policy "Public update leaderboard" on public.scores
	for update using (true) with check (true);
```

Optional: enforce best-by-name on the server (recommended) by adding a unique index and using an upsert RPC or a trigger to keep the greater score:

```sql
create unique index if not exists scores_player_name_unique on public.scores (player_name);
-- or write a trigger to set score = greatest(NEW.score, OLD.score) on conflict.
```

## License

MIT
````
