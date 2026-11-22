/**
 * The site's service worker. It shows phone alerts and opens the page an alert points at, and it
 * does nothing else.
 *
 * ⚠️ NO FETCH HANDLER AND NO CACHE, ON PURPOSE. A worker that answers fetches sits between every
 * visitor and the site for as long as it lives, and one that caches can go on serving last week's
 * build after a deploy, which on a site that ships several times a day is a bug report nobody can
 * reproduce. With no fetch handler the browser never routes a request through this file (Chrome
 * does not even start it for a navigation), so loading the site is exactly what it was before
 * this file existed. Adding one is a separate decision with its own plan, not a tidy-up here.
 *
 * ⚠️ ONE FILE, NOT A WORKER PLUS A HELPER IT `importScripts`. Browsers re-check this script on
 * every navigation whatever the server's headers say, but an imported script is fetched through
 * the HTTP cache by default (`updateViaCache: 'imports'`), and GitHub Pages sends
 * `max-age=600`. A helper split out for testing could run ten minutes behind the worker that
 * loads it. The pure parts are plain top-level functions instead, and
 * `scripts/service-worker.test.mjs` evaluates this exact file with a fake `self` to ask them.
 * Everything below goes through `self.`, the worker's own global, so what it leans on is plain to
 * see; the test hands it a fake one, and a reach for `window` or `document`, which a worker does
 * not have, fails there rather than on a phone.
 *
 * Plan and reasons: docs/2026-11-22-phone-alerts.md.
 */

/* the site's own icon, already in the manifest; a notification with none shows a blank square */
const ICON = '/icon-512.png'

/** what an alert says when the push carried nothing readable — see the push handler */
const TITLE = 'evancook.dev'

/**
 * A ring buzzes in three short pulses and waits to be answered. It is not a ringtone: a web page
 * cannot ring like a phone call, and an alert that pretends to would be worse than one that is
 * plainly an alert (the plan, "A ring is a ring").
 */
const RING_BUZZ = [300, 150, 300, 150, 300]

/**
 * push_outbox's own limits, from its CHECK constraints (docs/2026-11-22-phone-alerts.DRAFT.sql),
 * in its own unit: `char_length` counts characters, which in JavaScript is `Array.from`, not
 * `.length` — an emoji is one of the first and two of the second, so cutting by `.length` would
 * shorten a title the outbox had accepted whole. scripts/service-worker.test.mjs reads these
 * numbers out of the SQL, so the two cannot drift apart quietly.
 */
const TITLE_MAX = 120
const BODY_MAX = 400
const TAG_MAX = 64
const URL_MAX = 300

/**
 * Text cut to `max` characters, ending in "…" when anything was cut — the way the push function
 * shortens a body that will not fit (webpush.ts), so a cut sentence says it was cut rather than
 * stopping mid-word as though that were all.
 */
function cut(v, max) {
  if (typeof v !== 'string') return ''
  const chars = Array.from(v)
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : v
}

/**
 * An identifier within `max` characters, or nothing. Never cut: a cut tag is a DIFFERENT tag, which
 * could fold two unrelated alerts into one slot, and a cut URL is a different page. The outbox
 * refuses longer ones, so this only ever meets a payload that did not come from it.
 */
function whole(v, max) {
  return typeof v === 'string' && Array.from(v).length <= max ? v : ''
}

/**
 * What a push's payload becomes on screen: the title, and the options `showNotification` takes.
 *
 * Every field is checked for being a string and held to the outbox's limits, because the payload
 * is whatever arrived and the notification is drawn by the phone's own system UI, which is not a
 * place to find out that a body was 40 KB. Nothing here is rendered as HTML anywhere.
 */
function alertOf(payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const options = {
    body: cut(p.body, BODY_MAX),
    icon: ICON,
    /* resolved when it is tapped, not now: see alertUrl */
    data: { url: whole(p.url, URL_MAX) },
  }
  const tag = whole(p.tag, TAG_MAX)
  /* same tag, same slot: a newer alert replaces the older one rather than stacking beside it */
  if (tag) options.tag = tag
  if (p.kind === 'ring') {
    options.requireInteraction = true
    options.vibrate = RING_BUZZ
    /* ⚠️ A SECOND RING IN THE SAME SLOT WOULD OTHERWISE ARRIVE SILENTLY: a replacement under the
       same tag does not buzz unless it says so. That is right for a kudos collapsing into the one
       before it and wrong for somebody calling again. Only with a tag, because `renotify`
       without one makes showNotification throw, and a ring that throws shows nothing at all. */
    if (tag) options.renotify = true
  }
  return { title: cut(p.title, TITLE_MAX) || TITLE, options }
}

/**
 * Where tapping an alert may take somebody: a page on THIS site and nowhere else.
 *
 * ⚠️ ONLY A RELATIVE URL — a hash route (`#chat?room=…`) or a path (`/#profile?u=…`) — and then
 * only if it still resolves to this origin. Both halves are needed. The prefix check alone lets
 * `//elsewhere.example` and `/\elsewhere.example` through, which a URL parser reads as another
 * host (and it drops tabs and newlines first, so `/<tab>/elsewhere.example` is the same thing in
 * disguise). The origin check alone would accept an absolute URL, which nothing on the server has
 * reason to send. Anything that fails either goes to the home page, never to an error: the alert
 * was real even if its link was not.
 */
function alertUrl(raw, origin) {
  const home = origin + '/'
  if (typeof raw !== 'string' || !/^[#/]/.test(raw)) return home
  let url
  try {
    url = new URL(raw, home)
  } catch {
    return home
  }
  return url.origin === origin ? url.href : home
}

/**
 * Bring the site forward on the alert's page: an open tab if there is one, a new one if not.
 *
 * ⚠️ `navigate` REJECTS FOR A TAB THIS WORKER DOES NOT CONTROL, which is any tab opened before it
 * was installed. `clients.claim()` below takes those over on activation, and the fallback to a new
 * window covers whatever is left, so a tap always lands somewhere rather than only focusing a tab
 * on the wrong page.
 *
 * ⚠️ NAVIGATE FIRST, THEN FOCUS WHAT IT RETURNS. A tap grants the worker ONE window interaction,
 * and `focus()` and `openWindow()` each spend it (Chromium refuses the second with "Not allowed to
 * open a window"). Focusing first spent it before knowing whether the tab would navigate, so in
 * the one case the fallback exists for — a tab that will not — the fallback was refused and the
 * tap raised a tab on the wrong page. `navigate` spends nothing, and it resolves with the client
 * for the page it loaded, which is the one to bring forward; null means the tab ended up on
 * another site, which leaves nothing of ours to focus.
 */
async function openOn(url) {
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const tab = tabs.find((t) => t.focused) || tabs[0]
  if (tab) {
    try {
      const moved = await tab.navigate(url)
      if (moved) {
        await moved.focus()
        return
      }
    } catch {
      /* fall through to a new window */
    }
  }
  await self.clients.openWindow(url)
}

/* With no fetch handler and no cache there is nothing for an old copy to protect, so a new
   version takes over at once instead of waiting for every tab to close. */
self.addEventListener('install', () => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  /* ⚠️ ALWAYS SHOW SOMETHING. The subscription promised `userVisibleOnly`, and a push that shows
     nothing makes Chrome post its own "This site has been updated in the background" instead. */
  let payload = null
  try {
    payload = event.data ? event.data.json() : null
  } catch {
    payload = { body: event.data.text() }
  }
  const { title, options } = alertOf(payload)
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const raw = event.notification.data && event.notification.data.url
  event.waitUntil(openOn(alertUrl(raw, self.location.origin)))
})

/* ⚠️ NO `pushsubscriptionchange` HANDLER, ON PURPOSE. When a browser replaces a subscription on
   its own, the new one has to be saved with push_device_add — and a worker has no session to save
   it with: the member's token lives in the page's localStorage, which a worker cannot read, and a
   call without it is refused. So the replacement is left for the page. The next time Account is
   open, the switch asks the account for this browser's endpoint, does not find the new one, and
   reads off; turning it on saves it (phoneAlerts.ts, onHere). The old endpoint answers 404 or 410
   and the push function marks it gone. */
