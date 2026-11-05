import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/* ⚠️ IT LIVES IN scripts/ AND IS .mjs, FOR THE REASON migration-md5.test.mjs DOES. A test that
   walks the repository needs `node:fs`, and `src`'s tsconfig has no node types — so written as
   `src/ui/motion.test.ts` it passed vitest and failed `npm run typecheck`, which is a gate
   somebody has to notice rather than a gate that holds. The other filesystem rule-checker in
   this project sits here for the same reason and answers the same shape of question: a rule
   written in prose, about files, that nothing could run. */

/**
 * The one answer to "should this move?", enforced instead of asked for.
 *
 * `motion.ts` has always said it: "everything animated reads this rather than matchMedia
 * directly, so one switch reaches the click flair, the ambient backdrop, the scroll reveals, the
 * canvas window transitions, and anything added later that remembers to ask."
 *
 * ⚠️ "ANYTHING THAT REMEMBERS TO ASK" IS THE PROBLEM, AND FIFTEEN FILES DID NOT. Twenty-five
 * call sites still read the media query directly — the whole pets room, the park, the circuit
 * canvas, the watchlist wheel, ProfileArt and three of the home-page toys. Those are canvas
 * render loops, which are most of the motion on this site; the things that DID obey were largely
 * CSS transitions already covered by the blanket `[data-motion='reduce']` rule.
 *
 * It matters because the site switch is a localStorage flag and `matchMedia` cannot see it.
 * `motionReduced()` is `OS || site`, so reading the query directly honours the operating system
 * and silently ignores the switch — and the switch exists precisely because, as motion.ts puts
 * it, "the person most likely to need it is the least likely" to find the OS setting. Someone
 * who turned it on still got every pet, the park and the wheel moving.
 *
 * So this is a rule that runs. It is the same lesson as `migration-md5.test.mjs`: "never edit an
 * applied migration" was prose, and prose cannot be run, so it was broken three times before
 * anything could say so. A sentence in a header is not a guard.
 */

const ROOT = 'src'
/** The only module allowed to ask the browser. Everything else asks it. */
const OWNER = join('src', 'ui', 'motion.ts')
/**
 * ⚠️ `src/gpu` IS SOMEBODY ELSE'S. Another thread owns the WebGPU Lab and this sweep must not
 * reach into it — excluded by directory rather than by filename, so a new Lab file is excluded
 * too and a file moving OUT of the Lab is caught.
 */
const NOT_OURS = join('src', 'gpu')

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(ts|tsx)$/.test(full) ? [full] : []
  })

describe('one answer to whether things move', () => {
  it('is the only place that asks the browser directly', () => {
    const offenders = []
    for (const file of walk(ROOT)) {
      if (file === OWNER || file.startsWith(NOT_OURS)) continue
      const src = readFileSync(file, 'utf8')
      /* the call, not the words — a comment mentioning the query is fine and several explain
         why the rule exists */
      const re = /matchMedia\s*\??\.?\s*\(\s*['"`]\(prefers-reduced-motion/g
      const hits = src.match(re)
      if (hits) offenders.push(`${file} (${hits.length})`)
    }
    expect(
      offenders,
      'these ask the browser instead of motionReduced(), so the site’s own switch cannot reach them',
    ).toEqual([])
  })

  it('is imported by the things that move', () => {
    /* a weak but useful floor: if this drops to nothing, the sweep has been undone wholesale
       rather than one file at a time */
    const users = walk(ROOT).filter((f) => {
      if (f === OWNER || f.startsWith(NOT_OURS)) return false
      return /from '[^']*(\.\/|ui\/)(motion|useMotion)'/.test(readFileSync(f, 'utf8'))
    })
    expect(users.length).toBeGreaterThanOrEqual(15)
  })

  it('leaves the CSS blanket rule as the other half', () => {
    /**
     * The attribute is what lets one switch reach the nine `@media (prefers-reduced-motion)`
     * blocks without duplicating every one of them with a second selector. If `applyMotionAttr`
     * stopped writing it, every CSS-driven animation would quietly stop obeying the site switch
     * while the JS half carried on working — the half of the bug that is hardest to notice.
     */
    const css = readFileSync(join('src', 'index.css'), 'utf8')
    expect(css).toContain("[data-motion='reduce']")
    expect(readFileSync(OWNER, 'utf8')).toContain("setAttribute('data-motion', 'reduce')")
  })
})
