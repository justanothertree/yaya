import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DUMPS, MIGRATIONS, migrationFiles } from './migration-md5.mjs'

/**
 * THE SCHEMA BASELINE IS THE ONE MIGRATION NOBODY RAN, which is why nothing else here looks at
 * it. `scripts/migration-md5.mjs` compares every migration file against the text production
 * executed and puts this one in `dumps` instead, unhashed on purpose: there is no recorded
 * statement to compare it against. So the file that builds the entire schema in CI is the file
 * with no gate on it — and it arrived with two holes in it, neither of which announced itself.
 *
 * ⚠️ IT CANNOT CREATE THE EXTENSIONS ITS OWN COLUMNS ARE TYPED FROM. `db dump --schema
 * public,finance` emits no `create extension`, because an extension belongs to the database
 * rather than to either named schema. Measured: db-guards run 41951750375 died on statement 673
 * with `type "extensions.citext" does not exist`.
 *
 * ⚠️ AND IT CONTAINS NO TRIGGERS AT ALL, while production has 24. Every other object kind in it
 * matches production exactly, and all 24 trigger FUNCTIONS are present — so the schema reads
 * complete and enforces nothing. Run 41954680315 reported five tables whose tier column is
 * writable with no clamp trigger, and one seeded row already above its owner's ceiling.
 *
 * Both are fixed by hand-written files BESIDE the dump, under supabase/baseline/, applied around
 * it by `[db.seed] sql_paths`. They are beside it rather than inside it because the documented
 * way to update the dump is to regenerate it, and a regeneration is a fresh file: anything
 * hand-written inside the old one is lost at that moment without a word.
 *
 * What this file asks is therefore about the THREE of them together, because that is what a
 * schema is here: the dump's demands are met by 01-extensions.sql, the triggers in
 * 02-triggers.sql name functions and tables the dump really defines, and config.toml applies
 * them in an order where each arrives before whatever needs it.
 *
 * Made to fail on purpose, 4 Nov 2026, each from a scratchpad copy: the dump without its
 * extension prologue turned the citext and pgcrypto assertions red; config.toml with the dump
 * trimmed out of `sql_paths` named the empty database; the triggers file with `public.` removed
 * from one statement named that statement.
 */

const dumpName = migrationFiles().find((n) => DUMPS.has(n.slice(0, 14)))
const SUPABASE = join(MIGRATIONS, '..')
const read = (...p) => readFileSync(join(SUPABASE, ...p), 'utf8')

const dump = readFileSync(join(MIGRATIONS, dumpName), 'utf8')
const privileges = read('baseline', '00-privileges.sql')
const extensions = read('baseline', '01-extensions.sql')
const triggers = read('baseline', '02-triggers.sql')
const toml = read('config.toml')

/**
 * A reference the PARSER has to resolve is the only kind that matters. `extensions.http_get` and
 * `vault.decrypted_secrets` are reached from inside function bodies, which the dump's own
 * `check_function_bodies = false` lets through unresolved, and these files' comments name them in
 * prose. So strip dollar-quoted bodies and `--` comments before sweeping. Stripping can only ever
 * hide a reference, never invent one, which is the safe direction for a check that fails on what
 * it finds.
 */
const ddlOnly = (sql) =>
  sql.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, '').replace(/--[^\n]*/g, '')

const dumpDdl = ddlOnly(dump)
const REF = /(?:"extensions"|\bextensions)\s*\.\s*"?([a-z_]+)"?/g

/**
 * The one thing in here that cannot be derived from the files: which extension provides a name.
 * A new entry is a decision — "the dump now resolves THIS at DDL time, and that extension has to
 * be created for it" — so the closed set below is the point rather than a convenience.
 */
const PROVIDED_BY = { citext: 'citext', gen_random_bytes: 'pgcrypto' }

describe('the schema baseline and the files that complete it', () => {
  it('reaches into the extensions schema at DDL time at all, or this sweep is about nothing', () => {
    /* the floor. Every assertion below is satisfied by a dump with no extension references in
       it, which is exactly what a trimmed-down regeneration would look like. */
    expect([...dumpDdl.matchAll(REF)].length).toBeGreaterThan(0)
  })

  it('needs nothing from the extensions schema that 01-extensions does not create', () => {
    const names = [...new Set([...dumpDdl.matchAll(REF)].map((m) => m[1]))]
    expect(names.filter((n) => !(n in PROVIDED_BY))).toEqual([])
    for (const n of names) {
      expect(
        extensions.includes(`"${PROVIDED_BY[n]}"`),
        `the dump resolves extensions.${n} at DDL time and 01-extensions.sql never creates ${PROVIDED_BY[n]}`,
      ).toBe(true)
    }
  })

  it('creates citext, because two columns have it as their type', () => {
    const columns = [...dumpDdl.matchAll(/"extensions"\."citext"/g)]
    expect(columns.length).toBeGreaterThan(0)
    expect(extensions).toMatch(/CREATE EXTENSION IF NOT EXISTS "citext"/i)
  })

  it('creates pgcrypto, because a DEFAULT is parsed along with its column', () => {
    /* `circuit_groups.join_code` defaults to encode(extensions.gen_random_bytes(6), 'hex'). The
       local stack already carries pgcrypto, so this one has never failed — which is the reason to
       pin it: it is insurance against a stack that does not, and insurance nothing exercises is
       insurance somebody deletes as redundant. */
    expect([...dumpDdl.matchAll(/extensions"?\."?gen_random_bytes/g)].length).toBeGreaterThan(0)
    expect(extensions).toMatch(/CREATE EXTENSION IF NOT EXISTS "pgcrypto"/i)
  })

  it('creates the extensions schema, and each extension `if not exists`', () => {
    expect(extensions).toMatch(/CREATE SCHEMA IF NOT EXISTS "extensions"/i)
    /* ⚠️ comment-stripped, and the first version of this was not: this file's own header says
       "emits no `create extension`" in prose, which the sweep counted as a bare create. */
    const creates = [...ddlOnly(extensions).matchAll(/CREATE EXTENSION(?: IF NOT EXISTS)?/gi)].map(
      (m) => m[0],
    )
    expect(creates.length).toBeGreaterThan(0)
    expect(creates.filter((c) => !/IF NOT EXISTS/i.test(c))).toEqual([])
  })
})

describe('the privileges a restore cannot reproduce', () => {
  /**
   * ⚠️ `auto_expose_new_tables = false` STOPS FOUR PRIVILEGES SHORT, and the four it covers are
   * the four anybody would think to check. Its SQL revokes `select, insert, update, delete` on
   * tables and leaves TRUNCATE, REFERENCES and TRIGGER handed out — so run 41956008931 reported
   * eight `a deny-all table is not deny-all`, every one of them TRUNCATE, on the four tables the
   * house pattern keeps at RLS-on / zero-policies / no-grants. TRUNCATE is the privilege RLS
   * cannot cover: there is no TRUNCATE policy type.
   */
  const sql = ddlOnly(privileges)

  it('revokes every privilege, not the four the config flag names', () => {
    for (const kind of ['TABLES', 'SEQUENCES', 'FUNCTIONS'])
      expect(sql, `nothing revokes the default privileges on ${kind}`).toMatch(
        new RegExp(`REVOKE ALL ON ${kind} FROM`, 'i'),
      )
  })

  it('names all three roles the Data API uses', () => {
    /* service_role included on purpose: the dump grants it back explicitly wherever production
       grants it, and a restore that keeps it by default is as unfaithful as one that keeps anon. */
    for (const role of ['anon', 'authenticated', 'service_role'])
      expect(sql, `${role} keeps its default privileges`).toMatch(new RegExp(`\\b${role}\\b`))
  })
})

describe('the triggers the dump left out', () => {
  const statements = triggers.split('\n').filter((l) => /^CREATE/i.test(l))

  it('carries enough of them to be the file it claims to be', () => {
    /* a FLOOR, not a count: production had 24 on 4 Nov and a count maintained by hand is the
       thing CLAUDE.md §11 refuses. What this catches is the failure that actually happened —
       a generator dropping the whole class. The real number comes from the database:
         select count(*) from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          where not tg.tgisinternal and n.nspname in ('public','finance'); */
    expect(statements.length).toBeGreaterThan(10)
  })

  it('writes every one `or replace`, so applying it twice is a no-op', () => {
    /* the dump may one day carry triggers of its own; then this file runs over the top of them
       and must not raise. That is the whole reason for `or replace` rather than a bare create. */
    expect(statements.filter((s) => !/^CREATE OR REPLACE TRIGGER /.test(s))).toEqual([])
  })

  it('schema-qualifies every function it executes', () => {
    /* pg_get_triggerdef writes the function unqualified, and the dump sets `search_path = ''`
       for its whole session — where an unqualified name resolves to nothing. */
    const unqualified = statements.filter((s) => !/EXECUTE FUNCTION public\./.test(s))
    expect(unqualified).toEqual([])
  })

  it('names only functions and tables the dump actually defines', () => {
    /* the check that notices drift between the two files, which is the cost of them being two.
       A function renamed in a later migration, or a table the dump no longer has, shows up here
       rather than as a `relation does not exist` three minutes into a CI run. */
    const missing = []
    for (const s of statements) {
      const fn = /EXECUTE FUNCTION public\.([a-z_]+)\(/.exec(s)?.[1]
      const table = /\sON public\.([a-z_]+)\s/.exec(s)?.[1]
      expect(fn, `no function in: ${s}`).toBeDefined()
      expect(table, `no table in: ${s}`).toBeDefined()
      if (!dump.includes(`FUNCTION "public"."${fn}"(`)) missing.push(`function ${fn}`)
      if (!dump.includes(`TABLE IF NOT EXISTS "public"."${table}"`)) missing.push(`table ${table}`)
    }
    expect([...new Set(missing)]).toEqual([])
  })
})

describe('config.toml, which is the other half of all of it', () => {
  /**
   * ⚠️ NOTHING ELSE WOULD CONTRADICT THIS. The CLI is told to skip migrations — supabase/migrations
   * cannot replay, and the reasoning with the measurement behind it is in that config block — so
   * `[db.seed] sql_paths` is the only thing that builds anything. Trim an entry and `db reset`
   * produces a database that is empty, or worse one with no enforcement in it: every guard that
   * needs a session then succeeds against an empty set and the job reports a green zero, which is
   * the shape CLAUDE.md §2 keeps describing. These settings are one decision, and this is what
   * notices when one of them moves without the others.
   */
  /* a line scan rather than a TOML dependency: the section header on its own line, the lines
     under it up to the next header, and a key read off those. */
  const section = (name) => {
    const all = toml.split(/\r?\n/)
    const at = all.findIndex((l) => l.trim() === `[${name}]`)
    if (at < 0) return []
    const rest = all.slice(at + 1)
    const end = rest.findIndex((l) => l.trim().startsWith('['))
    return end === -1 ? rest : rest.slice(0, end)
  }
  const setting = (sec, key) => {
    const lines = section(sec)
    const at = lines.findIndex((l) => l.trimStart().startsWith(`${key} =`))
    if (at < 0) return undefined
    const value = lines.slice(at).join('\n')
    const from = value.indexOf('=') + 1
    /* a list may be written over several lines; take up to its closing bracket */
    const text = value.slice(from)
    const close = text.indexOf(']')
    return (
      text.trimStart().startsWith('[') ? text.slice(0, close + 1) : text.split('\n')[0]
    ).trim()
  }

  it('applies the schema by one of the two mechanisms the CLI has', () => {
    const replayed = setting('db.migrations', 'enabled')
    const paths = setting('db.seed', 'sql_paths')
    expect(replayed, 'config.toml has no [db.migrations] enabled').toBeDefined()
    expect(paths, 'config.toml has no [db.seed] sql_paths').toBeDefined()
    expect(
      replayed === 'true' || paths.includes(dumpName),
      'migrations are skipped and the dump is not a seed path: CI would build an empty database',
    ).toBe(true)
    if (paths.includes(dumpName)) expect(setting('db.seed', 'enabled')).toBe('true')
  })

  it('applies extensions, then the dump, then the triggers, then the fixtures', () => {
    const paths = setting('db.seed', 'sql_paths')
    const order = [
      '00-privileges.sql',
      '01-extensions.sql',
      dumpName,
      '02-triggers.sql',
      'seed.sql',
    ].map((n) => [n, paths.indexOf(n)])
    for (const [n, at] of order) expect(at, `${n} is not in sql_paths`).toBeGreaterThan(-1)
    const places = order.map(([, at]) => at)
    expect(places, 'sql_paths is out of order').toEqual([...places].sort((a, b) => a - b))
  })

  it('keeps the api from re-granting what the dump revoked', () => {
    /* pg_dump describes an ACL by what it holds, never by what it lacks: a function production
       revoked from anon has no anon entry to dump, so a restore onto a database whose default
       privileges grant anon leaves anon holding it, and the guards report a permission production
       does not have. Run 41954680315 did exactly that, ~30 times. */
    expect(setting('api', 'auto_expose_new_tables')).toBe('false')
  })

  /**
   * ⚠️ THE REGENERATION NOTE ROTTED WITHIN ONE COMMIT OF BEING WRITTEN, which is the argument
   * for this being a test rather than a habit. `supabase/baseline/README.md` and the table in
   * `supabase/migrations/README.md` both list what builds the schema; `00-privileges.sql` was
   * added a few hours later and neither list gained it. A list of files maintained by hand is
   * the thing CLAUDE.md §11 refuses, and the fix is to ask `sql_paths` instead of asking a
   * person to remember. Nothing here checks the prose — only that no file silently drops out
   * of the documents that tell somebody how to regenerate.
   */
  it('is described by both READMEs, file for file', () => {
    const paths = setting('db.seed', 'sql_paths')
    const names = [...paths.matchAll(/([A-Za-z0-9_.-]+\.sql)/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(3)
    for (const doc of ['baseline/README.md', 'migrations/README.md']) {
      const text = read(...doc.split('/'))
      expect(
        names.filter((n) => !text.includes(n)),
        `${doc} does not mention every file in sql_paths`,
      ).toEqual([])
    }
  })
})
