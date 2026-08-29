/**
 * How loud each thing is, kept in one place.
 *
 * ⚠️ VOLUME MUST NOT REACH THE ANALYSER. That is the whole reason this is a module rather than a
 * gain node bolted onto whatever needed one. The obvious wiring — source → gain → analyser →
 * speakers — means turning the music down also shrinks the bars, and the visualiser slowly dies
 * as you make the room comfortable. The correct shape is a fork:
 *
 *     source ─┬─► analyser        (measure: full signal, output left dangling)
 *             └─► gain ─► speakers (hear: attenuated)
 *
 * so loudness and picture are independent. Every producer here wires it that way.
 *
 * Channels rather than one master, because the things being mixed are unrelated: a backing track
 * and your own microphone played back to you are different decisions, and an instrument room will
 * be a third. A single slider would make each new source fight the others.
 */

export type Channel = 'music' | 'monitor'

const KEY: Record<Channel, string> = {
  music: 'mix_music_v1',
  monitor: 'mix_monitor_v1',
}

/**
 * Defaults chosen for the first second, not for the average case.
 *
 * Music starts at half rather than full: the first thing anyone does is drop a track in, and a
 * file that opens at full scale on a laptop is genuinely startling. Monitor starts lower still —
 * see localMic.ts on why anything above unity there is a feedback howl waiting to happen.
 */
const DEFAULTS: Record<Channel, number> = { music: 0.5, monitor: 0.6 }

const EVENT = 'yaya:mixer'

const level: Record<Channel, number> = { ...DEFAULTS }

try {
  for (const c of Object.keys(level) as Channel[]) {
    const v = Number(localStorage.getItem(KEY[c]))
    if (Number.isFinite(v) && v >= 0 && v <= 1) level[c] = v
  }
} catch {
  /* private mode — the defaults are sensible */
}

/** Live gain nodes, so a slider reaches audio that is already playing. */
const nodes = new Map<Channel, GainNode>()

export function volume(c: Channel): number {
  return level[c]
}

export function setVolume(c: Channel, v: number) {
  level[c] = Math.max(0, Math.min(1, v))
  const node = nodes.get(c)
  if (node) {
    // ⚠️ Ramped, never assigned. Setting .value on a live gain is a step change in the waveform,
    // which is an audible click — and dragging a slider would be a burst of them.
    try {
      node.gain.setTargetAtTime(level[c], node.context.currentTime, 0.015)
    } catch {
      node.gain.value = level[c]
    }
  }
  try {
    localStorage.setItem(KEY[c], String(level[c]))
  } catch {
    /* applies for this visit */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

export function onMixerChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

/**
 * Build the gain node for a channel, already at the stored level.
 *
 * The producer owns the node's lifetime and calls releaseGain when it tears down; this only holds
 * a reference so a slider can find it. A stale node left in the map would be a gain on a closed
 * context, which throws the moment somebody moves the slider.
 */
export function makeGain(ctx: AudioContext, c: Channel): GainNode {
  const g = ctx.createGain()
  g.gain.value = level[c]
  nodes.set(c, g)
  return g
}

export function releaseGain(c: Channel) {
  nodes.delete(c)
}
