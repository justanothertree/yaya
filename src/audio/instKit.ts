import { INSTRUMENTS, fxSnapshot, setKnob, type Fx, type InstrumentId } from './synth'
import { kitName, kitNum, kitPick, kitStore } from '../ui/savedKits'

/**
 * A rig: what you play, where on the keyboard, in what key, through which effects.
 *
 * ⚠️ THE ROOM ALREADY REMEMBERED FOUR OF THESE AND FORGOT THE FIVE THAT MATTER MOST. Instrument,
 * octave, scale and root each had their own storage key; the effects — echo, its time, space,
 * vibrato and glide — had none, so the sound you spent a minute dialling in was gone the moment
 * you left, while the octave you barely touched came back. Effects are the difference between two
 * patches far more than the octave is.
 *
 * A kit is all nine at once, which also makes "the same instrument, dry" and "the same instrument,
 * drenched" two different things you can keep — which is what a person actually wants to switch
 * between.
 */
export type InstKit = {
  name: string
  inst: InstrumentId
  octave: number
  scale: string
  root: number
  fx: Fx
}

const INST_IDS = INSTRUMENTS.map(([id]) => id)

/**
 * Read a kit without ever throwing.
 *
 * ⚠️ The scale is checked by the CALLER's list, not here: SCALES lives in the room, and importing
 * a room into an audio module to validate one string is the wrong direction. What this does
 * guarantee is the part that can hurt — every effect value lands in 0..1 before it can reach an
 * AudioParam, because a feedback gain above 1 is a delay line that never decays.
 */
export function readInstKit(v: unknown, scaleIds: readonly string[]): InstKit | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = kitName(o.name)
  if (!name) return null
  const fx = (o.fx ?? {}) as Record<string, unknown>
  return {
    name,
    inst: kitPick(INST_IDS, o.inst, 'keys'),
    octave: Math.round(kitNum(o.octave, 1, 6, 4)),
    scale: kitPick(scaleIds, o.scale, 'chromatic'),
    root: Math.round(kitNum(o.root, 0, 11, 0)),
    fx: {
      echo: kitNum(fx.echo, 0, 1, 0),
      echoTime: kitNum(fx.echoTime, 0, 1, 0.26),
      space: kitNum(fx.space, 0, 1, 0),
      vibrato: kitNum(fx.vibrato, 0, 1, 0),
      glide: kitNum(fx.glide, 0, 1, 0),
    },
  }
}

/**
 * The store, given the room's scale list.
 *
 * ⚠️ Built once at module load with the list passed in, rather than the module reaching for it.
 * Same reason as everywhere else today: the check has to be against the list the room really
 * offers, and the way that goes wrong is a second copy of it living somewhere else.
 */
export const makeInstKits = (scaleIds: readonly string[]) =>
  kitStore<InstKit>('instrument_kits_v1', (v) => readInstKit(v, scaleIds))

/** Everything a kit captures, read off the live synth and the room's own state. */
export const captureFx = (): Fx => fxSnapshot()

/** Put a kit's effects on the synth, through the same setter the sliders use. */
export function applyFx(fx: Fx) {
  setKnob('echo', fx.echo)
  setKnob('echoTime', fx.echoTime)
  setKnob('space', fx.space)
  setKnob('vibrato', fx.vibrato)
  setKnob('glide', fx.glide)
}
