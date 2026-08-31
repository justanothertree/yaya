import { onParty, sendParty, voiceSession } from '../voice/voiceSession'

/**
 * Seeing each other move around the site.
 *
 * The call already puts people in the same room; this puts them on the same PAGE. You see where
 * everyone's pointer is, which page they're on, and — once a window is shared — what they are
 * doing inside it. It rides the call's own channel (see sendParty in voiceSession), so the
 * audience is exactly the audience that can already hear you, enforced by Postgres rather than
 * by this file.
 *
 *
 * WHY THIS IS THE MOST DANGEROUS FEATURE ON THE SITE
 *
 * A pointer stream is not a small fact. At 15 samples a second it tells anyone watching how fast
 * you read, what you hovered and did not click, when you stopped moving and for how long, and
 * which parts of a page you keep coming back to. That is behavioural telemetry, and the fact that
 * it goes to friends rather than an ad network does not change what it is — it changes who has
 * it. Everything below exists because of that.
 *
 *   OFF BY DEFAULT, and off again every time you load the page. Not persisted, deliberately.
 *   A setting you turned on once in March must not still be broadcasting in July because you
 *   forgot it existed. You turn it on for a session, and the session ends when the tab does.
 *
 *   RECIPROCAL, and not negotiable. If you are not sharing your pointer you do not receive
 *   anyone else's — `peers` stays empty and nothing renders. There is no watch-without-being-
 *   watched mode, because that is the mode an observer would want and nobody else would.
 *
 *   PRIVATE PAGES ARE NEVER SHARED. On the routes in PRIVATE_ROUTES the broadcast stops and
 *   you disappear from everyone's screen, exactly as if you had switched it off. Your bank
 *   balance is on one of those pages and the shape of your pointer over a list of transactions
 *   is not something to hand to a friend by accident.
 *
 *   ONLY WHILE THE TAB IS VISIBLE. A backgrounded tab that kept transmitting would report your
 *   idle time to the room, which is a different feature that nobody asked for.
 *
 *   NO SCREEN COORDINATES EVER LEAVE. What goes out is a fraction across the page's content
 *   column and an offset down the document. Raw client coordinates would carry your viewport
 *   size, and with it your monitor and window setup — a fingerprint, given away for nothing,
 *   since it is not even what the receiver needs.
 *
 *
 * WHY NOT PERSIST THE TOGGLE
 *
 * Every other preference here is persisted and this one is not, which is worth being explicit
 * about rather than looking like an oversight. The others are about how the site looks to you.
 * This one is about what you emit to other people, and the failure mode of forgetting is
 * one-directional: nobody has ever been harmed by their trail colour resetting.
 */

/** How often a pointer may go out, at most. */
const SEND_HZ = 15
const SEND_MS = 1000 / SEND_HZ
/** Movement smaller than this (in px) is not worth a message. */
const MIN_MOVE = 3
/** A pointer with nothing new behind it for this long is treated as gone. */
const STALE_MS = 6000

/**
 * Pages that never broadcast, whatever the toggle says.
 *
 * ⚠️ A DENY LIST, and it is checked by prefix so a route with a query string cannot slip past.
 * An allow list would be safer in principle and wrong in practice: a page added next year would
 * silently default to not-shared, the feature would look broken on it, and the fix would be to
 * add it to the list — which is the deny list again, just with a worse failure in between. The
 * rule for adding one here is simple: if a stranger reading over your shoulder would bother you,
 * it belongs on this list.
 */
const PRIVATE_ROUTES = [
  'account-settings',
  'signin',
  'investments',
  'admin',
  'invite',
  'chat',
  'contact',
]

/**
 * A stable colour per person, so the same friend is the same colour everywhere they appear —
 * their cursor, their notes on the keyboard, their name in a roster. Derived from the user id
 * rather than assigned on arrival, so it does not shuffle when someone rejoins.
 */
export function hueFor(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % 360
}

export type PartyPeer = {
  id: string
  name: string
  /** which page they are on, so a cursor is only drawn for people looking at the same one */
  route: string
  /** 0–1 across the content column */
  x: number
  /** pixels down the document */
  y: number
  /** performance.now() of the last update, for the staleness sweep */
  at: number
}

export type PartyState = {
  /** true while WE are broadcasting. Also the gate on receiving — see the reciprocity note. */
  sharing: boolean
  /** everyone else's pointer, keyed by user id */
  peers: Record<string, PartyPeer>
}

let state: PartyState = { sharing: false, peers: {} }
const listeners = new Set<() => void>()

function set(patch: Partial<PartyState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

/** The page you are on, from the hash — the same source the router itself reads. */
export function currentRoute(): string {
  if (typeof window === 'undefined') return 'home'
  const raw = (window.location.hash || '#home').replace('#', '')
  return raw.split('?')[0] || 'home'
}

export function routeIsPrivate(route = currentRoute()): boolean {
  return PRIVATE_ROUTES.some((r) => route === r || route.startsWith(r + '?'))
}

/**
 * The element pointer positions are measured against.
 *
 * ⚠️ The CONTENT COLUMN, not the window. Two people on different sized screens see the same
 * article at different widths but in the same order, so a fraction across the column lands on
 * roughly the same word for both of them; a fraction across the viewport would land in the
 * margin for one of them and mid-sentence for the other. It is still an approximation — text
 * wraps differently at different widths — and it is the closest one available without shipping
 * a DOM anchor with every sample.
 */
function column(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.getElementById('content')
}

let raf = 0
let lastSent = 0
let lastX = -1
let lastY = -1
let pending: { x: number; y: number } | null = null
let detach: Array<() => void> = []

function flush() {
  raf = 0
  if (!pending || !state.sharing) return
  const now = performance.now()
  if (now - lastSent < SEND_MS) {
    // too soon — come back on a later frame rather than dropping the sample
    raf = requestAnimationFrame(flush)
    return
  }
  const box = column()
  if (!box) return
  const r = box.getBoundingClientRect()
  if (r.width < 1) return
  const x = (pending.x - r.left) / r.width
  const y = pending.y + window.scrollY
  if (Math.abs(pending.x - lastX) < MIN_MOVE && Math.abs(pending.y - lastY) < MIN_MOVE) return
  lastX = pending.x
  lastY = pending.y
  lastSent = now
  pending = null
  sendParty('ptr', { route: currentRoute(), x: Number(x.toFixed(4)), y: Math.round(y) })
}

function onMove(e: PointerEvent) {
  if (!state.sharing) return
  if (document.visibilityState !== 'visible') return
  if (routeIsPrivate()) return
  pending = { x: e.clientX, y: e.clientY }
  if (!raf) raf = requestAnimationFrame(flush)
}

/**
 * Tell the room you are no longer anywhere they can see.
 *
 * Sent when you leave for a private page, hide the tab, or switch off. Without it your cursor
 * would simply stop moving and sit there — which reads as "still here, gone quiet" rather than
 * "gone", and the difference matters when the reason you left is that you opened your bank page.
 */
function announceGone() {
  sendParty('gone', {})
}

export const party = {
  getState: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  /**
   * Start or stop sharing. Turning it off also drops everyone else's cursors, because receiving
   * without sending is the one arrangement this feature will not offer.
   */
  setSharing(on: boolean) {
    if (on === state.sharing) return
    if (!on) {
      announceGone()
      set({ sharing: false, peers: {} })
      return
    }
    set({ sharing: true })
  },

  /** Wire the listeners once, at app start. Returns a teardown. */
  start() {
    if (detach.length) return () => {}

    const off = onParty((m) => {
      // ⚠️ reciprocity, enforced on the RECEIVING side too: not sharing means not seeing, even
      // though the messages are arriving on the channel regardless.
      if (!state.sharing) return
      if (m.kind === 'gone') {
        if (!state.peers[m.from]) return
        const next = { ...state.peers }
        delete next[m.from]
        set({ peers: next })
        return
      }
      if (m.kind !== 'ptr') return
      const b = m.body as { route?: unknown; x?: unknown; y?: unknown }
      // Everything off the wire is somebody else's data. A peer running a patched client can
      // send whatever it likes, so nothing here is trusted into a style property unchecked.
      if (typeof b?.route !== 'string' || b.route.length > 64) return
      if (typeof b.x !== 'number' || !Number.isFinite(b.x)) return
      if (typeof b.y !== 'number' || !Number.isFinite(b.y)) return
      set({
        peers: {
          ...state.peers,
          [m.from]: {
            id: m.from,
            name: typeof m.name === 'string' ? m.name.slice(0, 40) : 'Someone',
            route: b.route,
            x: Math.max(-0.5, Math.min(1.5, b.x)),
            y: Math.max(0, Math.min(200000, b.y)),
            at: performance.now(),
          },
        },
      })
    })

    const move = (e: PointerEvent) => onMove(e)
    window.addEventListener('pointermove', move, { passive: true })

    const onHide = () => {
      if (state.sharing && document.visibilityState !== 'visible') announceGone()
    }
    document.addEventListener('visibilitychange', onHide)

    // Leaving for a private page has to withdraw you, not just stop updating you.
    let wasPrivate = routeIsPrivate()
    const onHash = () => {
      const now = routeIsPrivate()
      if (state.sharing && now && !wasPrivate) announceGone()
      wasPrivate = now
    }
    window.addEventListener('hashchange', onHash)

    // A peer who crashed or closed the tab never sends `gone`; this is what clears them.
    const sweep = window.setInterval(() => {
      const now = performance.now()
      const live = Object.values(state.peers).filter((p) => now - p.at < STALE_MS)
      if (live.length !== Object.keys(state.peers).length)
        set({ peers: Object.fromEntries(live.map((p) => [p.id, p])) })
    }, 2000)

    // Leaving the call ends the party with it — there is no co-presence without a room.
    const offVoice = voiceSession.subscribe(() => {
      if (!voiceSession.getState().inCall && (state.sharing || Object.keys(state.peers).length))
        set({ sharing: false, peers: {} })
    })

    detach = [
      off,
      offVoice,
      () => window.removeEventListener('pointermove', move),
      () => document.removeEventListener('visibilitychange', onHide),
      () => window.removeEventListener('hashchange', onHash),
      () => window.clearInterval(sweep),
    ]
    return () => {
      detach.forEach((d) => d())
      detach = []
    }
  },
}
