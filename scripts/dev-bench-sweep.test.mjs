import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The workbench list in App.tsx says what the rendering does.
 *
 * ⚠️ A LIST BESIDE THE THING IT DESCRIBES IS THE KIND THAT GOES QUIETLY WRONG. `DEV_BENCHES`
 * exists so `scripts/mobile-audit.js` can ask which workbenches there are rather than keeping a
 * copy — CLAUDE.md's rule about hand-maintained lists is exactly why the sweep reads the nav
 * instead of naming rooms. Moving the list into App.tsx only moves the drift unless something
 * compares it to the seven `DEV_PREVIEW === '…'` comparisons it is supposed to describe.
 *
 * The failure it guards is silent in the worst way: add an eighth workbench, forget the list,
 * and the sweep reports a clean five while the new surface is never looked at. Nothing goes
 * red, nothing looks wrong, and the gap is invisible precisely because the tool says it checked.
 * That is the shape of the bug this whole file exists to prevent, one level up.
 *
 * ⚠️ IT READS THE SOURCE RATHER THAN IMPORTING IT, because `DEV_BENCHES` is not exported and
 * should not be — nothing in the app needs it, and an export is a thing production has to carry
 * (see the note in App.tsx about `import.meta.env.DEV` folding branches, not modules). Reading
 * the text is the honest trade: it cannot be fooled by a re-export, and it breaks loudly if
 * somebody reformats the declaration, which is a cheap failure to fix.
 */

const APP = new URL('../src/App.tsx', import.meta.url)
const src = readFileSync(APP, 'utf8')

/** every `DEV_PREVIEW === 'name'` the rendering actually branches on */
const rendered = [...src.matchAll(/DEV_PREVIEW === '([a-z-]+)'/g)].map((m) => m[1])

/** the declared list, read out of its `const DEV_BENCHES = [...] as const` */
const declaredBlock = src.match(/const DEV_BENCHES = \[([\s\S]*?)\] as const/)
const declared = declaredBlock
  ? [...declaredBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
  : null

describe('the workbench list', () => {
  it('is findable at all — the shapes below depend on it', () => {
    expect(declared, 'no `const DEV_BENCHES = [...] as const` in App.tsx').not.toBeNull()
    expect(declared.length).toBeGreaterThan(0)
    expect(
      rendered.length,
      'no DEV_PREVIEW comparisons found — did the rendering change?',
    ).toBeGreaterThan(0)
  })

  it('names every workbench the app renders', () => {
    const missing = rendered.filter((name) => !declared.includes(name))
    expect(missing, 'these are rendered but not listed, so nothing will ever sweep them').toEqual(
      [],
    )
  })

  it('and names no workbench the app does not render', () => {
    const extra = declared.filter((name) => !rendered.includes(name))
    expect(
      extra,
      'these are listed but nothing renders them, so a sweep would load a blank page and call it clean',
    ).toEqual([])
  })

  it('lists each one once', () => {
    expect(new Set(declared).size, 'a duplicate would be swept twice for nothing').toBe(
      declared.length,
    )
  })

  it('is handed to the checker only in dev', () => {
    /* ⚠️ the assignment has to be inside an `import.meta.env.DEV` branch or it ships — the
       bundle carries whatever is reachable, and CLAUDE.md has the 2.78 kB receipt */
    const handover = src.match(/if \(import\.meta\.env\.DEV\) \{[\s\S]{0,200}?__devBenches/)
    expect(
      handover,
      '__devBenches must be assigned inside an import.meta.env.DEV block',
    ).not.toBeNull()
  })
})
