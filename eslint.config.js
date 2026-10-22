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
  globalIgnores(['dist', '.claude']),
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
