import { onParty, sendParty, voiceSession } from '../voice/voiceSession'
import { noteOff, noteOn, type InstrumentId } from '../audio/synth'

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
const voiceId = (peer: string, midi: number) => `jam:${peer}:${midi}`

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
      set({ on: false, players: {} })
      return
    }
    set({ on: true })
  },

  /**
   * Offer a note to the room. A no-op unless jamming is on, so InstrumentRoom calls it
   * unconditionally next to capture() — the same reason that one has no "recording mode"
   * branch: the note you heard and the note they hear come from one call site.
   */
  play(midi: number, on: boolean, inst: InstrumentId) {
    if (!state.on) return
    sendParty('jam', { midi, on, inst })
  },

  start() {
    if (detach.length) return () => {}

    const off = onParty((m) => {
      if (m.kind !== 'jam' || !state.on) return
      const b = m.body as { midi?: unknown; on?: unknown; inst?: unknown; leave?: unknown }
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
      const id = voiceId(m.from, b.midi)
      const mine = voices.get(m.from) ?? []

      if (b.on === false) {
        noteOff(id)
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
        noteOn(id, inst, b.midi)
      }

      const prev = state.players[m.from]
      const held = mine.map((v) => Number(v.split(':')[2])).filter(Number.isFinite)
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
        for (const peer of [...voices.keys()]) stopAllFor(peer)
        set({ on: false, players: {} })
      }
    })

    detach = [off, offVoice]
    return () => {
      detach.forEach((d) => d())
      detach = []
    }
  },
}
