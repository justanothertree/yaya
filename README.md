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
- Snake game (`src/sections/SnakeGame.tsx`) with touch D‑pad, swipe, keyboard, fullscreen, and a local leaderboard
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

## License

MIT
````
