import { onParty, sendParty, voiceSession } from '../voice/voiceSession'

/**
 * Windows the party is looking at together.
 *
 * The model you asked for: every window you have open is either YOUR copy or the PARTY's copy.
 * Nothing is shared by default; somebody offers a window, and anyone who wants it follows along.
 *
 * ⚠️ WHAT TRAVELS IS THE WINDOW'S SETTINGS, NOT ITS PICTURE. Screen sharing already exists in the
 * call and is the wrong tool here: it sends a video of one person's window, so it costs upload
 * bandwidth, arrives blurry, and gives everyone else a rectangle they cannot touch. Sending the
 * settings instead means every browser renders the window itself, at full resolution, still
 * interactive, for about a hundred bytes. It also means "joining" is a real state rather than a
 * viewing mode.
 *
 * The trade is worth naming: what you see is the same window, not the same pixels. In the
 * visualiser that means the same modes, colours and motion drawing whatever audio YOU are
 * hearing — which, in a call, is largely the same audio anyway. Nobody's local sound is
 * transported, and no window is ever driven remotely without being followed on purpose.
 *
 *
 * WHO CAN DO WHAT
 *
 * Anyone may offer; nobody is made to follow. Following is a LOCAL decision and the sharer is
 * never told — there is no "Evan is watching your window" signal, because that would turn a
 * convenience into an audience, and people behave differently in front of an audience.
 *
 * A follower's own controls keep working. Touching one stops you following rather than fighting
 * the incoming state, which is the only behaviour that does not feel broken: a slider that snaps
 * back half a second after you move it reads as the site being buggy, not as the site being
 * shared.
 *
 * Like everything in src/party, this rides the call's own channel, so the audience is exactly the
 * people already in the call and Postgres decides that, not this file.
 */

/** Most state updates a second. Dials move continuously while dragged; nobody needs 60 of those. */
const SEND_MS = 200
/** An offer with nothing behind it for this long is treated as withdrawn. */
const STALE_MS = 20000

export type Offer = {
  /** the window's id, e.g. 'visualizer' */
  id: string
  /** who is sharing it */
  by: string
  name: string
  at: number
}

export type SharedState = {
  /** windows other people are offering, keyed `${peer}:${windowId}` */
  offers: Record<string, Offer>
  /** window ids WE are offering */
  sharing: string[]
  /** window id → the peer whose copy we are following */
  following: Record<string, string>
  /**
   * Peers whose windows we follow WHOLESALE, including ones they have not opened yet.
   *
   * ⚠️ Kept as a standing decision rather than applied once and forgotten, because the thing
   * that made this manual was not the first join — it was the second and the third. Somebody
   * opens the instrument, you join; they open the visualiser, you join again. Remembering the
   * answer means "I am watching what Josh is doing" is one decision instead of one per window
   * for the rest of the call.
   */
  followingAll: string[]
}

let state: SharedState = { offers: {}, sharing: [], following: {}, followingAll: [] }
const listeners = new Set<() => void>()

function set(patch: Partial<SharedState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

/** the latest state each sharer has sent, per window, so a late follower starts in the right place */
const latest = new Map<string, unknown>()
/** what each of our own shared windows should broadcast when asked */
const snapshots = new Map<string, () => unknown>()
/** what to do with an update for a window we follow */
const appliers = new Map<string, (data: unknown) => void>()

const lastSent = new Map<string, number>()
const queued = new Map<string, unknown>()
let flushTimer = 0

const key = (peer: string, id: string) => `${peer}:${id}`

/** ⚠️ Ids become map keys and are rendered; a peer supplies them, so they are bounded here. */
function cleanId(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.slice(0, 40).replace(/[^\w:-]/g, '')
  return t || null
}

function flush() {
  flushTimer = 0
  const now = performance.now()
  for (const [id, data] of queued) {
    const last = lastSent.get(id) ?? 0
    if (now - last < SEND_MS) {
      // still too soon for this window — come back for it
      if (!flushTimer) flushTimer = window.setTimeout(flush, SEND_MS - (now - last))
      continue
    }
    queued.delete(id)
    lastSent.set(id, now)
    sendParty('win', { act: 'state', id, data })
  }
}

export const shared = {
  getState: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  /**
   * Register a window so it CAN be shared. Does not share it — that is `offer`.
   *
   * `snapshot` produces the state to send; `apply` receives somebody else's. A window that only
   * ever follows can pass a snapshot that returns null, and one that only ever leads can ignore
   * apply — but almost every window wants both, because whoever is sharing can change.
   */
  register(id: string, snapshot: () => unknown, apply: (data: unknown) => void) {
    snapshots.set(id, snapshot)
    appliers.set(id, apply)
    return () => {
      snapshots.delete(id)
      appliers.delete(id)
    }
  },

  /** Start offering a window to the room. */
  offer(id: string, name: string) {
    if (state.sharing.includes(id)) return
    set({ sharing: [...state.sharing, id] })
    sendParty('win', { act: 'offer', id, name })
    shared.push(id)
  },

  /** Stop offering it. Anyone following stops with it — see the `drop` handler. */
  withdraw(id: string) {
    if (!state.sharing.includes(id)) return
    set({ sharing: state.sharing.filter((x) => x !== id) })
    sendParty('win', { act: 'drop', id })
  },

  /** Send this window's current state, throttled. Call it whenever the window changes. */
  push(id: string) {
    if (!state.sharing.includes(id)) return
    const snap = snapshots.get(id)
    if (!snap) return
    queued.set(id, snap())
    if (!flushTimer) flushTimer = window.setTimeout(flush, 0)
  },

  /** Follow somebody's copy of a window, and adopt whatever they last sent straight away. */
  follow(id: string, peer: string) {
    set({ following: { ...state.following, [id]: peer } })
    const seed = latest.get(key(peer, id))
    if (seed !== undefined) appliers.get(id)?.(seed)
  },

  /**
   * Go back to your own copy.
   *
   * ⚠️ Called by the window itself whenever you touch one of its controls. Fighting an incoming
   * update is not a behaviour anyone can work with — a slider that springs back reads as broken,
   * so touching a control means you have taken the window back.
   */
  unfollow(id: string) {
    if (!(id in state.following)) return
    const peer = state.following[id]
    const next = { ...state.following }
    delete next[id]
    /**
     * ⚠️ TAKING ONE WINDOW BACK ENDS THE STANDING ANSWER for that person, and it has to.
     * Otherwise touching a slider would drop you out of the window and the wholesale follow
     * would put you straight back in — the site and you pulling in opposite directions, which
     * is the exact failure the note at the top of this file exists to avoid.
     */
    set({ following: next, followingAll: state.followingAll.filter((p) => p !== peer) })
  },

  /** Follow everything somebody is showing, and everything they show next. */
  followAll(peer: string) {
    const mine = Object.values(state.offers).filter((o) => o.by === peer)
    const following = { ...state.following }
    for (const o of mine) following[o.id] = peer
    set({
      following,
      followingAll: state.followingAll.includes(peer)
        ? state.followingAll
        : [...state.followingAll, peer],
    })
    for (const o of mine) {
      const seed = latest.get(key(peer, o.id))
      if (seed !== undefined) appliers.get(o.id)?.(seed)
    }
  },

  /** Stop following everything of theirs, and stop expecting more. */
  unfollowAll(peer: string) {
    const following = { ...state.following }
    for (const [id, by] of Object.entries(following)) if (by === peer) delete following[id]
    set({ following, followingAll: state.followingAll.filter((p) => p !== peer) })
  },

  /** Everyone who is offering at least one window right now. */
  sharers(): Array<{ by: string; name: string; count: number }> {
    const seen = new Map<string, { by: string; name: string; count: number }>()
    for (const o of Object.values(state.offers)) {
      const got = seen.get(o.by)
      if (got) got.count++
      else seen.set(o.by, { by: o.by, name: o.name, count: 1 })
    }
    return [...seen.values()]
  },

  /** Everyone offering this window right now. */
  offersFor(id: string): Offer[] {
    return Object.values(state.offers).filter((o) => o.id === id)
  },

  start() {
    const off = onParty((m) => {
      const b = m.body as { act?: unknown; id?: unknown; name?: unknown; data?: unknown }
      if (m.kind !== 'win') return
      const id = cleanId(b?.id)

      if (b?.act === 'ask') {
        // A newcomer wants to know what is on offer. Everyone sharing answers with an offer and
        // the current state, so joining a party in progress does not mean waiting for the next
        // time somebody happens to move a slider.
        for (const own of state.sharing) {
          sendParty('win', { act: 'offer', id: own, name: own })
          const snap = snapshots.get(own)
          if (snap) sendParty('win', { act: 'state', id: own, data: snap() })
        }
        return
      }

      if (!id) return

      if (b.act === 'offer') {
        /* ⚠️ after the offer is recorded, not before: follow() seeds from what they last sent */
        const wholesale = state.followingAll.includes(m.from)
        set({
          offers: {
            ...state.offers,
            [key(m.from, id)]: {
              id,
              by: m.from,
              name: typeof m.name === 'string' ? m.name.slice(0, 40) : 'Someone',
              at: performance.now(),
            },
          },
        })
        if (wholesale) shared.follow(id, m.from)
        return
      }

      if (b.act === 'drop') {
        const offers = { ...state.offers }
        delete offers[key(m.from, id)]
        const following = { ...state.following }
        // stop following a window nobody is sharing any more, rather than leaving it frozen on
        // the last thing that arrived
        if (following[id] === m.from) delete following[id]
        set({ offers, following })
        latest.delete(key(m.from, id))
        return
      }

      if (b.act === 'state') {
        latest.set(key(m.from, id), b.data)
        // keep the offer alive — a sharer who is actively pushing state is plainly still sharing
        const k = key(m.from, id)
        if (state.offers[k])
          set({ offers: { ...state.offers, [k]: { ...state.offers[k], at: performance.now() } } })
        if (state.following[id] !== m.from) return
        try {
          appliers.get(id)?.(b.data)
        } catch {
          /* a window that cannot read an update keeps its own state */
        }
      }
    })

    // ask once on arrival, so a late joiner sees what is already being shared
    sendParty('win', { act: 'ask' })

    const sweep = window.setInterval(() => {
      const now = performance.now()
      const live = Object.entries(state.offers).filter(([, o]) => now - o.at < STALE_MS)
      if (live.length !== Object.keys(state.offers).length)
        set({ offers: Object.fromEntries(live) })
    }, 5000)

    // leaving the call ends every shared window with it
    const offVoice = voiceSession.subscribe(() => {
      if (voiceSession.getState().inCall) return
      if (!state.sharing.length && !Object.keys(state.offers).length) return
      latest.clear()
      set({ offers: {}, sharing: [], following: {} })
    })

    return () => {
      off()
      offVoice()
      window.clearInterval(sweep)
      window.clearTimeout(flushTimer)
      flushTimer = 0
      latest.clear()
      set({ offers: {}, sharing: [], following: {} })
    }
  },
}
