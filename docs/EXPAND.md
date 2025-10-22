# Expand Guide

Use this checklist to grow the portfolio safely. Each item links to the exact file to edit.

## Content updates

- [ ] Brand text in nav: `src/App.tsx` (the brand link text)
- [ ] Resume content: `src/sections/Resume.tsx`
- [ ] Projects list: `src/sections/projects.json`
- [ ] Contact endpoint: `src/sections/ContactForm.tsx` (Formspree ID)

## Styling

- [ ] Global theme: `src/index.css` (colors, spacing, components)
- [ ] Section layout: `.grid-*` utilities in `src/index.css`

## Pages deployment

- Live URL (custom domain): https://evancook.dev/
- Base path: set to `'/'` in `vite.config.ts` for root-domain deploys (custom domain)
- Alternative: for project pages (e.g., `https://<user>.github.io/yaya/`), set `base: '/yaya/'` and remove `public/CNAME`
- CI: `.github/workflows/deploy.yml` (deploys on push to main)

## Custom domain (optional)

Currently prepared for `evancook.dev` with `public/CNAME`.

Steps:

1. DNS: point evancook.dev to GitHub Pages (CNAME to `<user>.github.io` or set A/ALIAS records). See GitHub Pages docs.
2. GitHub repo → Settings → Pages → Custom domain = `evancook.dev`.
3. Ensure `vite.config.ts` has `base: '/'` for root-domain deploys.

## Developer workflow

1. Local dev
   - `npm run dev` for hot reload.
   - `npm run lint` for static checks.
   - `npm run build && npm run preview` to test production bundle.

2. Commit & push
   - Push to `main` to auto-deploy.
   - Open PRs for larger changes; CI runs lint and build.

## Ideas to add next

- [ ] Analytics (privacy-friendly, e.g., Plausible/Umami)
- [ ] Accessibility pass (aria labels/roles, focus styles)
- [ ] Dark/light toggle (persisted in localStorage)
- [ ] Project detail pages (routes with hash or a router)
- [ ] Blog section (markdown -> simple renderer)
- [ ] Unit tests for components (Vitest + Testing Library)
