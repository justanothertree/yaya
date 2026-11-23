/**
 * Which relay is running: a fingerprint of its own source, served on /health.
 *
 * ⚠️ "THE DEPLOY SUCCEEDED" HAS NOT MEANT "THE NEW CODE IS RUNNING" HERE BEFORE. ws-server.js
 * keeps the story over its /health route: every deploy built, failed Render's health check, and
 * the previous build went on serving while a string of pushes appeared to ship. Nothing outside
 * could tell, because a relay's answers are the same shape whichever build gives them. The edge
 * functions taught the same lesson from the other side (CLAUDE.md §2): a probe proves a thing
 * BOOTS, and only a comparison with the source proves it is the one you meant.
 *
 * So the relay hashes the files it runs from, once, at start, and says the result — and
 * `scripts/relay-smoke.mjs --stamp` computes the same thing from a checkout or a git ref, through
 * THESE functions, so the two cannot disagree about method. Equal stamps mean the code serving
 * /health is that commit's relay; anything else means it is not, whatever the dashboard says.
 *
 * ⚠️ WHAT IS IN IT: ws-server.js and every lib/*.mjs beside it — what the relay imports — and
 * not the tests, which Render carries and never runs, so a test-only change does not look like a
 * different relay. NOT the dependencies: a lockfile is something `npm install` on Render may
 * rewrite in place, which would make a correct deploy look like the wrong one. A dependency bump
 * alone does not change the stamp; say so wherever that matters.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Whether a path, relative to server/, is part of the relay's stamp. One rule for disk and git. */
export const stamped = (name) =>
  name === 'ws-server.js' || (/^lib\/[^/]+\.mjs$/.test(name) && !name.endsWith('.test.mjs'))

/**
 * The first 12 hex characters of a sha256 over every file's name and text, in name order —
 * so the order a directory listing happens to come back in cannot change it.
 *
 * Each file goes in as a JSON pair, which is self-delimiting: "a" + "bc" and "ab" + "c" are
 * different inputs, where plain concatenation would make them one.
 */
export function stampOf(files) {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const h = createHash('sha256')
  for (const f of sorted) h.update(JSON.stringify([f.name, f.text]))
  return h.digest('hex').slice(0, 12)
}

/** The stamped files of a server/ directory on disk, as `{name, text}`. */
export function serverFiles(dir) {
  const names = ['ws-server.js', ...readdirSync(join(dir, 'lib')).map((n) => `lib/${n}`)]
  return names
    .filter(stamped)
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
}

export const stampOfServer = (dir) => stampOf(serverFiles(dir))
