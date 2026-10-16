/* ⚠️ `vitest/config` rather than `vite`, which is the same defineConfig with the `test` key
   typed — see the note on `test.exclude` below. Everything else here is Vite's. */
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Custom domain deploy uses root path
  base: '/',
  test: {
    /**
     * ⚠️ WORKTREES LIVE INSIDE THE REPO, AND VITEST WAS RUNNING ALL OF THEM. The desktop app
     * puts a background task's checkout in `.claude/worktrees/<name>/`, which is gitignored but
     * very much still on disk — and vitest's default `include` is `**` from the project root. On
     * 16 Oct, with six background tasks open, `npm run test` reported **316 test files and 7,433
     * tests** against a suite of 45 files and 1,060: seven copies of the same thing, one per
     * worktree plus this checkout.
     *
     * That is not only seven times the wait. It means a run here passes or fails on code being
     * written in another session — a half-finished edit in somebody else's worktree becomes a
     * red suite in this one, about a file this checkout does not contain.
     *
     * The defaults are kept and `.claude` added, rather than replaced: the default list is what
     * excludes node_modules and dist, and restating it by hand is how it drifts.
     */
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(
      process.env.GITHUB_SHA?.slice(0, 7) || process.env.npm_package_version || '',
    ),
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Vendor code in its own files, so YOUR changes do not expire THEIR cache.
         *
         * Measured from the entry chunk's sourcemap rather than guessed: React was 551kB of
         * source in there and the Supabase SDK 813kB — together about two thirds of a 656kB
         * entry, and more Supabase than React. None of it changes when the site changes, but it
         * lived in the same file as the site, so every deploy handed returning visitors the whole
         * lot again to pick up a CSS tweak.
         *
         * ⚠️ THIS DOES NOT MAKE THE FIRST VISIT SMALLER, and it is not meant to. The same bytes
         * arrive, in parallel rather than in one file. What changes is every visit after a
         * deploy: the vendor files are still cached, so only the app chunk is fetched again.
         * Making the first visit smaller is a different job — deferring the Supabase SDK past
         * first paint — and that trades a real risk of a signed-out flash for bytes a signed-in
         * visitor needs immediately anyway.
         *
         * ⚠️ Split by package, not per module: one chunk per node_modules entry would turn a
         * handful of files into dozens of requests, and the Supabase packages are always wanted
         * together in any case.
         */
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return
          /* ⚠️ matched WITH the surrounding slashes: a bare 'react' also matches react-dom,
             react-refresh and several more, so the slashes are the whole test */
          for (const pkg of ['react', 'react-dom', 'scheduler']) {
            if (id.includes(`/node_modules/${pkg}/`)) return 'react'
          }
          if (id.includes('/node_modules/@supabase/') || id.includes('/phoenix/')) {
            return 'supabase'
          }
        },
      },
    },
  },
})
