import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  /**
   * ⚠️ `.claude` IS IGNORED FOR THE REASON vite.config.ts IGNORES IT, and this config had not
   * caught up. The desktop app puts a background task's checkout in `.claude/worktrees/<name>/`,
   * which is gitignored but very much still on disk — and `npm run lint` is `eslint .` from the
   * project root.
   *
   * Measured on 22 Oct with six worktrees open: `npm run lint` reported **86 problems** and
   * `npx eslint src` reported **13**. Seventy-three of them belonged to other checkouts, so the
   * figure quoted on every commit message for weeks was about seven copies of the repository
   * rather than about this one.
   *
   * That is the smaller half. The larger one is that a lint ERROR in somebody else's half-finished
   * worktree fails the gate HERE, about a file this checkout does not contain — which is exactly
   * what vitest was doing before `test.exclude` was added, and the note there says so at length.
   * Two tools, one blind spot, and only one of them had been told.
   */
  globalIgnores(['dist', '.claude', '**/node_modules']),

  /**
   * ⚠️ THE ONLY BLOCK HERE MATCHED `.ts` AND `.tsx`, SO EVERY `.js` AND `.mjs` IN THE REPOSITORY
   * WAS LINTED BY NOTHING AT ALL — and `npm run lint` passed, because a file that matches no
   * config block has no rules to break.
   *
   * Measured on 28 Oct: `npx eslint server scripts` printed **nothing** and exited 0, and it went
   * on printing nothing after `undefinedFunctionCall()` and an unused const were appended to
   * `server/ws-server.js`. That file is the relay the park's realtime runs on — production code
   * reachable by anybody with the URL — and `scripts/mobile-audit.js` is what this project's
   * entire viewport doctrine is measured with. Neither had ever been checked.
   *
   * It is the same shape as the `.claude` note above and as vitest's `exclude`: a tool quietly
   * answering about a smaller set than the one you asked it about. There the set was too big;
   * here it was too small, which is the direction nothing ever contradicts.
   *
   * ⚠️ `globals.node`, NOT `globals.browser`. The browser set has no `process`, `Buffer` or
   * `setImmediate`, so pointing the existing block at these files would have invented a dozen
   * no-undef errors in working code — which is how a lint rule gets switched off instead of fixed.
   */
  {
    files: ['server/**/*.{js,mjs}', 'scripts/**/*.mjs', '*.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  /**
   * ⚠️ `scripts/mobile-audit.js` RUNS IN THE BROWSER, not in node — it is pasted into the Browser
   * pane (or imported from the dev server) and talks to `document`, `getComputedStyle` and
   * `matchMedia`. Node globals would be wrong for it in both directions: it would lose `document`
   * and gain a `process` it must never touch.
   */
  {
    files: ['scripts/mobile-audit.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
