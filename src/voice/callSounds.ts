import { sharedCtx } from '../audio/context'

/**
 * Little call chimes: you joined, you left, someone arrived, someone went.
 *
 * Synthesised rather than loaded from files. Four small audio assets would mean four
 * requests, four things to host and four things to get wrong on a slow connection, and a
 * two-note chime is a dozen lines of Web Audio. Nothing to download, nothing to cache.
 *
 * Shape follows what people already expect from every voice app: rising = arrived,
 * falling = gone. Yours are a two-note phrase; other people's are a single short blip, so a
 * busy room doesn't turn into a xylophone.
 */

const KEY = 'voice.sounds.v1'

let ctx: AudioContext | null = null

export function soundsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function setSoundsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* private mode — it just won't persist */
  }
}

/** One soft sine note with an eased envelope; a raw gate on an oscillator clicks. */
function note(at: number, freq: number, dur: number, peak: number) {
  if (!ctx) return
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, at)
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(peak, at + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(g)
  g.connect(ctx.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

function play(seq: Array<[freq: number, delay: number, dur: number, peak: number]>) {
  if (!soundsEnabled()) return
  try {
    if (!ctx) ctx = sharedCtx()
    // A context made before any gesture starts suspended. Joining a call is a gesture, so
    // by the time these play it's unlocked — resume anyway, silently, in case it isn't.
    void ctx.resume().catch(() => {})
    const t0 = ctx.currentTime + 0.01
    seq.forEach(([f, d, dur, peak]) => note(t0 + d, f, dur, peak))
  } catch {
    /* no Web Audio — silence is an acceptable outcome for a chime */
  }
}

// Deliberately quiet. These land while someone is putting a phone to their ear.
export const callSounds = {
  /** you joined — rising perfect fourth, resolves upward */
  join: () =>
    play([
      [523.25, 0, 0.16, 0.16],
      [698.46, 0.09, 0.24, 0.16],
    ]),
  /** you left — the same phrase inverted */
  leave: () =>
    play([
      [698.46, 0, 0.14, 0.14],
      [466.16, 0.08, 0.28, 0.14],
    ]),
  /** someone else arrived — one bright blip */
  peerJoin: () => play([[880, 0, 0.12, 0.1]]),
  /** someone else left — one lower blip */
  peerLeave: () => play([[587.33, 0, 0.16, 0.1]]),
}
