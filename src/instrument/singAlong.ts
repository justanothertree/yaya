import { sharedCtx } from '../audio/context'
import { hasLyrics } from '../audio/lyricLines'
import { harmonyAbove } from '../audio/lyrics'
import {
  loopLength,
  loopOrigin,
  loopState,
  seekTo,
  setLayerWordsGain,
  startLoop,
  subscribeLoop,
} from '../audio/looper'
import { PRESETS, singInto, type PresetId } from '../audio/singer'
import { fitSongLyrics } from '../audio/songLyrics'
import { partInput, type Fx } from '../audio/synth'

/**
 * The song, sung: every part's words on its notes, every time round the loop, until it is stopped.
 *
 * ⚠️ A PLAY-THROUGH OF THE SONG YOU BUILT, NOT A LINE ON ONE TAKE — Evan, 15 Nov 2026: "a
 * play-through so I hear the singer on my existing song". ▶ starts the song from bar one (or
 * jumps it there when it is already playing) and the voice comes in with it; it sings again each
 * time round, so it behaves like a part of the song rather than a one-off, until ■ or the room's
 * own Stop.
 *
 * ⚠️ EACH LAP IS FITTED WHEN IT IS SCHEDULED, about a second before it starts — so a word changed
 * in the lyrics box is heard the next time round, the same way a note changed in the editor is.
 *
 * ⚠️ THE LOOP'S ORIGIN IS WATCHED, because the voice is scheduled ahead on the audio clock and the
 * loop is not: a seek, a tempo change or a new length moves the bar lines under a line already
 * scheduled. Any jump that is not the loop simply coming round stops what was scheduled and sings
 * again from where the loop now is.
 *
 * ⚠️ IT IS MODULE STATE, NOT A COMPONENT'S, so closing the lyrics box does not stop the voice —
 * the ■ on the lyrics row and the dot on 🎤 Voice still can. The room stops it on its way out.
 */

/** how every line is sung — the vibe pass's two keepers (docs/2026-11-14-singer-vibe.md) */
const SOUND = { vibrato: 'late', space: 'room' } as const
/* the voice brings its own vibrato, glide and breath — and its own light room, which REPLACES the
   bus's reverb, so the bus adds none (two rooms on one voice is the smear the A/B measured) */
const DRY: Fx = { echo: 0, echoTime: 0.26, space: 0, vibrato: 0, glide: 0, tone: 0.5 }
/** how loud the voice comes, before a part's own words fader */
const WORDS = 0.9
/**
 * ⚠️ EACH PART'S WORDS ON A BUS OF THEIR OWN, so each can have its own fader. They shared one
 * ('sing') while nothing could set a level; with two singing parts on one bus, the second part's
 * level would simply overwrite the first's.
 */
const wordsBus = (id: string) => `sing:${id}`

/**
 * How loud a part's words are sung — the lyrics row's fader. Kept on the part, and heard at once
 * if the song is being sung: the bus is ramped where it stands, rather than waiting for the next
 * lap to be scheduled with the new level.
 */
export function setWordsLevel(id: string, gain: number) {
  setLayerWordsGain(id, gain)
  if (singing) levelWords()
}

/**
 * The words' buses at the level each part now asks for — changed by the fader above, or by
 * anything else that changes a part: an undo, a jam partner, a song put back. Only what moved is
 * touched, so a bus is not re-ramped forty times a second for nothing.
 *
 * ⚠️ WITHOUT THIS, ONLY THE FADER REACHED A BUS THAT WAS SINGING. Undoing a level, or a partner
 * changing it, was heard from the next lap — on a long song, over a minute later.
 */
const levelled = new Map<string, number>()
function levelWords() {
  for (const part of loopState().layers) {
    if (!hasLyrics(part)) continue
    const g = part.wordsGain ?? 1
    if (levelled.get(part.id) === g) continue
    levelled.set(part.id, g)
    partInput(wordsBus(part.id), DRY, WORDS * g)
  }
}

/** how far ahead of a lap its line is scheduled */
const AHEAD = 1
const TICK_MS = 150

export type Harmony = 'off' | 'third' | 'octave'
export type VoiceChoice = { preset: PresetId; double: boolean; harmony: Harmony }

const VOICE_KEY = 'inst_sing_voice_v1'
/* a doubled voice is part of what makes the breathy and glitchy sounds; clean starts single */
export const DOUBLED: Record<PresetId, boolean> = { clean: false, breathy: true, glitchy: true }

function readVoice(): VoiceChoice {
  const fallback: VoiceChoice = { preset: 'clean', double: false, harmony: 'off' }
  try {
    const o = JSON.parse(localStorage.getItem(VOICE_KEY) ?? 'null') as Partial<VoiceChoice> | null
    if (!o || typeof o !== 'object') return fallback
    return {
      preset: o.preset && o.preset in PRESETS ? o.preset : fallback.preset,
      double: typeof o.double === 'boolean' ? o.double : fallback.double,
      harmony: o.harmony === 'third' || o.harmony === 'octave' ? o.harmony : 'off',
    }
  } catch {
    return fallback
  }
}

let voice: VoiceChoice | null = null
let singing = false
let scale: { degrees: readonly number[]; root: number } = {
  degrees: [0, 2, 4, 5, 7, 9, 11],
  root: 0,
}
const listeners = new Set<() => void>()
let view = { singing, voice: { preset: 'clean', double: false, harmony: 'off' } as VoiceChoice }
const tell = () => {
  view = { singing, voice: voiceNow() }
  for (const fn of listeners) fn()
}

export const voiceNow = (): VoiceChoice => (voice ??= readVoice())
export const singView = () => view
export const singingNow = () => view.singing
export function subscribeSinging(fn: () => void): () => void {
  if (!listeners.size) view = { singing, voice: voiceNow() }
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** the voice, double and harmony — remembered, and heard from the next lap */
export function setVoice(patch: Partial<VoiceChoice>) {
  voice = { ...voiceNow(), ...patch }
  try {
    localStorage.setItem(VOICE_KEY, JSON.stringify(voice))
  } catch {
    /* private window: it lasts the visit */
  }
  tell()
}

/** the scale the harmony follows — the room's, told whenever it changes */
export function setSingScale(degrees: readonly number[], root: number) {
  scale = { degrees, root }
}

/** what is scheduled: the stop for each lap's voices, keyed by when that lap starts */
const laps = new Map<number, () => void>()
let timer = 0
let unsub: (() => void) | null = null
/** the origin and length the scheduled laps were laid against */
let laidAt: { origin: number; len: number } | null = null

/**
 * Sing one lap of the song, starting at `top` on the audio clock. Notes before `from` seconds into
 * the lap are left out — the part of a lap the loop has already played when the voice joins it.
 */
function singLap(top: number, from: number): () => void {
  const s = loopState()
  const c = sharedCtx()
  const v = voiceNow()
  const stops: Array<() => void> = []
  for (const part of s.layers.filter(hasLyrics)) {
    const sung = fitSongLyrics(part, s).sung.filter((n) => n.t >= from - 1e-6)
    if (!sung.length) continue
    stops.push(
      singInto(c, partInput(wordsBus(part.id), DRY, WORDS * (part.wordsGain ?? 1)), sung, top, {
        ...SOUND,
        preset: v.preset,
        double: v.double,
        harmony: v.harmony === 'off' ? null : (m) => harmonyAbove(m, scale.degrees, scale.root),
        octave: v.harmony === 'octave',
        beat: 60 / s.bpm,
        seed: Math.floor(Math.random() * 1e9),
        /* a lap scheduled ahead has time for its first consonant before the downbeat */
        lead: Math.max(0, top + from - (c.currentTime + 0.03)),
      }),
    )
  }
  return () => stops.forEach((x) => x())
}

/**
 * One lap of the song's words, from its top at `top` on the audio clock, for a recording of the
 * song: the voice's own sound and choices, and no following — a bounce plays the song once, and
 * the last word should ring out rather than be cut by a next lap that is never coming. Returns
 * its stop, to let go of the nodes afterwards. Nothing when no part has words.
 */
export function singOneLap(top: number): (() => void) | null {
  return loopState().layers.some(hasLyrics) ? singLap(top, 0) : null
}

function hushLaps() {
  for (const stop of laps.values()) stop()
  laps.clear()
}

/** keep the voice a lap ahead of the loop, and start again wherever the loop jumps to */
function follow() {
  const s = loopState()
  if (!s.playing) {
    stopSinging()
    return
  }
  const now = sharedCtx().currentTime
  const len = loopLength()
  const o = loopOrigin()
  /* a seek, a tempo change or a new length: the loop did not just come round, it moved */
  const laps0 = laidAt ? (o - laidAt.origin) / len : NaN
  const steady =
    laidAt !== null &&
    Math.abs(len - laidAt.len) < 1e-6 &&
    Math.abs(laps0 - Math.round(laps0)) * len < 0.005
  if (!steady) {
    hushLaps()
    laidAt = { origin: o, len }
  }
  /* this lap, from wherever the loop has got to — the whole of it when it has only just begun
     (or not yet: a loop just started begins a few milliseconds in the future) */
  const into = now - o
  if (!laps.has(key(o))) laps.set(key(o), singLap(o, into < 0.05 ? 0 : into + 0.12))
  /* and the next, a little before it comes round */
  const next = o + len
  if (now > next - AHEAD && !laps.has(key(next))) laps.set(key(next), singLap(next, 0))
  /* laps long finished keep nothing worth stopping */
  for (const k of [...laps.keys()]) if (k / 1000 < o - len - 2) laps.delete(k)
  levelWords()
}
const key = (t: number) => Math.round(t * 1000)

/**
 * Play the song from the top with the words sung. Nothing happens without words to sing.
 *
 * ⚠️ FROM BAR ONE EITHER WAY: the loop is started, or jumped back to its top when it is already
 * going — a play-through that came in at bar seven would not be one.
 */
export function startSinging() {
  stopSinging()
  if (!loopState().layers.some(hasLyrics)) return
  if (loopState().playing) seekTo(0)
  else startLoop()
  singing = true
  laidAt = { origin: loopOrigin(), len: loopLength() }
  follow()
  timer = window.setInterval(follow, TICK_MS)
  unsub = subscribeLoop(() => {
    if (!loopState().playing) stopSinging()
  })
  tell()
}

/** Stop the voice — every lap already scheduled included. The loop itself is left alone. */
export function stopSinging() {
  hushLaps()
  if (timer) window.clearInterval(timer)
  timer = 0
  unsub?.()
  unsub = null
  laidAt = null
  if (!singing) return
  singing = false
  tell()
}
