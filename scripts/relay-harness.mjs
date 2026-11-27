/**
 * The real relay, run as a process and talked to over a real socket — for tests and the smoke.
 *
 * ⚠️ NOT A DOUBLE. scripts/park-stub-relay.mjs stands in for the relay; this STARTS it, the same
 * `server/ws-server.js` Render runs, so what a test hears is what a browser would hear. The relay
 * opens a listening socket at import, which is why nothing could ask it about its frames before:
 * the only way to the real answer is a real process.
 *
 * ⚠️ AND IT MUST NEVER OUTLIVE THE TEST THAT STARTED IT. `stop()` is the ordinary way out. The
 * backstop is the preload below: it ends the relay when its stdin closes, which happens however
 * the parent goes — a vitest worker killed at a timeout or by a ctrl-C runs no `afterAll`, and
 * a relay left behind holds a port and answers the next run's questions with the last run's
 * rooms.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const RELAY = fileURLToPath(new URL('../server/ws-server.js', import.meta.url))
/** the doorless double — started only by its own test, and only with PARK_STUB_RELAY=yes */
export const STUB = fileURLToPath(new URL('./park-stub-relay.mjs', import.meta.url))
const GUARD =
  "data:text/javascript,process.stdin.on('end',()=>process.exit(0));" +
  "process.stdin.on('close',()=>process.exit(0));process.stdin.resume()"

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Resolves true once `cond()` holds, or false at `ms`. Never throws, never waits longer. */
export async function until(cond, ms, every = 10) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await sleep(every)
  }
  return cond()
}

/**
 * Start the relay on a port the OS picks, and say which. `script` is the relay unless a test
 * says otherwise (the stub's own test passes STUB).
 *
 * ⚠️ THE ENVIRONMENT IS BUILT, NOT INHERITED. A shell with SUPABASE_URL in it, or a CI secret,
 * would otherwise turn "the relay with no Supabase" into the relay with whatever this machine
 * has — and the frames a socket hears depend on that. Only PATH is passed through.
 */
export async function startRelay(env = {}, { bootMs = 10_000, script = RELAY } = {}) {
  const child = spawn(process.execPath, ['--import', GUARD, script], {
    env: {
      PATH: process.env.PATH ?? '',
      PORT: '0',
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  /* both streams are read for the whole life of the process: an unread pipe fills, and a relay
     blocked writing a log line answers nothing */
  let log = ''
  const keep = (d) => {
    log = (log + String(d)).slice(-8000)
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  let exited = false
  child.on('exit', () => {
    exited = true
  })
  const listening = () => /listening on :(\d+)/.exec(log)?.[1]
  const up = await until(() => !!listening() || exited, bootMs)
  if (!up || !listening()) {
    child.kill('SIGKILL')
    throw new Error(`the relay did not start within ${bootMs}ms:\n${log}`)
  }
  const port = Number(listening())
  return {
    port,
    url: `ws://127.0.0.1:${port}`,
    http: `http://127.0.0.1:${port}`,
    log: () => log,
    async stop() {
      if (exited) return
      child.kill('SIGTERM')
      if (!(await until(() => exited, 3000))) child.kill('SIGKILL')
      await until(() => exited, 2000)
    },
  }
}

/**
 * A socket that keeps every frame it is sent, in order, as parsed JSON.
 *
 * `inbox` is the record; tests empty it between steps. `opened` settles when the socket is open
 * or has failed, within `ms`.
 */
export function openSocket(url, { ms = 10_000 } = {}) {
  const ws = new WebSocket(url)
  const inbox = []
  ws.on('message', (data) => {
    try {
      inbox.push(JSON.parse(String(data)))
    } catch {
      inbox.push({ unparsed: String(data) })
    }
  })
  /* a refused or reset socket reports here; without a listener `ws` rethrows it into the test */
  ws.on('error', () => {})
  const opened = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no open within ${ms}ms`)), ms)
    ws.once('open', () => {
      clearTimeout(t)
      resolve()
    })
    ws.once('close', () => {
      clearTimeout(t)
      reject(new Error('closed before it opened'))
    })
  })
  return {
    ws,
    inbox,
    opened,
    send: (o) => ws.send(JSON.stringify(o)),
    close: () => ws.close(),
  }
}
