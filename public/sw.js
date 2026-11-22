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
 * What a push's payload becomes on screen: the title, and the options `showNotification` takes.
 *
 * Every field is checked for being a string and cut to a length, because the payload is whatever
 * the push function sent and the notification is drawn by the phone's own system UI, which is not
 * a place to find out that a body was 40 KB. Nothing here is rendered as HTML anywhere.
 */
function alertOf(payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
  const options = {
    body: text(p.body, 300),
    icon: ICON,
    /* resolved when it is tapped, not now: see alertUrl */
    data: { url: text(p.url, 500) },
  }
  const tag = text(p.tag, 100)
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
  return { title: text(p.title, 100) || TITLE, options }
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
 */
async function openOn(url) {
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const tab = tabs.find((t) => t.focused) || tabs[0]
  if (tab) {
    try {
      /* focus first: the right to focus a window lasts only while this click is being handled */
      await tab.focus()
      await tab.navigate(url)
      return
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
