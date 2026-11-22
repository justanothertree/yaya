import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/**
 * Two paths a case-insensitive filesystem cannot tell apart.
 *
 * ⚠️ THIS IS A RULE PROSE COULD NOT KEEP, WHICH IS WHY IT IS A TEST. `src/voice/CallChat.tsx`
 * and `src/voice/callChat.ts` sat on `main` differing in one letter's case, and the import in
 * `CallDock.tsx` — `import { CallChat } from './CallChat'` — resolved to the LOWERCASE module on
 * every case-insensitive filesystem. That module has no `CallChat` export, so the app died at
 * boot with a SyntaxError on every room, not just the call. Measured 18 Nov 2026: the dev
 * server's served source for CallDock.tsx read `import { CallChat } from
 * "/src/voice/callChat.ts"`, and asking it for the extensionless `/src/voice/CallChat` returned
 * the store's text.
 *
 * ⚠️ AND CI IS STRUCTURALLY BLIND TO IT, which is how it reached `main` at all. The runners are
 * Linux and case-sensitive: `./CallChat` resolves to `CallChat.tsx` there, every job goes green,
 * and the only machines that break are the ones nobody runs CI on. Living in the suite rather
 * than in a workflow step also means the pre-push hook catches it before the push, which is the
 * difference between a fix and an incident.
 *
 * ⚠️ AND THE OBVIOUS CHECK — FOLD THE WHOLE PATH AND LOOK FOR DUPLICATES — DOES NOT CATCH IT.
 * That was the first version of this file, and it passed with the real pair restored: folded,
 * they are `src/voice/callchat.tsx` and `src/voice/callchat.ts`, which are different strings,
 * and a filesystem holds both quite happily. The bug was never a path collision. It is a MODULE
 * SPECIFIER collision: `./CallChat` carries no extension, so resolution tries them in order and
 * a case-insensitive lookup matches whichever it reaches first. So the fold has to drop the
 * extension, which is the one thing that makes the two names the same question.
 *
 * ⚠️ IT ASKS `git ls-files`, NOT THE DIRECTORY. A walk from the project root would descend into
 * `.claude/worktrees/<name>/`, which is gitignored and very much still on disk — the same blind
 * spot that had `npm run lint` reporting 86 problems about seven checkouts.
 */

const MODULE_EXT = /\.(?:[cm]?[jt]sx?)$/

const tracked = () =>
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)

/**
 * Two importable modules whose specifiers a case-insensitive filesystem cannot distinguish.
 *
 * Folding drops the module extension, so `CallChat.tsx` and `callChat.ts` land on the same key.
 * Two files sharing a name and differing only in extension — `foo.ts` beside `foo.tsx` — fold to
 * the same key too, and are deliberately NOT flagged: their resolution order is fixed and does
 * not depend on the filesystem, so flagging them would be the sweep crying wolf. The test is
 * whether the un-folded specifiers differ, which is exactly when the answer stops being stable.
 */
export function specifierCollisions(paths) {
  const byFolded = new Map()
  for (const p of paths) {
    if (!MODULE_EXT.test(p)) continue
    const bare = p.replace(MODULE_EXT, '')
    const key = bare.toLowerCase()
    const seen = byFolded.get(key) ?? new Map()
    seen.set(bare, p)
    byFolded.set(key, seen)
  }
  return [...byFolded.values()]
    .filter((byBare) => byBare.size > 1)
    .map((byBare) => [...byBare.values()].sort())
}

/** Two paths of ANY kind that fold to one name — the plainer hazard, and a real one for assets. */
export function pathCollisions(paths) {
  const byFolded = new Map()
  for (const p of paths) {
    const key = p.toLowerCase()
    byFolded.set(key, (byFolded.get(key) ?? new Set()).add(p))
  }
  return [...byFolded.values()].filter((g) => g.size > 1).map((g) => [...g].sort())
}

describe('no two tracked paths collide on a case-insensitive filesystem', () => {
  const paths = tracked()

  it('has something to check, so a pass is about files rather than an empty list', () => {
    /* without this, `git ls-files` answering [] outside a repository reads as "all clear" */
    expect(paths.length).toBeGreaterThan(500)
    expect(paths).toContain('package.json')
    expect(paths.filter((p) => MODULE_EXT.test(p)).length).toBeGreaterThan(200)
  })

  it('has no two modules whose import specifier folds to the same name', () => {
    expect(specifierCollisions(paths)).toEqual([])
  })

  it('has no two paths of any kind that fold to the same name', () => {
    expect(pathCollisions(paths)).toEqual([])
  })

  it('catches the exact pair that shipped', () => {
    /* the fault this file exists for, and the one the first version of it passed over */
    expect(specifierCollisions(['src/voice/CallChat.tsx', 'src/voice/callChat.ts'])).toEqual([
      ['src/voice/CallChat.tsx', 'src/voice/callChat.ts'],
    ])
  })

  it('catches a collision in a DIRECTORY component too', () => {
    expect(specifierCollisions(['src/voice/thing.ts', 'src/Voice/thing.ts'])).toEqual([
      ['src/Voice/thing.ts', 'src/voice/thing.ts'],
    ])
  })

  it('does not flag one name with two extensions, whose resolution order is fixed', () => {
    /* the cry-wolf direction: `foo.ts` beside `foo.tsx` is legal and deterministic */
    expect(specifierCollisions(['a/foo.ts', 'a/foo.tsx'])).toEqual([])
    expect(specifierCollisions(['a/b.ts', 'a/bb.ts', 'A.ts'])).toEqual([])
  })

  it('catches a non-module collision the specifier check would skip', () => {
    expect(pathCollisions(['public/Logo.png', 'public/logo.png'])).toEqual([
      ['public/Logo.png', 'public/logo.png'],
    ])
  })
})
