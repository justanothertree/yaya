import { INSTRUMENTS, fxSnapshot, setKnob, type Fx, type InstrumentId } from './synth'
import { CHORDS, type ChordId } from './chords'
import { STRUMS, type StrumId } from './strum'
import { ARPS, type ArpId } from './arp'
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
  /**
   * How a key is played, as opposed to what it sounds like.
   *
   * ⚠️ FOUR SETTINGS THAT ARRIVED AFTER THIS TYPE DID, and a rig quietly stopped describing the
   * sound the day the first of them shipped. "The same instrument, dry" and "the same
   * instrument, drenched" were the two things a kit was built to tell apart; "the same
   * instrument, as a swung arpeggiated seventh" is a bigger difference than either and was not
   * being saved at all. Applying a rig set the scale and the effects and left the chord and the
   * arpeggio wherever they happened to be, so the rig did not reproduce what you kept.
   *
   * ⚠️ OPTIONAL ON THE WAY IN. Every kit saved before today has none of them, and the honest
   * default is off — which is exactly how those kits sounded when they were saved.
   */
  chord: ChordId
  strum: StrumId
  arp: ArpId
  swing: boolean
}

const INST_IDS = INSTRUMENTS.map(([id]) => id)
const CHORD_IDS = CHORDS.map(([id]) => id)
const STRUM_IDS = STRUMS.map(([id]) => id)
const ARP_IDS = ARPS.map(([id]) => id)

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
      tone: kitNum(fx.tone, 0, 1, 0.5),
      glide: kitNum(fx.glide, 0, 1, 0),
    },
    /* validated against the real lists, so a kit naming a shape that has since been removed
       becomes "off" rather than a value nothing handles */
    chord: kitPick(CHORD_IDS, o.chord, 'off'),
    strum: kitPick(STRUM_IDS, o.strum, 'off'),
    arp: kitPick(ARP_IDS, o.arp, 'off'),
    swing: o.swing === true,
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
  /**
   * ⚠️ `tone` WAS MISSING HERE FOR AS LONG AS IT EXISTED, which is the whole reason this
   * function now has a test. `fxSnapshot` saved it and `readInstKit` validated it, so a rig
   * carried the tone faithfully in storage and then silently ignored it on the way back out —
   * two of the three paths updated and the third forgotten. Measured: save at 0.85, move the
   * slider to 0, apply the rig, and the knob is still 0 while echo comes back correctly.
   *
   * The loop below is deliberate. A list of five setKnob calls is a list somebody has to
   * remember to extend; walking the object means the next knob added to `Fx` is applied by
   * this function the moment it exists.
   */
  for (const k of Object.keys(fx) as Array<keyof Fx>) setKnob(k, fx[k])
}
