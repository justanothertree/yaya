import { sharedCtx, resumeAudio } from './context'
import { fxSnapshot, noteOff, noteOn, type Fx, type InstrumentId } from './synth'
import { detectTempo, lastPlayedAt, playedBetween } from './capture'
import { toEvents, toNotes } from './noteEdit'

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
  /**
   * How long this take is, in seconds.
   *
   * ⚠️ The take's OWN length, which is not the same as the loop's. Record two bars and then
   * ask for four and the take does not suddenly become four bars of music with two bars of
   * silence after it — it repeats, twice, which is what "make the loop longer" means to anyone
   * who has used a looper pedal. Shrink back to two and the second pass simply stops being
   * played; nothing is destroyed, and growing again brings it back.
   *
   * Kept in seconds and rescaled with the tempo (see setBpm) rather than stored as a bar count,
   * because the events beside it are in seconds too and the two must not be able to disagree.
   */
  len: number
  /**
   * Which bars of the song this layer plays in — the arrangement.
   *
   * ⚠️ UNDEFINED MEANS EVERYWHERE, and that is what makes this additive rather than a rewrite.
   * Every take recorded before arrangement existed, and every one recorded without touching the
   * grid, has no mask and plays in every bar exactly as it always did. Structure is something you
   * opt into by turning a bar off, not something you have to set up before you can hear anything.
   *
   * One entry per bar of the SONG, not of the take. A one-bar drum loop in a sixteen-bar song has
   * sixteen entries, because the question the arrangement answers is "is the drum part playing
   * during bar 12", and the tiling underneath already knows how to repeat a short take to get
   * there.
   */
  play?: boolean[]
  /**
   * The effect settings this take was played with.
   *
   * ⚠️ STORED ON THE LAYER, not read from the knobs at playback. The knobs are live, so a part
   * recorded with a long echo and a big room lost both the moment you turned them down to record
   * something dry over the top — the events never changed, but every layer in the stack was
   * played through whatever the sliders said at that instant. You could not build an arrangement,
   * because the last thing you touched rewrote everything under it.
   *
   * Captured at COMMIT rather than at the first note, so a sound you were still dialling in while
   * the count-in ran is stored as you finally left it rather than as you first tried it.
   */
  fx: Fx
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
/**
 * How long a song may be.
 *
 * ⚠️ Raised from eight, because eight bars is a loop and a track is not. The scheduler already
 * tiles a short take across a long loop, so a one-bar drum pattern fills thirty-two bars without
 * anyone re-recording it — which means the only thing standing between a loop and an arrangement
 * was the ceiling and a way to say "not in this bar".
 */
const MAX_BARS = 32
/**
 * How far ahead notes are handed to the audio clock.
 *
 * ⚠️ Raised while jamming (see setLookahead). Alone at the keyboard, short is better: it is
 * how quickly muting a layer or moving a slider takes effect. In a jam every scheduled note is
 * also a message to everyone else, and a message that leaves 140ms before the note is due arrives
 * after it — the lookahead has to cover the trip or the far end is always late.
 */
let lookahead = 0.14
const LOOKAHEAD_SOLO = 0.14

/** Give the network room while jamming; back to snappy when alone. */
export function setLookahead(seconds: number) {
  lookahead = Math.max(LOOKAHEAD_SOLO, Math.min(1, seconds))
}
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

/**
 * Voice ids the loop has started and not yet released, per layer.
 *
 * ⚠️ THIS IS WHAT FIXES NOTES THAT RANG FOREVER. A note-off only ever happened because the
 * scheduler came round to the event that carried it — so anything that stopped the scheduler
 * reaching it left the note sounding with nothing left in the world able to stop it. Every one of
 * these was reachable from the UI:
 *
 *   Stop            — the timer died mid-note; the note-off was still in the future.
 *   Mute a layer    — `if (layer.muted) continue` skips its note-OFFS as eagerly as its note-ons.
 *   Delete a layer  — the events holding the note-off went with it.
 *   Clear / Undo    — same, in bulk.
 *   Tempo or bars   — the grid moves under the scheduled note, and its note-off lands somewhere
 *                     the window never looks.
 *
 * Panic was the only cure, which is why it existed. Tracking the ids means each of those can
 * release exactly the notes it is responsible for instead — muting one layer must not cut off
 * another, which a global panic cannot help doing.
 */
const sounding = new Map<string, Set<string>>()

/**
 * Somebody who wants to know about every note the loop schedules, and when.
 *
 * Exists so the jam can send your loops to the room as NOTES rather than as audio down the call
 * — with the time they are due, so the far end schedules them rather than playing them on
 * arrival. The looper stays unaware of any of that: it announces, and something else decides
 * whether anyone is listening.
 */
export type ScheduledNote = {
  midi: number
  on: boolean
  inst: InstrumentId
  /** when it is due, on our audio clock */
  at: number
  /** which layer it belongs to, so the far end can keep the parts apart */
  part: string
  /**
   * ⚠️ The LAYER's effects, not the live knobs. Sending a snapshot of the sliders would
   * undo the whole point of storing effects on a take: everyone else would hear your bassline
   * through whatever you happened to be dialling in for the take you are playing now.
   */
  fx: Fx
}

let onSchedule: ((n: ScheduledNote) => void) | null = null

export function setScheduleListener(fn: ((n: ScheduledNote) => void) | null) {
  onSchedule = fn
}

function noteStarted(layerId: string, voice: string) {
  let set = sounding.get(layerId)
  if (!set) sounding.set(layerId, (set = new Set()))
  set.add(voice)
}

/**
 * Silence one layer now.
 *
 * Immediate rather than at the note's scheduled end: the caller is stopping, muting or deleting,
 * and every one of those means "now". A voice whose oscillator has not started yet is still worth
 * releasing — stopping it early is how it ends up making no sound at all rather than starting
 * after the layer it belongs to has gone.
 */
export function releaseLayer(layerId: string) {
  const set = sounding.get(layerId)
  if (!set) return
  for (const v of set) noteOff(v)
  sounding.delete(layerId)
}

/** Silence every layer, without touching whatever you are playing by hand. */
function releaseAllLayers() {
  for (const id of [...sounding.keys()]) releaseLayer(id)
}

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
    // ⚠️ Nothing before the first pass. Starting with a count-in puts loopStart a bar in the
    // future, which makes rep -1 a real repetition as far as the arithmetic is concerned — and
    // its notes land inside the count-in. You would hear the loop during the bar that exists to
    // tell you the loop has not started.
    if (rep < 0) continue
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
      /**
       * A take shorter than the loop REPEATS to fill it.
       *
       * Two bars laid down and then four asked for gives you the two bars twice, not two bars
       * and a silence — the thing a looper pedal does, and the thing "make it longer" means.
       * A take LONGER than the loop is cut short at the boundary: the events are still there, so
       * shrinking is a view rather than an edit and growing again brings the rest back.
       *
       * ⚠️ WHOLE REPETITIONS ONLY, and this was a note-that-rang-forever.
       *
       * The condition used to be `k * own < len`, which admits a final repetition that STARTS
       * inside the loop without finishing inside it — and the guard below then skipped everything
       * past the boundary, note-OFFS included. So a take of 1.2s in a 5s loop scheduled a fifth
       * pass at 4.8s, its note-ons at 4.9s were played, and their note-offs at 5.15s were dropped
       * on the floor. The note had nothing left in the world to end it, and every lap started
       * another copy on top. That is the sticking-and-layering that survived the quantise fix,
       * because it was never the same bug.
       *
       * Whole repetitions leave a sliver of silence when the loop is not an exact multiple of the
       * take, which is the correct answer: a partial pass is not something anybody asked to hear.
       */
      const own = Math.max(0.05, layer.len)
      const reps = Math.max(1, Math.floor(len / own + 1e-6))
      const end = base + len
      const barLen = (60 / state.bpm) * BEATS_PER_BAR
      for (let k = 0; k < reps; k++) {
        const sub = base + k * own
        /**
         * ⚠️ Skip a whole repetition that cannot touch this window.
         *
         * Cheap before, load-bearing now. A one-bar take in a thirty-two bar song is thirty-two
         * repetitions, and the window only ever covers a fraction of a second of them — without
         * this, every layer walked every note of every repetition forty times a second to
         * discard almost all of it. One comparison per repetition instead.
         */
        if (sub > to || sub + own < from) continue
        for (const e of layer.events) {
          let at = sub + e.t
          /**
           * The arrangement: silence in a bar this layer is not part of.
           *
           * ⚠️ Checked on the NOTE's bar rather than the repetition's, so a note that starts
           * near the end of one bar belongs to the bar it starts in. Deciding per repetition
           * would let a take that straddles a boundary sound in a bar you had switched off.
           *
           * Note-offs are exempt: a note that legitimately started must always be allowed to
           * end, even if it runs into a bar the layer is muted for. Silencing the release rather
           * than the attack is how a note rings forever.
           */
          if (e.on && layer.play) {
            const bar = Math.floor((at - base) / barLen)
            if (bar >= 0 && bar < layer.play.length && !layer.play[bar]) continue
          }
          /**
           * ⚠️ A note-off past the boundary is CLAMPED, never skipped.
           *
           * Skipping a note-on is fine — a note that cannot start inside the loop simply does not
           * play. Skipping a note-OFF is not symmetrical at all: its note-on may already have
           * been scheduled, and dropping the only thing that would have ended it is precisely how
           * a voice ends up ringing until Panic. This can still be reached with a take longer
           * than the loop, where k=0 alone runs past the end. Ending it at the boundary is both
           * safe and what the truncation already implies.
           */
          if (at >= end) {
            if (e.on) continue
            at = Math.max(from, end - 0.005)
          }
          if (at < from || at >= to) continue
          // ⚠️ the id carries the layer, the repetition AND which pass through the take this is.
          // Without the repetition a note still sounding when the loop came round would be
          // silenced by its own next note-on; without `k`, the second pass through a tiled take
          // would silence the first one's held notes.
          const id = `L${layer.id}:${rep}:${k}:${e.midi}`
          // the layer is its own part, so its echo and reverb are its own too — see Layer.fx
          if (e.on) {
            noteOn(id, layer.instrument, e.midi, at, { key: `L${layer.id}`, fx: layer.fx })
            noteStarted(layer.id, id)
          } else {
            noteOff(id, at)
            sounding.get(layer.id)?.delete(id)
          }
          onSchedule?.({
            midi: e.midi,
            on: e.on,
            inst: layer.instrument,
            at,
            part: `L${layer.id}`,
            fx: layer.fx,
          })
        }
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

  const target = now + lookahead
  if (scheduledTo < now) scheduledTo = now
  if (target > scheduledTo) {
    scheduleWindow(scheduledTo, target)
    scheduledTo = target
  }
  // clamped at 0: during a count-in `now` is before the loop's first beat, and a playhead
  // running backwards off the left of the bar is not a useful picture of "about to start"
  set({ position: Math.max(0, (now - loopStart) / len) })
}

/**
 * Start the transport.
 *
 * `leadIn` pushes the first bar into the future without delaying the scheduler, which is what
 * makes a count-in possible: the clicks live BEFORE the loop's first beat, so there has to be
 * room before it for them to happen in.
 */
export function startLoop(leadIn = 0) {
  if (state.playing) return
  resumeAudio()
  const c = sharedCtx()
  loopStart = c.currentTime + 0.08 + Math.max(0, leadIn)
  // ⚠️ from NOW, not from loopStart. The count-in sits in the gap between the two, and a
  // scheduler that only looked forward from the loop's first beat would never see it.
  scheduledTo = c.currentTime
  set({ playing: true })
  timer = window.setInterval(tick, TICK_MS)
}

/**
 * Jump the playhead to a point in the loop.
 *
 * ⚠️ MOVES THE ORIGIN, it does not move a cursor. The loop has no playhead variable to set — the
 * position is derived from `currentTime - loopStart` — so "go to 1.5s in" is "pretend the pass
 * began 1.5s ago". That sounds like a trick and is actually the honest description: the origin IS
 * where the bar line is, which is why this is the same operation the shared metronome sends.
 *
 * ⚠️ Held notes are released FIRST. Skipping over a note-off leaves the voice that its note-on
 * started with nothing to stop it, and it rings until Panic — the classic stuck note, arrived at
 * by the one gesture guaranteed to skip events.
 *
 * scheduledTo is wound back to now, or the scheduler would believe it had already covered the
 * stretch you just jumped into and would play nothing until it caught up.
 *
 * Nothing here knows about the network. transport.ts already broadcasts on any origin change
 * while playing, so a seek reaches the room the same way a tempo change does, under the same
 * last-change-wins rule — which is what you want, because a loop with two different origins is
 * not one loop.
 */
export function seekTo(t: number) {
  if (!state.playing) return
  const c = sharedCtx()
  const len = loopLength()
  if (!(len > 0)) return
  const into = ((t % len) + len) % len
  releaseAllLayers()
  loopStart = c.currentTime - into
  scheduledTo = c.currentTime
  // let anything watching the transport see that the origin moved
  set({})
}

export function stopLoop() {
  if (timer) clearInterval(timer)
  timer = 0
  // ⚠️ before commitTake, not after: a take being committed can add a layer, and releasing
  // afterwards would then chase notes that were never started
  releaseAllLayers()
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
/**
 * Keep the thing you just played, without having been recording.
 *
 * ⚠️ There is no recording step. Every note has been going into a ring buffer since the page
 * loaded (see capture.ts), so this reads history rather than capturing anything — which is the
 * entire point. A record button asks you to decide before you play, and deciding is what stops
 * people playing well; this asks afterwards, when you already know whether it was any good.
 *
 * Two cases, and they want different things:
 *
 * RUNNING — there is already a grid, so the last loop's worth of playing is folded onto it by
 * the same modulo the live recorder uses. A phrase played across the loop boundary lands where it
 * belongs in the cycle rather than being cut in half, because the cycle is what it was played
 * against.
 *
 * STOPPED — there is no grid, so one is inferred from the playing itself and the phrase starts at
 * bar one. ⚠️ The tempo is only ADOPTED WHEN THERE ARE NO LAYERS YET. Detection is good but not
 * certain, and quietly re-timing an arrangement somebody has already built on the strength of a
 * guess is not a trade worth making — with layers present, capture uses the tempo you set and
 * leaves the guess alone.
 */
export function captureLast(): { ok: boolean; notes: number; bpm: number; tempoSet: boolean } {
  const c = sharedCtx()
  const now = c.currentTime
  const last = lastPlayedAt()
  const fail = { ok: false, notes: 0, bpm: state.bpm, tempoSet: false }
  // nothing played, or nothing played recently enough that "the last bit" means anything
  if (last == null || now - last > 30) return fail

  let bpm = state.bpm
  let tempoSet = false
  let len: number
  let from: number
  let to: number
  let phase: number

  if (state.playing) {
    len = loopLength()
    from = now - len
    to = now
    phase = loopStart
  } else {
    const onsets = playedBetween(last - 25, now)
      .filter((e) => e.on)
      .map((e) => e.t)
    const guess = state.layers.length ? null : detectTempo(onsets)
    if (guess) {
      bpm = guess
      tempoSet = true
    }
    len = (state.bars * BEATS_PER_BAR * 60) / bpm
    // start the take at the first note of the phrase, not at an arbitrary moment `len` ago —
    // otherwise a four-bar capture of a two-bar idea begins with two bars of silence
    const winStart = last - len
    const inWindow = onsets.filter((t) => t >= winStart)
    phase = inWindow.length ? inWindow[0] : winStart
    from = phase
    to = phase + len
  }

  /**
   * Pair the note-ons with their note-offs in ABSOLUTE time, before any wrapping.
   *
   * ⚠️ Order matters here and getting it wrong is how you make a note that never stops. Wrap
   * first and a note held across the loop boundary becomes an off at 0.1 and an on at 0.9 — sorted
   * by time, the off comes first, the on has nothing after it, and the note rings forever. Pairing
   * while the times are still absolute keeps each note whole; the wrap then moves a note rather
   * than splitting one.
   */
  const played = playedBetween(from - 0.001, to + 0.001)
  const open = new Map<number, number>()
  const notes: Array<{ midi: number; t: number; dur: number }> = []
  let inst: InstrumentId = 'keys'
  for (const e of played) {
    inst = e.inst
    const prev = open.get(e.midi)
    if (prev !== undefined) notes.push({ midi: e.midi, t: prev, dur: e.t - prev })
    if (e.on) open.set(e.midi, e.t)
    else open.delete(e.midi)
  }
  // still held when the window closes: end them at the window's end, as commitTake does
  for (const [midi, t] of open) notes.push({ midi, t, dur: to - t })

  const wrap = (t: number) => (state.playing ? (((t - phase) % len) + len) % len : t - phase)
  const placed = notes
    .filter((n) => n.dur > 0.02)
    .map((n) => ({ midi: n.midi, t: wrap(n.t), dur: n.dur }))
    .filter((n) => n.t >= 0 && n.t < len)

  // toEvents does the boundary trimming and the same-pitch overlap rule — the same code the note
  // editor writes through, so a captured take cannot be shaped differently from an edited one
  const events = quantise(toEvents(placed, len), len, state.quantize)
  if (!events.some((e) => e.on)) return fail

  const layer: Layer = {
    id: String(Date.now()),
    instrument: inst,
    events,
    muted: false,
    fx: fxSnapshot(),
    len,
  }
  if (tempoSet || bpm !== state.bpm) set({ bpm })
  set({ layers: [...state.layers, layer] })
  if (!state.playing) startLoop()
  return { ok: true, notes: placed.length, bpm, tempoSet }
}

export function armRecord(replaceId?: string) {
  /**
   * ⚠️ Pressing record from STOPPED counts you in first.
   *
   * It used to start the loop 80ms away and arm onto that, so every count-in click — they sit at
   * armAt minus one, two, three, four beats — was already in the past by the time it was
   * scheduled, and none of them was ever heard. Recording simply began, instantly, from silence,
   * with nothing to play to. A bar of lead-in puts those four clicks back in the future where
   * they can be sounded, which is the entire point of a count-in.
   *
   * When the loop is ALREADY running there is no lead-in: the next boundary is coming anyway and
   * the clicks before it are already scheduled.
   */
  const beat = 60 / state.bpm
  if (!state.playing) startLoop(BEATS_PER_BAR * beat)
  const c = sharedCtx()
  const len = loopLength()
  // the next top: the start itself when it has not happened yet, otherwise one boundary on
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
  /**
   * ⚠️ SNAP OFF STILL NORMALISES. It used to return the take untouched, and that was a stuck
   * note nobody could see coming.
   *
   * commitTake closes anything still held at `len - 0.02`. Strike a note in the last fraction of
   * a pass and capture() records the note-on at, say, 1.999 — so the closer's note-off at 1.980
   * sorts BEFORE the note-on it belongs to. The scheduler then starts that note every lap with
   * nothing left to end it. With snapping on the take went through the converter and the problem
   * could not survive; with snapping off it went straight into the layer.
   *
   * So the early return keeps only the SNAP, and hands the events through the converter either
   * way. Turning a musical preference off should not change whether the data is well formed.
   */
  if (!q) return toEvents(toNotes(events, len), len)
  const grid = (60 / state.bpm) * (4 / q)
  /**
   * ⚠️ DONE IN NOTES, NOT IN EVENTS — and the event version had a bug that made notes ring
   * forever, stacking another copy on every repetition until Panic.
   *
   * It snapped each note-on with `(Math.round(t / grid) * grid) % len`. For a note near the end of
   * the take that rounds UP to len, and the modulo then wraps it to ZERO — the note-on jumps to
   * the top of the loop while its note-off, moved by the same (now hugely negative) delta, gets
   * clamped to 0 as well. A note-on and a note-off at the same instant sort unstably, so half the
   * time the off came first, the on had nothing after it, and the voice was never released. Every
   * lap added another.
   *
   * Snapping the note's START and carrying its LENGTH along cannot express that state at all: a
   * note is a start and a duration, so there is no way to produce an on without an off. toEvents
   * then applies the boundary rule and the same-pitch overlap rule — the same code the editor
   * writes through, so a quantised take and an edited one are shaped by one set of rules.
   *
   * Clamped rather than wrapped, too. A note at the very end belongs at the end; wrapping it to
   * the start moves it somewhere the player did not play it.
   */
  const notes = toNotes(events, len).map((n) => ({
    ...n,
    t: Math.max(0, Math.min(len, Math.round(n.t / grid) * grid)),
  }))
  return toEvents(notes, len)
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
        l.id === target
          ? { ...l, instrument: takeInstrument, events, muted: false, fx: fxSnapshot(), len }
          : l,
      ),
    })
    return
  }
  set({
    recording: false,
    replacing: null,
    layers: [
      ...state.layers,
      {
        id: String(Date.now()),
        instrument: takeInstrument,
        events,
        muted: false,
        fx: fxSnapshot(),
        len,
      },
    ],
  })
}

export function toggleMute(id: string) {
  // muting has to cut what that layer is holding; the scheduler will never reach those note-offs
  releaseLayer(id)
  set({ layers: state.layers.map((l) => (l.id === id ? { ...l, muted: !l.muted } : l)) })
}

export function removeLayer(id: string) {
  releaseLayer(id)
  set({ layers: state.layers.filter((l) => l.id !== id) })
}

export function clearLayers() {
  releaseAllLayers()
  set({ layers: [] })
}

/**
 * Move the whole arrangement to a new tempo.
 *
 * ⚠️ Event times are scaled with it. They are stored in seconds, so leaving them alone would
 * mean a take recorded at 90bpm keeps its old spacing while the bar lines move — the part drifts
 * off the grid and then gets cut off by the end of a loop that is now shorter than it is. Scaling
 * both the events and each take's own length by the same ratio keeps every note exactly where it
 * was musically, which is the only reading of a tempo change that makes sense.
 */
export function setBpm(bpm: number) {
  const next = Math.max(40, Math.min(200, Math.round(bpm)))
  if (next === state.bpm) return
  const ratio = state.bpm / next
  restart()
  set({
    bpm: next,
    layers: state.layers.map((l) => ({
      ...l,
      len: l.len * ratio,
      events: l.events.map((e) => ({ ...e, t: e.t * ratio })),
    })),
  })
}

export function setBars(bars: number) {
  const next = Math.max(1, Math.min(MAX_BARS, Math.round(bars)))
  if (next === state.bars) return
  // Layers are NOT touched: a take keeps its own length and the scheduler tiles it into whatever
  // the loop is now. That is what makes going 2 -> 4 fill the new bars and 4 -> 2 reversible.
  restart()
  set({ bars: next })
}

/**
 * Take the loop back to the top after a structural change.
 *
 * Changing the tempo or the bar count moves every bar line, so notes already scheduled against
 * the old grid land in places the new one never looks — which is one of the ways a note used to
 * get stuck. Releasing and restarting from the top is both the safe answer and the legible one:
 * you changed the shape of the loop, so the loop starts again.
 */
function restart() {
  releaseAllLayers()
  if (!state.playing) return
  const c = sharedCtx()
  loopStart = c.currentTime
  scheduledTo = c.currentTime
}

/**
 * Where the current loop began, on the audio clock.
 *
 * Exposed so a jam can share it. The metronome is a click at loopStart + n beats and nothing
 * else, so two people agreeing on this number and on the tempo is the whole of "our metronomes
 * are together" — there is nothing else to synchronise.
 */
export function loopOrigin(): number {
  return loopStart
}

/**
 * Adopt somebody else's transport.
 *
 * ⚠️ `origin` is in OUR audio clock already — the caller has converted it (see party/clock).
 * Doing the conversion here would put a network concern inside the sequencer, and the sequencer
 * has no idea other machines exist.
 *
 * Layers are left alone. Following someone's tempo must not rewrite the takes you have recorded,
 * which is exactly what setBpm does and why this is not simply setBpm plus a nudge.
 */
export function setTransport(t: { bpm: number; bars: number; playing: boolean; origin: number }) {
  const bpm = Math.max(40, Math.min(200, Math.round(t.bpm)))
  const bars = Math.max(1, Math.min(8, Math.round(t.bars)))
  if (!t.playing) {
    if (state.playing) stopLoop()
    if (bpm !== state.bpm || bars !== state.bars) set({ bpm, bars })
    return
  }
  releaseAllLayers()
  loopStart = t.origin
  const c = sharedCtx()
  scheduledTo = Math.max(c.currentTime, t.origin)
  // wind an origin that is already in the past forward to the pass we are actually in, so the
  // playhead and the metronome describe now rather than a bar that finished minutes ago
  const len = (bars * BEATS_PER_BAR * 60) / bpm
  while (c.currentTime - loopStart >= len) loopStart += len
  if (!state.playing) {
    if (timer) clearInterval(timer)
    timer = window.setInterval(tick, TICK_MS)
  }
  set({ bpm, bars, playing: true })
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
  releaseLayer(state.layers[state.layers.length - 1].id)
  set({ layers: state.layers.slice(0, -1) })
}

/**
 * Re-voice a take without replaying it.
 *
 * The cheapest fix of all: the notes are right, the sound is not. Storing notes rather than audio
 * is what makes this a one-line change instead of a re-recording.
 */
/**
 * Give a layer the sound the knobs are currently making.
 *
 * The escape hatch for the rule above: settings stick to the take, which is right almost always
 * and wrong the moment you decide the bassline wants more room after all. Re-recording it just to
 * change the reverb would mean playing it again, which is a silly price for turning a dial.
 */
/**
 * Turn one bar of one layer on or off.
 *
 * ⚠️ Releases the layer first, for the same reason editing its notes does: the bar you just
 * switched off may be sounding right now, and the note-off that would have ended it is about to
 * stop being scheduled.
 *
 * The mask is grown to the song's length on demand and filled with `true`, so switching one bar
 * off never silently mutes the bars nobody has touched.
 */
/**
 * A layer with nothing in it, to draw notes into.
 *
 * ⚠️ The note editor could only ever be reached through a recording, so starting a loop meant
 * playing something first even when what you wanted was to place four notes by hand. A take is
 * stored as notes, so there is no reason an empty one cannot exist — the only thing standing in
 * the way was that every path to a layer went through the recorder.
 *
 * commitTake still refuses an empty PASS, and should: an empty pass is somebody who armed by
 * accident, and turning that into a layer would litter the stack. This is the deliberate version
 * of the same thing, which is a different intention entirely.
 */
export function addEmptyLayer(instrument: InstrumentId): string {
  const id = `${Date.now()}-blank`
  set({
    layers: [
      ...state.layers,
      { id, instrument, events: [], muted: false, fx: fxSnapshot(), len: loopLength() },
    ].slice(0, 12),
  })
  return id
}

export function toggleLayerBar(id: string, bar: number) {
  releaseLayer(id)
  set({
    layers: state.layers.map((l) => {
      if (l.id !== id) return l
      const mask = Array.from({ length: state.bars }, (_, i) => l.play?.[i] ?? true)
      if (bar >= 0 && bar < mask.length) mask[bar] = !mask[bar]
      return { ...l, play: mask }
    }),
  })
}

/** Put a layer back in every bar. */
export function clearLayerBars(id: string) {
  releaseLayer(id)
  set({ layers: state.layers.map((l) => (l.id === id ? { ...l, play: undefined } : l)) })
}

export function setLayerFx(id: string) {
  set({ layers: state.layers.map((l) => (l.id === id ? { ...l, fx: fxSnapshot() } : l)) })
}

/**
 * Replace a layer's notes, from the editor.
 *
 * ⚠️ Releases the layer first. Editing while the loop runs is the normal case — you nudge a
 * note and listen to what it did — and the events holding the note-offs for whatever is sounding
 * right now are the ones being replaced. Without this, editing a layer mid-note strands it,
 * exactly like muting used to.
 */
/**
 * Replace everything with a saved song.
 *
 * ⚠️ Stops and releases first. Loading over a running loop would leave every currently sounding
 * note owned by a layer that no longer exists, and nothing left to release it — the same
 * stranding that mute and delete had to be taught about.
 */
export function loadSong(bpm: number, bars: number, layers: Layer[]) {
  stopLoop()
  releaseAllLayers()
  set({
    bpm: Math.max(40, Math.min(200, Math.round(bpm))),
    bars: Math.max(1, Math.min(MAX_BARS, Math.round(bars))),
    layers,
    position: 0,
  })
}

/**
 * Drop one saved part into what you already have — a drum loop you made last week under a new
 * bassline.
 *
 * ⚠️ The layer keeps its OWN length rather than being stretched to this song's loop. That is what
 * makes reuse work at all: a one-bar drum pattern tiles into a four-bar arrangement (see the
 * scheduler), so borrowing a part does not require the two songs to have been the same shape. The
 * tempo is not touched either — the borrowed part plays at the tempo you are working at now,
 * which is the only reading that lets you build something new out of it.
 */
export function addLayers(layers: Layer[]) {
  if (!layers.length) return
  set({ layers: [...state.layers, ...layers].slice(0, 12) })
}

export function setLayerEvents(id: string, events: LoopEvent[]) {
  releaseLayer(id)
  set({
    layers: state.layers.map((l) =>
      l.id === id ? { ...l, events: [...events].sort((a, b) => a.t - b.t) } : l,
    ),
  })
}

export function setLayerInstrument(id: string, instrument: InstrumentId) {
  set({ layers: state.layers.map((l) => (l.id === id ? { ...l, instrument } : l)) })
}
