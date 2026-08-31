import { onParty, sendParty, voiceSession } from '../voice/voiceSession'
import {
  fxSnapshot,
  noteOff,
  noteOn,
  setBroadcastAudio,
  type Fx,
  type InstrumentId,
} from '../audio/synth'
import { sharedCtx } from '../audio/context'
import { setLookahead, setScheduleListener } from '../audio/looper'
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
}

let state: JamState = { on: false, players: {} }
const listeners = new Set<() => void>()

function set(patch: Partial<JamState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

/** per-peer rate accounting, and which voices they currently own */
const rate = new Map<string, number[]>()
const voices = new Map<string, string[]>()

const VALID = new Set<string>([
  'keys',
  'pluck',
  'bell',
  'pad',
  'bass',
  'organ',
  'brass',
  'reed',
  'marimba',
  'choir',
  'sub',
  'drums',
])

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
  if (!state.players[peer]) return
  const next = { ...state.players }
  delete next[peer]
  set({ players: next })
}

let detach: Array<() => void> = []
/** what setOn(true) started, torn down by setOn(false) */
let rig: Array<() => void> = []

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
      rig.forEach((d) => d())
      rig = []
      setScheduleListener(null)
      setLookahead(0)
      setBroadcastAudio(true)
      set({ on: false, players: {} })
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
    rig = [clock.start(), transport.start()]
    setLookahead(0.5)
    // your loops become notes for everyone else, stamped with when they are due
    setScheduleListener((n) => jam.play(n.midi, n.on, n.inst, { at: n.at, part: n.part, fx: n.fx }))
    // and stop being audio, so nobody hears them twice — see setBroadcastAudio
    setBroadcastAudio(false)
    set({ on: true })
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
    sendParty('jam', body)
  },

  start() {
    if (detach.length) return () => {}

    const off = onParty((m) => {
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
        while (mine.length >= MAX_VOICES_EACH) noteOff(mine.shift()!)
        if (!mine.includes(id)) mine.push(id)
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
