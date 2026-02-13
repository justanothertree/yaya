# Yaya Portfolio & Snake Game

[![Deploy](https://github.com/justanothertree/yaya/actions/workflows/deploy.yml/badge.svg)](https://github.com/justanothertree/yaya/actions/workflows/deploy.yml)
[![Build](https://github.com/justanothertree/yaya/actions/workflows/build.yml/badge.svg)](https://github.com/justanothertree/yaya/actions/workflows/build.yml)
[![Lint](https://github.com/justanothertree/yaya/actions/workflows/lint.yml/badge.svg)](https://github.com/justanothertree/yaya/actions/workflows/lint.yml)

## Summary

Yaya is a single-page personal site with sections for resume, projects, contact, and a browser-based Snake game. The Snake client runs entirely in the browser, supports keyboard and touch controls, and can optionally connect to a Supabase-backed leaderboard and a Node.js WebSocket server for multiplayer rounds.

## Project scope

- **Portfolio site** – Single-page layout with sections for home, projects, resume, Snake, and contact.
- **Snake game client** – Canvas-based Snake implementation with configurable settings and a score leaderboard.
- **Optional backend** – Minimal Node.js WebSocket relay for multiplayer rooms and optional Supabase-backed persistence for leaderboard scores (single-player and multiplayer).

## Tech stack

- **Frontend**
  - React + TypeScript single-page app (entry: src/main.tsx, shell: src/App.tsx)
  - Vite dev server and bundler (vite.config.ts)
  - CSS for layout and game visuals (src/index.css, src/game/game.css)
  - Formspree for contact form submissions (src/sections/ContactForm.tsx)

- **Backend (optional)**
  - Node.js WebSocket server using ws (server/ws-server.js, server/package.json)
  - Optional Supabase integration for online leaderboard and multiplayer round results (src/game/leaderboard.ts, docs/)

- **Tooling**
  - TypeScript project configuration (tsconfig\*.json)
  - ESLint for linting (eslint.config.js)
  - Husky-based git hooks and commit message linting for commit hygiene (package.json)
  - GitHub Actions for build, lint, and deploy (.github/workflows/\*.yml)

## Feature list

### Portfolio

- **Hash-based navigation** – Section routing driven by the URL hash, handled in src/App.tsx.
- **Keyboard shortcuts** – Number keys `1–5` jump between sections; left/right arrows move between sections when the game does not have focus.
- **Touch navigation** – Horizontal swipe gestures on touch devices to switch sections (implemented in src/App.tsx).
- **Projects grid** – Projects rendered from src/sections/projects.json via src/sections/Projects.tsx.
- **Resume section** – Editable resume content in src/sections/Resume.tsx.
- **Contact form** – Accessible contact form posting to Formspree in src/sections/ContactForm.tsx.

### Snake game

- **Canvas-based gameplay** – Snake engine and renderer implemented in src/game/engine.ts and src/game/renderer.ts, orchestrated by src/game/manager.tsx.
- **Controls** – Arrow keys or WASD to move, Space to pause/resume, and swipe gestures on the game canvas (see src/sections/SnakeGame.tsx and src/game/manager.tsx).
- **Configurable settings** – Configurable gameplay options via an in-game toolbar, with persistence in localStorage.
- **Leaderboard with fallback** – Score submission and retrieval via Supabase when configured, with a local browser leaderboard fallback using localStorage (src/game/leaderboard.ts).
- **Optional multiplayer** – Room-based multiplayer mode when a WebSocket server is configured; the client uses NetClient (src/game/net.ts) to talk to server/ws-server.js.

## Repository structure

```text
.
├─ src/
│  ├─ App.tsx               # SPA shell, navigation, theming, keyboard/swipe handling
│  ├─ main.tsx              # Frontend entry
│  ├─ index.css             # Global styles
│  ├─ game/                 # Snake engine, renderer, net client, leaderboard integration
│  ├─ sections/             # Resume, Projects, SnakeGame, ContactForm, and other sections
│  ├─ config/
│  │  └─ site.ts            # Site metadata (name, URLs, socials)
│  └─ dev/
│     └─ supabaseDebug.ts   # Supabase environment/status debug helpers (dev-only)
├─ server/
│  ├─ ws-server.js          # WebSocket relay for multiplayer Snake
│  ├─ index.js              # Alternate/simple WebSocket server
│  ├─ package.json          # Server-only dependencies and scripts
│  └─ README.md             # Server-specific API and deployment details
├─ docs/                    # Supabase schema and backend contract (reference only)
├─ public/                  # Static assets, CNAME, web manifest, sitemap, robots, etc.
├─ .github/workflows/       # Build, lint, and GitHub Pages deploy workflows
├─ vite.config.ts           # Vite configuration and build-time version injection
└─ package.json             # Root scripts, dependencies, and tooling configuration
```

## Local development

### Prerequisites

- Node.js 18+ and npm

### Frontend (portfolio + Snake client)

From the repository root:

```bash
npm install
npm run dev
```

The app runs on the Vite dev server (by default http://localhost:5173).

Build and preview:

```bash
npm run build
npm run preview
```

Lint and type-check:

```bash
npm run lint
npm run typecheck
```

### WebSocket server (optional multiplayer backend)

You can run the WebSocket server either via its own package.json or from the root.

Option 1 – inside the server folder:

```bash
cd server
npm install
npm start
```

Option 2 – from the repo root (uses server/ws-server.js):

```bash
npm run ws-server
```

By default, ws-server.js listens on a configurable port (PORT env var, default 8080). The frontend discovers the WebSocket URL from `VITE_WS_URL` when provided, or falls back to the current origin.

## Environment variables (minimal)

### Frontend

Set these in your frontend build environment (for example, `.env` at the project root):

- `VITE_SUPABASE_URL` – Optional. Supabase project URL; enables online leaderboard and related data when combined with the key below.
- `VITE_SUPABASE_ANON_KEY` – Optional. Supabase anon public key used from the browser.
- `VITE_WS_URL` – Optional. WebSocket endpoint for multiplayer, e.g. `ws://localhost:8080` in development or `wss://your-app.example.com` in production.

If Supabase variables are not set or calls fail, the game continues to work using a local browser leaderboard stored in localStorage.

### WebSocket server

Set these on the WebSocket server process (for example in your hosting provider):

- `PORT` – Optional. Port for the HTTP/WS server (default 8080).
- `SUPABASE_URL` – Optional. Supabase project URL used by the server to finalize multiplayer rounds.
- `SUPABASE_ANON_KEY` – Optional. Supabase key used by the server for the same purpose.

Additional Supabase-related environment variables (for table names and advanced tuning) are documented in docs/supabase-contract.md and are not required for a basic setup.

## Deployment overview

### Frontend

- The site is built with `npm run build`; output is written to `dist/`.
- GitHub Actions workflow `.github/workflows/deploy.yml` builds the site and deploys it to GitHub Pages on pushes to `main`.
- Environment secrets for Supabase and the WebSocket URL are wired into the build step in that workflow.
- A custom domain is configured via `public/CNAME`; ensure your GitHub Pages settings and DNS records match.
- You can also deploy the built `dist/` folder to any static hosting provider.

### WebSocket server

- The server in `server/ws-server.js` is a small Node.js process that can be deployed to any Node-capable host (for example Render, Railway, Fly.io, or similar).
- See `server/README.md` for the message format, configuration notes, and a sample Render configuration.
- After deploying the server, set `VITE_WS_URL` in your frontend environment to the `wss://` URL of your service.

## Development status

- **Portfolio and single-player Snake** – Stable and suitable as a personal site and game.
- **Supabase leaderboard and multiplayer backend** – Implemented and used in the codebase, but optional and dependent on external services; treat the Supabase schema and server configuration in docs/ and server/ as the source of truth when enabling these features.

Future changes are tracked via issues and pull requests rather than documented here.

## License

MIT – see LICENSE.

## Verification Notes (Contributor Reference)

- **Navigation and shortcuts** – Verified in src/App.tsx: hash-based routing, numeric (`1–5`) and arrow-key section navigation, plus touch swipe handling.
- **Sections** – Resume, Projects, Snake, and Contact sections are implemented in src/sections/Resume.tsx, src/sections/Projects.tsx, src/sections/SnakeGame.tsx, and src/sections/ContactForm.tsx.
- **Contact form** – Posts to a Formspree endpoint in src/sections/ContactForm.tsx; endpoint is easily replaceable.
- **Snake engine and settings** – Core gameplay and settings (grid size, apples count, edge behavior) are implemented in src/game/engine.ts and wired through src/game/manager.tsx.
- **Leaderboard behavior** – Supabase-backed leaderboard with a localStorage fallback is implemented in src/game/leaderboard.ts and configured via environment variables and browser storage.
- **Multiplayer** – Client networking is implemented in src/game/net.ts and src/game/manager.tsx, using a WebSocket URL derived from `VITE_WS_URL`; the corresponding server behavior and room management are implemented in server/ws-server.js.
- **Supabase contract** – Detailed schema, RPC, and trigger information exists only in docs/ (supabase-contract.md and related SQL files) and is intentionally referenced rather than duplicated in this README.
- **Omissions** – This README does not document internal RPC names, trigger names, or full table schemas, and does not claim features that appear only in comments or docs without clear runtime wiring.
