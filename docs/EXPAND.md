# Expand this portfolio

Use this checklist to customize and grow your site.

## Branding and content
- Update brand text in `src/App.tsx` (top-left brand link).
- Edit Resume content in `src/sections/Resume.tsx`.
- Update footer links in `src/App.tsx`.

## Projects
- Edit `src/sections/projects.json` to add or remove items.
  - Fields: `title`, `desc`, `link`, `linkText`.
  - External links should start with `http` and will open in a new tab.
  - Internal links can use hashes like `#snake`, `#projects`.

## Contact form
- Using Formspree: `src/sections/ContactForm.tsx`.
  - Replace `https://formspree.io/f/xeorpelp` with your own ID if needed.
  - Add any additional fields you want; Formspree will capture them.

## Styling
- Global styles in `src/index.css`.
- Add utility classes or tweak variables at the top (`:root`).

## Navigation & sections
- The nav is hash-based. Valid sections: `home`, `projects`, `resume`, `snake`, `contact`.
- To add a new section:
  1) Create a component in `src/sections/`.
  2) Import it in `src/App.tsx` and extend the `Section` type.
  3) Add a nav link and render condition.

## Deployment
- GitHub Pages project URL: https://justanothertree.github.io/yaya/
- Vite base is set to `/yaya/` in `vite.config.ts`.
- When moving to a custom domain (e.g., `evancook.dev`):
  - Keep `public/CNAME` with `evancook.dev`.
  - Change `base` in `vite.config.ts` to `'/'` and remove `VITE_BASE` override in CI.

## CI and quality
- Lint on PRs: `.github/workflows/lint.yml`.
- Build on PRs: `.github/workflows/build.yml`.
- Add tests if needed; recommend `vitest` for unit tests.

## Ideas to add later
- Analytics (e.g., Plausible, umami) via a small script in `index.html`.
- Blog posts (static markdown rendered via a simple loader).
- Dark mode toggle (expand CSS variables and a stateful toggle).
- Project tags/filters in Projects section.