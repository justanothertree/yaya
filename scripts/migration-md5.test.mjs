import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bodyOf, check, md5, readManifest } from './migration-md5.mjs'

/**
 * The rule is "never edit a migration production has already applied", and this is the thing
 * that notices. It runs on `npm run test`, which runs on pre-push — so the edit is refused on
 * the machine that made it rather than in a workflow file that is still parked in `docs/ci`.
 *
 * ⚠️ THE REAL-DIRECTORY CHECK AT THE BOTTOM IS A ZERO, AND A ZERO IS WHAT CLAUDE.md WARNS
 * ABOUT. `mobileAudit` once reported a flawless zero of everything for three rooms running
 * because its visibility test answered false for every control on the site. So the fixture
 * tests here are not decoration: they are the checker being made to speak. Each one builds a
 * throwaway migrations directory and a throwaway manifest, puts a specific fault in it, and
 * asserts the checker names that fault — an edited body, an edit on top of a recorded
 * divergence, a divergence with no reason, a CRLF file, a file with no line at all.
 *
 * ⚠️ AND THE ONE THAT MATTERS MOST IS `an edit on top of a recorded divergence`. The obvious
 * way to write a manifest is version → "allowed to differ", which is an exemption: once a file
 * is on the list it can be edited for ever and nothing says so. Three of this repository's
 * eleven divergences are files that gained re-run guards, and two of those three did it
 * silently — so an exemption would have been handed to exactly the files most likely to be
 * edited again. The third column pins the one text that is allowed instead.
 *
 * Made to fail on purpose, 4 Nov 2026: a single character appended to the body of
 * `20261031014737_setters_clamp_to_the_ceiling.sql` turned the real-directory test red with
 * `edited after production applied it`, and restoring the file from a copy turned it green.
 */

const GOOD = ['-- a header', '-- it says things', '', 'select 1;', ''].join('\n')

function sandbox(files, manifest) {
  const dir = mkdtempSync(join(tmpdir(), 'yaya-mig-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  const path = join(dir, 'applied.md5')
  writeFileSync(path, `# a manifest\n${manifest}\n`)
  return { dir, manifest: path }
}

describe('bodyOf', () => {
  it('drops the header, the blank line under it and the trailing newlines', () => {
    expect(bodyOf(GOOD)).toBe('select 1;')
  })

  it('keeps a block comment, because production stored one', () => {
    expect(bodyOf('-- header\n\n/* why */\nselect 1;\n')).toBe('/* why */\nselect 1;')
  })

  it('stops at the first line that is not a comment, so an inner -- line stays', () => {
    expect(bodyOf('-- header\n\nselect 1;\n-- and why\nselect 2;\n')).toBe(
      'select 1;\n-- and why\nselect 2;',
    )
  })

  it('leaves a body that has no header at all alone', () => {
    expect(bodyOf('select 1;')).toBe('select 1;')
  })
})

describe('readManifest', () => {
  it('reads two columns as "must match production" and four as a recorded divergence', () => {
    const rows = readManifest(['# note', '', '2026  aaa', '2027  bbb  ccc  comments'].join('\n'))
    expect(rows.get('2026')).toMatchObject({ applied: 'aaa', file: null, reason: null })
    expect(rows.get('2027')).toMatchObject({ applied: 'bbb', file: 'ccc', reason: 'comments' })
  })

  /* the manifest is pinned to LF in .gitattributes for the same reason the .sql files are, but
     the reasons here must survive a CRLF checkout rather than becoming `comments\r` — which the
     check would then refuse as a reason it does not recognise, about a file that is fine */
  it('survives a CRLF checkout of itself', () => {
    const rows = readManifest('# note\r\n2027  bbb  ccc  comments\r\n')
    expect(rows.get('2027')).toMatchObject({ file: 'ccc', reason: 'comments' })
  })
})

describe('check, made to fail', () => {
  it('passes a file that is byte for byte what production ran', () => {
    const r = check(
      sandbox({ '20260101000000_a.sql': GOOD }, `20260101000000  ${md5('select 1;')}`),
    )
    expect(r.failed).toEqual([])
    expect(r.matched).toHaveLength(1)
  })

  it('names a file edited after production applied it', () => {
    const r = check(
      sandbox({ '20260101000000_a.sql': GOOD }, `20260101000000  ${md5('select 2;')}`),
    )
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0].why).toMatch(/edited after production applied it/)
  })

  it('accepts a recorded divergence, and only the exact text that was recorded', () => {
    const ran = md5('select 2;')
    const ok = check(
      sandbox(
        { '20260101000000_a.sql': GOOD },
        `20260101000000  ${ran}  ${md5('select 1;')}  comments`,
      ),
    )
    expect(ok.failed).toEqual([])
    expect(ok.diverged[0].reason).toBe('comments')

    /* the same file edited once more, on top of the divergence that was allowed */
    const again = check(
      sandbox(
        { '20260101000000_a.sql': GOOD.replace('select 1;', 'select 3;') },
        `20260101000000  ${ran}  ${md5('select 1;')}  comments`,
      ),
    )
    expect(again.failed).toHaveLength(1)
    expect(again.failed[0].why).toMatch(/changed since it was recorded/)
  })

  it('refuses a divergence whose reason is not one of the named ones', () => {
    const r = check(
      sandbox(
        { '20260101000000_a.sql': GOOD },
        `20260101000000  ${md5('select 2;')}  ${md5('select 1;')}  unexplained`,
      ),
    )
    expect(r.failed[0].why).toMatch(/no reason named/)
  })

  it('blames the line endings rather than the md5 when a file carries CR', () => {
    const r = check(
      sandbox(
        { '20260101000000_a.sql': GOOD.replace(/\n/g, '\r\n') },
        `20260101000000  ${md5('select 1;')}`,
      ),
    )
    expect(r.failed[0].why).toMatch(/carries CR/)
  })

  it('says when a file has no line yet, and when a line has no file', () => {
    const r = check(sandbox({ '20260101000000_a.sql': GOOD }, '20251212121212  aaa'))
    expect(r.unlisted.map((u) => u.version)).toEqual(['20260101000000'])
    expect(r.missing.map((m) => m.version)).toEqual(['20251212121212'])
  })
})

describe('supabase/migrations as it stands', () => {
  const r = check()

  it('has nothing edited since production ran it', () => {
    expect(r.failed.map((f) => `${f.name}: ${f.why}`)).toEqual([])
  })

  it('has a line in applied.md5 for every migration file', () => {
    expect(r.unlisted.map((u) => u.name)).toEqual([])
  })

  it('accounts for all 79 files, 11 of them divergences that are written down', () => {
    expect(r.matched.length + r.diverged.length).toBe(79)
    expect(r.diverged).toHaveLength(11)
  })
})
