/**
 * Builds `supabase/functions/lab-move/core.bundle.js` from `core.ts` and every rules module it
 * reaches, as one ES module with no imports, which is what Deno and a deploy can take.
 *
 *   node scripts/lab-move-bundle.mjs           write it
 *   node scripts/lab-move-bundle.mjs --check   exit 1 if the file on disk is not what this builds
 *
 * ⚠️ WHY A BUNDLE AT ALL: the rules modules import each other without file extensions, which Vite
 * resolves and Deno does not. Rewriting forty modules' imports for one server would make every
 * other change to them carry a rule nobody remembers; a bundle keeps the browser's code as it is.
 *
 * ⚠️ AND WHY IT IS COMMITTED, THOUGH IT IS GENERATED: a deploy sends files, and CLAUDE.md §2's
 * check for an edge function is a byte-for-byte diff of what is deployed against what is in git.
 * That diff is only possible if the file is in git. core.test.ts runs `--check`'s comparison, so
 * a rules change that forgets to rebuild fails `npm run test`, not production.
 *
 * It uses Vite's own build (a direct dependency already), not a new tool.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
export const ENTRY = `${root}supabase/functions/lab-move/core.ts`
export const OUT = `${root}supabase/functions/lab-move/core.bundle.js`

const BANNER = `// GENERATED from core.ts by scripts/lab-move-bundle.mjs. Do not edit: rebuild it.
// core.test.ts fails while this differs from what the build makes of the source today.`

/** the bundle, as text */
export async function bundle() {
  const out = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry: ENTRY, formats: ['es'], fileName: () => 'core.bundle.js' },
      rollupOptions: { output: { banner: BANNER } },
    },
  })
  const results = Array.isArray(out) ? out : [out]
  const chunks = results.flatMap((r) => r.output).filter((o) => o.type === 'chunk')
  if (chunks.length !== 1) throw new Error(`expected one chunk, got ${chunks.length}`)
  return chunks[0].code
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const code = await bundle()
  if (process.argv.includes('--check')) {
    const now = await readFile(OUT, 'utf8').catch(() => '')
    if (now !== code) {
      console.error('core.bundle.js is stale: run node scripts/lab-move-bundle.mjs')
      process.exit(1)
    }
  } else {
    await writeFile(OUT, code)
    console.log(`wrote ${OUT} (${code.length} bytes)`)
  }
}
