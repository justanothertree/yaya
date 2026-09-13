import { onParty, sendParty } from '../voice/voiceSession'
import { toLocalTime } from './clock'
import { loopOrigin, loopState, setTransport, subscribeLoop } from '../audio/looper'

/**
 * One metronome for the whole room.
 *
 * Everybody had their own before this: their own tempo, their own bar count, and — the part that
 * actually made it unusable — their own idea of where the bar line was, set by whenever they
 * happened to press Play. Two people counting the same tempo from different instants is not a
 * shared beat, it is two beats, and you cannot play together to two beats.
 *
 *
 * WHAT IS SHARED, AND WHAT IS NOT
 *
 * The transport: tempo, bar count, running or stopped, and where the current pass began. That is
 * the whole of a metronome — a click at the origin plus a click every beat after it — so agreeing
 * on those four things is agreeing on the beat, and there is nothing else to send.
 *
 * ⚠️ RECORDED LAYERS ARE SHARED NOW, AND THIS PARAGRAPH USED TO SAY THE OPPOSITE. It argued
 * that your loops stay yours and you hear each other only because the notes are broadcast as they
 * play — "a jam rather than a shared document". Left standing it would be the worst kind of
 * comment: a confident explanation of a decision that has been reversed, in the file somebody
 * reads FIRST to find out what is shared.
 *
 * What changed the answer was that a take is finished and unchanging, so streaming it costs a
 * copy of the same notes every bar forever AND arrives late, while sending it once lets every
 * machine play it from this transport — which is the thing that made it possible. The layers
 * ride in jam.ts (see shareLayers); this file still owns only the beat they are played against,
 * and that division is unchanged.
 *
 *
 * WHO IS IN CHARGE
 *
 * Nobody, and last change wins. Press play, change the tempo, change the bars — whatever you did
 * becomes the room's transport, and everyone follows.
 *
 * The alternative is a host, and a host needs electing, re-electing when they leave, and a rule
 * for what happens to everyone else meanwhile. For four friends in a call, "the last person to
 * touch it" is both simpler and closer to what actually happens in a room with instruments in it.
 * The failure mode is two people changing the tempo at the same moment and one of them losing,
 * which is survivable and self-correcting; the failure mode of a host is the jam stopping when
 * one person's laptop sleeps.
 *
 *
 * ⚠️ THE ECHO PROBLEM
 *
 * Applying a transport changes local loop state, and local loop state changes are what trigger a
 * broadcast — so without care, receiving one would send it straight back, and a room of three
 * would ring forever. `applying` is the guard. It is a flag rather than something cleverer
 * because the round trip is asynchronous and any comparison-based approach ("is this the same as
 * what I just received?") has to define same-ness on floating point clock values that were
 * deliberately converted between machines and therefore never match.
 */

let applying = false
let last = ''
let detach: Array<() => void> = []
let on = false

function snapshot(): string {
  const s = loopState()
  // origin only matters while running, and including it while stopped would broadcast on every
  // tick as the loop wound itself forward
  return `${s.bpm}|${s.bars}|${s.playing}|${s.playing ? loopOrigin().toFixed(3) : ''}`
}

export const transport = {
  /** Start following and leading the room's transport. Called when Jam goes on. */
  start() {
    if (detach.length) return () => {}
    on = true
    last = snapshot()

    const off = onParty((m) => {
      if (m.kind !== 'tempo' || !on) return
      const b = m.body as { bpm?: unknown; bars?: unknown; playing?: unknown; origin?: unknown }
      if (typeof b?.bpm !== 'number' || typeof b.bars !== 'number') return
      if (!Number.isFinite(b.bpm) || !Number.isFinite(b.bars)) return
      const playing = b.playing === true
      let origin = 0
      if (playing) {
        if (typeof b.origin !== 'number' || !Number.isFinite(b.origin)) return
        /**
         * ⚠️ Refuse rather than guess. Without a clock estimate for this peer their origin is a
         * number from another machine's timeline and means nothing here — adopting it would put
         * the bar line somewhere arbitrary, which is worse than the unsynced metronome this
         * exists to fix. The next ping is four seconds away and the next transport change will
         * land correctly.
         */
        const local = toLocalTime(m.from, b.origin)
        if (local == null) return
        origin = local
      }
      applying = true
      try {
        setTransport({ bpm: b.bpm, bars: b.bars, playing, origin })
      } finally {
        // after the state settles, so the change we just applied is not read back as ours to send
        last = snapshot()
        applying = false
      }
    })

    const offLoop = subscribeLoop(() => {
      if (!on || applying) return
      const now = snapshot()
      if (now === last) return
      last = now
      const s = loopState()
      sendParty('tempo', {
        bpm: s.bpm,
        bars: s.bars,
        playing: s.playing,
        origin: s.playing ? loopOrigin() : 0,
      })
    })

    detach = [off, offLoop]
    return () => {
      on = false
      detach.forEach((d) => d())
      detach = []
    }
  },
}
