import { sharedCtx, resumeAudio } from './context'
import { noteOff, noteOn } from './synth'
import type { Song } from './songFile'

/**
 * Playing somebody's song, anywhere on the site.
 *
 * ⚠️ DELIBERATELY NOT THE LOOPER. The looper is a singleton holding whatever you are working on,
 * and a visitor pressing play on a profile must not load a stranger's arrangement over the top of
 * their own half-finished one. This is a separate, much smaller thing: it can play a song and
 * stop, and it can do nothing else — no recording, no editing, no transport that anything else
 * shares.
 *
 * It does go through the same synth, which is what makes the visualiser block work: the synth
 * registers the `instrument` tap, so a song playing on a profile is a signal the visualiser can
 * already watch without anything being wired between them.
 *
 * ⚠️ The scheduling rules are the looper's, and they are here because they were learned the hard
 * way rather than because they are obvious:
 *
 *   WHOLE REPETITIONS ONLY. A pass that starts inside the loop without finishing inside it gets
 *   its note-ons scheduled and its note-offs dropped past the boundary, and the note rings until
 *   the tab closes — with another copy stacked on every lap.
 *
 *   NOTE-OFFS ARE CLAMPED, NEVER SKIPPED. Skipping a note-on is fine; a note that cannot start
 *   does not play. Skipping a note-off is not the mirror of that, because its note-on may already
 *   be sounding.
 *
 *   EVERY STARTED VOICE IS TRACKED, so stopping actually stops rather than leaving the last bar
 *   ringing over whatever the visitor does next.
 */

const LOOKAHEAD = 0.2
const TICK_MS = 40
const BEATS_PER_BAR = 4

type State = { playing: string | null }
let state: State = { playing: null }
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

export function songPlayerState() {
  return state
}
export function subscribeSongPlayer(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let timer = 0
let origin = 0
let scheduledTo = 0
let current: Song | null = null
let token = ''
const sounding = new Set<string>()

function releaseAll() {
  for (const id of sounding) noteOff(id)
  sounding.clear()
}

function tick() {
  const song = current
  if (!song) return
  const c = sharedCtx()
  const now = c.currentTime
  const len = (song.bars * BEATS_PER_BAR * 60) / song.bpm
  if (len <= 0) return

  const target = now + LOOKAHEAD
  if (scheduledTo < now) scheduledTo = now
  if (target <= scheduledTo) return

  const from = scheduledTo
  const to = target
  const firstRep = Math.floor((from - origin) / len)
  const lastRep = Math.floor((to - origin) / len)

  for (let rep = Math.max(0, firstRep); rep <= lastRep; rep++) {
    const base = origin + rep * len
    const end = base + len
    for (let li = 0; li < song.layers.length; li++) {
      const layer = song.layers[li]
      if (layer.muted) continue
      const own = Math.max(0.05, layer.len)
      const reps = Math.max(1, Math.floor(len / own + 1e-6))
      for (let k = 0; k < reps; k++) {
        const sub = base + k * own
        for (const e of layer.events) {
          let at = sub + e.t
          if (at >= end) {
            if (e.on) continue
            at = Math.max(from, end - 0.005)
          }
          if (at < from || at >= to) continue
          const id = `sp:${token}:${li}:${rep}:${k}:${e.midi}`
          if (e.on) {
            noteOn(id, layer.instrument, e.midi, at, { key: `sp:${token}:${li}`, fx: layer.fx })
            sounding.add(id)
          } else {
            noteOff(id, at)
            sounding.delete(id)
          }
        }
      }
    }
  }
  scheduledTo = to
}

/** Stop whatever is playing. Safe to call when nothing is. */
export function stopSong() {
  if (timer) window.clearInterval(timer)
  timer = 0
  current = null
  releaseAll()
  if (state.playing) set({ playing: null })
}

/**
 * Play a song, identified by `id` so the UI can show which one is going.
 *
 * ⚠️ Stops anything already playing first. Two songs at once is never what somebody clicking a
 * second play button meant, and on a profile with three of them it would be a mess nobody could
 * untangle without reloading.
 */
export function playSong(id: string, song: Song) {
  stopSong()
  resumeAudio()
  const c = sharedCtx()
  current = song
  token = `${Date.now().toString(36)}`
  origin = c.currentTime + 0.08
  scheduledTo = origin
  set({ playing: id })
  tick()
  timer = window.setInterval(tick, TICK_MS)
}

/** Play it if it isn't playing, stop it if it is — what a single play button on a card wants. */
export function toggleSong(id: string, song: Song) {
  if (state.playing === id) stopSong()
  else playSong(id, song)
}
