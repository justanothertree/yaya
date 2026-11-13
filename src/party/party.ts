import { onParty, sendParty, voiceSession } from '../voice/voiceSession'
import { together } from './together'
import { isCursorSkin, myCursor, onCursorChange, type CursorSkin } from '../ui/cursorSkin'
import { labSocial } from '../lab/social/social'
import { isToyId } from '../lab/social/gate'
import { TOY_EVENT, currentToy } from '../lab/links'

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
 *   OFF BY DEFAULT, and off again when the call ends (Evan, 13 Nov). Not persisted,
 *   deliberately. A setting you turned on once in March must not still be broadcasting in July
 *   because you forgot it existed. You turn it on for a call, and the call ends when you leave.
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
/**
 * ⚠️ AND ABOUT HALF THAT OVER A LAB TOY (8 Hz). Measured by the admin's meter (meter.ts): a
 * pointer that never stops is ~13 messages a second at 15 Hz, and Supabase meters every one per
 * person it reaches — the plan's cost section (docs/2026-11-13-lab-social-plan.md) found four
 * people over the free plan's 100 a second. The receiver smooths between samples, so 8 reads as
 * movement rather than steps.
 */
const LAB_SEND_MS = 1000 / 8
/** Movement smaller than this (in px) is not worth a message. */
const MIN_MOVE = 3
/** A pointer with nothing new behind it for this long is treated as gone. */
const STALE_MS = 6000
/**
 * How often to say which room you are in, even standing perfectly still.
 *
 * ⚠️ THIS IS A NEW THING LEAVING YOUR MACHINE, and it is worth being blunt about that rather
 * than filing it under the pointer stream. Until now, going still meant going quiet: no
 * pointermove, no message. Presence has to keep transmitting while you sit and read, because
 * "who is where" that forgets you after six seconds of reading is worse than nothing — it would
 * flicker every friend in and out of the nav bar all evening.
 *
 * What makes it acceptable is that it is strictly COARSER than what is already going out. The
 * pointer stream is fifteen samples a second carrying a position; this is one message every five
 * seconds carrying a room name and nothing else. It rides the same toggle, the same tab-visible
 * rule and the same private-routes deny list, so there is no page you can be seen on that you
 * could not already be seen on.
 */
const HERE_MS = 5000
/** Three missed heartbeats before we decide someone has gone. */
const HERE_STALE_MS = 16000

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
  /**
   * Over a Lab toy, where on it: fractions of the toy's own stage, so two screens of different
   * sizes agree on the spot (a page position would not — the stage is a different size on each).
   * Only sent while the Lab's friends-only gate is open (src/lab/social/gate.ts).
   */
  sub?: string
  tx?: number
  ty?: number
  /** performance.now() of the last update, for the staleness sweep */
  at: number
}

/** A finger touching a Lab toy: a ring that fades where it landed, since a phone has no hover. */
export type PartyTap = { key: number; id: string; sub: string; tx: number; ty: number; at: number }

/**
 * Someone in the call, and the room they are standing in.
 *
 * ⚠️ SEPARATE FROM PartyPeer ON PURPOSE. A pointer that has not moved in six seconds should stop
 * being drawn — a cursor frozen mid-page reads as "still here, gone quiet", which is the exact
 * ambiguity the `gone` message exists to remove. But a PERSON who has not moved in six seconds
 * is still in the room. Two facts with two different lifetimes, so two maps; folding them into
 * one would force a single staleness window to be wrong for one of them.
 */
export type PartyHere = {
  id: string
  name: string
  route: string
  /**
   * The pointer they chose to wear, if they wear one.
   *
   * ⚠️ ON THE PERSON, NOT ON THE POINTER SAMPLE, and that is the whole reason it lives
   * in this type rather than in PartyPeer. A `ptr` goes out fifteen times a second; which cursor
   * somebody is wearing changes about twice a year. Putting it in the sample would mean sending
   * a fact that has not changed, fifteen times a second, per person — a realtime message should
   * carry what changed.
   *
   * So it rides on `where`, which is sent on arrival, on changing page, on the heartbeat, and
   * the moment somebody picks a different one. Missing simply means the plain arrow.
   */
  skin?: CursorSkin
  /**
   * The Lab toy they are on, when their route is `lab` and their Lab allowed it — only in a call
   * where everyone present is their friend (src/lab/social/gate.ts). Checked for shape on
   * arrival (isToyId); the Lab draws it only if it names a toy it has.
   */
  sub?: string
  at: number
}

export type PartyState = {
  /** true while WE are broadcasting. Also the gate on receiving — see the reciprocity note. */
  sharing: boolean
  /** everyone else's pointer, keyed by user id */
  peers: Record<string, PartyPeer>
  /** who is in which room, keyed by user id — outlives their pointer, see PartyHere */
  here: Record<string, PartyHere>
  /** recent taps on Lab toys, newest last; each lives TAP_MS */
  taps: PartyTap[]
}

/** how long a tap's ring stays */
export const TAP_MS = 700

let state: PartyState = { sharing: false, peers: {}, here: {}, taps: [] }
const listeners = new Set<() => void>()

function set(patch: Partial<PartyState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

/** a position as a fraction of a box, with a little room for an edge */
const isFraction = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= -0.05 && v <= 1.05

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

/** the stage of the Lab toy on screen, if there is one: the box Lab positions are measured in */
export function labStage(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>('.lab-toy .lab-stage')
}

/**
 * Where on a Lab toy a point is, when it may be said: on the Lab page, the friends-only gate
 * open, a toy named, and the point over that toy's stage. Null otherwise — and then the pointer
 * goes out exactly as it always has, as a page position.
 */
function labSpot(clientX: number, clientY: number) {
  if (currentRoute() !== 'lab' || !labSocial.allowed()) return null
  const sub = currentToy()
  const stage = labStage()
  if (!sub || !stage) return null
  const r = stage.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return null
  const tx = (clientX - r.left) / r.width
  const ty = (clientY - r.top) / r.height
  if (tx < 0 || tx > 1 || ty < 0 || ty > 1) return null
  return { sub, tx: Number(tx.toFixed(4)), ty: Number(ty.toFixed(4)) }
}

let raf = 0
let lastSent = 0
let lastX = -1
let lastY = -1
let pending: { x: number; y: number } | null = null
let tapKey = 0
let detach: Array<() => void> = []

function flush() {
  raf = 0
  if (!pending || !state.sharing) return
  const now = performance.now()
  const spot = labSpot(pending.x, pending.y)
  if (now - lastSent < (spot ? LAB_SEND_MS : SEND_MS)) {
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
  // the page position always rides along, so a client that predates Lab positions still draws
  // something sensible
  sendParty('ptr', { route: currentRoute(), x: Number(x.toFixed(4)), y: Math.round(y), ...spot })
}

function onMove(e: PointerEvent) {
  if (!state.sharing) return
  if (document.visibilityState !== 'visible') return
  if (routeIsPrivate()) return
  /* ⚠️ A FINGER ON A LAB TOY SENDS TAPS, NOT A TRAIL (onTap below). A drag across a toy's
     stage is playing it, and as a stream it would be the most expensive and least readable
     thing the party could send; the tap says where, which is what a watcher wants. */
  if (e.pointerType !== 'mouse' && labSpot(e.clientX, e.clientY)) return
  pending = { x: e.clientX, y: e.clientY }
  if (!raf) raf = requestAnimationFrame(flush)
}

/** a touch (or pen) on a Lab toy: one message, drawn as a fading ring where it landed */
function onTap(e: PointerEvent) {
  if (!state.sharing || e.pointerType === 'mouse') return
  if (document.visibilityState !== 'visible') return
  const spot = labSpot(e.clientX, e.clientY)
  if (spot) sendParty('tap', { route: 'lab', ...spot })
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

/**
 * Say which room you are in.
 *
 * ⚠️ Checks the deny list itself rather than trusting the caller. There are four call sites —
 * the toggle, hashchange, the heartbeat and visibility — and the one that forgets the check is
 * the one that broadcasts you from your bank page. Cheaper to be certain here once.
 */
function announceHere() {
  if (!state.sharing) return
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  if (routeIsPrivate()) return
  /* ⚠️ the SHAPE only, never the colour. In the party a person's colour is how you tell
     whose cursor is whose — see hueFor — and everybody on the default theme shares an accent,
     so taking their accent too would turn a room into one colour. The shape is theirs; the hue
     stays the room's. */
  const { id } = myCursor()
  const route = currentRoute()
  /* ⚠️ THE TOY ONLY WHEN THE LAB'S GATE SAYS SO: everyone else in the call is a friend. The page
     itself has always gone out to the whole call; which toy you are on is the new, finer fact,
     and it goes to friends or to nobody. */
  const toy = route === 'lab' && labSocial.allowed() ? currentToy() : null
  sendParty('where', {
    route,
    ...(id === 'system' ? {} : { skin: id }),
    ...(toy ? { sub: toy } : {}),
  })
}

/** One shape from either message that proves presence, so the two paths cannot disagree. */
function whereFrom(
  m: { from: string; name?: unknown },
  route: string,
  skin?: CursorSkin,
  sub?: string | null,
): PartyHere {
  return {
    id: m.from,
    name: typeof m.name === 'string' ? m.name.slice(0, 40) : 'Someone',
    route,
    /* ⚠️ A `ptr` CARRIES NO SKIN, SO THE ONE ALREADY KNOWN HAS TO SURVIVE IT. Both
       messages build a PartyHere through here, and a pointer sample arrives fifteen times a
       second — rebuilt without this the skin would be wiped by the very next sample and the
       cursor would flicker back to the default arrow almost immediately. */
    skin: skin ?? state.here[m.from]?.skin,
    /* a `where` says which toy outright (null: none); a pointer sample keeps the one known, the
       same reason as the skin above — and a page that is not the Lab has no toy at all */
    sub:
      route !== 'lab'
        ? undefined
        : sub === undefined
          ? state.here[m.from]?.sub
          : (sub ?? undefined),
    at: performance.now(),
  }
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
      set({ sharing: false, peers: {}, here: {}, taps: [] })
      return
    }
    set({ sharing: true })
    // say where you are immediately: waiting up to five seconds to appear reads as broken
    announceHere()
  },

  /** Wire the listeners once, at app start. Returns a teardown. */
  start() {
    if (detach.length) return () => {}

    const off = onParty((m) => {
      // ⚠️ reciprocity, enforced on the RECEIVING side too: not sharing means not seeing, even
      // though the messages are arriving on the channel regardless.
      if (!state.sharing) return
      if (m.kind === 'gone') {
        if (!state.peers[m.from] && !state.here[m.from]) return
        const next = { ...state.peers }
        delete next[m.from]
        const nextHere = { ...state.here }
        delete nextHere[m.from]
        set({ peers: next, here: nextHere })
        return
      }
      if (m.kind === 'where') {
        const b = m.body as { route?: unknown; skin?: unknown; sub?: unknown }
        // somebody else's string, on its way into a lookup and a title attribute
        if (typeof b?.route !== 'string' || b.route.length > 64) return
        /* checked against the real list rather than taken as given: it decides which picture
           gets drawn, and the client that sent it is one anybody can rewrite */
        const skin = isCursorSkin(b.skin) && b.skin !== 'system' ? b.skin : undefined
        const sub = isToyId(b.sub) ? b.sub : null
        set({ here: { ...state.here, [m.from]: whereFrom(m, b.route, skin, sub) } })
        return
      }
      if (m.kind === 'tap') {
        const b = m.body as { sub?: unknown; tx?: unknown; ty?: unknown }
        if (!isToyId(b?.sub) || !isFraction(b.tx) || !isFraction(b.ty)) return
        const now = performance.now()
        set({
          taps: [
            ...state.taps.filter((t) => now - t.at < TAP_MS).slice(-11),
            { key: ++tapKey, id: m.from, sub: b.sub, tx: b.tx, ty: b.ty, at: now },
          ],
        })
        return
      }
      if (m.kind !== 'ptr') return
      const b = m.body as {
        route?: unknown
        x?: unknown
        y?: unknown
        sub?: unknown
        tx?: unknown
        ty?: unknown
      }
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
            // a Lab position only whole: a toy and both fractions, or none of it
            ...(isToyId(b.sub) && isFraction(b.tx) && isFraction(b.ty)
              ? { sub: b.sub, tx: b.tx, ty: b.ty }
              : {}),
            at: performance.now(),
          },
        },
        // a moving pointer is also proof of presence, so it counts as a heartbeat
        here: { ...state.here, [m.from]: whereFrom(m, b.route) },
      })
    })

    const move = (e: PointerEvent) => onMove(e)
    window.addEventListener('pointermove', move, { passive: true })
    const tap = (e: PointerEvent) => onTap(e)
    window.addEventListener('pointerdown', tap, { passive: true })

    const onHide = () => {
      if (!state.sharing) return
      if (document.visibilityState !== 'visible') announceGone()
      // coming back has to re-announce, or you stay invisible until you move the mouse
      else announceHere()
    }
    document.addEventListener('visibilitychange', onHide)

    // Leaving for a private page has to withdraw you, not just stop updating you.
    let wasPrivate = routeIsPrivate()
    const onHash = () => {
      const now = routeIsPrivate()
      if (state.sharing && now && !wasPrivate) announceGone()
      /* ⚠️ Announce on ARRIVAL, not only on the next heartbeat. Changing rooms is the one moment
         this feature exists to show, and up to five seconds of showing a friend in the room they
         just left is the difference between "look, they followed me" and a bug. */
      if (!now) announceHere()
      wasPrivate = now
    }
    window.addEventListener('hashchange', onHash)
    // a different Lab toy replaces the address without a hashchange (GpuLab's pick)
    window.addEventListener(TOY_EVENT, announceHere)
    // and the Lab's gate opening or closing changes what `where` may say, so say it again
    const offLab = labSocial.subscribe(announceHere)

    const beat = window.setInterval(announceHere, HERE_MS)

    /* ⚠️ trying a different pointer on says so at once rather than at the next heartbeat.
       The beat would get there eventually, and "eventually" for a thing you just changed while
       somebody is watching reads as it not having worked. */
    const offCursor = onCursorChange(announceHere)

    // A peer who crashed or closed the tab never sends `gone`; this is what clears them.
    const sweep = window.setInterval(() => {
      const now = performance.now()
      const live = Object.values(state.peers).filter((p) => now - p.at < STALE_MS)
      const lively = Object.values(state.here).filter((p) => now - p.at < HERE_STALE_MS)
      const patch: Partial<PartyState> = {}
      if (live.length !== Object.keys(state.peers).length)
        patch.peers = Object.fromEntries(live.map((p) => [p.id, p]))
      if (lively.length !== Object.keys(state.here).length)
        patch.here = Object.fromEntries(lively.map((p) => [p.id, p]))
      if (state.taps.some((t) => now - t.at >= TAP_MS))
        patch.taps = state.taps.filter((t) => now - t.at < TAP_MS)
      if (patch.peers || patch.here || patch.taps) set(patch)
    }, 2000)

    /**
     * ⚠️ THE POINTER IS PART OF "SHARE EVERYTHING", and it has no switch of its own any more.
     *
     * It had one, sitting next to the one that means all of it, and the pair read as a puzzle:
     * you turned on sharing everything and your cursor still was not there, because the cursor
     * was the one thing "everything" did not cover. Showing where you are pointing is the
     * smallest and most obviously co-presence thing on the list — if anything belongs under that
     * switch it is this.
     *
     * ⚠️ Subscribed FROM HERE, like every other room, because together.ts holds a preference
     * and must not know what any of this means — see the note at the top of that file.
     *
     * ⚠️ The switch lasts one call (Evan, 13 Nov). It used to be remembered across visits, so it
     * came back on by itself in every new call — against the promise at the top of this file.
     * Leaving the call now turns it off (below), and nothing is kept across a reload.
     */
    const offAll = together.subscribe(() => party.setSharing(together.getState().on))
    if (together.getState().on) party.setSharing(true)

    // Leaving the call ends the party with it — there is no co-presence without a room — and
    // ends the switch too, so the next call starts with nothing shared until you say so.
    const offVoice = voiceSession.subscribe(() => {
      if (voiceSession.getState().inCall) return
      if (state.sharing || Object.keys(state.peers).length || Object.keys(state.here).length)
        set({ sharing: false, peers: {}, here: {}, taps: [] })
      if (together.getState().on) together.setOn(false)
    })

    detach = [
      off,
      offCursor,
      offVoice,
      offAll,
      offLab,
      () => window.removeEventListener(TOY_EVENT, announceHere),
      () => window.removeEventListener('pointermove', move),
      () => window.removeEventListener('pointerdown', tap),
      () => document.removeEventListener('visibilitychange', onHide),
      () => window.removeEventListener('hashchange', onHash),
      () => window.clearInterval(beat),
      () => window.clearInterval(sweep),
    ]
    return () => {
      detach.forEach((d) => d())
      detach = []
    }
  },
}
