import { describe, expect, it } from 'vitest'
import {
  FORGET_WITHIN_MS,
  deviceLabel,
  listsEndpoint,
  makeAlerts,
  notYet,
  prefsOf,
  sameKey,
  supportOf,
  testLine,
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

describe('listsEndpoint', () => {
  const here = 'https://fcm.googleapis.com/fcm/send/device-77'

  it('finds this endpoint among the account’s rows, and only this one', () => {
    expect(listsEndpoint([row('https://web.push.apple.com/QGx', 1), row(here, 2)], here)).toBe(true)
    expect(listsEndpoint([row('https://web.push.apple.com/QGx', 1)], here)).toBe(false)
    /* the same service, a different browser: exact, never a prefix */
    expect(listsEndpoint([row(here + '8', 1)], here)).toBe(false)
    expect(listsEndpoint([row(here.slice(0, -1), 1)], here)).toBe(false)
  })

  it('anything that is not the list of rows holds nothing', () => {
    expect(listsEndpoint([], here)).toBe(false)
    expect(listsEndpoint(null, here)).toBe(false)
    expect(listsEndpoint(row(here), here)).toBe(false)
    expect(listsEndpoint([null, 7, here, { id: 'x' }], here)).toBe(false)
  })
})

// ── switching on and off, with a fake browser and a fake server ────────────

/** a device row as push_devices_mine returns it, every field away from its default */
const row = (endpoint: string, n = 1) => ({
  id: `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`,
  endpoint,
  label: `Pixel ${n + 6}, Chrome`,
  created_at: `2026-11-0${n}T08:15:00+00:00`,
  last_ok_at: `2026-11-1${n}T21:40:00+00:00`,
})

/**
 * The server in memory, keeping the one thing the switch now asks it: which endpoints are on the
 * signed-in member's account (`mine` is what it starts with). A device on somebody else's
 * account is simply not in that list, which is all push_devices_mine lets one member see.
 */
function server(mine: string[] = []) {
  const devices = new Set(mine)
  return {
    devices,
    answer: (fn: string, args: Record<string, unknown> = {}): RpcAnswer => {
      switch (fn) {
        case 'push_device_add':
          devices.add(String(args.p_endpoint))
          return { data: '11111111-2222-4333-8444-555555555555', error: null }
        case 'push_device_remove':
          return { data: devices.delete(String(args.p_endpoint)), error: null }
        case 'push_devices_mine':
          return { data: [...devices].map((e, i) => row(e, i + 1)), error: null }
        case 'push_test':
          return { data: 2, error: null }
      }
      return { data: null, error: null }
    },
  }
}

function fakes({
  permission = 'default' as NotificationPermission,
  grant = 'granted' as NotificationPermission,
  answer = server().answer as (fn: string, args?: Record<string, unknown>) => RpcAnswer,
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
    return answer(fn, args)
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
    /* a subscription the account does not hold delivers nothing, so none is kept */
    expect(f.current()).toBeNull()
    expect(await api.onHere()).toBe(false)
  })

  it('a subscription the account does not hold reads off, and turning on saves it here', async () => {
    /* a shared browser: subscribed under this key by the member before, so the browser says yes
       and this member's account says nothing about it */
    const f = fakes({ hadKey: urlBase64ToUint8Array(RFC_KEY), registered: true })
    const api = makeAlerts(RFC_KEY, f.rpc, f.browser)
    expect(await api.onHere()).toBe(false)
    expect(f.log).toEqual([['rpc', 'push_devices_mine', undefined]])
    f.log.length = 0
    expect(await api.enable()).toEqual({ ok: true })
    /* the same subscription, saved to whoever is signed in: no unsubscribe, no new subscribe */
    expect(f.log.map((x) => (Array.isArray(x) ? x.slice(0, 2).join(' ') : x))).toEqual([
      'ask',
      'register',
      'rpc push_device_add',
    ])
    expect(await api.onHere()).toBe(true)
  })

  it('the account is asked only about a subscription made under this key', async () => {
    const f = fakes({ registered: true })
    const api = makeAlerts(RFC_KEY, f.rpc, f.browser)
    /* no subscription at all: nothing to ask the server about */
    expect(await api.onHere()).toBe(false)
    expect(f.log).toEqual([])
  })

  it('an account that cannot be asked reads off rather than on', async () => {
    const f = fakes({
      hadKey: urlBase64ToUint8Array(RFC_KEY),
      registered: true,
      answer: () => ({ data: null, error: { message: 'Failed to fetch' } }),
    })
    expect(await makeAlerts(RFC_KEY, f.rpc, f.browser).onHere()).toBe(false)
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
    const r = await api.sendTest()
    expect(r).toEqual({ ok: true, devices: 2 })
    expect(testLine(r)).toBe('Test sent. It should arrive within a minute.')
  })

  it('a test refused for no device, or for the minute, says which', async () => {
    /* each refusal as PostgREST delivers it: P0002 is a plpgsql error, so HTTP 500 with the code
       in the body; PT429 sets the status itself */
    const said = async (answer: RpcAnswer) => {
      const f = fakes({ answer: () => answer })
      return testLine(await makeAlerts(RFC_KEY, f.rpc, f.browser).sendTest())
    }
    const err = (code: string | undefined, message: string) => ({ code, message })
    expect(
      await said({
        data: null,
        error: err('P0002', 'alerts are not on for any device'),
        status: 500,
      }),
    ).toBe('No device has alerts on.')
    expect(await said({ data: null, error: err('PT429', 'one test a minute'), status: 429 })).toBe(
      'One test a minute; try again shortly.',
    )
    /* either half of the 429 is enough on its own */
    expect(
      await said({ data: null, error: err(undefined, 'Too Many Requests'), status: 429 }),
    ).toBe('One test a minute; try again shortly.')
    expect(await said({ data: null, error: err('PT429', 'one test a minute') })).toBe(
      'One test a minute; try again shortly.',
    )
    /* and the rest are not mistaken for either */
    expect(await said({ data: null, error: err('PGRST202', 'Could not find'), status: 404 })).toBe(
      'Not switched on yet.',
    )
    expect(await said({ data: null, error: err('42501', 'suspended'), status: 403 })).toBe(
      'Couldn’t send. Try again.',
    )
  })

  it('signing out takes this device off the account and unsubscribes it', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/device-77'
    const s = server()
    const f = fakes({ answer: s.answer })
    const api = makeAlerts(RFC_KEY, f.rpc, f.browser)
    await api.enable()
    expect(s.devices.has(endpoint)).toBe(true)
    f.log.length = 0
    await api.forgetHere()
    expect(f.log).toContainEqual(['rpc', 'push_device_remove', { p_endpoint: endpoint }])
    expect(f.log).toContainEqual(['unsubscribe', endpoint])
    expect(s.devices.has(endpoint)).toBe(false)
    expect(f.current()).toBeNull()
  })

  it('signing out unsubscribes even a subscription the account does not hold', async () => {
    /* whoever's it was, nobody is signed in here afterwards */
    const f = fakes({ hadKey: new Uint8Array(65).fill(7), registered: true })
    await makeAlerts(RFC_KEY, f.rpc, f.browser).forgetHere()
    expect(f.current()).toBeNull()
  })

  it('signing out waits for a stalled server only as long as the cap, and never throws', async () => {
    const f = fakes({ hadKey: urlBase64ToUint8Array(RFC_KEY), registered: true })
    const stalled: typeof f.rpc = async (fn, args) => {
      await f.rpc(fn, args)
      return await new Promise<RpcAnswer>(() => {})
    }
    const cap = 40
    const t0 = performance.now()
    await makeAlerts(RFC_KEY, stalled, f.browser).forgetHere(cap)
    const took = performance.now() - t0
    expect(took).toBeGreaterThanOrEqual(cap - 5)
    expect(took).toBeLessThan(cap + 400)
    /* the call did leave, while the session was still there to carry it */
    expect(f.log).toContainEqual([
      'rpc',
      'push_device_remove',
      { p_endpoint: 'https://fcm.googleapis.com/fcm/send/device-77' },
    ])
    /* a browser that throws is the same: sign-out goes on */
    const broken = fakes()
    broken.browser.existing = async () => {
      throw new Error('service workers are disabled')
    }
    await expect(
      makeAlerts(RFC_KEY, broken.rpc, broken.browser).forgetHere(cap),
    ).resolves.toBeUndefined()
  })

  it('signing out with a quick server takes the server’s time, not the cap', async () => {
    const f = fakes({ hadKey: urlBase64ToUint8Array(RFC_KEY), registered: true })
    const t0 = performance.now()
    await makeAlerts(RFC_KEY, f.rpc, f.browser).forgetHere()
    expect(performance.now() - t0).toBeLessThan(FORGET_WITHIN_MS / 2)
  })

  it('with no key, signing out asks nothing of the browser or the server', async () => {
    const f = fakes({ hadKey: urlBase64ToUint8Array(RFC_KEY), registered: true })
    await makeAlerts('', f.rpc, f.browser).forgetHere()
    expect(f.log).toEqual([])
    expect(f.current()).not.toBeNull()
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
