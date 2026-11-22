import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * public/sw.js, asked without a browser.
 *
 * ⚠️ IT EVALUATES THE FILE THAT SHIPS, not a copy of its functions. The worker is a classic script
 * served as-is from `public/`, so there is no module to import; `vm` runs its text in a context
 * whose only globals are a fake `self` (with its `clients`, `registration` and `location`) and `URL`.
 * That is narrower than a real worker on purpose: a reference to `window` or `document`, which a
 * worker does not have, throws here instead of on a phone — measured, by adding one.
 *
 * ⚠️ LIVES IN scripts/ BECAUSE IT NEEDS `node:vm`, and the tests under src/ are typechecked against
 * the browser's types only. Same home and same reason as dev-bench-sweep.test.mjs, which reads
 * App.tsx.
 */

const SRC = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const SITE = 'https://evancook.dev'

/** a tab as `clients.matchAll` returns it, recording what was done to it */
function tab({ focused = false, navigateFails = false } = {}) {
  const t = {
    focused,
    did: [],
    focus: async () => {
      t.did.push('focus')
      return t
    },
    navigate: async (url) => {
      t.did.push(['navigate', url])
      if (navigateFails) throw new TypeError('not controlled')
      return t
    },
  }
  return t
}

function worker({ tabs = [] } = {}) {
  const on = {}
  const shown = []
  const opened = []
  const ctx = {
    URL,
    location: { origin: SITE },
    addEventListener: (type, fn) => {
      on[type] = fn
    },
    skipWaiting: () => Promise.resolve(),
    registration: {
      showNotification: async (title, options) => {
        /* the one rule of the Notifications API a payload could trip: `renotify` with no tag is
           a TypeError, and a push whose notification throws shows nothing */
        if (options.renotify && !options.tag) throw new TypeError('renotify needs a tag')
        shown.push({ title, options: JSON.parse(JSON.stringify(options)) })
      },
    },
    clients: {
      matchAll: async () => tabs,
      openWindow: async (url) => {
        opened.push(url)
      },
      claim: async () => {},
    },
  }
  ctx.self = ctx
  vm.createContext(ctx)
  vm.runInContext(SRC, ctx, { filename: 'public/sw.js' })

  /** fire an event the way the browser does, and wait for whatever it asked to be waited for */
  async function fire(type, event) {
    const waits = []
    on[type]({ ...event, waitUntil: (p) => waits.push(p) })
    await Promise.all(waits)
  }
  return { ctx, on, shown, opened, fire }
}

const pushOf = (payload) => ({
  data:
    payload === undefined
      ? null
      : {
          json: () => JSON.parse(payload),
          text: () => payload,
        },
})

describe('the worker', () => {
  it('listens for push, a tap, install and activate — and never for fetch', () => {
    const { on } = worker()
    /* ⚠️ the fetch half is the claim in the file's header: no fetch handler, so it can never
       stand between anybody and the site, and never serve a stale build */
    expect(Object.keys(on).sort()).toEqual(['activate', 'install', 'notificationclick', 'push'])
  })
})

describe('a push', () => {
  it('shows the title, body, tag, the site icon and where a tap goes', async () => {
    const w = worker()
    await w.fire(
      'push',
      pushOf(
        JSON.stringify({
          kind: 'message',
          title: 'Morgan',
          body: 'are you coming tonight?',
          tag: 'chat:room-7',
          url: '#chat?room=room-7',
        }),
      ),
    )
    expect(w.shown).toEqual([
      {
        title: 'Morgan',
        options: {
          body: 'are you coming tonight?',
          icon: '/icon-512.png',
          tag: 'chat:room-7',
          data: { url: '#chat?room=room-7' },
        },
      },
    ])
  })

  it('a ring waits to be answered and buzzes; a message does neither', async () => {
    const w = worker()
    await w.fire('push', pushOf(JSON.stringify({ kind: 'ring', title: 'Morgan is calling' })))
    await w.fire('push', pushOf(JSON.stringify({ kind: 'message', title: 'Morgan' })))
    const [ring, message] = w.shown.map((s) => s.options)
    expect(ring.requireInteraction).toBe(true)
    /* "short": a few pulses, none longer than a second, nothing like a ringtone */
    expect(ring.vibrate.length).toBeGreaterThan(1)
    expect(ring.vibrate.length).toBeLessThanOrEqual(6)
    expect(Math.max(...ring.vibrate)).toBeLessThanOrEqual(1000)
    expect(message.requireInteraction).toBeUndefined()
    expect(message.vibrate).toBeUndefined()
  })

  it('a ring that replaces an earlier one buzzes again; a tagged message replaces quietly', async () => {
    const w = worker()
    await w.fire('push', pushOf(JSON.stringify({ kind: 'ring', tag: 'ring:room-7' })))
    await w.fire('push', pushOf(JSON.stringify({ kind: 'ring' })))
    await w.fire('push', pushOf(JSON.stringify({ kind: 'post', tag: 'kudos:log-3' })))
    /* all three shown: an untagged ring asking to renotify would have thrown in the fake, as it
       does in the browser */
    expect(w.shown).toHaveLength(3)
    const [tagged, untagged, kudos] = w.shown.map((s) => s.options)
    expect(tagged.renotify).toBe(true)
    expect(untagged.requireInteraction).toBe(true)
    expect(kudos.renotify).toBeUndefined()
  })

  it('still shows something when the push carries nothing, or nothing readable', async () => {
    /* userVisibleOnly is a promise to the browser: every push shows a notification */
    const w = worker()
    await w.fire('push', pushOf(undefined))
    await w.fire('push', pushOf('not json at all'))
    expect(w.shown).toHaveLength(2)
    expect(w.shown[0].title).toBe('evancook.dev')
    expect(w.shown[1].options.body).toBe('not json at all')
  })

  it('cuts what it is given down to a size a phone can draw', async () => {
    const w = worker()
    await w.fire(
      'push',
      pushOf(JSON.stringify({ title: 'x'.repeat(5000), body: 'y'.repeat(50000), tag: 7 })),
    )
    const [{ title, options }] = w.shown
    expect(title.length).toBeLessThanOrEqual(100)
    expect(options.body.length).toBeLessThanOrEqual(300)
    /* a tag that is not a string is no tag, rather than the number 7 coerced into a slot */
    expect(options.tag).toBeUndefined()
  })
})

describe('where a tap may go', () => {
  const { ctx } = worker()
  const go = (raw) => ctx.alertUrl(raw, SITE)

  it('a hash route or a path on this site, as an absolute URL on this site', () => {
    expect(go('#chat?room=abc')).toBe('https://evancook.dev/#chat?room=abc')
    expect(go('/#profile?u=morgan_k')).toBe('https://evancook.dev/#profile?u=morgan_k')
    expect(go('#circuit?tab=feed')).toBe('https://evancook.dev/#circuit?tab=feed')
  })

  it('anything else goes to the home page — and never to another site', () => {
    const hostile = [
      'https://elsewhere.example/',
      '//elsewhere.example/',
      '/\\elsewhere.example/',
      '/\t/elsewhere.example/',
      '/\n/elsewhere.example/',
      'javascript:alert(1)',
      'data:text/html,hi',
      ' https://elsewhere.example/',
      /* same site, but absolute: nothing on the server has reason to send one */
      'https://evancook.dev/#chat',
      '',
      undefined,
      null,
      42,
      { href: '#chat' },
    ]
    for (const raw of hostile) {
      const got = go(raw)
      /* measured through the parser, not through the function's own prefix rule */
      expect(new URL(got).origin, JSON.stringify(raw)).toBe(SITE)
      expect(got, JSON.stringify(raw)).toBe('https://evancook.dev/')
    }
  })
})

describe('a tap', () => {
  const tapOn = (url) => ({ notification: { data: { url }, close() {} } })

  it('brings an open tab forward on the alert’s page, and opens nothing new', async () => {
    const back = tab()
    const front = tab({ focused: true })
    const w = worker({ tabs: [back, front] })
    await w.fire('notificationclick', tapOn('#chat?room=abc'))
    expect(front.did).toEqual(['focus', ['navigate', 'https://evancook.dev/#chat?room=abc']])
    expect(back.did).toEqual([])
    expect(w.opened).toEqual([])
  })

  it('opens a window when no tab is open', async () => {
    const w = worker()
    await w.fire('notificationclick', tapOn('#chronicle'))
    expect(w.opened).toEqual(['https://evancook.dev/#chronicle'])
  })

  it('opens a window when the open tab will not navigate', async () => {
    /* a tab the worker does not control rejects navigate — the tap must still land */
    const stuck = tab({ navigateFails: true })
    const w = worker({ tabs: [stuck] })
    await w.fire('notificationclick', tapOn('#chat?room=abc'))
    expect(w.opened).toEqual(['https://evancook.dev/#chat?room=abc'])
  })

  it('closes the alert, and a hostile link lands on the home page', async () => {
    let closed = 0
    const w = worker()
    await w.fire('notificationclick', {
      notification: { data: { url: '//elsewhere.example/' }, close: () => closed++ },
    })
    expect(closed).toBe(1)
    expect(w.opened).toEqual(['https://evancook.dev/'])
  })
})
