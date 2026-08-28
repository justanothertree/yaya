/**
 * The sound of somebody wanting to talk to you.
 *
 * Synthesised rather than shipped as a file. An mp3 would be a network request, a licence to
 * think about, and weight in a bundle that is already over the chunk warning — for two seconds
 * of audio that is four oscillators and an envelope. It also means the tone can be tuned by
 * changing a number instead of re-recording anything.
 *
 * Two distinct sounds, because the two events deserve different urgency: a DM ringing is
 * someone calling YOU, and a group call filling up is ambient news.
 */

import { registerTap } from '../audio/audioTap'

/** One shared context. Browsers cap how many you may create, and a leaked one per ring adds up. */
let ctx: AudioContext | null = null
/** Where notes go instead of straight to the destination — see audio(). */
let bus: AnalyserNode | null = null
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (!ctx) {
      ctx = new Ctor()
      // Every note routes through here on its way out, so a visualiser watching 'ring' sees the
      // actual ringtone rather than a guess at it. In-path, unlike the call's analysers: this is
      // the only route to the speakers, so leaving its output dangling would mute the ring.
      bus = ctx.createAnalyser()
      bus.fftSize = 1024
      bus.connect(ctx.destination)
      registerTap('ring', bus)
    }
    return ctx
  } catch {
    return null
  }
}

/**
 * Autoplay policy: a context created before the user has interacted starts `suspended`, and
 * calling resume() outside a gesture does nothing. So we resume on the first real gesture and
 * simply stay quiet until then — a ring that throws is worse than a ring that waits.
 */
export function armRingtone(): () => void {
  if (typeof window === 'undefined') return () => {}
  const wake = () => {
    const a = audio()
    if (a && a.state === 'suspended') void a.resume().catch(() => {})
  }
  const opts = { passive: true } as const
  window.addEventListener('pointerdown', wake, opts)
  window.addEventListener('keydown', wake, opts)
  return () => {
    window.removeEventListener('pointerdown', wake)
    window.removeEventListener('keydown', wake)
  }
}

/**
 * One struck note.
 *
 * The gain ramps instead of switching: a bare start/stop on a gain of 1 is a step change in the
 * waveform, which is a click. Triangle rather than sine because a pure sine at low volume reads
 * as a hum on laptop speakers; a triangle keeps a little edge to cut through.
 */
function note(a: AudioContext, freq: number, at: number, dur: number, peak: number) {
  const osc = a.createOscillator()
  const gain = a.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, at)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(gain).connect(bus ?? a.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

const PREF = 'call_sound_v1'

/** Default ON — a call you don't hear about is the thing being fixed. */
export function ringtoneEnabled(): boolean {
  try {
    return localStorage.getItem(PREF) !== '0'
  } catch {
    return true
  }
}

export function setRingtoneEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? '1' : '0')
  } catch {
    /* private mode — the sound still works for this session */
  }
}

/**
 * `ring` — a DM is calling you. Two rising notes, twice, like a phone.
 * `joined`  — someone stepped into a group call. One soft note, once.
 */
export function playCallSound(kind: 'ring' | 'joined') {
  if (!ringtoneEnabled()) return
  const a = audio()
  // suspended = the user hasn't interacted yet, so we are not allowed to make noise
  if (!a || a.state !== 'running') return
  const t = a.currentTime + 0.02
  if (kind === 'joined') {
    // a perfect fifth up, quiet — "someone's here", not "answer me"
    note(a, 587.33, t, 0.16, 0.06) // D5
    note(a, 880.0, t + 0.1, 0.22, 0.05) // A5
    return
  }
  // E5 -> A5 twice, with the gap a desk phone leaves between rings
  for (const off of [0, 0.62]) {
    note(a, 659.25, t + off, 0.2, 0.1)
    note(a, 880.0, t + off + 0.14, 0.34, 0.09)
  }
}
