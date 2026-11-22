import { sharedCtx } from './context'
import { onMixerChange, volume } from './mixer'

/**
 * The one node every recorded take plays through.
 *
 * ⚠️ makeGain IS ONCE PER CHANNEL, NOT ONCE PER SOUND, and getting that wrong is quiet in both
 * directions. It hands back a gain node and REGISTERS it as the node that channel's slider
 * moves — so calling it for each take made the instrument fader control whichever take was
 * created last and nothing else. It also does not connect the node to anything; every caller
 * does that itself. A take created with makeGain and left unconnected plays perfectly, into
 * nowhere, with onended firing on time — which is exactly what a working feature looks like
 * from the outside. See synth.ts and localMic.ts, which each call it once and wire it up.
 *
 * So takes get a bus of their own, and a fader after it that follows the instrument slider by
 * hand: made once, connected once. Each take is a source with its own gain into the bus.
 */

let bus: GainNode | null = null
/** the instrument fader, between the bus and the speakers */
let fader: GainNode | null = null
let unhook: (() => void) | null = null

/**
 * Where a take plays into: one node, at the level it was recorded.
 *
 * ⚠️ THE FADER IS THE NEXT NODE, NOT THIS ONE (17 Nov 2026), because this one is what the stems
 * and ⬇ Export song tap (see stems.tapAll). They tap the synth after its limiter and BEFORE the
 * instrument fader, so a file is the song and not how loud this device was turned up; this bus
 * used to BE the fader, so the same file got every take after it. Measured with a generated
 * recording in the loop and the fader at 0: the export had every part, at full level, and of the
 * recording nothing but the noise floor, 68dB under where it was recorded. At the default 0.7,
 * every take came out 3dB under the parts beside how they sound together. The speakers hear what
 * they always did: the bus and the fader are still one line to them.
 */
export function takeBus(): GainNode {
  if (bus) return bus
  const ctx = sharedCtx()
  const g = ctx.createGain()
  const f = ctx.createGain()
  f.gain.value = volume('instrument')
  g.connect(f)
  f.connect(ctx.destination)
  /* ⚠️ followed rather than read once, or the slider would only apply to takes placed after
     it was moved — the same reason a layer's gain rides its bus instead of scaling its notes */
  unhook = onMixerChange(() => {
    if (!fader) return
    /**
     * ⚠️ RAMPED, and it was not. mixer.ts says why in its own `setVolume` — "setting .value on
     * a live gain is a step change in the waveform, which is an audible click, and dragging a
     * slider would be a burst of them" — and then ramps the one node it registered itself.
     * This fader is deliberately NOT that node (see above), so it got the slider's value by
     * assignment and stepped while everything else on the same fader glided. One channel,
     * two behaviours, decided by which node you happened to be listening to.
     */
    try {
      fader.gain.setTargetAtTime(volume('instrument'), fader.context.currentTime, 0.015)
    } catch {
      fader.gain.value = volume('instrument')
    }
  })
  bus = g
  fader = f
  return g
}

/**
 * ⚠️ FOR TESTS AND TEARDOWN ONLY. Nothing in the app drops the bus: it is one node on the
 * shared context and it costs nothing to leave connected, and dropping it while a take is
 * sounding would cut the take off mid-word.
 */
export function dropTakeBus() {
  unhook?.()
  unhook = null
  try {
    bus?.disconnect()
    fader?.disconnect()
  } catch {
    /* already gone with the context */
  }
  bus = null
  fader = null
}
