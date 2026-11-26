/**
 * After a relay deploy: is the relay serving the code that was merged, and does it still work?
 *
 *   node scripts/relay-smoke.mjs --stamp [--ref <rev>]
 *     prints the build stamp of server/ — the working tree's, or a git revision's
 *
 *   RELAY_URL=<the relay's address> node scripts/relay-smoke.mjs [--ref <rev>] [--wait <seconds>]
 *     waits for /health to report that stamp, then sends a park hello and checks what comes back
 *
 * ⚠️ TWO DIFFERENT QUESTIONS, TWO CHECKS — the rule CLAUDE.md §2 learnt from the edge functions.
 * The stamp proves the code answering is THIS code: /health's `build` is computed by the relay
 * from its own files, and this computes it from the checkout through the very same functions in
 * server/lib/buildStamp.mjs (a test fails if this file ever grows its own copy). The park hello
 * proves that code still BOOTS into a working relay. Neither can stand in for the other: a deploy
 * that never went live answers the hello perfectly, from the previous build.
 *
 * ⚠️ IT WAITS FOR THE STAMP RATHER THAN ASKING ONCE. Render keeps serving the previous build
 * until the new one passes its health check, and a free instance asleep can take most of a
 * minute to answer at all — so "not yet" is the expected first reading, and the honest failure
 * is "still the old build after N seconds", which is what it prints.
 *
 * ⚠️ THE ADDRESS COMES FROM THE ENVIRONMENT AND IS NEVER PRINTED. It is the deploy workflow's
 * VITE_WS_URL secret; ws(s):// and http(s):// are both accepted, and only the origin is used.
 *
 * ⚠️ THE PARK IT KNOCKS ON IS ITS OWN. A fresh `park:smoke-<random>` id, never `park` (which is
 * the public park, and a hello there would show up as a presence change on people's screens) and
 * never a uuid (which would be somebody's hosted map). Nothing is authenticated and nothing is
 * kept: the socket hears its frames and closes, and the empty room goes with it.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { stampOf, stampOfServer, stamped } from '../server/lib/buildStamp.mjs'
import { openSocket, sleep, until } from './relay-harness.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SERVER = fileURLToPath(new URL('../server', import.meta.url))

function usage(why) {
  console.error(
    `relay-smoke: ${why}\n` +
      'usage: node scripts/relay-smoke.mjs --stamp [--ref <rev>]\n' +
      '       RELAY_URL=<address> node scripts/relay-smoke.mjs [--ref <rev>] [--wait <seconds>]',
  )
  process.exit(2)
}

const args = process.argv.slice(2)
const opt = { stamp: false, ref: null, wait: 90 }
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--stamp') opt.stamp = true
  else if (a === '--ref') opt.ref = args[++i] ?? usage('--ref needs a revision')
  else if (a === '--wait') opt.wait = Number(args[++i])
  else usage(`unknown argument ${a}`)
}
/* a revision is handed to git as an argument, so one that looks like an option is refused */
if (opt.ref !== null && (!opt.ref || opt.ref.startsWith('-'))) usage('not a revision')
if (!Number.isFinite(opt.wait) || opt.wait < 0) usage('--wait needs a number of seconds')

/** The stamp of server/ on disk, or at a git revision — the same files, by the same rule. */
function stampAt(ref) {
  if (!ref) return stampOfServer(SERVER)
  const git = (...a) =>
    execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const names = git('ls-tree', '-r', '--name-only', ref, '--', 'server/')
    .split('\n')
    .filter(Boolean)
    .map((p) => p.slice('server/'.length))
    .filter(stamped)
  if (!names.includes('ws-server.js')) usage(`no server/ws-server.js at ${ref}`)
  return stampOf(names.map((name) => ({ name, text: git('show', `${ref}:server/${name}`) })))
}

const want = stampAt(opt.ref)
if (opt.stamp) {
  console.log(want)
  process.exit(0)
}

const raw = process.env.RELAY_URL
if (!raw) usage('RELAY_URL is not set')
let origin
try {
  const u = new URL(raw)
  const secure = { 'wss:': true, 'https:': true, 'ws:': false, 'http:': false }[u.protocol]
  if (secure === undefined) usage('RELAY_URL must be ws://, wss://, http:// or https://')
  origin = {
    http: `${secure ? 'https' : 'http'}://${u.host}`,
    ws: `${secure ? 'wss' : 'ws'}://${u.host}`,
  }
} catch {
  usage('RELAY_URL is not a URL')
}

const from = opt.ref ? `git ${opt.ref}` : 'the working tree'
console.log(`relay-smoke: want build ${want} (server/ in ${from})`)

/** Ask /health until it reports `want`, or the wait runs out. Says what it saw each time. */
async function waitForBuild() {
  const end = Date.now() + opt.wait * 1000
  let last = ''
  for (;;) {
    const left = Math.max(1000, end - Date.now())
    let seen
    try {
      const r = await fetch(`${origin.http}/health`, {
        signal: AbortSignal.timeout(Math.min(15_000, left)),
      })
      const body = await r.json().catch(() => null)
      if (r.ok && body?.build === want) return { ok: true, seen: `build ${want}` }
      seen = !r.ok
        ? `HTTP ${r.status}`
        : typeof body?.build === 'string'
          ? `build ${body.build} — not this one yet (still the previous deploy?)`
          : 'an answer with no build in it — a relay from before the stamp existed'
    } catch (e) {
      seen =
        e?.name === 'TimeoutError'
          ? 'no answer in time — asleep, or still starting'
          : 'unreachable — asleep, restarting, or the wrong address'
    }
    if (seen !== last) console.log(`  /health: ${seen}`)
    last = seen
    if (Date.now() >= end) return { ok: false, seen }
    await sleep(3000)
  }
}

/** A park hello on a room nobody else is in, and the kinds of frame it hears, first-seen order. */
async function parkHello() {
  const expect = ['welcome', 'host', 'presence', 'settings']
  const s = openSocket(origin.ws, { ms: 15_000 })
  try {
    await s.opened
    s.send({ type: 'hello', room: `park:smoke-${randomBytes(6).toString('hex')}`, create: true })
    await until(() => expect.every((t) => s.inbox.some((f) => f?.type === t)), 10_000)
    /* a moment longer, so a frame that should not be there (an error, say) is seen too */
    await sleep(300)
    const seen = [...new Set(s.inbox.map((f) => f?.type))]
    return { ok: JSON.stringify(seen) === JSON.stringify(expect), seen }
  } catch (e) {
    return { ok: false, seen: [`no socket: ${e?.message}`] }
  } finally {
    s.close()
  }
}

const build = await waitForBuild()
if (!build.ok) {
  console.error(`FAIL: after ${opt.wait}s the relay is not running build ${want}: ${build.seen}`)
  process.exit(1)
}
console.log(`  /health: ${build.seen} — the relay is running this code`)
const park = await parkHello()
console.log(`  park hello: ${park.seen.join(', ') || 'nothing'}`)
if (!park.ok) {
  console.error('FAIL: a park hello should hear welcome, host, presence, settings — and only those')
  process.exit(1)
}
console.log('ok')
process.exit(0)
