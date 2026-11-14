import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The feed-hides-browsing draft, asked of the text it will meet, with no database.
 *
 * ⚠️ THE DRAFT IS A TEXT SUBSTITUTION, SO ITS MOST LIKELY FAILURE IS A TEXT ONE: an anchor that
 * is one space out, or found twice. In production that raises and changes nothing, which is safe
 * and late. Here it is asked of the schema dump CI builds from, which `checks.sql` check A compares
 * with production before anything runs. The behaviour -- what the Feed and the Friends tab return
 * -- is asked of a real database by supabase/tests/feed-hides-browsing.sql.
 *
 * It lives in scripts/ and is .mjs for the reason migration-md5.test.mjs does: it reads files, and
 * src's tsconfig has no node types.
 */

const DUMP = readFileSync('supabase/migrations/00000000000000_baseline.sql', 'utf8')
const DRAFT = readFileSync('docs/2026-11-13-feed-hides-browsing.DRAFT.sql', 'utf8')
const ROLLBACK = readFileSync('docs/2026-11-13-feed-hides-browsing.ROLLBACK.sql', 'utf8')
const CHECKS = readFileSync('docs/2026-11-13-feed-hides-browsing.checks.sql', 'utf8')

/** a function's whole definition in the dump, from CREATE to the ALTER that follows it */
function dumped(fn) {
  const start = DUMP.indexOf(`CREATE OR REPLACE FUNCTION "public"."${fn}"(`)
  const end = DUMP.indexOf(`ALTER FUNCTION "public"."${fn}"(`, start)
  if (start < 0 || end < 0) throw new Error(`${fn} is not in the dump`)
  return DUMP.slice(start, end)
}

/** the (function, old, new, times) rows of a substitution file's VALUES list */
function substitutions(sql) {
  const lit = String.raw`E'((?:[^']|'')*)'`
  const row = new RegExp(String.raw`\('([a-z_]+)',\s*${lit},\s*${lit},\s*(\d+)\)`, 'g')
  const unescape = (s) => s.replace(/''/g, "'").replace(/\\n/g, '\n')
  return [...sql.matchAll(row)].map((m) => ({
    fn: m[1],
    old: unescape(m[2]),
    new: unescape(m[3]),
    want: Number(m[4]),
  }))
}

const count = (hay, needle) => hay.split(needle).length - 1

const draft = substitutions(DRAFT)
const rollback = substitutions(ROLLBACK)

describe('the feed-hides-browsing draft', () => {
  it('changes exactly the two readers that show sittings to other people', () => {
    expect(draft.map((s) => s.fn)).toEqual(['chronicle_friends_log', 'feed_recent'])
  })

  it('finds each anchor exactly as often as it says, in the text CI builds from', () => {
    for (const s of draft) expect(count(dumped(s.fn), s.old), s.fn).toBe(s.want)
  })

  it('adds one line, `and not a.auto`, directly before the sharing check, and nothing else', () => {
    for (const s of draft) {
      const before = dumped(s.fn)
      const after = before.split(s.old).join(s.new)
      expect(count(after, 'and not a.auto'), s.fn).toBe(1)
      const lost = before.split('\n').filter((l) => !after.split('\n').includes(l))
      const added = after.split('\n').filter((l) => !before.split('\n').includes(l))
      expect(lost, s.fn).toEqual([])
      expect(
        added.map((l) => l.trim()),
        s.fn,
      ).toEqual(['and not a.auto'])
      /* the line it sits in front of is the sharing check, so the filter narrows that gate */
      const lines = after.split('\n')
      const at = lines.findIndex((l) => l.trim() === 'and not a.auto')
      expect(lines[at + 1], s.fn).toMatch(/and public\.(can_see_item|item_reaches_anyone)\(/)
    }
  })

  it('is undone byte for byte by the rollback', () => {
    expect(rollback.map((s) => [s.fn, s.old, s.new])).toEqual(
      draft.map((s) => [s.fn, s.new, s.old]),
    )
    for (const s of draft) {
      const before = dumped(s.fn)
      const patched = before.split(s.old).join(s.new)
      const r = rollback.find((x) => x.fn === s.fn)
      expect(count(patched, r.old), s.fn).toBe(r.want)
      expect(patched.split(r.old).join(r.new), s.fn).toBe(before)
    }
  })
})

describe('the production checks', () => {
  /* comments and string literals out, so a word like "update" in an explanation, or the privilege
     name in has_function_privilege(…, 'execute'), is not mistaken for a statement */
  const code = CHECKS.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/E?'(?:[^']|'')*'/g, "''")

  it('run inside a read-only transaction that is rolled back', () => {
    expect(code.trim()).toMatch(/^begin transaction read only;/i)
    expect(code.trim()).toMatch(/rollback;$/i)
  })

  it('contain no statement that writes', () => {
    expect(code).not.toMatch(
      /\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|execute|copy|call|do)\b/i,
    )
  })
})
