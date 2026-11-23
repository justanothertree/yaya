/**
 * The Lab table's door, asked through the REAL path: the real relay (server/ws-server.js, run as
 * a process), a real local Supabase — GoTrue issues every session, PostgREST runs `is_suspended`
 * and `are_friends` as that member — and real sockets. Nothing stands in for either side.
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=… \
 *     LAB_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     node scripts/lab-door-probe.mjs [--then-stopped]
 *
 * ⚠️ LOCAL ONLY, AND IT SAYS SO BEFORE IT DOES ANYTHING. It signs four people up, gives them a
 * profile, makes two of them friends of a third and suspends the fourth — all with psql, on the
 * database at LAB_TEST_DB_URL — so it refuses any address that is not this machine. Run it
 * against `supabase start` on a scratch COPY of supabase/ (docs/2026-11-07-lab-catalog-and-
 * feedback.md has the commands). It removes what it made before it finishes, pass or fail.
 *
 * The cast: Ann, Bo, Cy and Dee. Ann–Bo and Ann–Cy are friends; Bo and Cy are not. Dee is
 * suspended. Eve is nobody's friend.
 *
 * ⚠️ `--then-stopped` ENDS WITH SUPABASE GONE. After everything else it prints a line asking for
 * the local stack to be stopped (`supabase stop`), waits until it stops answering, and then asks
 * the relay to let somebody in. The answer must be door-unavailable — and the person asking is
 * Eve, who really is not Ann's friend, so a door that read "could not ask" as "no" would say
 * not-friends to her and be caught. Her token and standing were checked a moment before, so
 * while the relay still remembers them (a minute) the question that fails is the friends one.
 *
 * ⚠️ ONE CASE GOES THROUGH A DELAY, AND ONLY A DELAY. The silent-socket timer must not close a
 * socket whose check is still running. A friends answer cannot be held past the timer — the
 * relay gives up on any fetch at eight seconds, which would make the case a door-unavailable
 * one — so the hold is on the token and the standing instead, seven seconds each, by a proxy that
 * forwards every byte to the real stack and only waits first. That case has its own relay.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, request } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import { LAB, SAY } from '../server/lib/labDoor.mjs'
import { openSocket, sleep, startRelay, until } from './relay-harness.mjs'

const URL_ = process.env.SUPABASE_URL ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
const DB = process.env.LAB_TEST_DB_URL ?? ''
const THEN_STOPPED = process.argv.includes('--then-stopped')
const local = (u) => /^(https?|postgresql):\/\/([^@/]*@)?(127\.0\.0\.1|localhost)[:/]/.test(u)
if (!local(URL_) || !local(DB) || !ANON) {
  console.error(
    'refusing: SUPABASE_URL and LAB_TEST_DB_URL must both be this machine, and SUPABASE_ANON_KEY set',
  )
  process.exit(2)
}

const sql = (text) =>
  execFileSync('psql', [DB, '-qXAt', '-v', 'ON_ERROR_STOP=1', '-c', text], {
    encoding: 'utf8',
  }).trim()
if (sql(`select to_regprocedure('public.are_friends(uuid,uuid)') is not null`) !== 't') {
  console.error('refusing: this database has no are_friends')
  process.exit(2)
}

const run = Date.now().toString(36)
const results = []
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail })
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${cond || !detail ? '' : ` — ${detail}`}`)
}
const client = () =>
  createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const made = []

async function member(key) {
  const email = `lab-door-${key}-${run}@example.test`
  const password = `pw-${run}-${key}-x9`
  const { data, error } = await client().auth.signUp({ email, password })
  if (error || !data.session)
    throw new Error(`sign-up for ${key} gave no session: ${error?.message}`)
  const id = data.user.id
  made.push(id)
  const name = `ld${key}${run}`.slice(0, 30)
  sql(`insert into public.player_registry (player_name) values ('${name}');
       insert into public.profiles (user_id, username) values ('${id}', '${name}')`)
  /* a second, separate session: a different token for the same person */
  const again = async () => {
    const r = await client().auth.signInWithPassword({ email, password })
    if (r.error || !r.data.session) throw new Error(`sign-in for ${key}: ${r.error?.message}`)
    return r.data.session.access_token
  }
  return { key, id, token: data.session.access_token, again }
}
const befriend = (a, b) =>
  sql(`insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
       values (least('${a.id}'::uuid, '${b.id}'::uuid), greatest('${a.id}'::uuid, '${b.id}'::uuid), '${a.id}', 'accepted', now())`)
function cleanUp() {
  if (!made.length) return
  const ids = made.map((id) => `'${id}'`).join(',')
  sql(`delete from public.friendships where user_a in (${ids}) or user_b in (${ids});
       delete from public.profiles where user_id in (${ids});
       delete from public.player_registry where player_name like 'ld%${run}';
       delete from auth.users where id in (${ids})`)
  made.length = 0
}

/**
 * The delay: a transparent proxy to the stack that holds `/auth/v1/user` and `is_suspended` for
 * one token — the slow one — and forwards everything else untouched, both ways.
 */
let slowToken = null
const HOLD_MS = 7000
const target = new URL(URL_)
const proxy = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    const path = (req.url || '').split('?')[0]
    const auth = req.headers.authorization || ''
    if (
      slowToken &&
      auth === `Bearer ${slowToken}` &&
      (path === '/auth/v1/user' || path === '/rest/v1/rpc/is_suspended')
    )
      await sleep(HOLD_MS)
    const up = request(
      {
        host: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: target.host },
      },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers)
        r.pipe(res)
      },
    )
    up.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    up.end(Buffer.concat(chunks))
  })
})

const table = () => `lab:${randomBytes(16).toString('base64url')}`
const socks = []
function connect(relay) {
  const s = openSocket(relay.url)
  socks.push(s)
  return s
}
async function arrive(relay, room, token) {
  const s = connect(relay)
  await s.opened
  s.send({ type: 'hello', room })
  await until(() => s.inbox.some((f) => f.type === 'welcome'), 5000)
  s.id = s.inbox.find((f) => f.type === 'welcome')?.id
  s.inbox.length = 0
  if (token) s.send({ type: 'auth', token })
  return s
}
const answered = (s, ms = 10_000) =>
  until(() => s.inbox.some((f) => f.type === 'labin' || f.type === 'error'), ms)
const verdict = (s) => {
  const f = s.inbox.find((x) => x.type === 'labin' || x.type === 'error')
  return f ? (f.type === 'labin' ? 'in' : f.code) : 'nothing'
}
const isClosed = (s) => s.ws.readyState === WebSocket.CLOSED
const words = (s, code) =>
  JSON.stringify(s.inbox.filter((f) => f.type === 'error')) ===
  JSON.stringify([{ type: 'error', code, message: SAY[code] }])

const relayEnv = (url) => ({
  SUPABASE_URL: url,
  SUPABASE_ANON_KEY: ANON,
  CONN_BURST: '100000',
  CONN_BURST_GLOBAL: '100000',
})

let relay
let slowRelay
try {
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
  relay = await startRelay(relayEnv(URL_))
  slowRelay = await startRelay(relayEnv(`http://127.0.0.1:${proxy.address().port}`))

  const ann = await member('ann')
  const bo = await member('bo')
  const cy = await member('cy')
  const dee = await member('dee')
  const eve = await member('eve')
  befriend(ann, bo)
  befriend(ann, cy)
  sql(`update public.profiles set suspended = true where user_id = '${dee.id}'`)
  ok(
    'every session was issued by GoTrue and is a JWT',
    [ann, bo, cy, dee, eve].every((m) => m.token.split('.').length === 3),
  )
  ok(
    'the database agrees with the cast: Ann–Bo and Ann–Cy friends, Bo–Cy not, Dee suspended',
    sql(`select string_agg(x::text, ',') from (values
           ((select count(*) from public.friendships where status = 'accepted'
               and least('${bo.id}'::uuid,'${cy.id}'::uuid) = user_a
               and greatest('${bo.id}'::uuid,'${cy.id}'::uuid) = user_b)),
           ((select count(*) from public.friendships where status = 'accepted'
               and (user_a in ('${ann.id}') or user_b in ('${ann.id}')))),
           ((select count(*) from public.profiles where suspended and user_id = '${dee.id}'))) v(x)`) ===
      '0,2,1',
  )

  console.log('the race: Bo and Cy, who are not friends, arrive together where Ann is')
  {
    const room = table()
    const a = await arrive(relay, room, ann.token)
    await answered(a)
    const [b, c] = await Promise.all([arrive(relay, room, bo.token), arrive(relay, room, cy.token)])
    await answered(b)
    await answered(c)
    const v = [verdict(b), verdict(c)].sort()
    ok('Ann alone is let in', verdict(a) === 'in')
    ok(
      'exactly one of Bo and Cy is let in, and the other is told not-friends',
      JSON.stringify(v) === '["in","not-friends"]',
      v.join(', '),
    )
    for (const s of [a, b, c]) s.close()
  }

  console.log('friends meet; a stranger to one of them is refused; two tabs; `to`')
  const room = table()
  const a1 = await arrive(relay, room, ann.token)
  await answered(a1)
  const b1 = await arrive(relay, room, bo.token)
  await answered(b1)
  ok('Ann and Bo are both let in', verdict(a1) === 'in' && verdict(b1) === 'in')
  ok(
    'Bo is told Ann is here, by her account id',
    JSON.stringify(b1.inbox.find((f) => f.type === 'labin')?.who) ===
      JSON.stringify([{ from: a1.id, uid: ann.id }]),
  )
  await until(() => a1.inbox.some((f) => f.type === 'lab-here'), 5000)
  ok(
    'Ann is told Bo arrived',
    a1.inbox.some((f) => f.type === 'lab-here' && f.from === b1.id && f.uid === bo.id),
  )
  a1.inbox.length = 0
  b1.inbox.length = 0
  a1.send({ type: 'lab', d: 'from ann' })
  b1.send({ type: 'lab', d: 'from bo' })
  await until(
    () => a1.inbox.some((f) => f.type === 'lab') && b1.inbox.some((f) => f.type === 'lab'),
    5000,
  )
  ok(
    "each gets the other's lab, with the relay's from and uid",
    JSON.stringify(b1.inbox.filter((f) => f.type === 'lab')) ===
      JSON.stringify([{ type: 'lab', from: a1.id, uid: ann.id, d: 'from ann' }]) &&
      JSON.stringify(a1.inbox.filter((f) => f.type === 'lab')) ===
        JSON.stringify([{ type: 'lab', from: b1.id, uid: bo.id, d: 'from bo' }]),
  )

  a1.inbox.length = 0
  b1.inbox.length = 0
  const c1 = await arrive(relay, room, cy.token)
  await answered(c1)
  await until(() => isClosed(c1), 5000)
  ok(
    "Cy, Ann's friend but not Bo's, is refused not-friends while Bo is in",
    words(c1, 'not-friends'),
  )
  ok('and is closed', isClosed(c1))
  await sleep(200)
  ok('Ann and Bo hear nothing about it', a1.inbox.length === 0 && b1.inbox.length === 0)

  const a2 = await arrive(relay, room, await ann.again())
  await answered(a2)
  ok("Ann's second tab, with a second session, is let in", verdict(a2) === 'in')
  const b2 = await arrive(relay, room, await bo.again())
  await answered(b2)
  ok("Bo's second tab is let in", verdict(b2) === 'in')
  await sleep(200)
  for (const s of [a1, a2, b1, b2]) s.inbox.length = 0
  a1.send({ type: 'lab', d: 'for bo', to: bo.id })
  await until(() => [b1, b2].every((s) => s.inbox.some((f) => f.type === 'lab')), 5000)
  await sleep(200)
  ok(
    "`to` reaches both of Bo's sockets",
    [b1, b2].every(
      (s) =>
        JSON.stringify(s.inbox) ===
        JSON.stringify([{ type: 'lab', from: a1.id, uid: ann.id, d: 'for bo' }]),
    ),
  )
  ok("and nobody else — not Ann's other tab", a2.inbox.length === 0 && a1.inbox.length === 0)

  console.log('a suspended member')
  {
    const d = await arrive(relay, table(), dee.token)
    await answered(d)
    await until(() => isClosed(d), 5000)
    ok('Dee is told members-only, and closed', words(d, 'members-only') && isClosed(d))
    ok('and never hears the word suspended', !JSON.stringify(d.inbox).match(/suspend/i))
  }

  console.log(`the silent-socket timer, at its real ${LAB.vouchMs / 1000} s`)
  {
    const slow = await bo.again()
    slowToken = slow
    const r = table()
    const a = await arrive(slowRelay, r, ann.token)
    await answered(a)
    const t0 = Date.now()
    const [silent, held] = await Promise.all([arrive(slowRelay, r), arrive(slowRelay, r, slow)])
    await until(() => isClosed(silent), LAB.vouchMs + 3000)
    const closedAt = Date.now() - t0
    ok(
      `a socket that never sent auth is closed at the timer (${(closedAt / 1000).toFixed(1)} s)`,
      isClosed(silent) && closedAt >= LAB.vouchMs - 200 && closedAt < LAB.vouchMs + 2000,
    )
    ok('with the door’s sentence', words(silent, 'members-only'))
    ok(
      'a socket whose check is still running at the timer is not closed by it',
      !isClosed(held) && held.inbox.length === 0,
    )
    await answered(held, 2 * HOLD_MS + 5000)
    const inAt = Date.now() - t0
    ok(
      `and is let in when the answers arrive (${(inAt / 1000).toFixed(1)} s)`,
      verdict(held) === 'in' && inAt > LAB.vouchMs,
    )
    ok(
      'Ann heard about Bo, and nothing about the silent socket',
      JSON.stringify(a.inbox.map((f) => f.type)) === '["labin","lab-here"]',
    )
    slowToken = null
    for (const s of [a, held]) s.close()
  }

  /* for the stopped case: Ann waiting at a table, Eve's token and standing freshly checked, and a
     session nobody has shown the relay yet */
  let annWaiting
  let eveCheckedAt = 0
  let unseen
  let stopRoom
  if (THEN_STOPPED) {
    stopRoom = table()
    annWaiting = await arrive(relay, stopRoom, ann.token)
    await answered(annWaiting)
    ok('Ann waits at a table, let in', verdict(annWaiting) === 'in')
    annWaiting.inbox.length = 0
    const e = await arrive(relay, table(), eve.token)
    await answered(e)
    eveCheckedAt = Date.now()
    ok(
      'Eve, alone at a table of her own, is let in (her token and standing now remembered)',
      verdict(e) === 'in',
    )
    e.close()
    unseen = await cy.again()
  }

  cleanUp()

  if (THEN_STOPPED) {
    console.log('\nSTOP THE LOCAL SUPABASE NOW (supabase stop) — waiting for it to stop answering…')
    const gone = await (async () => {
      for (const end = Date.now() + 120_000; Date.now() < end; await sleep(500)) {
        try {
          await fetch(`${URL_}/auth/v1/health`, { signal: AbortSignal.timeout(1000) })
        } catch {
          return true
        }
      }
      return false
    })()
    ok('the local Supabase stopped answering', gone)
    const since = Math.round((Date.now() - eveCheckedAt) / 1000)
    const stage = since < 55 ? 'the friends question' : 'the token (the relay forgot her)'
    console.log(`  (${since} s after Eve was checked, so what fails for her is ${stage})`)
    const e = await arrive(relay, stopRoom, eve.token)
    await answered(e)
    await until(() => isClosed(e), 5000)
    ok(
      'Eve — not Ann’s friend — is told door-unavailable, never not-friends',
      words(e, 'door-unavailable') && isClosed(e),
      JSON.stringify(e.inbox),
    )
    const n = await arrive(relay, stopRoom, unseen)
    await answered(n)
    ok('a session the relay has never seen is door-unavailable too', words(n, 'door-unavailable'))
    await sleep(200)
    ok(
      'Ann, waiting at the table, heard nothing about either',
      annWaiting.inbox.length === 0,
      JSON.stringify(annWaiting.inbox),
    )
  }
} catch (err) {
  ok('the probe ran to the end', false, err?.message || String(err))
} finally {
  for (const s of socks) s.close()
  /* a no-op when it already ran; with the stack stopped early by a failure, it says so */
  try {
    cleanUp()
  } catch (err) {
    console.error('could not remove what this made:', err?.message)
  }
  await relay?.stop()
  await slowRelay?.stop()
  proxy.closeAllConnections()
  await new Promise((r) => proxy.close(r))
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length} of ${results.length} passed`)
process.exit(failed.length ? 1 : 0)
