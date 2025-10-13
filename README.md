# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
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

- Resume (`src/sections/Resume.tsx`)
- Snake game (`src/sections/SnakeGame.tsx`)
- Contact form (`src/sections/ContactForm.tsx`) — replace the Formspree endpoint with your own ID
- Sticky top navigation with hash-based deep links (supports back/forward)

## Run locally (Windows PowerShell)

```powershell
npm ci
npm run dev
```

Open the printed Local URL. For a production-like server:

```powershell
npm run build
npm run preview
```

## Lint

```powershell
npm run lint
```

## Deploy to GitHub Pages

1. Push this repo to GitHub with default branch `main`.
2. In GitHub: Settings → Pages → Source = GitHub Actions.
3. The workflow `.github/workflows/deploy.yml` builds and deploys `dist/` on push to `main`.
4. Project URL (Pages): https://justanothertree.github.io/yaya/
5. Base path is set to `/yaya/` in `vite.config.ts` (overridable via `VITE_BASE`).

## Customize

- Change the brand text in the top nav inside `src/App.tsx`.
- Edit resume content in `src/sections/Resume.tsx`.
- Tweak styling in `src/index.css`.

## Repository hygiene

- MIT License included (`LICENSE`).
- EditorConfig for consistent formatting (`.editorconfig`).
- CI: Lint workflow (`.github/workflows/lint.yml`).
```
