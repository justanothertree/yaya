import { describe, expect, it } from 'vitest'
import {
  deviceLabel,
  makeAlerts,
  notYet,
  prefsOf,
  sameKey,
  supportOf,
  urlBase64ToUint8Array,
  type Browser,
  type Env,
  type Reg,
  type RpcAnswer,
  type Sub,
} from './phoneAlerts'

/**
 * RFC 8291's own example receiver key (Appendix A, `ua_public`): a real P-256 point, written the
 * way every VAPID and p256dh key is, and it happens to hold both `-` and `_`.
 *
 * The expected bytes were produced by Node's `Buffer.from(k, 'base64url')`, an implementation that
 * shares nothing with the one under test, and pasted in as a literal.
 */
const RFC_KEY =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
const RFC_KEY_HEX =
  '042571b2becdfde360551aaf1ed0f4cd366c11cebe555f89bcb7b186a53339173168ece2ebe018597bd30479b86e3c8f8eced577ca59187e9246990db682008b0e'
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

describe('support', () => {
  const env = (over: Partial<Env>): Env => ({
    serviceWorker: true,
    pushManager: true,
    notification: true,
    standalone: undefined,
    ...over,
  })

  it('every piece present is a browser that can subscribe', () => {
    expect(supportOf(env({}))).toBe('ok')
    /* an iPhone's Home Screen app on 16.4 or later has all three */
    expect(supportOf(env({ standalone: true }))).toBe('ok')
  })

  it('Safari on an iPhone, in a tab, is told to install rather than told no', () => {
    expect(supportOf(env({ pushManager: false, notification: false, standalone: false }))).toBe(
      'install',
    )
  })

  it('anything missing elsewhere is nothing to offer', () => {
    expect(supportOf(env({ serviceWorker: false }))).toBe('none')
    expect(supportOf(env({ pushManager: false }))).toBe('none')
    expect(supportOf(env({ notification: false }))).toBe('none')
    /* a Home Screen app on iOS before 16.4: installed, and still no push — installing again is no answer */
    expect(supportOf(env({ pushManager: false, notification: false, standalone: true }))).toBe(
      'none',
    )
    /* an http origin has no service worker at all, iPhone or not */
    expect(supportOf(env({ serviceWorker: false, pushManager: false, standalone: false }))).toBe(
      'none',
    )
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodes a real key to the 65-byte uncompressed point it is', () => {
    const b = urlBase64ToUint8Array(RFC_KEY)
    expect(b.length).toBe(65)
    expect(b[0]).toBe(0x04)
    expect(hex(b)).toBe(RFC_KEY_HEX)
  })

  it('reads - and _ as the URL-safe alphabet, and needs no padding', () => {
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([0xfb, 0xff])
    expect([...urlBase64ToUint8Array('BTS_')]).toEqual([0x05, 0x34, 0xbf])
  })

  it('pads for itself, so a decoder that insists on padding still reads a key', () => {
    /* the WHATWG atob forgives a missing `=`; this one, standing in for any engine that does not,
       refuses — which is the only way the function's own padding can be seen at all */
    const forgiving = globalThis.atob
    globalThis.atob = (s: string) => {
      if (s.length % 4 !== 0) throw new DOMException('not padded', 'InvalidCharacterError')
      return forgiving(s)
    }
    try {
      expect(hex(urlBase64ToUint8Array(RFC_KEY))).toBe(RFC_KEY_HEX)
    } finally {
      globalThis.atob = forgiving
    }
  })
})

describe('sameKey', () => {
  it('the same bytes match, and anything else does not', () => {
    const key = urlBase64ToUint8Array(RFC_KEY)
    expect(sameKey(key.slice().buffer, key)).toBe(true)
    const other = key.slice()
    other[64] ^= 1
    expect(sameKey(other.buffer, key)).toBe(false)
    expect(sameKey(key.slice(0, 64).buffer, key)).toBe(false)
    /* Firefox reports no key at all for some subscriptions: that is not ours */
    expect(sameKey(null, key)).toBe(false)
  })
})

describe('deviceLabel', () => {
  const PIXEL_UA =
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'

  it('names a Pixel by its model when the browser says it', () => {
    expect(
      deviceLabel({
        ua: PIXEL_UA,
        platform: 'Android',
        model: 'Pixel 7',
        brands: [{ brand: 'Not_A Brand' }, { brand: 'Chromium' }, { brand: 'Google Chrome' }],
      }),
    ).toBe('Pixel 7, Chrome')
  })

  it('never calls a phone "K", which is what every reduced Android user agent says', () => {
    expect(deviceLabel({ ua: PIXEL_UA })).toBe('Android, Chrome')
    expect(deviceLabel({ ua: PIXEL_UA, model: 'K' })).toBe('Android, Chrome')
  })

  it('reads the user agent where there are no hints', () => {
    const cases: [string, string][] = [
      ['Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0', 'Android, Firefox'],
      [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        'iPhone, Safari',
      ],
      [
        'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
        'Android, Samsung Internet',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        'Windows, Edge',
      ],
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        'Mac, Safari',
      ],
    ]
    for (const [ua, want] of cases) expect(deviceLabel({ ua }), ua).toBe(want)
  })

  it('says something even when it can tell nothing', () => {
    expect(deviceLabel({ ua: '' })).toBe('A browser')
  })
})

describe('notYet', () => {
  it('"no such function", in each way it arrives, means not switched on yet', () => {
    expect(notYet({ code: 'PGRST202', message: 'Could not find the function' }, 404)).toBe(true)
    expect(notYet({ code: '42883' }, 400)).toBe(true)
    expect(notYet({ message: 'Not Found' }, 404)).toBe(true)
  })

  it('every other refusal is a refusal', () => {
    expect(notYet(null, 200)).toBe(false)
    expect(notYet({ code: '42501', message: 'permission denied' }, 401)).toBe(false)
    expect(notYet({ code: 'P0001', message: 'not signed in' }, 400)).toBe(false)
    expect(notYet({ message: 'Failed to fetch' })).toBe(false)
  })
})

describe('prefsOf', () => {
  it('no row is all on — the server’s default', () => {
    expect(prefsOf(null)).toEqual({
      ring: true,
      message: true,
      post: true,
      challenge: true,
      chronicle: true,
    })
  })

  it('every off is read, from an object or a one-row array', () => {
    /* every field away from its default, so dropping any one of them goes red */
    const allOff = { ring: false, message: false, post: false, challenge: false, chronicle: false }
    expect(prefsOf(allOff)).toEqual(allOff)
    expect(prefsOf([allOff])).toEqual(allOff)
    expect(prefsOf({ message: false })).toEqual({
      ring: true,
      message: false,
      post: true,
      challenge: true,
      chronicle: true,
    })
  })
})

// ── switching on and off, with a fake browser and a fake server ────────────

function fakes({
  permission = 'default' as NotificationPermission,
  grant = 'granted' as NotificationPermission,
  answer = (fn: string): RpcAnswer => ({ data: fn === 'push_test' ? 2 : null, error: null }),
  env = {
    serviceWorker: true,
    pushManager: true,
    notification: true,
    standalone: undefined,
  } as Env,
  /** a subscription this browser already holds, made under this key */
  hadKey = null as Uint8Array | null,
  registered = false,
} = {}) {
  const log: unknown[] = []
  let current: Sub | null = null
  let isRegistered = registered

  const sub = (keyBytes: Uint8Array): Sub => {
    const s: Sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/device-77',
      options: { applicationServerKey: keyBytes.slice().buffer },
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/fcm/send/device-77',
        keys: { p256dh: 'p256dh-of-device-77', auth: 'auth-of-device-77' },
      }),
      unsubscribe: async () => {
        log.push(['unsubscribe', s.endpoint])
        if (current === s) current = null
        return true
      },
    }
    return s
  }
  if (hadKey) current = sub(hadKey)

  const reg: Reg = {
    pushManager: {
      getSubscription: async () => current,
      subscribe: async (o) => {
        log.push(['subscribe', o.userVisibleOnly, hex(o.applicationServerKey)])
        current = sub(o.applicationServerKey)
        return current
      },
    },
  }

  const browser: Browser = {
    env: () => env,
    permission: () => permission,
    askPermission: async () => {
      log.push('ask')
      permission = grant
      return grant
    },
    existing: async () => (isRegistered ? reg : null),
    register: async () => {
      log.push('register')
      isRegistered = true
      return reg
    },
    hints: async () => ({
      ua: 'Mozilla/5.0 (Linux; Android 10; K) Chrome/131.0.0.0 Mobile Safari/537.36',
      platform: 'Android',
      model: 'Pixel 7',
      brands: [{ brand: 'Google Chrome' }],
    }),
  }

  const rpc = async (fn: string, args?: Record<string, unknown>) => {
    log.push(['rpc', fn, args])
    return answer(fn)
  }

  return { log, browser, rpc, current: () => current }
}

describe('makeAlerts', () => {
  it('with no key offers nothing, on any browser, and never asks for permission', async () => {
    const f = fakes()
    const api = makeAlerts('', f.rpc, f.browser)
    expect(api.offer()).toBe('none')
    expect((await api.enable()).ok).toBe(false)
    expect(await api.onHere()).toBe(false)
    expect(f.log).toEqual([])
  })

  it('turning on: permission, then the worker, then subscribe, then the server', async () => {
    const f = fakes()
    const api = makeAlerts(RFC_KEY, f.rpc, f.browser)
    expect(api.offer()).toBe('ok')
    expect(await api.enable()).toEqual({ ok: true })
    expect(f.log).toEqual([
      'ask',
      'register',
      ['subscribe', true, RFC_KEY_HEX],
      [
        'rpc',
        'push_device_add',
        {
          p_endpoint: 'https://fcm.googleapis.com/fcm/send/device-77',
          p_p256dh: 'p256dh-of-device-77',
          p_auth: 'auth-of-device-77',
          p_label: 'Pixel 7, Chrome',
        },
      ],
    ])
    expect(await api.onHere()).toBe(true)
  })

  it('a refused prompt stops there: no worker, no subscription, nothing saved', async () => {
    const f = fakes({ grant: 'denied' })
    const api = makeAlerts(RFC_KEY, f.rpc, f.browser)
    expect(await api.enable()).toEqual({ ok: false, why: 'denied' })
    expect(f.log).toEqual(['ask'])
  })

  it('a server without the functions yet says so, and leaves no subscription behind', async () => {
    const f = fakes({
      answer: () => ({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function' },
        status: 404,
      }),
    })
    const api = makeAlerts(RFC_KEY, f.rpc, f.browser)
    const r = await api.enable()
    expect(r.ok === false && r.why).toBe('not-yet')
    /* ⚠️ the switch reads the browser, so a subscription left here would read On and deliver nothing */
    expect(f.current()).toBeNull()
    expect(await api.onHere()).toBe(false)
  })

  it('a subscription under an old key is replaced, not reused', async () => {
    const f = fakes({ hadKey: new Uint8Array(65).fill(7), registered: true })
    const api = makeAlerts(RFC_KEY, f.rpc, f.browser)
    /* it is there, and it is not ours: off */
    expect(await api.onHere()).toBe(false)
    expect(await api.enable()).toEqual({ ok: true })
    const steps = f.log.map((x) => (Array.isArray(x) ? x[0] : x))
    expect(steps).toEqual(['ask', 'register', 'unsubscribe', 'subscribe', 'rpc'])
    expect(await api.onHere()).toBe(true)
  })

  it('turning off: off here first, then the server is told which device', async () => {
    const f = fakes()
    const api = makeAlerts(RFC_KEY, f.rpc, f.browser)
    await api.enable()
    f.log.length = 0
    expect(await api.disable()).toEqual({ ok: true })
    expect(f.log).toEqual([
      ['unsubscribe', 'https://fcm.googleapis.com/fcm/send/device-77'],
      [
        'rpc',
        'push_device_remove',
        { p_endpoint: 'https://fcm.googleapis.com/fcm/send/device-77' },
      ],
    ])
    expect(await api.onHere()).toBe(false)
  })

  it('a kind is saved alone, so the others are left as they are', async () => {
    const f = fakes()
    const api = makeAlerts(RFC_KEY, f.rpc, f.browser)
    expect(await api.setPref('message', false)).toEqual({ ok: true })
    expect(await api.setPref('ring', true)).toEqual({ ok: true })
    expect(f.log).toEqual([
      ['rpc', 'push_prefs_set', { p_message: false }],
      ['rpc', 'push_prefs_set', { p_ring: true }],
    ])
  })

  it('a test reports how many devices it went to', async () => {
    const f = fakes()
    const api = makeAlerts(RFC_KEY, f.rpc, f.browser)
    expect(await api.sendTest()).toEqual({ ok: true, devices: 2 })
  })

  it('prefs read "not yet" before the migration, and "failed" when the call fails', async () => {
    const missing = fakes({
      answer: () => ({ data: null, error: { code: 'PGRST202' }, status: 404 }),
    })
    expect(await makeAlerts(RFC_KEY, missing.rpc, missing.browser).prefs()).toBe('not-yet')
    const down = fakes({
      answer: () => ({ data: null, error: { message: 'Failed to fetch' } }),
    })
    expect(await makeAlerts(RFC_KEY, down.rpc, down.browser).prefs()).toBe('failed')
  })
})
