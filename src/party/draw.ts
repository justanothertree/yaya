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

let seq = 0
let onRemote: ((s: Stroke, from: string) => void) | null = null
let onUndo: ((id: string) => void) | null = null
let onPaper: ((bg: string | null) => void) | null = null
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

  /** what to do when somebody takes a stroke back, or repaints the paper */
  setUndoHandler(fn: ((id: string) => void) | null) {
    onUndo = fn
  },
  setPaperHandler(fn: ((bg: string | null) => void) | null) {
    onPaper = fn
  },

  setOn(on: boolean) {
    if (on === state.on) return
    if (!on) sendParty('art', { leave: true })
    set({ on, peers: on ? state.peers : {} })
  },

  /**
   * Name a stroke before it is committed, so it can be referred to later.
   *
   * ⚠️ NUMBERED LOCALLY AND NAMESPACED ON ARRIVAL. The sender counts from one and does not need
   * to know its own peer id; the receiver files it under `${'${from}'}:${'${n}'}`. Two people cannot
   * collide, and nobody can name a stroke into somebody else's namespace, because the only
   * name a message can produce is built from the id the transport itself stamped on it.
   */
  mark(): string {
    return `me:${++seq}`
  },

  /** Offer a finished stroke to the room. A no-op unless drawing together is on. */
  send(s: Stroke) {
    if (!state.on) return
    sendParty('art', { s, n: Number(s.id?.slice(3)) || 0 })
  },

  /**
   * ⚠️ UNDO HAD TO TRAVEL TOO, and it could not until strokes could be named.
   *
   * Only finished strokes were ever sent, so taking one back was a private event: your copy lost
   * the line and everyone else kept it, and from then on the two pictures disagreed for good.
   * Worse, it was silent — the person who undid saw the right thing.
   *
   * A stroke now carries a transient id, so "remove the one I called this" is a message anybody
   * can act on without knowing anything about the order of their own array. The id is assigned
   * where the stroke is sent, lives only in memory, and is never written to a file: packDrawing
   * lists the fields it emits, so an extra property simply does not travel to disk.
   */
  undo(id: string) {
    if (!state.on || !id.startsWith('me:')) return
    sendParty('art', { undo: Number(id.slice(3)) || 0 })
  },

  /** The paper everyone is drawing on. Sent because it is the one thing that is not a stroke. */
  paper(bg: string | null) {
    if (!state.on) return
    sendParty('art', { bg: bg ?? 0 })
  },

  start() {
    if (detach.length) return () => {}
    const off = onParty((m) => {
      if (m.kind !== 'art' || !state.on) return
      const b = m.body as {
        s?: unknown
        n?: unknown
        leave?: unknown
        undo?: unknown
        bg?: unknown
      }
      if (typeof b?.undo === 'number') {
        if (!allowed(m.from)) return
        // ⚠️ built from the sender's own id, so nobody can take back a stroke that is not theirs
        onUndo?.(`${m.from}:${b.undo}`)
        return
      }
      if (b && 'bg' in b) {
        if (!allowed(m.from)) return
        // ⚠️ the same hex test the file reader uses; a colour goes into a style, so never raw
        const c = b.bg
        if (c === 0 || c === null) onPaper?.(null)
        else if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) onPaper?.(c)
        return
      }
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
      s.id = `${m.from}:${typeof b.n === 'number' ? b.n : 0}`
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
