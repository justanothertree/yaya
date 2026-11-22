/**
 * 📱 Phone alerts, the browser's half: whether this browser can take them, turning them on and off
 * for this device, and the member's choice of what to be told about.
 *
 * The server's half is three deny-all tables reached only through SECURITY DEFINER functions, an
 * outbox and a `push` edge function — docs/2026-11-22-phone-alerts.md. This file talks to it
 * through six RPCs and nothing else:
 *
 *   push_device_add(p_endpoint, p_p256dh, p_auth, p_label)   this device's subscription
 *   push_device_remove(p_endpoint)                            ...and taking it away
 *   push_devices_mine()                                       [{ id, endpoint, label, created_at, last_ok_at }]
 *   push_prefs_get()                                          { ring, message, post, challenge, chronicle }
 *   push_prefs_set(p_ring?, p_message?, p_post?, p_challenge?, p_chronicle?)
 *   push_test()                                               queue a test alert to the member's devices
 *
 * ⚠️ IT SHIPS DARK. Until the VAPID key exists (src/notify/vapid.ts) `offer()` answers 'none',
 * the card renders nothing and signing out asks nothing; and until the migration is applied every
 * one of those RPCs answers "no such function", which `notYet` turns into "not switched on yet"
 * rather than an error.
 *
 * ⚠️ THE BROWSER AND THE SERVER ARE BOTH PASSED IN (`makeAlerts(key, rpc, browser)`), so the
 * order of a switch-on — permission, then subscribe, then save — can be asked in vitest with
 * fakes, and the Browser pane can draw the card through a stand-in (src/dev/alertsPreview.ts)
 * without a push service, a session or a key.
 */

/** What a member can switch on and off, in the order the card lists them. Keys are push_prefs' columns. */
export const KINDS = [
  { kind: 'ring', label: 'Calls' },
  { kind: 'message', label: 'Messages' },
  { kind: 'post', label: 'Posts on your things' },
  { kind: 'challenge', label: 'Game challenges' },
  { kind: 'chronicle', label: 'Chronicle' },
] as const

export type Kind = (typeof KINDS)[number]['kind']
export type Prefs = Record<Kind, boolean>

// ── what this browser can do ────────────────────────────────────────────────

/** The four facts support turns on, read once from the real browser by `readEnv`. */
export type Env = {
  serviceWorker: boolean
  pushManager: boolean
  notification: boolean
  /**
   * `navigator.standalone`, which only Safari on an iPhone or iPad defines: true in a web app
   * opened from the Home Screen, false in a tab, undefined everywhere else.
   */
  standalone: boolean | undefined
}

/**
 * - **'ok'**: this browser can subscribe. Chrome, Edge, Firefox and Samsung Internet on Android
 *   and desktop; Safari on a Mac; a Home Screen web app on iOS 16.4 or later.
 * - **'install'**: Safari on an iPhone or iPad, in a tab. iOS gives push only to a web app added to
 *   the Home Screen, so the useful answer is how to get there, not "unsupported". An iPhone on iOS
 *   before 16.4 lands here too and will find no switch once installed: a tab exposes nothing that
 *   tells the two apart short of parsing the version out of the user agent, and the advice is right
 *   for every iPhone that has had an update since March 2023.
 * - **'none'**: nothing to offer. An http origin (all three APIs need https), a private window with
 *   no service workers, an in-app browser, an old one — or iOS before 16.4, whose Home Screen app
 *   has no push either.
 */
export type Support = 'ok' | 'install' | 'none'

export function supportOf(e: Env): Support {
  if (e.serviceWorker && e.pushManager && e.notification) return 'ok'
  if (e.standalone === false && e.serviceWorker) return 'install'
  return 'none'
}

export function readEnv(): Env {
  if (typeof window === 'undefined') {
    return { serviceWorker: false, pushManager: false, notification: false, standalone: undefined }
  }
  return {
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    standalone: (navigator as Navigator & { standalone?: boolean }).standalone,
  }
}

// ── keys ────────────────────────────────────────────────────────────────────

/**
 * A base64url string (RFC 4648 §5, no padding — how a VAPID key is written) as bytes, which is
 * what `pushManager.subscribe` takes as `applicationServerKey`.
 */
export function urlBase64ToUint8Array(s: string): Uint8Array<ArrayBuffer> {
  /* ⚠️ THE WHATWG `atob` PADS FOR ITSELF, SO THE ONLY TEST THAT SEES THIS LINE BRINGS ITS OWN
     DECODER. Deleting it left every test written against Node's `atob` green, which is the
     forgiving one. It stays because this is the one string every browser's subscribe depends on,
     an 87-character key needs one `=` under a strict decoder, and whether every engine is the
     forgiving kind is a claim about browsers this repository cannot run (CLAUDE.md §6). */
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * Was this subscription made with this key?
 *
 * ⚠️ A SUBSCRIPTION OUTLIVES ITS KEY. If the key pair is ever replaced, a phone still holds a
 * subscription the push service will only accept messages for under the OLD key — so it reads as
 * on and receives nothing. Asked here, a stale one counts as off, and turning on replaces it.
 */
export function sameKey(had: ArrayBuffer | null | undefined, want: Uint8Array): boolean {
  if (!had || had.byteLength !== want.length) return false
  const a = new Uint8Array(had)
  return a.every((b, i) => b === want[i])
}

// ── the device's name, as the member will see it in a list of devices ──────

export type Hints = {
  ua: string
  /** from navigator.userAgentData, where the browser has it (Chromium) */
  platform?: string
  model?: string
  brands?: readonly { brand: string }[]
}

/** user-agent-client-hint brands worth naming, as people say them */
const BRANDS: [RegExp, string][] = [
  [/^Google Chrome$/, 'Chrome'],
  [/^Microsoft Edge$/, 'Edge'],
  [/^Samsung Internet$/, 'Samsung Internet'],
  [/^Opera$/, 'Opera'],
  [/^Brave$/, 'Brave'],
]

/* ⚠️ ORDER MATTERS: every Chromium browser also says "Chrome/" and "Safari/", and Chrome on iOS
   says "Safari/" too, so the specific names are asked first */
const UA_BROWSERS: [RegExp, string][] = [
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/EdgA?\/|EdgiOS\//, 'Edge'],
  [/OPR\/|OPT\//, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/CriOS\/|Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

const UA_DEVICES: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/CrOS/, 'Chromebook'],
  [/Windows/, 'Windows'],
  [/Macintosh/, 'Mac'],
  [/Linux/, 'Linux'],
]

const PLATFORMS: Record<string, string> = {
  Android: 'Android',
  'Chrome OS': 'Chromebook',
  ChromeOS: 'Chromebook',
  Windows: 'Windows',
  macOS: 'Mac',
  Linux: 'Linux',
  iOS: 'iPhone',
}

/**
 * "Pixel 7, Chrome" — what this device is called in the member's list of devices.
 *
 * ⚠️ THE MODEL COMES ONLY FROM CLIENT HINTS. Chrome's reduced user-agent string says `Android 10; K`
 * on every Android phone, so the "K" is not a model and is not shown; without hints the label
 * falls back to the platform, which is less specific and still true.
 */
export function deviceLabel(h: Hints): string {
  const brand = h.brands
    ?.map((b) => BRANDS.find(([re]) => re.test(b.brand))?.[1])
    .find((x): x is string => !!x)
  const browser = brand ?? UA_BROWSERS.find(([re]) => re.test(h.ua))?.[1]
  const model = h.model?.trim()
  const device =
    (model && model !== 'K' ? model : undefined) ??
    (h.platform ? PLATFORMS[h.platform] : undefined) ??
    UA_DEVICES.find(([re]) => re.test(h.ua))?.[1]
  return [device, browser].filter(Boolean).join(', ').slice(0, 60) || 'A browser'
}

type UAData = {
  platform?: string
  brands?: readonly { brand: string }[]
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }>
}

async function readHints(): Promise<Hints> {
  const d = (navigator as Navigator & { userAgentData?: UAData }).userAgentData
  let model: string | undefined
  try {
    model = (await d?.getHighEntropyValues?.(['model']))?.model
  } catch {
    /* refused or unsupported: the label is a courtesy, and the platform will do */
  }
  return { ua: navigator.userAgent, platform: d?.platform, brands: d?.brands, model }
}

// ── the server ──────────────────────────────────────────────────────────────

export type RpcError = { code?: string; message?: string }
export type RpcAnswer = { data: unknown; error: RpcError | null; status?: number }
export type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<RpcAnswer>

/**
 * Does this refusal mean the server has no such function yet?
 *
 * PGRST202 is PostgREST's "could not find the function" (sent as a 404), 42883 is Postgres's own
 * undefined_function, and a bare 404 covers a gateway that answers before PostgREST does. All
 * three mean the migration has not been applied — "not switched on yet", not "something broke".
 */
export function notYet(error: RpcError | null | undefined, status?: number): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || error.code === '42883' || status === 404
}

/**
 * push_prefs_get's answer, whatever shape PostgREST gave it — one object, or a one-row array.
 *
 * ⚠️ A MISSING ROW OR COLUMN IS ON, because that is the server's default: the plan's "the
 * defaults are on, because the member opted in by turning alerts on at all". Only an explicit
 * false is off — so a kind added to the table later reads as on until somebody turns it off,
 * which is also what the server will do with it.
 */
export function prefsOf(data: unknown): Prefs {
  const row = (Array.isArray(data) ? data[0] : data) as Partial<Record<Kind, unknown>> | null
  const out = {} as Prefs
  for (const { kind } of KINDS) out[kind] = !(row && row[kind] === false)
  return out
}

/**
 * Does push_devices_mine's answer hold this endpoint? Anything that is not its list of rows —
 * null, an error body, a row without an endpoint — holds nothing, so the switch reads off.
 */
export function listsEndpoint(data: unknown, endpoint: string): boolean {
  return (
    Array.isArray(data) &&
    data.some((d: unknown) => !!d && (d as { endpoint?: unknown }).endpoint === endpoint)
  )
}

/**
 * What a refusal means to this page.
 *
 * - **'not-yet'**: no such function — see `notYet`.
 * - **'no-device'**: P0002, which only push_test raises: no live device on the account.
 * - **'too-soon'**: push_test's one-a-minute limit. Raised as SQLSTATE PT429, which PostgREST
 *   turns into HTTP 429; either half is enough, since which one survives the trip is PostgREST's
 *   business and not this file's.
 */
export type Refusal = 'not-yet' | 'no-device' | 'too-soon' | 'failed'

export function refusalOf(error: RpcError, status?: number): Refusal {
  if (notYet(error, status)) return 'not-yet'
  if (error.code === 'P0002') return 'no-device'
  if (error.code === 'PT429' || status === 429) return 'too-soon'
  return 'failed'
}

// ── switching it on and off ─────────────────────────────────────────────────

/** the parts of a PushSubscription this file uses, so a test can build one */
export type Sub = {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer | null }
  toJSON(): { endpoint?: string; keys?: Record<string, string> }
  unsubscribe(): Promise<boolean>
}

/** the parts of a ServiceWorkerRegistration this file uses */
export type Reg = {
  pushManager: {
    getSubscription(): Promise<Sub | null>
    subscribe(options: {
      userVisibleOnly: boolean
      applicationServerKey: Uint8Array<ArrayBuffer>
    }): Promise<Sub>
  }
}

export type Browser = {
  env(): Env
  permission(): NotificationPermission | 'unsupported'
  askPermission(): Promise<NotificationPermission>
  /** this site's worker registration if it has one — never registers */
  existing(): Promise<Reg | null>
  /** register /sw.js for the whole site, and wait until it is active, which subscribe needs */
  register(): Promise<Reg>
  hints(): Promise<Hints>
}

export type Outcome =
  | { ok: true; devices?: number }
  | { ok: false; why: Refusal | 'denied'; message?: string }

export type AlertsApi = {
  /** whether to offer alerts at all — 'none' while there is no key, whatever the browser */
  offer(): Support
  permission(): NotificationPermission | 'unsupported'
  /** is THIS device subscribed, with the current key, AND on the signed-in member's account */
  onHere(): Promise<boolean>
  enable(): Promise<Outcome>
  disable(): Promise<Outcome>
  prefs(): Promise<Prefs | 'not-yet' | 'failed'>
  setPref(kind: Kind, on: boolean): Promise<Outcome>
  sendTest(): Promise<Outcome>
  /**
   * For signing out: take this browser off the account and unsubscribe it. Never rejects, and
   * resolves within `ms` whatever the network is doing.
   */
  forgetHere(ms?: number): Promise<void>
}

/** what the card says after "Send a test" — here rather than in the card so a test can ask it */
export function testLine(r: Outcome): string {
  if (r.ok) return 'Test sent. It should arrive within a minute.'
  switch (r.why) {
    case 'no-device':
      return 'No device has alerts on.'
    case 'too-soon':
      return 'One test a minute; try again shortly.'
    case 'not-yet':
      return 'Not switched on yet.'
    default:
      return 'Couldn’t send. Try again.'
  }
}

/**
 * How long signing out waits for this browser's alerts to be taken off the account.
 *
 * ⚠️ A CAP, NOT A DELAY: the usual wait is one RPC, and this is only what a stalled network can
 * cost. It cannot be zero, because the call must leave while the session still has a token —
 * after `auth.signOut()` it would go out as anon and be refused.
 */
export const FORGET_WITHIN_MS = 1000

const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : 'unknown error'

export function makeAlerts(key: string, rpc: Rpc, browser: Browser): AlertsApi {
  const usable = () => !!key && supportOf(browser.env()) === 'ok'
  /* a plain boolean, not a type guard: "not ours" does not mean "not a subscription" */
  const ours = (s: Sub | null): boolean =>
    !!s && sameKey(s.options.applicationServerKey, urlBase64ToUint8Array(key))

  async function call(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ ok: true; data: unknown } | Extract<Outcome, { ok: false }>> {
    try {
      const { data, error, status } = await rpc(fn, args)
      if (!error) return { ok: true, data }
      return { ok: false, why: refusalOf(error, status), message: error.message }
    } catch (e) {
      return { ok: false, why: 'failed', message: messageOf(e) }
    }
  }

  return {
    offer: () => (key ? supportOf(browser.env()) : 'none'),
    permission: () => browser.permission(),

    async onHere() {
      if (!usable()) return false
      const reg = await browser.existing()
      const sub = reg ? await reg.pushManager.getSubscription() : null
      if (!sub || !ours(sub)) return false
      /* ⚠️ THE BROWSER SAYING YES IS NOT ENOUGH; THE ACCOUNT HAS TO SAY IT TOO. A subscription
         belongs to the browser, and the device row to whoever saved it last — so on a shared
         browser the next member to sign in found the switch on and was told about nothing, while
         the alerts went on going to the member before. The same for a device the push function
         marked gone, and for a subscription the browser replaced on its own (sw.js says why it
         cannot save that one). Read off in each case, the switch offers to turn on, and
         push_device_add moves the row to whoever is signed in. A call that fails reads off as
         well: turning on again costs one idempotent save, and on when it is not costs the alerts. */
      const mine = await call('push_devices_mine')
      return mine.ok && listsEndpoint(mine.data, sub.endpoint)
    },

    async enable() {
      if (!usable()) return { ok: false, why: 'failed', message: 'not available in this browser' }
      let sub: Sub
      try {
        /* ⚠️ PERMISSION IS ASKED FIRST, BEFORE ANYTHING IS AWAITED. Firefox shows the prompt only
           while the click that asked for it is still being handled, so registering the worker
           first would make it refuse without asking. */
        const asked = await browser.askPermission()
        if (asked !== 'granted') return { ok: false, why: 'denied' }
        const reg = await browser.register()
        const had = await reg.pushManager.getSubscription()
        if (had && ours(had)) sub = had
        else {
          /* a subscription under another key cannot be reused, and subscribe refuses while it is
             there — see sameKey */
          if (had) await had.unsubscribe()
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
          })
        }
      } catch (e) {
        return { ok: false, why: 'failed', message: messageOf(e) }
      }
      const keys = sub.toJSON().keys ?? {}
      const hints = await browser.hints().catch((): Hints => ({ ua: '' }))
      const saved = await call('push_device_add', {
        p_endpoint: sub.endpoint,
        p_p256dh: keys.p256dh ?? null,
        p_auth: keys.auth ?? null,
        p_label: deviceLabel(hints),
      })
      if (!saved.ok) {
        /* a subscription the account does not hold delivers nothing, and `onHere` reads it as
           off; kept, it would only be a promise to the push service that nobody keeps. So it
           goes again, and the card says why. */
        await sub.unsubscribe().catch(() => false)
        return saved
      }
      return { ok: true }
    },

    async disable() {
      let sub: Sub | null = null
      try {
        const reg = await browser.existing()
        sub = reg ? await reg.pushManager.getSubscription() : null
        if (!sub) return { ok: true }
        await sub.unsubscribe()
      } catch (e) {
        return { ok: false, why: 'failed', message: messageOf(e) }
      }
      /* ⚠️ OFF HERE FIRST, THEN THE SERVER IS TOLD, and failing to tell it does not make this
         device on again. Once unsubscribed, the push service answers 404 or 410 for this
         endpoint, and the push function marks a device that answers that way gone — so a lost
         call is tidied by the next alert rather than leaving the phone buzzing. */
      await call('push_device_remove', { p_endpoint: sub.endpoint })
      return { ok: true }
    },

    async prefs() {
      const r = await call('push_prefs_get')
      if (r.ok) return prefsOf(r.data)
      return r.why === 'not-yet' ? 'not-yet' : 'failed'
    },

    async setPref(kind, on) {
      /* ⚠️ ONLY THE ONE THAT CHANGED. The others go unsaid, which the function reads as "leave
         alone" — CLAUDE.md §8: a save that writes every column is a delete for the ones the
         caller forgot, and two devices flipping two different kinds at once must both stick. */
      const r = await call('push_prefs_set', { ['p_' + kind]: on })
      return r.ok ? { ok: true } : r
    },

    async sendTest() {
      const r = await call('push_test')
      if (!r.ok) return r
      return { ok: true, devices: typeof r.data === 'number' ? r.data : undefined }
    },

    async forgetHere(ms = FORGET_WITHIN_MS) {
      /* no key, no subscription anybody could have made: nothing is asked, of the browser or the
         server, until the feature exists */
      if (!usable()) return
      const work = (async () => {
        const reg = await browser.existing()
        const sub = reg ? await reg.pushManager.getSubscription() : null
        if (!sub) return
        /* ⚠️ ANY SUBSCRIPTION, NOT ONLY ONE UNDER THIS KEY OR ON THIS ACCOUNT. Whoever's it is,
           nobody is signed in here once this finishes, and alerts must not go on arriving on a
           browser its member has left. The server only marks the CALLER's own row gone, so
           asking about somebody else's changes nothing there; the unsubscribe ends it here, and
           the push service's 404 or 410 then ends it for the row that is left. Both at once,
           because each is a network round trip and sign-out is waiting. */
        await Promise.allSettled([
          call('push_device_remove', { p_endpoint: sub.endpoint }),
          sub.unsubscribe(),
        ])
      })()
      await new Promise<void>((done) => {
        const cap = setTimeout(done, ms)
        void work
          .catch(() => {})
          .finally(() => {
            clearTimeout(cap)
            done()
          })
      })
    },
  }
}

// ── the real browser ────────────────────────────────────────────────────────

/** wait for a registration to have an active worker — subscribe refuses without one */
function activated(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return Promise.resolve()
  const w = reg.installing ?? reg.waiting
  if (!w) return Promise.reject(new Error('the alert worker did not start'))
  return new Promise((resolve, reject) => {
    const look = () => {
      if (w.state === 'activated') resolve()
      else if (w.state === 'redundant') reject(new Error('the alert worker did not start'))
    }
    w.addEventListener('statechange', look)
    look()
  })
}

export const realBrowser: Browser = {
  env: readEnv,
  permission: () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
  askPermission: () => Notification.requestPermission(),
  existing: async () => (await navigator.serviceWorker.getRegistration('/')) ?? null,
  async register() {
    /* scope '/' is the default for a worker at the root, said out loud because it is the claim
       the whole design rests on: one worker for every page of the site */
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await activated(reg)
    return reg
  },
  hints: readHints,
}
