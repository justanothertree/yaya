import { readdirSync, readFileSync } from 'node:fs'
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

/**
 * push_outbox's limits, read out of the SQL that creates it — the table owns these numbers, so a
 * test that typed them in beside the worker's would agree with whichever of the two was wrong.
 * Every file that creates the table is read (the draft now, its migration once applied), and they
 * must agree.
 */
function outboxLimits() {
  const root = new URL('../', import.meta.url)
  const files = [
    ...readdirSync(new URL('docs/', root)).map((f) => `docs/${f}`),
    ...readdirSync(new URL('supabase/migrations/', root)).map((f) => `supabase/migrations/${f}`),
  ].filter((f) => f.endsWith('.sql'))
  const found = []
  for (const f of files) {
    const sql = readFileSync(new URL(f, root), 'utf8')
    const table = /create table public\.push_outbox \(([\s\S]*?)\n\);/.exec(sql)
    if (!table) continue
    const num = (re) => Number(re.exec(table[1])?.[1])
    found.push({
      title: num(/char_length\(title\) between 1 and (\d+)/),
      body: num(/char_length\(body\) <= (\d+)/),
      tag: num(/char_length\(tag\) between 1 and (\d+)/),
      url: num(/char_length\(url\) <= (\d+)/),
    })
  }
  expect(found.length, 'no SQL creates push_outbox').toBeGreaterThan(0)
  for (const f of found) expect(f).toEqual(found[0])
  for (const n of Object.values(found[0])) expect(n).toBeGreaterThan(0)
  return found[0]
}

/** a character count in the outbox's unit — `char_length`, which is code points, not UTF-16 */
const chars = (s) => Array.from(s).length

/**
 * The one window interaction a tap grants the worker. `focus()` and `openWindow()` each spend it,
 * and a second is refused — Chromium's rule ("Not allowed to open a window"), and the reason a
 * focus spent too early leaves the fallback with nothing.
 */
function allowance() {
  const a = {
    left: 0,
    spend(what) {
      if (a.left < 1) throw new Error(`Not allowed to ${what}`)
      a.left -= 1
    },
  }
  return a
}

/**
 * a tab as `clients.matchAll` returns it, recording what was done to it. `navigate` resolves with
 * a NEW client, as it does for the document it loads — so focusing the old one is visible here.
 * `leaves` is a tab whose navigation ends up on another site, for which navigate resolves null.
 */
function tab({ focused = false, navigateFails = false, leaves = false } = {}) {
  const t = {
    focused,
    did: [],
    allowance: null,
    after: null,
    focus: async () => {
      t.allowance.spend('focus a window')
      t.did.push('focus')
      return t
    },
    navigate: async (url) => {
      t.did.push(['navigate', url])
      if (navigateFails) throw new TypeError('not controlled')
      if (leaves) return null
      t.after = tab({ focused })
      t.after.allowance = t.allowance
      return t.after
    },
  }
  return t
}

function worker({ tabs = [] } = {}) {
  const on = {}
  const shown = []
  const opened = []
  const grant = allowance()
  for (const t of tabs) t.allowance = grant
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
        grant.spend('open a window')
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
    /* only a tap may bring a window forward, and only once */
    grant.left = type === 'notificationclick' ? 1 : 0
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
       stand between anybody and the site, and never serve a stale build. Nor
       pushsubscriptionchange, which a worker has no session to act on (the note at its foot). */
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

  it('cuts what it is given to the outbox’s limits, and says so with "…"', async () => {
    const max = outboxLimits()
    const title = 'x'.repeat(5000)
    const body = 'y'.repeat(50000)
    const w = worker()
    await w.fire('push', pushOf(JSON.stringify({ title, body, tag: 7 })))
    const [shown] = w.shown
    /* exactly the limit, the last of it the ellipsis, the rest the text as it was */
    expect(chars(shown.title)).toBe(max.title)
    expect(shown.title).toBe(title.slice(0, max.title - 1) + '…')
    expect(chars(shown.options.body)).toBe(max.body)
    expect(shown.options.body).toBe(body.slice(0, max.body - 1) + '…')
    /* a tag that is not a string is no tag, rather than the number 7 coerced into a slot */
    expect(shown.options.tag).toBeUndefined()
  })

  it('anything the outbox accepts arrives whole — counted in characters, as the outbox counts', async () => {
    const max = outboxLimits()
    /* each exactly at the limit in the outbox's unit and well past it in UTF-16's, since every
       one of these emoji is one character and two code units: a cut made by `.length` would
       shorten all four */
    const title = '🔔'.repeat(max.title)
    const body = '💬'.repeat(max.body)
    const tag = '🔖'.repeat(max.tag)
    const url = '#' + '🔔'.repeat(max.url - 1)
    expect([title, body, tag, url].map(chars)).toEqual([max.title, max.body, max.tag, max.url])
    expect(title.length).toBe(2 * max.title)
    const w = worker()
    await w.fire('push', pushOf(JSON.stringify({ title, body, tag, url })))
    const [shown] = w.shown
    expect(shown.title).toBe(title)
    expect(shown.options.body).toBe(body)
    expect(shown.options.tag).toBe(tag)
    expect(shown.options.data.url).toBe(url)
  })

  it('one character over: text is cut on a character, an identifier is dropped', async () => {
    const max = outboxLimits()
    const w = worker()
    await w.fire(
      'push',
      pushOf(
        JSON.stringify({
          kind: 'ring',
          title: '🔔'.repeat(max.title + 1),
          body: '💬'.repeat(max.body + 1),
          tag: 't'.repeat(max.tag + 1),
          url: '#' + 'u'.repeat(max.url),
        }),
      ),
    )
    const [shown] = w.shown
    expect(shown.title).toBe('🔔'.repeat(max.title - 1) + '…')
    expect(shown.options.body).toBe('💬'.repeat(max.body - 1) + '…')
    /* never half an emoji: a lone surrogate is not a character, and encodeURIComponent says so */
    expect(() => encodeURIComponent(shown.title + shown.options.body)).not.toThrow()
    /* a cut tag would be a different slot and a cut URL a different page: neither is kept */
    expect(shown.options.tag).toBeUndefined()
    expect(shown.options.renotify).toBeUndefined()
    expect(shown.options.data.url).toBe('')
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
    /* navigated first, and what comes forward is the page it loaded, not the one it left */
    expect(front.did).toEqual([['navigate', 'https://evancook.dev/#chat?room=abc']])
    expect(front.after.did).toEqual(['focus'])
    expect(back.did).toEqual([])
    expect(w.opened).toEqual([])
  })

  it('opens a window when no tab is open', async () => {
    const w = worker()
    await w.fire('notificationclick', tapOn('#chronicle'))
    expect(w.opened).toEqual(['https://evancook.dev/#chronicle'])
  })

  it('opens a window when the open tab will not navigate — with the tap’s one window still unspent', async () => {
    /* a tab the worker does not control rejects navigate — the tap must still land. ⚠️ The fake
       refuses a second window interaction as Chromium does, so a focus spent on the stuck tab
       first makes this openWindow throw and the test go red */
    const stuck = tab({ navigateFails: true })
    const w = worker({ tabs: [stuck] })
    await w.fire('notificationclick', tapOn('#chat?room=abc'))
    expect(stuck.did).toEqual([['navigate', 'https://evancook.dev/#chat?room=abc']])
    expect(w.opened).toEqual(['https://evancook.dev/#chat?room=abc'])
  })

  it('opens a window when the tab navigated somewhere that is not this site', async () => {
    /* navigate resolves null then: there is no client of ours left to bring forward */
    const away = tab({ leaves: true })
    const w = worker({ tabs: [away] })
    await w.fire('notificationclick', tapOn('#chronicle'))
    expect(away.did).toEqual([['navigate', 'https://evancook.dev/#chronicle']])
    expect(w.opened).toEqual(['https://evancook.dev/#chronicle'])
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
