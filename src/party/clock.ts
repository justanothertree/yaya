import { onParty, sendParty } from '../voice/voiceSession'
import { sharedCtx } from '../audio/context'

/**
 * What time it is on somebody else's machine.
 *
 * Two people cannot share a metronome until they agree what "now" means. Every browser's
 * AudioContext clock starts whenever that tab opened, so one person's `currentTime` might be 12
 * and another's 4000, and neither number means anything to the other. This works out the
 * difference.
 *
 *
 * HOW
 *
 * The oldest trick there is, and the one NTP is built on. I send a ping stamped with my clock;
 * you stamp it with yours and send it back; I read my clock again when it lands.
 *
 *     t0 ─────────────► t1 ─────────────► t2
 *     my clock         your clock        my clock
 *
 * The round trip took t2 - t0. If the two legs were equal, your t1 happened at my
 * (t0 + t2) / 2 — so your clock is ahead of mine by t1 - (t0 + t2) / 2. That assumption is the
 * whole error term, and it is wrong by exactly half of however lopsided the trip was.
 *
 * ⚠️ THE FASTEST SAMPLE WINS, not the average. Averaging sounds more careful and is worse: a
 * slow round trip is slow because something queued, queueing is one-directional, and a lopsided
 * trip breaks the equal-legs assumption the estimate rests on. Every delay beyond the minimum is
 * therefore evidence of asymmetry, and mixing it in mixes in its error. The quickest round trip
 * seen is the one least likely to have been held up in one direction.
 *
 *
 * HOW GOOD IS IT
 *
 * Good to roughly half the jitter in the round trips, which on a normal connection lands within
 * ten or twenty milliseconds. Two clicks that far apart read as one slightly thick click rather
 * than two events — a flam starts to be audible somewhere around thirty. So this is enough to
 * play to and not enough to record against, which is the honest description of jamming over the
 * internet anyway.
 *
 * ⚠️ It is deliberately NOT used to correct anybody's own playing. Your metronome and your own
 * notes always run on your clock, unadjusted. An offset is a running estimate that moves by a few
 * milliseconds every time it is refined, and applying that to the sound under your own hands
 * would make the instrument wobble in time for reasons happening on somebody else's network.
 * Only things that arrive from elsewhere get converted.
 */

/** How often to re-measure. Clocks drift slowly; the network changes faster than they do. */
const PING_MS = 4000
/** Samples older than this are thrown away, so a bad minute cannot poison the rest of a session. */
const SAMPLE_TTL_MS = 60000

type Sample = { offset: number; rtt: number; at: number }

/** best-known offset per peer: their clock minus ours, in seconds */
const best = new Map<string, Sample>()
/** pings we sent and are still waiting on, by nonce */
const pending = new Map<number, number>()
let nonce = 1
let timer = 0
let detach: Array<() => void> = []

/**
 * Their clock time, expressed on ours.
 *
 * Returns null when we have never heard back from them — the caller then has no business
 * scheduling anything against that peer's timeline, and should say so rather than guess. A
 * silently wrong guess here is a metronome that is confidently in the wrong place.
 */
export function toLocalTime(peer: string, theirTime: number): number | null {
  const s = best.get(peer)
  if (!s || Date.now() - s.at > SAMPLE_TTL_MS) return null
  return theirTime - s.offset
}

/** How far off we think a peer's clock is, and how sure we are, for the UI to be honest with. */
export function clockQuality(peer: string): { rtt: number; age: number } | null {
  const s = best.get(peer)
  if (!s) return null
  return { rtt: s.rtt, age: Date.now() - s.at }
}

export const clock = {
  start() {
    if (detach.length) return () => {}

    const off = onParty((m) => {
      const b = m.body as { n?: unknown; t0?: unknown; t1?: unknown }
      if (m.kind === 'ping') {
        // Answer immediately and with our clock read as late as possible. Any work done between
        // reading it and sending shows up as their clock looking slow.
        if (typeof b?.n !== 'number' || typeof b.t0 !== 'number') return
        sendParty('pong', { n: b.n, t0: b.t0, t1: sharedCtx().currentTime })
        return
      }
      if (m.kind !== 'pong') return
      if (typeof b?.n !== 'number' || typeof b.t1 !== 'number') return
      const t0 = pending.get(b.n)
      if (t0 === undefined) return // not ours, or already answered by this peer
      const t2 = sharedCtx().currentTime
      const rtt = t2 - t0
      if (!Number.isFinite(rtt) || rtt < 0 || rtt > 5) return
      const offset = b.t1 - (t0 + t2) / 2
      if (!Number.isFinite(offset)) return
      const prev = best.get(m.from)
      // keep the quickest round trip, unless what we have has gone stale
      if (!prev || rtt < prev.rtt || Date.now() - prev.at > SAMPLE_TTL_MS)
        best.set(m.from, { offset, rtt, at: Date.now() })
    })

    const ping = () => {
      // ⚠️ ONE ping, not one per peer. The channel is a broadcast, so everybody answers the same
      // message with their own reply — and each reply carries its sender, which is all we needed.
      const n = nonce++
      pending.set(n, sharedCtx().currentTime)
      sendParty('ping', { n, t0: sharedCtx().currentTime })
      // stop waiting eventually, or a peer that never answers leaks an entry per ping forever
      window.setTimeout(() => pending.delete(n), 6000)
    }
    ping()
    timer = window.setInterval(ping, PING_MS)

    detach = [
      off,
      () => {
        window.clearInterval(timer)
        timer = 0
        pending.clear()
        best.clear()
      },
    ]
    return () => {
      detach.forEach((d) => d())
      detach = []
    }
  },
}
