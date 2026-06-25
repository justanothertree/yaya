# evancook.dev

[![Deploy](https://github.com/justanothertree/yaya/actions/workflows/deploy.yml/badge.svg)](https://github.com/justanothertree/yaya/actions/workflows/deploy.yml)
[![Build](https://github.com/justanothertree/yaya/actions/workflows/build.yml/badge.svg)](https://github.com/justanothertree/yaya/actions/workflows/build.yml)
[![Lint](https://github.com/justanothertree/yaya/actions/workflows/lint.yml/badge.svg)](https://github.com/justanothertree/yaya/actions/workflows/lint.yml)

> A personal web platform where every section is a live, working product — not a screenshot. Built in collaboration with AI assistants (GitHub Copilot, ChatGPT, Gemini, and Claude).

Live at **[evancook.dev](https://evancook.dev)**.

## What this is

A single React + TypeScript app that doubles as a portfolio and a real, multi-module
platform. Instead of describing past work, each nav section is something you can actually use:

- **Home** — portfolio / about, optionally "exploded" into a draggable canvas of windows.
- **The Circuit** — a fitness + movies tracker for me and my friends: daily workout logging,
  a standings board, charts, a social feed with kudos and comments, and a shared movie list.
  Data syncs in real time across devices, is **owned per user**, and is scoped to private
  "circuits" (groups). Signed-out visitors get a live public demo board plus a sandbox to play in.
- **Snake** — a canvas Snake game with single-player, an online leaderboard, and room-based
  multiplayer over WebSockets.
- **Investments** — a private, family-only finance module, feature-flagged per account.
- **Accounts** — invite-based signup, member profiles, and an admin console, all enforced by
  Supabase Auth + row-level security.

It's an evolving prototype. Two goals guide it: a codebase clean enough to be read as part of
the showcase, and a UI that explains itself to non-technical friends and family.

## Tech stack

- **Frontend:** React 19 + TypeScript, Vite 7, hash-routed SPA, three themes + global zoom,
  CSS design tokens.
- **Backend:** Supabase — Postgres, Auth, row-level security, and realtime — reached through a
  thin typed client, with security-definer RPCs for privileged actions.
- **State & sync:** a small external store (`useSyncExternalStore`) behind an adapter interface —
  localStorage when signed out, Supabase + realtime when signed in — with 30-step undo/redo.
- **Multiplayer Snake:** a minimal Node.js `ws` relay (`server/`).
- **Hosting:** GitHub Pages (custom domain) via GitHub Actions; the WebSocket server runs on any
  Node host.
- **Tooling:** ESLint, Husky + commitlint (Conventional Commits), GitHub Actions for build / lint / deploy.

## Architecture highlights

- **Module per section** — each feature in `src/sections/` is self-contained; heavy modules are
  lazy-loaded.
- **One UI, two backends** — `src/circuit/` swaps a localStorage adapter for a Supabase + realtime
  adapter behind a single interface, so the interface is identical signed in or out.
- **Ownership enforced in the database** — Circuit rows carry an owner and group; who can see and
  edit what is enforced by RLS, not the client.
- **Resilient public board** — signed out, the board renders instantly from a bundled snapshot,
  then refreshes from a live anon RPC and self-heals stale caches.

## Repository structure

```text
src/
  App.tsx            # SPA shell: nav, hash routing, theming, zoom, canvas toggle
  main.tsx           # entry point
  index.css          # global styles + design tokens
  sections/          # one module per nav section (EvanCook, Circuit, SnakeGame,
                     #   Investments, SignIn, AccountSettings, AdminPanel, AcceptInvite, ContactForm)
  circuit/           # The Circuit: store, adapters, scoring, social, seeds, and ui/
  finance/           # Supabase client, auth, typed queries/RPCs for the finance module
  game/              # Snake engine, renderer, net client, leaderboard
  config/site.ts     # site metadata
server/              # Node.js WebSocket relay for multiplayer Snake
docs/                # Supabase schema / RPC / trigger reference
public/              # static assets, CNAME, web manifest, sitemap
.github/workflows/   # build, lint, and GitHub Pages deploy
```

## Local development

Prerequisites: Node 18+ and npm.

```bash
npm install
npm run dev        # Vite dev server (http://localhost:5173)
npm run build      # type-check + production build to dist/
npm run preview    # preview the production build
npm run lint       # ESLint
npm run typecheck  # tsc, no emit
```

The app runs fully **without** a backend: signed out, the Circuit uses a local sandbox and Snake
uses a local leaderboard. Configure Supabase to enable accounts, cloud sync, and online scores.

## Environment variables

Frontend (e.g. `.env.local`, never committed):

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — enable Supabase auth, sync, and the online
  leaderboard. The anon key is safe in the browser; all access is gated by RLS.
- `VITE_WS_URL` — WebSocket endpoint for multiplayer Snake (falls back to local play).

Without Supabase configured, the app degrades gracefully to local-only behavior.

WebSocket server (`server/`): `PORT`, plus optional `SUPABASE_URL` / `SUPABASE_ANON_KEY` to
finalize multiplayer rounds. See [`server/README.md`](server/README.md).

## Deployment

- `.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `main`; the
  custom domain is set in `public/CNAME`.
- Deploy the `server/` WebSocket relay to any Node host (Render, Railway, Fly.io) and point
  `VITE_WS_URL` at its `wss://` URL.

## Built with AI

This site is, in part, a showcase of building software in collaboration with AI assistants —
GitHub Copilot, ChatGPT, Gemini, and Claude. The code is kept clean and reviewable precisely
because it is meant to be read.

## License

MIT — see [LICENSE](LICENSE).
