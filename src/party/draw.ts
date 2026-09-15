import { myPeerId, onParty, sendParty, voiceSession } from '../voice/voiceSession'
import { readStroke, type Stroke } from '../draw/strokes'
import { readLayerOp, type LayerOp } from '../draw/layerOps'

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

/**
 * ⚠️ TURNING SHARING ON USED TO PUT YOU IN FRONT OF A BLANK PAGE.
 *
 * Only finished strokes travel, and only from the moment you are listening — so everything drawn
 * before you arrived simply did not exist for you. Two people were then drawing on two different
 * pictures, with nothing on screen to say so, and every stroke after that made the gap wider. It
 * is the same failure clearing and undo each had, one layer up: the room had messages for
 * CHANGES and none for the state those changes are changes to.
 *
 * So a blank arrival asks, and whoever has the picture sends it.
 *
 * ⚠️ ONLY WHEN YOUR PAGE IS BLANK, and that is a rule about consent rather than about bytes. If
 * you have drawn something, you are not joining their picture — you are bringing your own, and
 * replacing it with theirs would destroy work to fix a synchronisation problem. Two people who
 * each already have a drawing stay as they are; there is no honest merge of two different
 * pictures, and pretending otherwise would pick a winner silently.
 */
const ASK_FOR_MS = 12000
/**
 * Packed JSON, split so no single message is enormous.
 *
 * ⚠️ SIZED FROM THE FORMAT'S OWN MAXIMUM, not from a comfortable-looking number. A drawing
 * tops out at MAX_STROKES, which packs to roughly a megabyte — so the pair below has to cover
 * that, or the largest pictures would be the ones that silently sent nothing and the feature
 * would fail exactly where a blank page is most obvious. Measured: 240 strokes of 60 points packs
 * to 63kB, so a full one is about 23 of these.
 *
 * ⚠️ FEWER, BIGGER MESSAGES rather than many small ones. The chunking exists to stay under
 * a per-message size limit; a hundred sends in a tight loop trades that for a per-second rate
 * limit, which drops messages instead of rejecting them and would leave a transfer permanently
 * one chunk short.
 */
const CHUNK = 48000
/** Only ever a limit on what a peer may make US hold while a transfer is in flight. */
const MAX_CHUNKS = 40

let asking = 0
let parts: string[] = []
let partIds: unknown[] = []
let partHidden: unknown[] = []
let partsOf = 0
let answerTimer: ReturnType<typeof setTimeout> | null = null

/**
 * ⚠️ THE ASK HAS TO BE REPEATED, and not asking twice is what made joining a drawing already
 * in progress land on a blank page. "Share everything" is REMEMBERED across visits, so for anyone
 * who had it on last time the switch is already true when the room mounts — which is the one
 * moment the call's channel is least likely to exist yet. sendParty drops a message on the floor
 * when there is no channel, silently and correctly, so the single ask evaporated and nothing ever
 * asked again: a blank page, no error, and every stroke afterwards widening the gap.
 *
 * It stops the instant a chunk arrives, or the instant this page has a picture of its own — at
 * that point you are not joining theirs, and the room's own rule takes over.
 */
let askTimer: ReturnType<typeof setInterval> | null = null
let asks = 0
const MAX_ASKS = 8
const ASK_EVERY_MS = 1500

function stopAsking() {
  if (askTimer) clearInterval(askTimer)
  askTimer = null
  asks = 0
}

function resetCatchUp() {
  asking = 0
  parts = []
  partIds = []
  partHidden = []
  partsOf = 0
  stopAsking()
  if (answerTimer) clearTimeout(answerTimer)
  answerTimer = null
}

/**
 * Somebody else's stroke names, in the names THIS machine uses.
 *
 * ⚠️ WITHOUT THIS, EVERY EDIT TO AN EXISTING STROKE WAS A NO-OP ON THE FAR END. A stroke is
 * numbered locally as `me:4` and filed by everyone else under `${'${from}'}:4` (see mark), so an op
 * that names strokes — dragging a selection, restyling one — travelled carrying names that
 * exist on the sender's machine and nowhere else. The receiver looked them up, found nothing,
 * and changed nothing: the drag simply did not happen for the other person, with both ends
 * believing it had. The stroke and undo paths never hit this because they send a NUMBER and let
 * the receiver build the name; these ops carry a list, so the list is translated instead.
 *
 * Both directions: their `me:` is our `${'${from}'}:`, and our own id coming back is our `me:`.
 * Built from the id the transport stamped, so it needs no trust — the same reasoning as the
 * rename in the picture handler.
 */
function theirIds(op: LayerOp, from: string): LayerOp {
  if (op.k !== 'style' && op.k !== 'xform') return op
  const mine = myPeerId()
  const ids = op.ids.map((id) => {
    if (id.startsWith('me:')) return `${from}:${id.slice(3)}`
    if (mine && id.startsWith(`${mine}:`)) return `me:${id.slice(mine.length + 1)}`
    return id
  })
  return { ...op, ids }
}

let seq = 0
let onRemote: ((s: Stroke, from: string) => void) | null = null
let onUndo: ((id: string) => void) | null = null
let onPaper: ((bg: string | null) => void) | null = null
let onClear: (() => void) | null = null
/** the whole picture, for somebody who just arrived to a drawing already in progress */
type Picture = { packed: unknown; ids: Array<string | undefined>; hidden: number[] }
let onPicture: ((pic: Picture) => void) | null = null
let onLayers: ((op: LayerOp) => void) | null = null
let onReel: ((r: { frame: number | null; fps: number }) => void) | null = null
let myPicture: (() => Picture | null) | null = null
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
  setClearHandler(fn: (() => void) | null) {
    onClear = fn
  },
  /** ⚠️ Takes a PACKED drawing straight off the wire — the room hands it to readDrawing, the
      same validator a file from a stranger's gallery goes through. Nothing here trusts it. */
  setPictureHandler(fn: ((pic: Picture) => void) | null) {
    onPicture = fn
  },
  /** What to send somebody who arrives to a drawing already in progress. Null means "I have
      nothing", which is also the answer while your own page is blank. */
  setPictureSource(fn: (() => Picture | null) | null) {
    myPicture = fn
  },

  setLayerHandler(fn: ((op: LayerOp) => void) | null) {
    onLayers = fn
  },
  setReelHandler(fn: ((r: { frame: number | null; fps: number }) => void) | null) {
    onReel = fn
  },

  /**
   * Which frame the room is looking at, and how fast it plays.
   *
   * ⚠️ THE FRAME IS SHARED, UNLIKE THE LAYER YOU ARE DRAWING ON, and the difference is worth
   * saying because they look like the same kind of thing. Two people on different LAYERS of one
   * picture both see everything either of them draws — that is collaboration. Two people on
   * different FRAMES see different pictures, which is not a shared canvas at all; it is the state
   * this whole module exists to prevent, reached by pressing a button that looks harmless.
   *
   * ⚠️ PLAYING IS NOT SHARED, though, and is the one exception. The play loop writes the
   * frame on every tick, so broadcasting it would be a message per frame per person; and watching
   * it back is a preview you take and then return from, not a change to the picture. Your view
   * rejoins theirs when you stop.
   */
  reel(frame: number | null, fps: number) {
    if (!state.on) return
    sendParty('art', { reel: { f: frame, fps } })
  },

  /**
   * Rearranging the layers, for everybody.
   *
   * ⚠️ THE ONE CHANGE NOBODY CAN SEE GO WRONG. A stroke that does not arrive is one stroke
   * missing. A reorder or a delete that does not arrive REWRITES which layer existing strokes sit
   * on — so the same picture is painted in a different order on one screen, or is missing a layer
   * on another, and neither person has anything on screen telling them the two have parted. See
   * applyLayerOp, which both ends run so they cannot disagree about what the change meant.
   */
  layers(op: LayerOp) {
    if (!state.on) return
    sendParty('art', { lay: op })
  },

  /**
   * "I just got here and my page is blank — does anyone have the picture?"
   *
   * ⚠️ ASKED BY THE NEWCOMER, not offered by the room. An offer would mean everybody pushing
   * their whole drawing at everybody else every time somebody's sharing switch flipped, and the
   * one person who needs it is the only one who knows they need it. Asking also makes the
   * accept window narrow: a picture that arrives while nobody asked is dropped.
   */
  catchUp() {
    if (!state.on) return
    resetCatchUp()
    const ask = () => {
      if (!state.on) return stopAsking()
      /* a picture of our own means we are no longer arriving to theirs — the room refuses an
         answer in that state anyway, so holding the window open would only invite one */
      if (myPicture?.()) return stopAsking()
      if (++asks > MAX_ASKS) return stopAsking()
      asking = Date.now()
      sendParty('art', { want: 1 })
    }
    ask()
    askTimer = setInterval(ask, ASK_EVERY_MS)
  },

  setOn(on: boolean) {
    if (on === state.on) return
    if (!on) sendParty('art', { leave: true })
    // a transfer in flight is about a room you are no longer in
    if (!on) resetCatchUp()
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

  /**
   * Start again — everybody.
   *
   * ⚠️ CLEARING WAS PRIVATE, and it was the worst kind of private. Undo already travelled and
   * paper already travelled, but "✕ Clear" only emptied your own array: you got a blank page,
   * everyone else kept the drawing, and from that moment the two pictures disagreed about
   * everything with nothing on screen to say so. You would carry on drawing into what you
   * thought was empty space.
   *
   * ⚠️ Not expressible as strokes. The module's whole premise is that strokes never conflict —
   * paint lands on paint — which is why there is no conflict resolution here. A clear is the
   * opposite kind of event: it is about the document rather than a mark on it, and it is exactly
   * why `undo`, `paper` and now this are separate messages rather than clever strokes.
   */
  clear() {
    if (!state.on) return
    sendParty('art', { clear: true })
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
        clear?: unknown
        want?: unknown
        pic?: unknown
        i?: unknown
        of?: unknown
        ids?: unknown
        hid?: unknown
        lay?: unknown
        reel?: unknown
      }
      if (b && 'reel' in b) {
        if (!allowed(m.from)) return
        const r = b.reel as { f?: unknown; fps?: unknown }
        if (!r || typeof r !== 'object') return
        /* clamped to the editor's own limits — 60 frames and 24fps — because these SIZE things:
           a frame number is used to step through, and an fps of nought is a timer that never
           fires while an enormous one is a render loop with no brakes */
        const f =
          r.f === null
            ? null
            : typeof r.f === 'number' && Number.isInteger(r.f) && r.f >= 0 && r.f < 60
              ? r.f
              : undefined
        if (f === undefined) return
        const fps =
          typeof r.fps === 'number' && Number.isFinite(r.fps)
            ? Math.max(1, Math.min(24, Math.round(r.fps)))
            : 8
        onReel?.({ frame: f, fps })
        return
      }
      if (b && 'lay' in b) {
        if (!allowed(m.from)) return
        const op = readLayerOp(b.lay)
        if (op) onLayers?.(theirIds(op, m.from))
        return
      }
      /**
       * Somebody arrived to a blank page and wants what is already drawn.
       *
       * ⚠️ ANSWERED BY ONE PERSON, WITHOUT ELECTING ONE. Everyone able to answer waits a
       * short random moment and drops out the instant they see somebody else's first chunk. No
       * coordinator, no tie-break on peer ids, nothing to be wrong when a peer list is
       * momentarily out of date — and in a room of two, which is nearly every room, it costs one
       * unnoticeable delay.
       */
      if (b?.want === 1) {
        if (!allowed(m.from)) return
        const mine = myPicture?.()
        if (!mine) return
        if (answerTimer) clearTimeout(answerTimer)
        answerTimer = setTimeout(
          () => {
            answerTimer = null
            if (!state.on) return
            let text: string
            try {
              text = JSON.stringify(mine.packed)
            } catch {
              return
            }
            const of = Math.ceil(text.length / CHUNK)
            if (of < 1 || of > MAX_CHUNKS) return
            for (let i = 0; i < of; i++) {
              sendParty('art', {
                pic: text.slice(i * CHUNK, (i + 1) * CHUNK),
                i,
                of,
                // ⚠️ only with the first chunk: the names are small next to the picture, and
                // repeating them on every chunk would be the largest thing in some messages
                /* ⚠️ hidden rides along because packDrawing does not carry it — it is not part
                   of the saved picture, it is part of the shared VIEW of it, and a newcomer who
                   could see layers everybody else had switched off would be looking at a
                   different arrangement from the first second. */
                ...(i === 0 ? { ids: mine.ids, hid: mine.hidden } : {}),
              })
            }
          },
          150 + Math.floor(Math.random() * 450),
        )
        return
      }
      if (typeof b?.pic === 'string') {
        /**
         * ⚠️ ACCEPTED ONLY WHILE WE ASKED. An unsolicited picture is a peer replacing your
         * drawing, which is the one thing this module must never let anybody do — so the window
         * is opened by catchUp() and closed the moment a picture lands or twelve seconds pass.
         */
        if (!asking || Date.now() - asking > ASK_FOR_MS) return
        const i = b.i
        const of = b.of
        if (typeof i !== 'number' || typeof of !== 'number') return
        if (!Number.isInteger(i) || !Number.isInteger(of)) return
        if (of < 1 || of > MAX_CHUNKS || i < 0 || i >= of) return
        if (b.pic.length > CHUNK) return
        // somebody else answered first, and two half-transfers interleaved would be neither
        if (partsOf && partsOf !== of) return
        /* an answer is on its way, so stop asking — another ask would only make the answerer
           start the whole transfer again from the top, mid-transfer */
        stopAsking()
        partsOf = of
        parts[i] = b.pic
        if (Array.isArray(b.ids)) partIds = b.ids
        if (Array.isArray(b.hid)) partHidden = b.hid
        for (let k = 0; k < of; k++) if (parts[k] === undefined) return
        const text = parts.join('')
        resetCatchUp()
        let packed: unknown
        try {
          packed = JSON.parse(text)
        } catch {
          return
        }
        /**
         * ⚠️ THE SENDER'S OWN STROKES ARRIVE CALLED "me:". Every stroke is named for who made
         * it so undo can travel, and the sender's copy of its own strokes is named from its own
         * side of the conversation. Left alone, a later "take back me:4" from them would find
         * nothing here, and the two pictures would part company over exactly the thing this
         * whole message exists to prevent. The transport stamped `from`, so the rename needs no
         * trust and no knowledge of anybody's id.
         */
        const ids = partIds.map((v) =>
          typeof v === 'string'
            ? v.startsWith('me:')
              ? `${m.from}:${v.slice(3)}`
              : v.slice(0, 60)
            : undefined,
        )
        /* clamped to real layer numbers: this list SIZES nothing, but it is compared against
           layer indices, and junk in it is a layer that can never be shown again */
        const hidden = partHidden
          .filter((v): v is number => typeof v === 'number' && Number.isInteger(v))
          .filter((v) => v >= 0 && v < 12)
        try {
          onPicture?.({ packed, ids, hidden })
        } catch {
          /* a room that cannot take a picture keeps its own */
        }
        return
      }
      if (b?.clear === true) {
        if (!allowed(m.from)) return
        onClear?.()
        return
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
