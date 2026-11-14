import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The feed-made-and-comments draft, asked of the text it will meet, with no database.
 *
 * ⚠️ WHAT THIS CAN AND CANNOT SAY. It can say the substitution lands where it means to, that the
 * rollback is its exact reverse, that every object the draft creates is shut to the API, and that
 * each source in the new block is read with the rule its own room uses. It cannot say those rules
 * BEHAVE -- that is supabase/tests/feed-made-and-comments.sql, run as three seeded members on a
 * real database through a scratch-probe branch.
 *
 * It lives in scripts/ and is .mjs for the reason migration-md5.test.mjs does: it reads files, and
 * src's tsconfig has no node types.
 */

const DUMP = readFileSync('supabase/migrations/00000000000000_baseline.sql', 'utf8')
const DRAFT = readFileSync('docs/2026-11-14-feed-made-and-comments.DRAFT.sql', 'utf8')
const ROLLBACK = readFileSync('docs/2026-11-14-feed-made-and-comments.ROLLBACK.sql', 'utf8')
const CHECKS = readFileSync('docs/2026-11-14-feed-made-and-comments.checks.sql', 'utf8')
const SQL_TEST = readFileSync('supabase/tests/feed-made-and-comments.sql', 'utf8')

/** a function's whole definition in the dump, from CREATE to the ALTER that follows it */
function dumped(fn) {
  const start = DUMP.indexOf(`CREATE OR REPLACE FUNCTION "public"."${fn}"(`)
  const end = DUMP.indexOf(`ALTER FUNCTION "public"."${fn}"(`, start)
  if (start < 0 || end < 0) throw new Error(`${fn} is not in the dump`)
  return DUMP.slice(start, end)
}

/** the text between the first pair of `$tag$` quotes */
function dollar(sql, tag) {
  const open = `$${tag}$`
  const a = sql.indexOf(open)
  const b = sql.indexOf(open, a + open.length)
  if (a < 0 || b < 0) throw new Error(`no ${open} literal`)
  return sql.slice(a + open.length, b)
}

/** SQL with its comments taken out, so a word in an explanation is not mistaken for code */
const code = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

const count = (hay, needle) => hay.split(needle).length - 1
const OLD = dollar(DRAFT, 'old')
const NEW = dollar(DRAFT, 'new')
const BLOCK = NEW.slice(0, NEW.length - OLD.length)
const before = dumped('feed_recent')
const after = before.split(OLD).join(NEW)

describe('the feed-made-and-comments draft', () => {
  it("finds feed_recent's final return exactly once, in the text CI builds from", () => {
    expect(count(before, OLD)).toBe(1)
  })

  it('only puts a block in front of that return, and changes nothing else', () => {
    expect(NEW.endsWith(OLD)).toBe(true)
    expect(BLOCK.length).toBeGreaterThan(0)
    expect(after.replace(BLOCK, '')).toBe(before)
  })

  /* one branch per source, each read with the rule its own room's reader applies */
  const branches = code(BLOCK).split(/\bunion all\b/)
  const branch = (table) => branches.filter((b) => b.includes(`from public.${table} `))

  it.each([
    ['circuit_log_comments', ['public.circuit_can_see_log(c.log_id)', 'public.is_suspended(v_me)']],
    [
      'lab_comments',
      ['public.lab_can_read_comment(c.user_id, false)', 'c.removed_at is null', 'not d.hidden'],
    ],
    [
      'profile_notes',
      ['public.guestbook_open_to(n.profile_user_id)', 'coalesce(o.suspended, false) = false'],
    ],
    [
      'profile_showcase',
      [
        "public.can_see_item(b.user_id, b.visibility,\n                                                      'profile_block', b.id::text)",
        "public.item_reaches_anyone(v_me, b.visibility,\n                                                             'profile_block', b.id::text)",
        's.first_shown_at >= v_from',
      ],
    ],
  ])('reads %s with its own room’s rule', (table, rules) => {
    expect(branch(table)).toHaveLength(1)
    for (const r of rules) expect(branch(table)[0], r).toContain(r)
  })

  it('asks about the same people as the loop above it, by the same three rules', () => {
    const people = [
      'coalesce(p.suspended, false) = false',
      'public.feed_may_show(p.user_id)',
      'coalesce(public.are_friends(v_me, p.user_id), false)',
    ]
    for (const r of people) {
      expect(count(code(before), r), r).toBeGreaterThan(0)
      expect(code(BLOCK), r).toContain(r)
    }
    expect(code(BLOCK)).toContain('where x.n <= p_per_member')
  })

  it('never touches get_member_activity, which also feeds public pages', () => {
    expect(code(DRAFT)).not.toMatch(/get_member_activity/)
  })

  it('shuts every object it creates to the API', () => {
    const made = [...code(DRAFT).matchAll(/create (table|function) public\.(\w+)(\([^)]*\))?/g)]
    expect(made.map((m) => m[2])).toEqual([
      'profile_showcase',
      'profile_showcase_note',
      'feed_preview',
    ])
    for (const [, kind, name, args] of made) {
      const sig =
        kind === 'function'
          ? `${name}(${(args ?? '()').slice(1, -1).replace(/p_\w+ /g, '')})`
          : name
      expect(code(DRAFT), sig).toContain(
        `revoke all on ${kind} public.${sig} from public, anon, authenticated;`,
      )
    }
    expect(code(DRAFT)).toContain('alter table public.profile_showcase enable row level security;')
    expect(code(DRAFT)).not.toMatch(/create policy/i)
  })

  it('backfills what is already on a page as never announced', () => {
    expect(code(DRAFT)).toMatch(
      /insert into public\.profile_showcase \(owner, block_type, config_md5, first_shown_at\)\s+select b\.user_id, b\.block_type, md5\(b\.config::text\), null/,
    )
  })
})

describe('the rollback', () => {
  it('is the draft’s substitution reversed, and restores feed_recent byte for byte', () => {
    expect(dollar(ROLLBACK, 'old')).toBe(NEW)
    expect(dollar(ROLLBACK, 'new')).toBe(OLD)
    expect(after.split(NEW).join(OLD)).toBe(before)
  })

  it('drops everything the draft creates, after feed_recent stops reading it', () => {
    const body = code(ROLLBACK)
    const drops = [
      'drop trigger profile_showcase_note on public.profile_blocks;',
      'drop function public.profile_showcase_note();',
      'drop table public.profile_showcase;',
      'drop function public.feed_preview(text);',
    ]
    for (const d of drops) {
      expect(body, d).toContain(d)
      expect(body.indexOf(d), d).toBeGreaterThan(body.indexOf('$rollback$;'))
    }
  })
})

describe('the production checks', () => {
  /* string literals out too, so the privilege names in has_table_privilege(…) are not statements */
  const stripped = code(CHECKS).replace(/E?'(?:[^']|'')*'/g, "''")

  it('run inside a read-only transaction that is rolled back', () => {
    expect(stripped.trim()).toMatch(/^begin transaction read only;/i)
    expect(stripped.trim()).toMatch(/rollback;$/i)
  })

  it('contain no statement that writes', () => {
    expect(stripped).not.toMatch(
      /\b(insert|update|delete|merge|truncate|create|alter|drop|grant|revoke|execute|copy|call|do)\b/i,
    )
  })

  it('look for the same anchor the draft substitutes on', () => {
    const lit = OLD.replace(/'/g, "''").replace(/\n/g, '\\n')
    expect(CHECKS).toContain(`E'${lit}'`)
  })

  it('expect the same four fingerprints the database test asserts', () => {
    const md5s = (s) => [...new Set(s.match(/\b[0-9a-f]{32}\b/g))].sort()
    expect(md5s(code(CHECKS))).toHaveLength(4)
    expect(md5s(code(SQL_TEST))).toEqual(md5s(code(CHECKS)))
  })
})
