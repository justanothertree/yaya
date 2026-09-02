import { onParty, sendParty, voiceSession } from '../voice/voiceSession'
import { readStroke, type Stroke } from '../draw/strokes'

/**
 * Drawing on the same page as somebody else.
 *
 * ⚠️ STROKES TRAVEL, NOT PIXELS — the same trade as the jam, and it holds for the same reasons. A
 * committed stroke is a tool, a colour and a short list of points: under a hundred bytes, against
 * a canvas share that would be a video of one person's window. So everybody renders it themselves
 * at their own resolution, it stays sharp, and it costs about what a chat message costs.
 *
 * ⚠️ A STROKE IS SENT WHEN IT IS FINISHED, not while it is being drawn. Streaming every pointer
 * move would be dozens of messages a second per person for a line that is not final yet, and the
 * only thing it buys is watching a hand move. What it costs is a shared picture that disagrees
 * with itself whenever somebody changes their mind mid-stroke, because half the room already has
 * the abandoned version. Finished strokes are atomic, so the picture is always somebody's actual
 * work.
 *
 * There is deliberately no conflict resolution, because strokes do not conflict: paint is applied
 * in the order it arrives, and two people drawing in the same place get what two people drawing in
 * the same place get. Ordering differences between machines are invisible unless the strokes
 * overlap, and when they do, "whoever's arrived last is on top" is what happens on paper too.
 */

/** Most strokes a second one person may add before the rest are dropped. */
const BURST = 20
const WINDOW_MS = 1000

type State = { on: boolean; peers: Record<string, string> }
let state: State = { on: false, peers: {} }
const listeners = new Set<() => void>()

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

const rate = new Map<string, number[]>()
function allowed(peer: string): boolean {
  const now = performance.now()
  const hits = (rate.get(peer) ?? []).filter((t) => now - t < WINDOW_MS)
  if (hits.length >= BURST) {
    rate.set(peer, hits)
    return false
  }
  hits.push(now)
  rate.set(peer, hits)
  return true
}

let onRemote: ((s: Stroke, from: string) => void) | null = null
let detach: Array<() => void> = []

export const drawParty = {
  getState: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  /** The room hands over what to do with somebody else's stroke. */
  setHandler(fn: ((s: Stroke, from: string) => void) | null) {
    onRemote = fn
  },

  setOn(on: boolean) {
    if (on === state.on) return
    if (!on) sendParty('art', { leave: true })
    set({ on, peers: on ? state.peers : {} })
  },

  /** Offer a finished stroke to the room. A no-op unless drawing together is on. */
  send(s: Stroke) {
    if (!state.on) return
    sendParty('art', { s })
  },

  start() {
    if (detach.length) return () => {}
    const off = onParty((m) => {
      if (m.kind !== 'art' || !state.on) return
      const b = m.body as { s?: unknown; leave?: unknown }
      if (b?.leave) {
        const peers = { ...state.peers }
        delete peers[m.from]
        set({ peers })
        return
      }
      if (!allowed(m.from)) return
      /**
       * ⚠️ Through the same reader every other path uses. A stroke off the wire ends up in a
       * canvas call and in the picture somebody may then save to their profile, so a peer's
       * data gets exactly the validation a file's would: known tool, hex colour, clamped
       * numbers, bounded point count.
       */
      const s = readStroke(b.s)
      if (!s) return
      const name = typeof m.name === 'string' ? m.name.slice(0, 40) : 'Someone'
      if (state.peers[m.from] !== name) set({ peers: { ...state.peers, [m.from]: name } })
      try {
        onRemote?.(s, m.from)
      } catch {
        /* a room that cannot take a stroke keeps its own picture */
      }
    })

    const offVoice = voiceSession.subscribe(() => {
      if (!voiceSession.getState().inCall && (state.on || Object.keys(state.peers).length))
        set({ on: false, peers: {} })
    })

    detach = [off, offVoice]
    return () => {
      detach.forEach((d) => d())
      detach = []
    }
  },
}
