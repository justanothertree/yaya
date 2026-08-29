/**
 * One AudioContext for the whole site, and the bus that lets a call hear things.
 *
 * ⚠️ THE REASON IS NOT TIDINESS. Audio nodes in different contexts are islands: connecting one to
 * another throws InvalidAccessError, full stop. This site had eight separate `new AudioContext`
 * sites — ringtone, call sounds, the mic gate, peer output, the local mic, a music file, tab
 * capture and the synth — which meant the instrument could never be routed into a call, music
 * could never be shared with anyone, and no two of them could ever be mixed. Not because anybody
 * decided that, but because they were born in different rooms.
 *
 * ⚠️ 48kHz, pinned. RNNoise runs at 48k natively and the call asked for that rate explicitly; the
 * browser's default is 44.1k. A shared context has to satisfy the fussiest occupant, and there is
 * exactly one candidate.
 *
 * ⚠️ NOTHING MAY EVER CLOSE IT. A closed context takes every other producer down with it, and the
 * failure is baffling from the outside: hanging up a call would silence the instrument. Producers
 * disconnect their own nodes and leave the context running — it costs one idle audio thread,
 * which is what a single page is supposed to use anyway.
 */

let ctx: AudioContext | null = null
let bus: GainNode | null = null

export function sharedCtx(): AudioContext {
  if (ctx) return ctx
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  // 48k to match the call. If the device refuses that rate, take whatever it gives rather than
  // failing outright — a visualiser at 44.1k is fine, and only the denoiser really cares.
  try {
    ctx = new Ctor({ sampleRate: 48000 })
  } catch {
    ctx = new Ctor()
  }
  return ctx
}

/**
 * Everything that peers should be able to hear, mixed into one node.
 *
 * The instrument connects here; so does music, when you choose to share it. A call connects this
 * bus into the stream it sends out, so whatever is on the bus reaches the room — and when there
 * is no call, the bus is simply a node whose output goes nowhere, which costs nothing.
 *
 * ⚠️ A separate path from your speakers, not a replacement for one. A producer connects to BOTH:
 * the bus so the room hears it, and its own output gain so you do. Routing your local monitoring
 * through the bus instead would mean muting yourself in a call also muted your own instrument.
 */
export function broadcastBus(): GainNode {
  if (bus) return bus
  const c = sharedCtx()
  bus = c.createGain()
  bus.gain.value = 1
  return bus
}

/** A gesture happened — unblock audio. Safe to call as often as you like. */
export function resumeAudio() {
  const c = ctx
  if (c && c.state === 'suspended') void c.resume().catch(() => {})
}
