/**
 * Echo: the pads play a tune, one note longer each round, and you play it back. Get a note wrong
 * and the round is lost — once for the end of the game in strict play, or three times in gentle.
 * In mirror play the tune is played back backwards. The score is the longest tune you played back.
 *
 * Pure, so echo.test.ts can play thousands of rounds without a page. The pads are tuned to a
 * pentatonic scale, so any tune the dice make is one worth humming.
 */
import { rng } from './bricks'
import { whole } from './kept'

export const PAD_COUNTS = [4, 6] as const
export type PadCount = (typeof PAD_COUNTS)[number]
export const MODES = ['echo', 'mirror'] as const
export type Mode = (typeof MODES)[number]
/** each pad's note, as MIDI numbers: a major pentatonic from middle C, and its octave for six */
export const NOTES: Record<PadCount, number[]> = {
  4: [60, 64, 67, 69],
  6: [60, 62, 64, 67, 69, 72],
}
export const LIVES = { strict: 1, gentle: 3 } as const

/** the tune, as long as asked: the same seed gives the same tune, and a longer one starts the same */
export function tune(seed: number, length: number, pads: number): number[] {
  const r = rng(seed)
  const out: number[] = []
  for (let i = 0; i < length; i++) {
    // never the same pad four times running: that is a test of counting, not of memory
    let p = Math.floor(r() * pads)
    if (i >= 3 && out[i - 1] === p && out[i - 2] === p && out[i - 3] === p)
      p = (p + 1 + Math.floor(r() * (pads - 1))) % pads
    out.push(p)
  }
  return out
}
/** the order the pads must be pressed in for a tune */
export const answer = (t: readonly number[], mode: Mode) =>
  mode === 'mirror' ? [...t].reverse() : [...t]
/** how long each note of a tune this long is held apart, in milliseconds: quicker as it grows */
export const gapFor = (length: number) => Math.max(260, 640 - length * 24)

export type Run = {
  seed: number
  pads: PadCount
  mode: Mode
  /** how many notes this round's tune has */
  length: number
  /** pads pressed so far this round */
  pressed: number[]
  lives: number
  /** the longest tune played back so far */
  best: number
  over: boolean
}
export function newRun(seed: number, pads: PadCount, mode: Mode, lives: number): Run {
  return { seed, pads, mode, length: 1, pressed: [], lives, best: 0, over: false }
}
export const roundTune = (r: Run) => tune(r.seed, r.length, r.pads)

export type Verdict = 'right' | 'round' | 'wrong' | 'over' | 'ignored'
/**
 * A pad pressed: right so far, the round complete (the tune grows by one), wrong (the same round
 * again, a life down), or wrong for the last time.
 */
export function press(r: Run, pad: number): { run: Run; verdict: Verdict } {
  if (r.over || pad < 0 || pad >= r.pads) return { run: r, verdict: 'ignored' }
  const want = answer(roundTune(r), r.mode)
  const pressed = [...r.pressed, pad]
  if (want[pressed.length - 1] !== pad) {
    const lives = r.lives - 1
    return lives <= 0
      ? { run: { ...r, pressed, lives: 0, over: true }, verdict: 'over' }
      : { run: { ...r, pressed: [], lives }, verdict: 'wrong' }
  }
  if (pressed.length < want.length) return { run: { ...r, pressed }, verdict: 'right' }
  return {
    run: { ...r, pressed: [], length: r.length + 1, best: Math.max(r.best, r.length) },
    verdict: 'round',
  }
}

/* --------------------------------------------------------------------------- what is kept */

export const ECHO_KEY = 'lab_echo_v1'
export const SOUNDS = ['bell', 'keys', 'pluck'] as const
export type Sound = (typeof SOUNDS)[number]
export const PALETTES = ['bright', 'pastel', 'neon'] as const
const best0 = () => ({ echo: 0, mirror: 0 })
export type Saved = {
  pads: PadCount
  mode: Mode
  strict: boolean
  sound: Sound
  palette: (typeof PALETTES)[number]
  /** the longest tune played back, by pads and by mode, strict and gentle kept apart */
  best: Record<'strict' | 'gentle', Record<PadCount, Record<Mode, number>>>
}
export const EMPTY: Saved = {
  pads: 4,
  mode: 'echo',
  strict: true,
  sound: 'bell',
  palette: 'bright',
  best: { strict: { 4: best0(), 6: best0() }, gentle: { 4: best0(), 6: best0() } },
}
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const pick = <T>(list: readonly T[], x: unknown, d: T): T =>
    list.includes(x as T) ? (x as T) : d
  const obj = (x: unknown) => (typeof x === 'object' && x ? x : {}) as Record<string, unknown>
  const best = {} as Saved['best']
  for (const k of ['strict', 'gentle'] as const) {
    const b = obj(obj(o.best)[k])
    best[k] = { 4: best0(), 6: best0() }
    for (const p of PAD_COUNTS) {
      const q = obj(b[p])
      best[k][p] = { echo: whole(q.echo, 1e4), mirror: whole(q.mirror, 1e4) }
    }
  }
  return {
    pads: pick(PAD_COUNTS, o.pads, EMPTY.pads),
    mode: pick(MODES, o.mode, EMPTY.mode),
    strict: typeof o.strict === 'boolean' ? o.strict : EMPTY.strict,
    sound: pick(SOUNDS, o.sound, EMPTY.sound),
    palette: pick(PALETTES, o.palette, EMPTY.palette),
    best,
  }
}
