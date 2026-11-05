import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DUMPS, MIGRATIONS, migrationFiles } from './migration-md5.mjs'

/**
 * THE SCHEMA BASELINE IS THE ONE MIGRATION NOBODY RAN, which is why nothing else here looks at
 * it. `scripts/migration-md5.mjs` compares every file against the text production executed and
 * puts this one in `dumps` instead, unhashed on purpose: there is no recorded statement to
 * compare it to. So the file that builds the entire schema in CI is the file with no gate on it.
 *
 * ⚠️ AND IT ARRIVED BROKEN, in the way a dump always is. `db dump --schema public,finance` emits
 * no `create extension`: an extension belongs to the database rather than to either named
 * schema, so it is outside what was asked for — while two columns in the dump are
 * `extensions.citext`, and a column's type is resolved when the table is created. Measured:
 * db-guards run 41951750375, the workflow's first real run, died on statement 673 with
 * `type "extensions.citext" does not exist`.
 *
 * The fix is a hand-written prologue at the top of the dump, and the reason this file exists is
 * that THE DOCUMENTED WAY TO UPDATE THE BASELINE DELETES THAT PROLOGUE. Its own header says
 * `Regenerate: supabase db dump ...`, and a regenerated dump is a fresh file with no prologue in
 * it — so the fix lives exactly one `-f` away from being lost, in a file nothing was watching.
 *
 * Made to fail on purpose, 4 Nov 2026: with the three prologue statements deleted from a copy,
 * `no CREATE EXTENSION in the baseline at all` and the citext assertion both go red, naming the
 * references that would not resolve.
 */

const file = migrationFiles().find((n) => DUMPS.has(n.slice(0, 14)))
const sql = readFileSync(join(MIGRATIONS, file), 'utf8')

/**
 * A reference the PARSER has to resolve is the only kind that matters here. `extensions.http_get`
 * and `vault.decrypted_secrets` are reached from inside function bodies, which the dump's own
 * `check_function_bodies = false` lets through unresolved, and the prologue's comment names them
 * in prose. So strip dollar-quoted bodies and `--` comments before sweeping. Stripping can only
 * ever hide a reference, never invent one, which is the safe direction for a check that fails on
 * what it finds.
 */
const ddl = sql.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, '').replace(/--[^\n]*/g, '')

const REF = /(?:"extensions"|\bextensions)\s*\.\s*"?([a-z_]+)"?/g

describe('the schema baseline', () => {
  it('reaches into the extensions schema at DDL time at all, or this sweep is about nothing', () => {
    /* the floor. Every assertion below is satisfied by a file with no extension references in
       it, which is precisely what a regenerated-and-then-trimmed dump would look like. */
    const refs = [...ddl.matchAll(REF)].map((m) => m[1])
    expect(refs.length).toBeGreaterThan(0)
    expect(new Set(refs).size).toBeGreaterThan(0)
  })

  it('creates the extensions schema before anything is put in it', () => {
    const made = ddl.search(/CREATE SCHEMA IF NOT EXISTS "extensions"/i)
    expect(made, 'the baseline never creates the extensions schema').toBeGreaterThan(-1)
    const first = [...ddl.matchAll(REF)][0]
    expect(first.index).toBeGreaterThan(made)
  })

  it('creates every extension before the first name resolved out of one', () => {
    const first = ddl.search(/CREATE EXTENSION/i)
    expect(first, 'no CREATE EXTENSION in the baseline at all').toBeGreaterThan(-1)
    const early = [...ddl.matchAll(REF)].filter((m) => m.index < first).map((m) => m[0])
    expect(early).toEqual([])
  })

  it('creates citext, because two columns have it as their type', () => {
    const columns = [...ddl.matchAll(/"extensions"\."citext"/g)]
    expect(columns.length).toBeGreaterThan(0)
    const made = ddl.search(/CREATE EXTENSION IF NOT EXISTS "citext"/i)
    expect(made, 'citext is used as a column type and never created').toBeGreaterThan(-1)
    expect(columns[0].index).toBeGreaterThan(made)
  })

  it('creates pgcrypto, because a DEFAULT is parsed along with its column', () => {
    /* `circuit_groups.join_code` defaults to encode(extensions.gen_random_bytes(6), 'hex'). The
       local stack already carries pgcrypto, so this one has never failed — which is the reason
       to pin it: it is insurance against a stack that does not, and insurance nothing exercises
       is insurance somebody deletes as redundant. */
    const uses = [...ddl.matchAll(/extensions"?\."?gen_random_bytes/g)]
    expect(uses.length).toBeGreaterThan(0)
    const made = ddl.search(/CREATE EXTENSION IF NOT EXISTS "pgcrypto"/i)
    expect(
      made,
      'gen_random_bytes is used in a DEFAULT and pgcrypto is never created',
    ).toBeGreaterThan(-1)
    expect(uses[0].index).toBeGreaterThan(made)
  })

  it('creates each one `if not exists`, so the file replays on a database that has them', () => {
    const creates = [...ddl.matchAll(/CREATE EXTENSION(?: IF NOT EXISTS)?/gi)].map((m) => m[0])
    expect(creates.length).toBeGreaterThan(0)
    expect(creates.filter((c) => !/IF NOT EXISTS/i.test(c))).toEqual([])
  })
})
