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
 * The card renders nothing while `VAPID_PUBLIC_KEY` is empty, which is every build until the
 * secret step — so without this the pane could never draw it, and its phone layout would ship on
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
 *   localStorage.setItem('dev_alerts', 'not-yet')   every RPC answers "no such function"
 *   localStorage.setItem('dev_alerts', 'blocked')   the browser has notifications blocked
 *   localStorage.setItem('dev_alerts', 'install')   Safari on an iPhone, in a tab
 *   localStorage.setItem('dev_alerts', 'flaky')     every save fails
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
  let permission: NotificationPermission = mode === 'blocked' ? 'denied' : 'default'
  let registered = false
  let current: Sub | null = null

  const endpoint = 'https://push.invalid/alerts-stand-in/this-device'
  const reg: Reg = {
    pushManager: {
      getSubscription: async () => current,
      subscribe: async () => {
        await wait(250)
        const s: Sub = {
          endpoint,
          options: { applicationServerKey: keyBytes.slice().buffer },
          toJSON: () => ({ endpoint, keys: { p256dh: 'stand-in', auth: 'stand-in' } }),
          unsubscribe: async () => {
            current = null
            return true
          },
        }
        current = s
        return s
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

  /* the server, in memory. Its defaults are the plan's: every kind on until turned off. */
  const prefs = Object.fromEntries(KINDS.map(({ kind }) => [kind, true])) as Prefs
  const devices = new Set<string>()
  const rpc: Rpc = async (fn, args = {}) => {
    await wait(300)
    if (mode === 'not-yet') {
      return {
        data: null,
        error: { code: 'PGRST202', message: `Could not find the function public.${fn}` },
        status: 404,
      }
    }
    if (mode === 'flaky' && fn !== 'push_prefs_get') {
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
      case 'push_device_add':
        devices.add(String(args.p_endpoint))
        return { data: null, error: null }
      case 'push_device_remove':
        devices.delete(String(args.p_endpoint))
        return { data: null, error: null }
      case 'push_test':
        return { data: devices.size, error: null }
    }
    return { data: null, error: { code: 'PGRST202', message: fn }, status: 404 }
  }

  return makeAlerts(fakeKey, rpc, browser)
}
