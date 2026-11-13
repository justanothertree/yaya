import type { Fx } from '../audio/synth'

/**
 * A layer's effects in a couple of words.
 *
 * Numbers would be honest and unreadable at this size — four percentages per row, in a list you
 * are scanning to find the bassline. The exact values are in the tooltip; this only has to be
 * enough to tell two layers apart at a glance.
 */
export function fxWord(fx: Fx): string {
  const bits: string[] = []
  if (fx.echo > 0.02) bits.push('echo')
  if (fx.space > 0.25) bits.push('room')
  if (fx.vibrato > 0.02) bits.push('wobble')
  if (fx.glide > 0.02) bits.push('slide')
  return bits.length ? bits.join(' + ') : 'dry'
}
