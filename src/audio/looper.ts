import { sharedCtx, resumeAudio } from './context'
import { noteOff, noteOn, type InstrumentId } from './synth'

/**
 * A loop you play into, and then play over.
 *
 * Record a pass, and it repeats; record again and the new pass stacks on top. That is the whole
 * instrument — a drum part, then a bassline over it, then a melody — and it is why this exists
 * rather than a step grid: you play a loop the way you play anything else, in time, with your
 * hands, instead of drawing it in.
 *
 * ⚠️ IT STORES NOTES, NOT AUDIO. Each layer is a list of "midi 60 down at 1.42s into the loop",
 * so a take is a few hundred bytes, can be replayed on any instrument, survives a tempo change
 * without pitch-shifting, and is exactly the payload that would travel to a friend's browser when
 * the shared room arrives. Recording the sound instead would give up all four.
 *
 * ⚠️ AND IT SCHEDULES AHEAD, which is the part that makes it usable at all. A setTimeout per note
 * lands wherever the browser's timer queue feels like — tens of milliseconds of jitter, which on
 * a hi-hat is the difference between a groove and a stumble. Instead a coarse timer wakes up
 * often and hands the audio clock every note due in the next fraction of a second; the clock,
 * which is sample-accurate, decides exactly when they sound. This is the standard Web Audio
 * scheduling pattern and there is no accurate alternative.
 */

export type LoopEvent = { t: number; midi: number; on: boolean }
export type Layer = {
  id: string
  instrument: InstrumentId
  events: LoopEvent[]
  muted: boolean
}

type State = {
  playing: boolean
  recording: boolean
  /** true once armed but before the loop comes round to the top */
  waiting: boolean
  bpm: number
  bars: number
  metronome: boolean
  /** 0 = off, else the subdivision notes snap to: 4 = quarters, 8 = eighths, 16 = sixteenths */
  quantize: number
  layers: Layer[]
  /** 0–1 through the current loop, for a playhead */
  position: number
  /** beats left before a take begins, so the UI can count you in. 0 when not arming. */
  countIn: number
  /** the layer a take will REPLACE, if you armed onto one */
  replacing: string | null
}

const BEATS_PER_BAR = 4
const LOOKAHEAD_S = 0.14
const TICK_MS = 25

let state: State = {
  playing: false,
  recording: false,
  waiting: false,
  bpm: 96,
  bars: 2,
  metronome: true,
  quantize: 8,
  layers: [],
  position: 0,
  countIn: 0,
  replacing: null,
}

const listeners = new Set<() => void>()
let snapshot = state

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  snapshot = state
  for (const fn of listeners) fn()
}

export function subscribeLoop(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export function loopState(): State {
  return snapshot
}

export const loopLength = () => (state.bars * BEATS_PER_BAR * 60) / state.bpm

let timer = 0
/** Where the current loop began, on the audio clock. */
let loopStart = 0
/** How far ahead we have already scheduled, as an absolute audio time. */
let scheduledTo = 0
/**
 * The exact audio time a waiting take will begin at.
 *
 * ⚠️ THIS IS WHY ARMING USED TO DO NOTHING. The old check was `now >= loopStart`, and
 * loopStart is advanced to the current loop before that line runs — so it was always true and
 * recording began on the next 25ms tick rather than at the top of the loop. Arm halfway through
 * a bar and your take started halfway through a bar, every time, which is most of why the thing
 * was hard to play with. Remembering the boundary makes the wait real.
 */
let armAt: number | null = null

/** Events captured during the pass being recorded now. */
let takeEvents: LoopEvent[] = []
let takeInstrument: InstrumentId = 'keys'
/** Notes held when recording started, so an unmatched note-off cannot hang a layer forever. */
const heldInTake = new Map<number, number>()

/** A click that is heard but never seen or sent. */
function click(at: number, accent: boolean, countIn = false) {
  const c = sharedCtx()
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'square'
  // the count-in sits above the metronome so the two are never confused for each other
  o.frequency.value = countIn ? (accent ? 2300 : 1850) : accent ? 1600 : 1050
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(accent ? 0.16 : 0.09, at + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.045)
  /**
   * ⚠️ Straight to the speakers: NOT through the synth's chain, NOT to the analyser, and NOT to
   * the broadcast bus. A click is a tool for the person playing — reverbed, drawn as a flash on
   * the visualiser every beat, or piped to everyone in the call, it would be three kinds of
   * wrong. Your metronome is nobody else's business.
   */
  o.connect(g).connect(c.destination)
  o.start(at)
  o.stop(at + 0.06)
}

/** Schedule everything falling between two absolute times. */
function scheduleWindow(from: number, to: number) {
  const len = loopLength()
  const beat = 60 / state.bpm

  // walk each loop repetition that overlaps the window
  const firstRep = Math.floor((from - loopStart) / len)
  const lastRep = Math.floor((to - loopStart) / len)
  for (let rep = firstRep; rep <= lastRep; rep++) {
    const base = loopStart + rep * len
    if (base + len < from) continue

    if (state.metronome) {
      for (let b = 0; b < state.bars * BEATS_PER_BAR; b++) {
        const at = base + b * beat
        if (at >= from && at < to) click(at, b % BEATS_PER_BAR === 0)
      }
    }

    for (const layer of state.layers) {
      if (layer.muted) continue
      for (const e of layer.events) {
        const at = base + e.t
        if (at < from || at >= to) continue
        // ⚠️ the id carries the layer AND the repetition. Without the repetition, a note still
        // sounding when the loop came round would be silenced by its own next note-on.
        const id = `L${layer.id}:${rep}:${e.midi}`
        if (e.on) noteOn(id, layer.instrument, e.midi, at)
        else noteOff(id, at)
      }
    }
  }

  /**
   * The count-in: the bar leading into a take, clicked whether or not the metronome is on.
   *
   * ⚠️ Independent of the metronome switch on purpose. Somebody who plays with the click off
   * still needs to know when recording starts, and "it began somewhere in the last two seconds"
   * is not something you can play to. This is the one case where the site makes a noise you did
   * not ask for, and it earns it.
   *
   * ⚠️ Outside the repetition loop, because the count-in happens ONCE at a known absolute
   * time — scheduling it per repetition would stack four identical clicks on the same instant
   * whenever the window spanned a loop boundary.
   */
  if (armAt != null) {
    for (let b = 1; b <= BEATS_PER_BAR; b++) {
      const at = armAt - b * beat
      if (at >= from && at < to) click(at, b === BEATS_PER_BAR, true)
    }
  }
}

function tick() {
  const c = sharedCtx()
  const now = c.currentTime
  const len = loopLength()

  // a pass just completed while armed: commit it and keep going
  if (state.recording && now - loopStart >= len) {
    commitTake()
  }
  while (now - loopStart >= len) loopStart += len

  if (state.waiting && armAt != null) {
    if (now >= armAt) {
      armAt = null
      set({ waiting: false, recording: true, countIn: 0 })
      takeEvents = []
      heldInTake.clear()
    } else {
      // how many beats are left before it starts, for the countdown on screen
      const beat = 60 / state.bpm
      const left = Math.max(1, Math.ceil((armAt - now) / beat))
      if (left !== state.countIn) set({ countIn: left })
    }
  }

  const target = now + LOOKAHEAD_S
  if (scheduledTo < now) scheduledTo = now
  if (target > scheduledTo) {
    scheduleWindow(scheduledTo, target)
    scheduledTo = target
  }
  set({ position: (now - loopStart) / len })
}

export function startLoop() {
  if (state.playing) return
  resumeAudio()
  const c = sharedCtx()
  loopStart = c.currentTime + 0.08
  scheduledTo = loopStart
  set({ playing: true })
  timer = window.setInterval(tick, TICK_MS)
}

export function stopLoop() {
  if (timer) clearInterval(timer)
  timer = 0
  if (state.recording) commitTake()
  armAt = null
  set({
    playing: false,
    recording: false,
    waiting: false,
    position: 0,
    countIn: 0,
    replacing: null,
  })
}

/**
 * Arm recording. The take begins at the TOP of the loop, not the instant you press the button.
 *
 * Anything else is unusable: you would have to hit record exactly on the downbeat while also
 * playing, and every take would start a fraction late. Arming and waiting is what every looper
 * does, and it is why the button says "armed" until the loop comes round.
 */
export function armRecord(replaceId?: string) {
  if (!state.playing) startLoop()
  const c = sharedCtx()
  const len = loopLength()
  /**
   * The NEXT top, not this instant.
   *
   * When the loop is already running that is one boundary away; when it has only just been
   * started it is the start itself, so pressing record from stopped does not cost you a whole
   * empty lap before anything happens.
   */
  armAt = c.currentTime < loopStart ? loopStart : loopStart + len
  set({ waiting: true, replacing: replaceId ?? null })
}

export function cancelRecord() {
  armAt = null
  set({ waiting: false, recording: false, countIn: 0, replacing: null })
  takeEvents = []
  heldInTake.clear()
}

/** Called by the keyboard for every note played, recorded or not. */
export function capture(midi: number, on: boolean, instrument: InstrumentId) {
  if (!state.recording) return
  const c = sharedCtx()
  const len = loopLength()
  let t = (c.currentTime - loopStart) % len
  if (t < 0) t += len
  takeInstrument = instrument
  if (on) heldInTake.set(midi, t)
  else heldInTake.delete(midi)
  takeEvents.push({ t, midi, on })
}

/**
 * Snap a take to the grid.
 *
 * ⚠️ Note-ONS are snapped and their matching note-off is moved BY THE SAME AMOUNT, rather
 * than snapping both independently. Snapping each end separately quietly rewrites how long every
 * note is — short notes collapse to zero length and vanish, long ones grow — so a quantised take
 * would not just be tidier than what you played, it would be a different part. Moving the pair
 * together fixes the timing and leaves the performance alone.
 */
function quantise(events: LoopEvent[], len: number, q: number): LoopEvent[] {
  if (!q) return events
  const grid = (60 / state.bpm) * (4 / q)
  const out = events.map((e) => ({ ...e }))
  for (const on of out) {
    if (!on.on) continue
    const snapped = (Math.round(on.t / grid) * grid) % len
    const delta = snapped - on.t
    on.t = snapped
    // the first note-off for this pitch after the original onset is this note's end
    const off = out.find((e) => !e.on && e.midi === on.midi && e.t >= on.t - delta)
    if (off) off.t = Math.max(0, Math.min(len - 0.001, off.t + delta))
  }
  return out.sort((a, b) => a.t - b.t)
}

function commitTake() {
  const len = loopLength()
  /**
   * ⚠️ Close anything still held.
   *
   * A note held across the end of the pass has a note-on and no note-off, and a layer like that
   * plays a note that never stops — on every repetition, forever, until Panic. Ending it a hair
   * before the loop boundary is both correct and what the player actually did: they were still
   * holding it when the loop came round.
   */
  for (const [midi] of heldInTake) {
    takeEvents.push({ t: Math.max(0, len - 0.02), midi, on: false })
  }
  heldInTake.clear()
  const events = quantise(
    takeEvents.sort((a, b) => a.t - b.t),
    len,
    state.quantize,
  )
  takeEvents = []
  const target = state.replacing
  if (!events.some((e) => e.on)) {
    // an empty pass is not a layer — it is somebody who armed by accident. Note that this also
    // means re-recording and playing nothing LEAVES the old take alone rather than wiping it.
    set({ recording: false, replacing: null })
    return
  }
  if (target) {
    // replace in place, keeping the layer's position in the stack so the list does not reorder
    // under the hand that just recorded it
    set({
      recording: false,
      replacing: null,
      layers: state.layers.map((l) =>
        l.id === target ? { ...l, instrument: takeInstrument, events, muted: false } : l,
      ),
    })
    return
  }
  set({
    recording: false,
    replacing: null,
    layers: [
      ...state.layers,
      { id: String(Date.now()), instrument: takeInstrument, events, muted: false },
    ],
  })
}

export function toggleMute(id: string) {
  set({ layers: state.layers.map((l) => (l.id === id ? { ...l, muted: !l.muted } : l)) })
}

export function removeLayer(id: string) {
  set({ layers: state.layers.filter((l) => l.id !== id) })
}

export function clearLayers() {
  set({ layers: [] })
}

export function setBpm(bpm: number) {
  set({ bpm: Math.max(40, Math.min(200, Math.round(bpm))) })
}

export function setBars(bars: number) {
  set({ bars: Math.max(1, Math.min(8, Math.round(bars))) })
}

export function setMetronome(on: boolean) {
  set({ metronome: on })
}

export function setQuantize(q: number) {
  set({ quantize: q })
}

/** Take back the last thing you recorded, without hunting for it in the list. */
export function undoLast() {
  if (!state.layers.length) return
  set({ layers: state.layers.slice(0, -1) })
}

/**
 * Re-voice a take without replaying it.
 *
 * The cheapest fix of all: the notes are right, the sound is not. Storing notes rather than audio
 * is what makes this a one-line change instead of a re-recording.
 */
export function setLayerInstrument(id: string, instrument: InstrumentId) {
  set({ layers: state.layers.map((l) => (l.id === id ? { ...l, instrument } : l)) })
}
