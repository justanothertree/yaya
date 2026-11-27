/**
 * After a relay deploy: is the relay serving the code that was merged, and does it still work?
 *
 *   node scripts/relay-smoke.mjs --stamp [--ref <rev>]
 *     prints the build stamp of server/ — the working tree's, or a git revision's
 *
 *   RELAY_URL=<the relay's address> node scripts/relay-smoke.mjs [--ref <rev>] [--wait <seconds>]
 *     waits for /health to report that stamp, then sends a park hello and checks what comes back;
 *     and, if that build has a Lab table door, knocks on one table without a token
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
 *
 * ⚠️ SO IS THE LAB TABLE, AND IT ASKS THE DOOR TO REFUSE IT. A fresh random code, no token: the
 * socket must hear its `welcome` and nothing else, `list` must not show the table, and at the
 * silent-socket timer the door must say its sentence and close. That sentence is in this build's
 * labDoor.mjs and in no older relay, so hearing it is the deployment speaking — the same move as
 * asking an edge function to refuse you (CLAUDE.md §2). It takes the timer's twelve seconds.
 *
 * ⚠️ BEHIND RENDER THE CLOSE IS A WARNING, AND NOTHING ELSE IS. Render's proxy drops the relay's
 * close frame, so there the step passes on the door's exact sentence arriving on its timer, and a
 * missing close is printed as a WARN. Anywhere else — a relay on this machine — the close frame
 * is required. Which is which, and why, is in relay-smoke-lab.mjs, where a test can ask it.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { serverFiles, stampOf, stamped } from '../server/lib/buildStamp.mjs'
import { LAB, SAY } from '../server/lib/labDoor.mjs'
import { openSocket, sleep, until } from './relay-harness.mjs'
import {
  CLOSE_GRACE_MS,
  ON_TIME,
  closeVerdict,
  refusalOnTime,
  viaRender,
} from './relay-smoke-lab.mjs'

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

/**
 * The stamp of server/ on disk, or at a git revision — the same files, by the same rule — and
 * the names of those files, which say what that build should be able to do.
 */
function buildAt(ref) {
  if (!ref) {
    const files = serverFiles(SERVER)
    return { stamp: stampOf(files), names: files.map((f) => f.name) }
  }
  const git = (...a) =>
    execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const names = git('ls-tree', '-r', '--name-only', ref, '--', 'server/')
    .split('\n')
    .filter(Boolean)
    .map((p) => p.slice('server/'.length))
    .filter(stamped)
  if (!names.includes('ws-server.js')) usage(`no server/ws-server.js at ${ref}`)
  const files = names.map((name) => ({ name, text: git('show', `${ref}:server/${name}`) }))
  return { stamp: stampOf(files), names }
}

const target = buildAt(opt.ref)
const want = target.stamp
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
      if (r.ok && body?.build === want)
        return { ok: true, seen: `build ${want}`, behindRender: viaRender(r.headers) }
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

/**
 * A Lab table nobody was sent, knocked on without a token: what the socket hears, whether `list`
 * shows it, and whether the door then refuses it in its own words, on its timer, and closes.
 * `behindRender` decides only what a missing close frame is (see relay-smoke-lab.mjs).
 */
async function labKnock(behindRender) {
  const room = `lab:${randomBytes(16).toString('base64url')}`
  const s = openSocket(origin.ws, { ms: 15_000 })
  const lister = openSocket(origin.ws, { ms: 15_000 })
  /* when each frame arrived, index for index with s.inbox (openSocket's listener runs first), and
     how the socket ended — what the harness does not keep */
  const heardAt = []
  let ended = null
  s.ws.on('message', () => heardAt.push(performance.now()))
  s.ws.once('close', (code) => (ended = { code, at: performance.now() }))
  const fail = (why) => ({ ok: false, why })
  try {
    await s.opened
    s.send({ type: 'hello', room, create: true })
    await until(() => s.inbox.length > 0, 10_000)
    await sleep(300)
    const first = s.inbox.map((f) => f?.type)
    if (JSON.stringify(first) !== '["welcome"]')
      return fail(`a Lab hello heard ${first.join(', ') || 'nothing'}, not welcome alone`)
    await lister.opened
    lister.send({ type: 'list' })
    await until(() => lister.inbox.some((f) => f?.type === 'rooms'), 10_000)
    const rooms = lister.inbox.find((f) => f?.type === 'rooms')?.items
    if (!Array.isArray(rooms)) return fail('list did not answer')
    if (rooms.some((r) => String(r?.id).startsWith('lab:'))) return fail('list shows a Lab table')
    /* the sentence, or the end of the socket, or the end of the latest time it may come */
    const deadline = heardAt[0] + LAB.vouchMs + ON_TIME.lateMs + 1000
    await until(
      () => s.inbox.length > 1 || ended !== null,
      Math.max(0, deadline - performance.now()),
    )
    /* then the close, which the relay sends in the same breath */
    if (s.inbox.length > 1)
      await until(
        () => ended !== null,
        Math.max(0, heardAt[1] + CLOSE_GRACE_MS - performance.now()),
      )
    const said = s.inbox.slice(1)
    const want = [{ type: 'error', code: 'members-only', message: SAY['members-only'] }]
    if (JSON.stringify(said) !== JSON.stringify(want))
      return fail(
        `at the timer it heard ${JSON.stringify(said)}${ended ? `, then a ${ended.code} close` : ''}`,
      )
    const timing = refusalOnTime(heardAt[1] - heardAt[0], LAB.vouchMs)
    if (!timing.ok) return fail(timing.why)
    const close = ended && ended.at - heardAt[1] <= CLOSE_GRACE_MS ? { code: ended.code } : null
    const closing = closeVerdict(close, behindRender)
    if (!closing.ok) return fail(`${timing.why}, but ${closing.why}`)
    return {
      ok: true,
      why: `welcome alone, not listed, ${timing.why}, ${closing.why}`,
      warn: closing.warn,
    }
  } catch (e) {
    return fail(`no socket: ${e?.message}`)
  } finally {
    s.close()
    lister.close()
  }
}

const build = await waitForBuild()
if (!build.ok) {
  console.error(`FAIL: after ${opt.wait}s the relay is not running build ${want}: ${build.seen}`)
  process.exit(1)
}
console.log(
  `  /health: ${build.seen} — the relay is running this code` +
    (build.behindRender ? ', behind Render’s proxy' : ', with no Render proxy in front of it'),
)
const warnings = []
const park = await parkHello()
console.log(`  park hello: ${park.seen.join(', ') || 'nothing'}`)
if (!park.ok) {
  console.error('FAIL: a park hello should hear welcome, host, presence, settings — and only those')
  process.exit(1)
}
if (target.names.includes('lib/labDoor.mjs')) {
  console.log(`  lab table: knocking without a token (about ${LAB.vouchMs / 1000} s)…`)
  const lab = await labKnock(build.behindRender)
  console.log(`  lab table: ${lab.why}`)
  if (!lab.ok) {
    console.error('FAIL: a Lab table must say nothing but welcome to a stranger, then refuse it')
    process.exit(1)
  }
  if (lab.warn) {
    warnings.push(lab.warn)
    console.warn(`  WARN: lab table: ${lab.warn}`)
  }
}
console.log(
  warnings.length ? `ok, with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : 'ok',
)
process.exit(0)
