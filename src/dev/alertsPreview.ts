import {
  KINDS,
  makeAlerts,
  urlBase64ToUint8Array,
  type AlertsApi,
  type Browser,
  type Env,
  type Prefs,
  type Reg,
  type Rpc,
  type Sub,
} from '../notify/phoneAlerts'

/**
 * ── DEV-ONLY stand-in for 📱 Phone alerts ──────────────────────────────────────
 *
 * The card renders nothing while `VAPID_PUBLIC_KEY` is empty, which every build was until the
 * secret step — and with it filled in, the real card needs a session and a push service the pane
 * does not have. So without this the pane could never draw it, and its phone layout would ship on
 * reasoning alone. Under the previewMember harness the card takes this instead: the REAL
 * `makeAlerts`, handed a fake key, a fake browser (no worker is registered, no push service is
 * asked) and a fake server that keeps prefs and devices in memory.
 *
 * ⚠️ REACHED ONLY THROUGH A DYNAMIC IMPORT BEHIND `import.meta.env.DEV`, so production never
 * emits this module — see PhoneAlertsCard's `useAlertsApi`. And everything lives inside the one
 * exported function: CLAUDE.md records a module-scope call keeping a harness file in the bundle,
 * and a const reachable across a chunk boundary shipping whatever it held. Checked after
 * `npm run build` by grepping `dist/` for `push.invalid`, which only this file says.
 *
 * Other states, set before a reload (the harness reads it once):
 *   localStorage.setItem('dev_alerts', 'not-yet')     every RPC answers "no such function"
 *   localStorage.setItem('dev_alerts', 'blocked')     the browser has notifications blocked
 *   localStorage.setItem('dev_alerts', 'install')     Safari on an iPhone, in a tab
 *   localStorage.setItem('dev_alerts', 'flaky')       every save fails
 *   localStorage.setItem('dev_alerts', 'elsewhere')   this browser is subscribed, on another
 *                                                     member's account: the switch reads off
 */
export function alertsStandIn(): AlertsApi {
  const mode = window.localStorage.getItem('dev_alerts') ?? ''
  const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

  /* NOT A KEY: 0x04 and 64 bytes of 0x2a, the shape of an uncompressed P-256 point and nothing
     more. Nothing here ever reaches a push service, so it only has to decode. */
  const fakeKey = 'BCoq' + 'Kioq'.repeat(20) + 'Kio'
  const keyBytes = urlBase64ToUint8Array(fakeKey)

  const env: Env =
    mode === 'install'
      ? { serviceWorker: true, pushManager: false, notification: false, standalone: false }
      : { serviceWorker: true, pushManager: true, notification: true, standalone: undefined }
  let permission: NotificationPermission =
    mode === 'blocked' ? 'denied' : mode === 'elsewhere' ? 'granted' : 'default'
  let registered = mode === 'elsewhere'
  let current: Sub | null = null

  const endpoint = 'https://push.invalid/alerts-stand-in/this-device'
  const subscription = (): Sub => {
    const s: Sub = {
      endpoint,
      options: { applicationServerKey: keyBytes.slice().buffer },
      toJSON: () => ({ endpoint, keys: { p256dh: 'stand-in', auth: 'stand-in' } }),
      unsubscribe: async () => {
        if (current === s) current = null
        return true
      },
    }
    return s
  }
  /* 'elsewhere': the browser already holds a subscription under this key, which the account
     below does not list — what a shared browser looks like to the next member to sign in */
  if (mode === 'elsewhere') current = subscription()

  const reg: Reg = {
    pushManager: {
      getSubscription: async () => current,
      subscribe: async () => {
        await wait(250)
        current = subscription()
        return current
      },
    },
  }

  const browser: Browser = {
    env: () => env,
    permission: () => permission,
    askPermission: async () => {
      await wait(250)
      if (permission === 'default') permission = 'granted'
      return permission
    },
    existing: async () => (registered ? reg : null),
    register: async () => {
      registered = true
      return reg
    },
    hints: async () => ({ ua: navigator.userAgent }),
  }

  /* the server, in memory. Its defaults are the plan's: every kind on until turned off. Its
     refusals are the real one's, code and status, as PostgREST hands them to supabase-js. */
  const prefs = Object.fromEntries(KINDS.map(({ kind }) => [kind, true])) as Prefs
  const devices = new Map<string, { id: string; label: string; created_at: string }>()
  let lastTest = -Infinity
  const rpc: Rpc = async (fn, args = {}) => {
    await wait(300)
    if (mode === 'not-yet') {
      return {
        data: null,
        error: { code: 'PGRST202', message: `Could not find the function public.${fn}` },
        status: 404,
      }
    }
    /* the saves fail; the two reads still answer, so the card gets as far as its switches */
    if (mode === 'flaky' && fn !== 'push_prefs_get' && fn !== 'push_devices_mine') {
      return { data: null, error: { code: 'XX000', message: 'stand-in failure' }, status: 500 }
    }
    switch (fn) {
      case 'push_prefs_get':
        return { data: { ...prefs }, error: null }
      case 'push_prefs_set':
        /* null and absent leave a kind alone, as the real function must */
        for (const { kind } of KINDS) {
          const v = args['p_' + kind]
          if (typeof v === 'boolean') prefs[kind] = v
        }
        return { data: { ...prefs }, error: null }
      case 'push_device_add': {
        /* one row per endpoint, as `on conflict (endpoint)` keeps it */
        const e = String(args.p_endpoint)
        const had = devices.get(e)
        const d = {
          id: had?.id ?? `pv-device-${devices.size + 1}`,
          label: String(args.p_label ?? had?.label ?? ''),
          created_at: had?.created_at ?? new Date().toISOString(),
        }
        devices.set(e, d)
        return { data: d.id, error: null }
      }
      case 'push_device_remove':
        return { data: devices.delete(String(args.p_endpoint)), error: null }
      case 'push_devices_mine':
        return {
          data: [...devices].map(([e, d]) => ({ ...d, endpoint: e, last_ok_at: null })),
          error: null,
        }
      case 'push_test':
        /* in the real one's order: no device first, then the minute */
        if (devices.size === 0) {
          return {
            data: null,
            error: { code: 'P0002', message: 'alerts are not on for any device' },
            status: 500,
          }
        }
        if (Date.now() - lastTest < 60_000) {
          return { data: null, error: { code: 'PT429', message: 'one test a minute' }, status: 429 }
        }
        lastTest = Date.now()
        return { data: devices.size, error: null }
    }
    return { data: null, error: { code: 'PGRST202', message: fn }, status: 404 }
  }

  return makeAlerts(fakeKey, rpc, browser)
}
