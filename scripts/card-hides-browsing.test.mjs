import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bodyOf } from './migration-md5.mjs'

/**
 * The card-hides-browsing draft, asked of the text it will meet, with no database.
 *
 * ⚠️ THE DRAFT IS A TEXT SUBSTITUTION, SO ITS MOST LIKELY FAILURE IS A TEXT ONE: an anchor that
 * is one space out, or found the wrong number of times. In production that raises and changes
 * nothing, which is safe and late. Here it is asked of the schema dump CI builds from, which
 * `checks.sql` check A compares with production before anything runs. The behaviour -- what a
 * friend's card and the owner's Sharing panel return -- is asked of a real database by
 * supabase/tests/card-hides-browsing.sql.
 *
 * ⚠️ AND PRODUCTION IS NOT THE DUMP. Ten migrations were applied between it and this draft, CI
 * replays none of them (supabase/config.toml says why), and one of them rewrote part of
 * get_member_chronicle. So this asks a second question the dump cannot answer by itself: that
 * nothing between the dump and the draft touched the lines the draft anchors on.
 *
 * It lives in scripts/ and is .mjs for the reason migration-md5.test.mjs does: it reads files, and
 * src's tsconfig has no node types.
 */

const DUMP = readFileSync('supabase/migrations/00000000000000_baseline.sql', 'utf8')
const DRAFT = readFileSync('docs/2026-11-14-card-hides-browsing.DRAFT.sql', 'utf8')
const ROLLBACK = readFileSync('docs/2026-11-14-card-hides-browsing.ROLLBACK.sql', 'utf8')
const CHECKS = readFileSync('docs/2026-11-14-card-hides-browsing.checks.sql', 'utf8')

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
const apply = (text, subs) => subs.reduce((t, s) => t.split(s.old).join(s.new), text)

const draft = substitutions(DRAFT)
const rollback = substitutions(ROLLBACK)
const FNS = ['get_member_chronicle', 'chronicle_sharing_mine']

/** what each function's filter reads, and how many queries over activities each one has */
const FILTER = {
  get_member_chronicle: { text: 'and (v_target = v_viewer or not a.auto)', reads: 3 },
  chronicle_sharing_mine: { text: 'and not a.auto', reads: 1 },
}
const READS = /\b(from|join) public\.chronicle_activities a\b/g

describe('the card-hides-browsing draft', () => {
  it('changes exactly the profile card and the Sharing panel', () => {
    expect([...new Set(draft.map((s) => s.fn))]).toEqual(FNS)
  })

  it('finds each anchor exactly as often as it says, in the text CI builds from', () => {
    for (const s of draft) expect(count(dumped(s.fn), s.old), s.fn).toBe(s.want)
  })

  it('puts the filter in every query over activities, and changes nothing else', () => {
    for (const fn of FNS) {
      const before = dumped(fn)
      const after = apply(
        before,
        draft.filter((s) => s.fn === fn),
      )
      const { text, reads } = FILTER[fn]
      expect(before.match(READS)?.length, fn).toBe(reads)
      expect(count(before, 'a.auto'), fn).toBe(0)
      expect(count(after, text), fn).toBe(reads)
      /* take each filter back out, with the line break and indent in front of it: what is left is
         the function as it was, so nothing else moved */
      const out = after.split(/\n\s+and (?:not a\.auto|\(v_target = v_viewer or not a\.auto\))/)
      expect(out.length - 1, fn).toBe(reads)
      expect(out.join(''), fn).toBe(before)
      /* and each one sits right under the WHERE of a query that reads `a`, inside it */
      const lines = after.split('\n')
      lines.forEach((l, i) => {
        if (!l.includes(text)) return
        expect(lines[i - 1], fn).toMatch(/^\s+where (e|a)\.owner = /)
        expect(lines[i - 2], fn).toMatch(READS)
      })
    }
  })

  it('leaves the owner their own card: the filter lets the owner through', () => {
    /* `v_target` is the card's owner and `v_viewer` is auth.uid(); the server raises before this if
       there is no viewer, so the left side is the owner looking at their own card */
    expect(dumped('get_member_chronicle')).toMatch(/v_viewer uuid := auth\.uid\(\);/)
    expect(dumped('get_member_chronicle')).toMatch(/if v_viewer is null then raise exception/)
  })

  it('is undone byte for byte by the rollback', () => {
    expect(rollback.map((s) => [s.fn, s.old, s.new])).toEqual(
      draft.map((s) => [s.fn, s.new, s.old]),
    )
    for (const fn of FNS) {
      const before = dumped(fn)
      const patched = apply(
        before,
        draft.filter((s) => s.fn === fn),
      )
      for (const r of rollback.filter((x) => x.fn === fn)) {
        expect(count(patched, r.old), fn).toBe(r.want)
      }
      expect(
        apply(
          patched,
          rollback.filter((s) => s.fn === fn),
        ),
        fn,
      ).toBe(before)
    }
  })
})

describe('the migrations applied since the dump', () => {
  /**
   * ⚠️ WHERE THE DUMP ENDS, PROVEN RATHER THAN REMEMBERED. 20261105023835 drops an index the dump
   * still has, so the dump predates it -- and every file from there on is a change CI's database
   * does not carry. If the dump is regenerated this stops being true, and so does the reasoning
   * below: this test then fails, which is the point.
   */
  const FIRST_AFTER = '20261105023835'
  /**
   * ⚠️ AND IT STOPS AT THIS DRAFT, which production applied as 20261114121930. The question is what
   * changed these functions between the dump and the moment the draft met them; the draft's own
   * record touches them by definition, and anything after it is a later change's business.
   */
  const THIS = '20261114121930'
  const files = readdirSync('supabase/migrations').filter(
    (f) => /^\d{14}_.*\.sql$/.test(f) && f.slice(0, 14) >= FIRST_AFTER && f.slice(0, 14) < THIS,
  )
  /**
   * ⚠️ THE BODY, NOT THE FILE. What ran is the body; the header is prose about it, and the md5
   * rule lets a note be added above an applied migration at any time. A later note naming one of
   * these functions is not a change to it, and should not turn this red. No header in range names
   * either function today, so this guards the next note rather than one already written.
   */
  const ran = (f) => bodyOf(readFileSync(`supabase/migrations/${f}`, 'utf8'))

  it('start after the dump was taken', () => {
    const first = readFileSync(`supabase/migrations/${files[0]}`, 'utf8')
    expect(files[0].slice(0, 14)).toBe(FIRST_AFTER)
    expect(first).toMatch(/drop index if exists public\.ux_player_registry_name_ci;/)
    expect(DUMP).toMatch(/"ux_player_registry_name_ci"/)
  })

  it('touch neither function except on lines the draft does not anchor on', () => {
    const anchorLines = [
      ...new Set(
        draft.flatMap((s) =>
          s.old
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean),
        ),
      ),
    ]
    const touching = files.filter((f) => FNS.some((fn) => ran(f).includes(fn)))
    /* one file, and it is the one the checks name: the repeat marks reaching the card's goals */
    expect(touching).toEqual(['20261110030419_chronicle_repeat_marks_profile.sql'])
    const body = ran(touching[0])
    for (const l of anchorLines) expect(body.includes(l), l).toBe(false)
  })

  /* the record production keeps is this draft's body, so the two cannot drift apart unnoticed */
  it('is recorded as the draft that ran', () => {
    const [record] = readdirSync('supabase/migrations').filter((f) => f.startsWith(`${THIS}_`))
    expect(record).toBe(`${THIS}_card_hides_browsing.sql`)
    expect(ran(record)).toBe(bodyOf(DRAFT))
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

  it('look for the same anchors the draft substitutes on', () => {
    for (const s of draft) {
      const lit = s.old.replace(/'/g, "''").replace(/\n/g, '\\n')
      expect(CHECKS.includes(`E'${lit}'`), s.fn).toBe(true)
    }
  })
})
