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
 * So takes get a bus of their own: one node, made once, connected once, following the
 * instrument fader by hand. Each take is a source with its own gain into this.
 */

let bus: GainNode | null = null
let unhook: (() => void) | null = null

export function takeBus(): GainNode {
  if (bus) return bus
  const ctx = sharedCtx()
  const g = ctx.createGain()
  g.gain.value = volume('instrument')
  g.connect(ctx.destination)
  /* ⚠️ followed rather than read once, or the slider would only apply to takes placed after
     it was moved — the same reason a layer's gain rides its bus instead of scaling its notes */
  unhook = onMixerChange(() => {
    if (bus) bus.gain.value = volume('instrument')
  })
  bus = g
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
  } catch {
    /* already gone with the context */
  }
  bus = null
}
