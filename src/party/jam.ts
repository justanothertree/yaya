import { onParty, sendParty, voiceSession } from '../voice/voiceSession'
import {
  INSTRUMENTS,
  fxSnapshot,
  noteOff,
  noteOn,
  setBroadcastAudio,
  type Fx,
  type InstrumentId,
} from '../audio/synth'
import { sharedCtx } from '../audio/context'
import {
  dropLayersFrom,
  loopState,
  putGuestLayer,
  removeLayer,
  setLayersShared,
  setLookahead,
  setScheduleListener,
  subscribeLoop,
  type Layer,
} from '../audio/looper'
import { packSong, readSong, songToLayers, toSong, type Song } from '../audio/songFile'
import { clock, toLocalTime } from './clock'
import { transport } from './transport'

/**
 * Playing the same instrument room together.
 *
 * ⚠️ NOTES TRAVEL, NOT AUDIO. Everyone's browser synthesises everyone else's notes locally, so
 * what crosses the wire is "C#4 down, marimba" — about forty bytes — rather than an audio stream.
 * That is the difference between a jam that works on a home connection and one that does not:
 *
 *   · it costs nothing next to the voice call already running, so it does not compete with it
 *   · nobody's part is compressed, gated, or ducked by the call's echo cancellation — which
 *     would otherwise treat a piano as background noise and remove it, being very good at
 *     exactly that
 *   · everyone hears the same thing at full quality, instead of N people's mic-quality mixes
 *   · each player picks their own instrument and it sounds right on every listener's machine
 *   · the instrument stops going down the call as audio at all, which is why it stops being
 *     treated as background noise by the call's own noise suppression
 *
 * ⚠️ THE SOUND TRAVELS WITH THE NOTE, not just the instrument id. A note used to arrive as
 * "C#4, bell" and get played through the LISTENER's reverb and echo settings, so a friend who had
 * carefully dialled in a cavernous pad was heard bone dry by anyone whose own knobs were down.
 * Two people each shaping a sound heard two different rooms, and neither heard what the other had
 * made. Their four effect values ride along with every note-on, and their part gets its own bus
 * on your machine — the same mechanism a looper layer uses to keep the sound it was recorded
 * with.
 *
 * The cost is that you hear a friend's note when the MESSAGE arrives, not when their finger
 * moved: realtime adds something like 40–150ms depending on where they are. That is playable for
 * chords, pads and trading phrases, and it is not tight enough for two people to hold a fast
 * groove in perfect lockstep. Nothing local can fix that — it is the network — so the honest
 * design is to be good at what the latency allows rather than pretend it isn't there.
 *
 * There is deliberately NO attempt to hide it by delaying your own notes to match the worst
 * peer's arrival. That trades everyone's feel for a shared illusion, and an instrument that
 * responds late to your own hands feels broken in a way that a friend arriving late does not.
 *
 *
 * WHAT A HOSTILE PEER CAN DO
 *
 * Every message here becomes an oscillator on your machine, which makes this the one part of
 * co-presence with a resource cost attached. A patched client could send note-ons forever and
 * never a note-off. So: notes are rate-limited per person, each person has a hard ceiling on
 * simultaneous voices, and the oldest is stolen rather than the newest refused — the same voice
 * stealing a hardware synth does, which sounds like a busy instrument instead of a broken one.
 *
 * ⚠️ The synth ALREADY caps voices globally and steals oldest-first, so it is worth saying why
 * a second cap per person is not redundant. A global cap bounds the damage to your CPU; it does
 * nothing about WHOSE notes survive. One peer spraying note-ons would sit at the front of that
 * one shared queue and evict everybody else's held notes as fast as they played them — the room
 * would stay within budget and be unplayable. Per-person ceilings mean a flood can only ever
 * cost the flooder their own polyphony.
 */

/** Most notes a second one person may trigger before the extras are dropped. */
const NOTE_BURST = 24
const NOTE_WINDOW_MS = 1000
/** Most notes one person may hold at once on your machine. */
const MAX_VOICES_EACH = 12

export type JamPlayer = {
  id: string
  name: string
  inst: InstrumentId
  /** midi numbers they are holding right now, for the keyboard to light up */
  held: number[]
}

export type JamState = {
  /** true while WE are sending our notes to the room */
  on: boolean
  players: Record<string, JamPlayer>
  /** a song somebody has put on the table, waiting for you to take it or wave it away */
  offer: SongOffer | null
}

let state: JamState = { on: false, players: {}, offer: null }
const listeners = new Set<() => void>()

function set(patch: Partial<JamState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

/** per-peer rate accounting, and which voices they currently own */
/**
 * ⚠️ A SONG SOMEBODY HAS OFFERED, held until you say yes.
 *
 * Notes already travel — a jam hears every scheduled note of everyone's loops, in time. What
 * never travelled is the DOCUMENT: open a song while jamming and the room can hear it while
 * having nothing on screen, no way to join in on the arrangement and nothing to keep.
 *
 * ⚠️ AN OFFER, NEVER AN ARRIVAL. Loading a song replaces every layer you have. Doing that to
 * somebody because their friend clicked Open would destroy work that was never asked about, and
 * a feature that can eat your afternoon is worse than no feature. It waits here until accepted.
 */
export type SongOffer = { from: string; name: string; song: Song }

/**
 * ⚠️ WHAT I AM HOLDING, and when each of THEIR notes started. Both exist for the same
 * reason: the channel is best-effort.
 *
 * Notes are broadcast, and a broadcast can be dropped. A lost note-ON is nothing — a note nobody
 * hears. A lost note-OFF is a voice with nothing left in the world to end it: it rings until
 * Panic, and its key stays lit, because the lit keys are drawn from the same list. That
 * asymmetry cannot be fixed by sending more carefully; it needs somebody to notice afterwards.
 *
 * So every player says, once a second, exactly which notes it is holding. Anyone hearing that can
 * release what is not on the list. A dropped note-off then costs a second of a hanging note
 * instead of the rest of the session.
 */
const myHeld = new Set<string>()
const startedAt = new Map<string, number>()
let beat = 0

const rate = new Map<string, number[]>()
const voices = new Map<string, string[]>()

/**
 * Which instruments a peer is allowed to name.
 *
 * ⚠️ DERIVED FROM THE INSTRUMENT LIST, never written out again. This was a hand-kept copy
 * of the twelve instruments that existed when jamming was built, and the sixteen added since were
 * silently dropped — a peer picked harp, played, and the rest of the room heard nothing at all,
 * with no error anywhere because an unknown instrument simply returns. A second copy of a list is
 * a copy that will fall behind; the check is worth having, the transcription is not.
 */
const VALID = new Set<string>(INSTRUMENTS.map(([id]) => id))

/**
 * A voice id nobody else can collide with.
 *
 * ⚠️ Namespaced by PEER. Two people playing middle C is the normal case in a jam, and a shared id
 * would mean the second press stole the first person's note and the first release silenced both
 * — the chord would collapse to one voice and then to none.
 */
const voiceId = (peer: string, part: string, midi: number) => `jam:${peer}:${part}:${midi}`

/**
 * Which of a peer's parts a note belongs to, made safe to use as a key.
 *
 * ⚠️ Restricted characters and a hard length cap, because this string becomes a map key on our
 * machine — one that the effects pool is indexed by. Left unchecked, a peer could mint an
 * unbounded number of distinct parts by varying it, and each one asks for a convolver. The pool
 * evicts, so this is a cap on churn rather than on memory, but a peer should not be able to make
 * our audio graph thrash at all.
 */
function cleanPart(v: unknown): string {
  if (typeof v !== 'string') return 'live'
  const t = v.slice(0, 24).replace(/[^\w:-]/g, '')
  return t || 'live'
}

/**
 * A peer's effect settings, made safe.
 *
 * ⚠️ Clamped to 0–1 rather than trusted, because these become AudioParam values. A feedback
 * gain above 1 is a delay line that never decays — a howl that grows until it clips and that the
 * person hearing it cannot stop, since the note that started it is long over. That is a denial of
 * service made of sound, and it costs one Math.min to make impossible.
 *
 * A missing or malformed value falls back to dry rather than to your own settings: a peer whose
 * client sends nothing should sound plain, not borrow the room you set up for yourself.
 */
function cleanFx(v: unknown): Fx {
  const o = (v ?? {}) as Record<string, unknown>
  const n = (k: string, d: number) => {
    const x = o[k]
    return typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d
  }
  return {
    echo: n('echo', 0),
    echoTime: n('echoTime', 0.26),
    space: n('space', 0),
    vibrato: n('vibrato', 0),
    glide: n('glide', 0),
  }
}

function allowed(peer: string): boolean {
  const now = performance.now()
  const hits = (rate.get(peer) ?? []).filter((t) => now - t < NOTE_WINDOW_MS)
  if (hits.length >= NOTE_BURST) {
    rate.set(peer, hits)
    return false
  }
  hits.push(now)
  rate.set(peer, hits)
  return true
}

function stopAllFor(peer: string) {
  for (const v of voices.get(peer) ?? []) noteOff(v)
  voices.delete(peer)
  rate.delete(peer)
  /* ⚠️ Their recorded parts go with their live notes, and for the same reason: this runs when
     somebody leaves or the call drops, and a take nobody in the room can reach is a loop playing
     forever with no controls attached to it. Their notes stopping while their bassline kept
     going would be the strangest possible half-departure. */
  dropLayersFrom(peer)
  if (!state.players[peer]) return
  const next = { ...state.players }
  delete next[peer]
  set({ players: next })
}

let detach: Array<() => void> = []
/** what setOn(true) started, torn down by setOn(false) */
let rig: Array<() => void> = []

/**
 * ── sharing the arrangement, not just the sound ─────────────────────────────
 *
 * ⚠️ THIS OVERTURNS A DECISION transport.ts still explains, so here is why. It said recorded
 * layers stay private and you hear each other because the notes are broadcast as they play —
 * "a jam rather than a shared document". That was a real choice and it worked, and three things
 * were wrong with it once people actually used it:
 *
 *   · a loop that never changes was re-sent every time it came round, for as long as the jam
 *     lasted, because the far end had no copy to play from;
 *   · nothing of yours appeared in anybody's arrangement, so they could not see your part, mix
 *     it, mute it, or build on it — the one thing a four-person jam is for;
 *   · and it is why the lookahead is half a second. Notes have to leave early enough to survive
 *     the trip, which means muting a layer takes that long to be heard by anyone else.
 *
 * A take is a small, finished, unchanging thing. Sending it once and letting every machine play
 * it from its own clock is both less traffic and better timing: a shared layer is sample-accurate
 * on every machine instead of arriving 40–150ms late, every bar, forever. Live playing still
 * streams as notes, because a note you are playing right now genuinely has nowhere else to come
 * from — see the latency note at the top of this file.
 *
 * ⚠️ ONE SUBSCRIPTION RATHER THAN A CALL AT EVERY EDIT. Committing a take, muting, changing the
 * volume, rearranging the bars, deleting — every one of those changes a layer, and hanging a
 * send off each is five call sites that have to be found again when a sixth is added. This
 * watches the layer list the same way transport.ts watches the transport, and sends what
 * actually differs.
 *
 * ⚠️ NO ECHO GUARD NEEDED, unlike the transport's. Only layers with no `from` are sent, and a
 * layer that arrived from somebody always has one — so a received layer cannot be re-sent by
 * construction rather than by a flag that has to be cleared correctly.
 */
/** what we last sent for each of our own layers, so an unchanged one is not re-sent */
const sentLayers = new Map<string, string>()
/**
 * The layer array we last looked at.
 *
 * ⚠️ THE CHEAP GUARD, AND IT IS NOT AN OPTIMISATION. subscribeLoop fires on every change to
 * loop state, and that includes `set({ position })` — which the scheduler writes on EVERY tick to
 * move the playhead. Without this, fingerprinting the layers would run tens of times a second and
 * JSON.stringify the whole arrangement each time, on the thread that is trying to schedule audio.
 *
 * A reference comparison is exact here rather than a heuristic: every mutation of the list goes
 * through `set({ layers: [...] })`, which is a new array, and nothing else in the looper mutates
 * one in place. So an unchanged reference means unchanged layers, and it costs one comparison.
 */
let seenLayers: readonly Layer[] | null = null

function layerFingerprint(l: Layer): string {
  // everything that changes what is heard or how it is arranged; `id` is the map key already
  return JSON.stringify([
    l.instrument,
    l.events,
    l.muted,
    l.len,
    l.gain ?? 1,
    l.play ?? null,
    l.plan ?? null,
    l.fx,
  ])
}

function shareLayers() {
  if (!state.on) return
  const s = loopState()
  if (s.layers === seenLayers) return
  seenLayers = s.layers
  const mine = s.layers.filter((l) => !l.from)
  const live = new Set(mine.map((l) => l.id))
  for (const id of [...sentLayers.keys()]) {
    if (live.has(id)) continue
    sentLayers.delete(id)
    sendParty('jam:drop', { id })
  }
  for (const l of mine) {
    const print = layerFingerprint(l)
    if (sentLayers.get(l.id) === print) continue
    sentLayers.set(l.id, print)
    /* ⚠️ Through toSong and packSong — the same pair a file goes through — so the far end can
       read it with readSong and get a stranger's data validated by code written for exactly
       that. A second, friendlier codec for peers would be a second thing to keep correct. */
    sendParty('jam:layer', { id: l.id, song: packSong(toSong('', s.bpm, s.bars, [l], l.id)) })
  }
  // and the scheduler stops broadcasting the notes of anything the room now holds
  setLayersShared(true)
}

export const jam = {
  getState: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  setOn(on: boolean) {
    if (on === state.on) return
    if (!on) {
      sendParty('jam', { leave: true })
      // silence everyone else's notes rather than leaving a held pad ringing forever
      for (const peer of [...voices.keys()]) stopAllFor(peer)
      if (beat) {
        clearInterval(beat)
        beat = 0
      }
      myHeld.clear()
      startedAt.clear()
      rig.forEach((d) => d())
      rig = []
      setScheduleListener(null)
      setLookahead(0)
      setBroadcastAudio(true)
      /* ⚠️ Every borrowed part goes, and mine go back to being broadcast. Keeping other
         people's takes after leaving the room would be walking off with their work in an
         arrangement they can no longer change; leaving mine marked shared would mean the next jam
         played them to nobody, because the flag says the room already has them. */
      for (const peer of Object.keys(state.players)) dropLayersFrom(peer)
      setLayersShared(false)
      sentLayers.clear()
      seenLayers = null
      set({ on: false, players: {}, offer: null })
      return
    }
    /**
     * Everything a jam needs, brought up together.
     *
     * ⚠️ The lookahead goes UP. The sequencer hands notes to the audio clock 140ms early when
     * you are alone, which is fine for local sound and useless as a head start over a network —
     * the message would arrive after the note was due. Half a second gives the trip room, at the
     * cost of muting a layer taking that long to be heard, which is the right way round.
     */
    beat = window.setInterval(() => {
      if (state.on) sendParty('jam:held', { held: [...myHeld] })
    }, 1000)
    /* ⚠️ The layer watch is part of the rig, so it comes down with everything else rather
       than being a subscription somebody has to remember to cancel. It fires once immediately,
       which is the catch-up: whatever you already had recorded when you joined is offered to the
       room the same way a new take is. */
    rig = [clock.start(), transport.start(), subscribeLoop(shareLayers)]
    setLookahead(0.5)
    // your loops become notes for everyone else, stamped with when they are due
    setScheduleListener((n) => jam.play(n.midi, n.on, n.inst, { at: n.at, part: n.part, fx: n.fx }))
    // and stop being audio, so nobody hears them twice — see setBroadcastAudio
    setBroadcastAudio(false)
    set({ on: true })
    // `on` has to be true before this runs — shareLayers refuses while the jam is off
    shareLayers()
    /**
     * ⚠️ AND ASK FOR THEIRS, or arriving second means arriving to an empty arrangement.
     *
     * shareLayers only sends what has CHANGED since it last looked, which is exactly right while
     * a jam runs and exactly wrong when somebody new turns up: everyone else's takes were sent
     * before you were listening, and nothing about them has changed since, so nobody would send
     * them again. The same hole the paint room had, and the same answer — the one person who
     * knows they have just arrived is the one who asks.
     */
    sendParty('jam:want', {})
  },

  /** Put a song on the table for the room. A no-op unless jamming is on. */
  offerSong(song: Song) {
    if (!state.on) return
    sendParty('jam:song', packSong(song))
  },

  /** Take the offer away, whether it was accepted or waved off. */
  clearOffer() {
    set({ offer: null })
  },

  /**
   * Offer a note to the room. A no-op unless jamming is on, so InstrumentRoom calls it
   * unconditionally next to capture() — the same reason that one has no "recording mode"
   * branch: the note you heard and the note they hear come from one call site.
   *
   * `at` is when the note is due on OUR audio clock, for notes the sequencer scheduled ahead.
   * Live playing has no such time — it already happened — and is sent to be played on arrival.
   */
  play(
    midi: number,
    on: boolean,
    inst: InstrumentId,
    opts?: { at?: number; part?: string; fx?: Fx },
  ) {
    if (!state.on) return
    // fx only on the way DOWN: a note-off has nothing to shape, and the bus already holds the
    // settings the note-on set
    const body: Record<string, unknown> = { midi, on, inst }
    if (on) body.fx = opts?.fx ?? fxSnapshot()
    if (opts?.at !== undefined) body.at = opts.at
    // 'live' is the default and is left off the wire, since most notes are live ones
    if (opts?.part) body.part = opts.part
    const key = `${opts?.part ?? 'live'}:${midi}`
    if (on) myHeld.add(key)
    else myHeld.delete(key)
    sendParty('jam', body)
  },

  start() {
    if (detach.length) return () => {}

    const off = onParty((m) => {
      /**
       * ⚠️ Its own message kind, and read through readSong like a file from disk. What arrives is
       * a stranger's JSON: readSong already clamps every length, checks every instrument against
       * the list this build has and caps the note count, because it was written for exactly this
       * class of input. Trusting it here because it came from a friend would be trusting the
       * network, not the friend.
       */
      /**
       * A peer's take, to be held and played from our own clock rather than heard as a stream.
       *
       * ⚠️ READ WITH readSong, the file reader, because that is what this is: a stranger's
       * JSON that becomes oscillators. It already clamps every length, checks the instrument
       * against the list this build has, and caps events per layer and in total — it was written
       * for exactly this input, and the fact that it arrived from a friend is a fact about the
       * friend, not about the network.
       *
       * ⚠️ THE ID IS BUILT FROM THE SENDER'S, namespaced with the id the transport stamped.
       * Two people whose first take is called the same thing cannot collide, and nobody can
       * replace a layer in somebody else's name, because the only id a message can produce is
       * one prefixed with its own.
       */
      if (m.kind === 'jam:layer' && state.on) {
        if (!allowed(m.from)) return
        const b = m.body as { id?: unknown; song?: unknown }
        if (typeof b?.id !== 'string' || b.id.length > 60) return
        const song = readSong(b.song)
        const one = song && songToLayers(song)[0]
        if (!one) return
        putGuestLayer({
          ...one,
          id: `${m.from}:${b.id}`,
          from: m.from,
          // we have the take; nobody should be streaming its notes at us as well
          shared: true,
        })
        return
      }
      /* Somebody has just joined. Forget what we think they have and offer everything again —
         cheap, because a take is a few hundred bytes and this happens once per arrival. */
      if (m.kind === 'jam:want' && state.on) {
        if (!allowed(m.from)) return
        sentLayers.clear()
        seenLayers = null
        shareLayers()
        return
      }
      if (m.kind === 'jam:drop' && state.on) {
        if (!allowed(m.from)) return
        const b = m.body as { id?: unknown }
        if (typeof b?.id !== 'string') return
        /* ⚠️ Namespaced with the sender's own id, same as above — which is also what stops
           "delete this layer" being a message anybody can aim at anybody else's part. */
        removeLayer(`${m.from}:${b.id}`)
        return
      }
      if (m.kind === 'jam:song' && state.on) {
        const song = readSong(m.body)
        if (song) set({ offer: { from: m.from, name: m.name || 'Someone', song } })
        return
      }
      /**
       * ⚠️ A LIST OF WHAT THEY HOLD, and anything of theirs not on it is released — but only
       * if it started before the list was drawn up.
       *
       * Without that clause this races: their heartbeat describes a moment, and a note they
       * played a hair after it would be cut off the instant the list arrived. A note older than
       * the heartbeat and absent from it, on the other hand, is a note whose ending never made
       * it, which is exactly what we are here to clean up.
       */
      if (m.kind === 'jam:held' && state.on) {
        const list = (m.body as { held?: unknown })?.held
        if (!Array.isArray(list)) return
        const alive = new Set(list.filter((x): x is string => typeof x === 'string'))
        const mine = voices.get(m.from) ?? []
        const cutoff = performance.now() - 1500
        const keep: string[] = []
        for (const id of mine) {
          const parts = id.split(':')
          const key = `${parts[2]}:${parts[3]}`
          if (alive.has(key) || (startedAt.get(id) ?? 0) > cutoff) {
            keep.push(id)
            continue
          }
          noteOff(id)
          startedAt.delete(id)
        }
        if (keep.length !== mine.length) {
          voices.set(m.from, keep)
          const held = keep.map((v) => Number(v.split(':')[3])).filter(Number.isFinite)
          const who = state.players[m.from]
          if (who) set({ players: { ...state.players, [m.from]: { ...who, held } } })
        }
        return
      }
      if (m.kind !== 'jam' || !state.on) return
      const b = m.body as {
        midi?: unknown
        on?: unknown
        inst?: unknown
        leave?: unknown
        fx?: unknown
        at?: unknown
        part?: unknown
      }
      if (b?.leave) {
        stopAllFor(m.from)
        return
      }
      // Nothing off the wire reaches the synth unchecked — a non-integer or out-of-range midi
      // number becomes a NaN frequency, and an oscillator set to NaN never stops.
      if (typeof b?.midi !== 'number' || !Number.isInteger(b.midi) || b.midi < 0 || b.midi > 127)
        return
      if (typeof b.inst !== 'string' || !VALID.has(b.inst)) return
      const inst = b.inst as InstrumentId
      const fx = cleanFx(b.fx)
      /**
       * A sequenced note carries the time it is due, so it can be placed rather than dropped
       * wherever the network happened to deliver it.
       *
       * ⚠️ A time already past is ignored and the note plays now instead — scheduling into the
       * past is how you get every late note firing at once in a burst. Late is better than
       * bunched: one note slightly out of place beats four arriving together.
       */
      let when: number | undefined
      if (typeof b.at === 'number' && Number.isFinite(b.at)) {
        const local = toLocalTime(m.from, b.at)
        if (local != null && local > sharedCtx().currentTime) when = local
      }
      const part = cleanPart(b.part)
      const id = voiceId(m.from, part, b.midi)
      const mine = voices.get(m.from) ?? []

      if (b.on === false) {
        noteOff(id, when)
        voices.set(
          m.from,
          mine.filter((v) => v !== id),
        )
      } else {
        if (!allowed(m.from)) return
        // ⚠️ Steal the OLDEST rather than refuse the newest: a ceiling that drops what you just
        // played sounds broken, while one that releases what has been ringing longest is what
        // every polyphonic instrument has always done.
        while (mine.length >= MAX_VOICES_EACH) {
          const old = mine.shift()!
          noteOff(old)
          startedAt.delete(old)
        }
        if (!mine.includes(id)) mine.push(id)
        startedAt.set(id, performance.now())
        voices.set(m.from, mine)
        noteOn(id, inst, b.midi, when, { key: `jam:${m.from}:${part}`, fx })
      }

      const prev = state.players[m.from]
      const held = mine.map((v) => Number(v.split(':')[3])).filter(Number.isFinite)
      set({
        players: {
          ...state.players,
          [m.from]: {
            id: m.from,
            name: typeof m.name === 'string' ? m.name.slice(0, 40) : (prev?.name ?? 'Someone'),
            inst,
            held,
          },
        },
      })
    })

    // Leaving the call has to silence the room, or a held note outlives the connection that
    // could ever have released it.
    const offVoice = voiceSession.subscribe(() => {
      if (!voiceSession.getState().inCall && (state.on || Object.keys(state.players).length)) {
        // through setOn, so the lookahead, the schedule listener and the audio path are all put
        // back — a dropped call used to be able to leave the instrument silently off the air
        jam.setOn(false)
        for (const peer of [...voices.keys()]) stopAllFor(peer)
        set({ players: {} })
      }
    })

    detach = [off, offVoice]
    return () => {
      detach.forEach((d) => d())
      detach = []
    }
  },
}
