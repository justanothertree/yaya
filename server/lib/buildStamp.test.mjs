import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { serverFiles, stampOf, stampOfServer, stamped } from './buildStamp.mjs'

/**
 * The relay's build stamp: the same files always give the same stamp, a byte anywhere in them
 * gives a different one, and a test file gives nothing.
 *
 * ⚠️ THE FIXTURE IS A SERVER DIRECTORY OF ITS OWN, not this repository's. Changing a byte of the
 * real ws-server.js to watch the stamp move would be a test that edits the relay; a scratch
 * directory with the same shape asks the same question of `stampOfServer` and nothing else.
 */

const SERVER = fileURLToPath(new URL('..', import.meta.url))
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SMOKE = join(ROOT, 'scripts', 'relay-smoke.mjs')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** a server/ lookalike: ws-server.js, two lib modules, a lib test, and a file that is not code */
function scratch() {
  const d = mkdtempSync(join(tmpdir(), 'relay-stamp-'))
  dirs.push(d)
  mkdirSync(join(d, 'lib'))
  writeFileSync(join(d, 'ws-server.js'), "import './lib/a.mjs'\nconsole.log('relay')\n")
  writeFileSync(join(d, 'lib', 'a.mjs'), 'export const a = 1\n')
  writeFileSync(join(d, 'lib', 'b.mjs'), 'export const b = 2\n')
  writeFileSync(join(d, 'lib', 'a.test.mjs'), "it('a', () => {})\n")
  writeFileSync(join(d, 'README.md'), '# notes\n')
  return d
}

/** flip one byte of a file in place */
function nudge(file) {
  const text = readFileSync(file, 'utf8')
  writeFileSync(
    file,
    text.slice(0, -2) + String.fromCharCode(text.charCodeAt(text.length - 2) ^ 1) + '\n',
  )
}

describe('the build stamp', () => {
  it('does not depend on the order the files arrive in', () => {
    const files = [
      { name: 'ws-server.js', text: 'one' },
      { name: 'lib/a.mjs', text: 'two' },
      { name: 'lib/b.mjs', text: 'three' },
    ]
    const s = stampOf(files)
    expect(s).toMatch(/^[0-9a-f]{12}$/)
    expect(stampOf([files[2], files[0], files[1]])).toBe(s)
    expect(stampOf([files[1], files[2], files[0]])).toBe(s)
  })

  it('keeps names and texts apart: moving a character between them is a different stamp', () => {
    expect(stampOf([{ name: 'lib/a.mjs', text: 'xy' }])).not.toBe(
      stampOf([{ name: 'lib/a.mjsx', text: 'y' }]),
    )
  })

  it('changes when one byte changes in ANY stamped file', () => {
    const d = scratch()
    const before = stampOfServer(d)
    for (const f of ['ws-server.js', 'lib/a.mjs', 'lib/b.mjs']) {
      const d2 = scratch()
      nudge(join(d2, f))
      expect(stampOfServer(d2), f).not.toBe(before)
    }
  })

  it('does not change for a test file, or for anything that is not the relay', () => {
    const d = scratch()
    const before = stampOfServer(d)
    nudge(join(d, 'lib', 'a.test.mjs'))
    nudge(join(d, 'README.md'))
    writeFileSync(join(d, 'lib', 'c.test.mjs'), "it('c', () => {})\n")
    expect(stampOfServer(d)).toBe(before)
    expect(serverFiles(d).map((f) => f.name)).toEqual(['ws-server.js', 'lib/a.mjs', 'lib/b.mjs'])
  })

  it('a new lib module joins the stamp without anybody listing it', () => {
    const d = scratch()
    const before = stampOfServer(d)
    writeFileSync(join(d, 'lib', 'c.mjs'), 'export const c = 3\n')
    expect(stampOfServer(d)).not.toBe(before)
  })

  /* ⚠️ the stamp's claim is "these are the files the relay runs", so it is checked against the
     relay's own imports rather than against a list — an import from outside lib/ would be code
     the stamp cannot see, and a deploy of it would read as no change at all */
  it('covers every file the real relay imports, at every depth', () => {
    const seen = new Set()
    const walk = (name) => {
      if (seen.has(name)) return
      seen.add(name)
      expect(stamped(name), `${name} is imported by the relay but not in its stamp`).toBe(true)
      const text = readFileSync(join(SERVER, name), 'utf8')
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g))
        walk(normalize(join(dirname(name), m[1])).replaceAll('\\', '/'))
    }
    walk('ws-server.js')
    expect(seen.size).toBeGreaterThan(4)
    for (const name of seen) expect(name.startsWith('..'), name).toBe(false)
  })
})

describe('one stamp, computed in one place', () => {
  it('relay-smoke --stamp prints exactly what the relay would serve from this checkout', () => {
    const out = execFileSync(process.execPath, [SMOKE, '--stamp'], { encoding: 'utf8' }).trim()
    expect(out).toBe(stampOfServer(SERVER))
  })

  it('neither the relay nor the smoke has a hash of its own: both import this module', () => {
    for (const [file, uses] of [
      [SMOKE, /\bstampOf\b/],
      [join(SERVER, 'ws-server.js'), /\bstampOfServer\(/],
    ]) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).toMatch(/from '(\.\.\/server\/lib|\.\/lib)\/buildStamp\.mjs'/)
      expect(src, file).toMatch(uses)
      expect(src, file).not.toMatch(/createHash\(/)
    }
  })

  /* the working tree and HEAD agree only when server/ has nothing uncommitted — always in CI,
     and not while a change to the relay is being written, so the comparison waits for that */
  const clean =
    execFileSync('git', ['status', '--porcelain', '--', 'server/'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim() === ''
  it.runIf(clean)(
    'relay-smoke --stamp --ref HEAD reads git and agrees with a clean checkout',
    () => {
      const out = execFileSync(process.execPath, [SMOKE, '--stamp', '--ref', 'HEAD'], {
        encoding: 'utf8',
      }).trim()
      expect(out).toBe(stampOfServer(SERVER))
    },
  )
})
