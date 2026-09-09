import { sharedCtx } from './context'
import { readWaveform } from './audioTap'
import { limiterReduction, liveVoices, noteCounts, preLimitPeak, resetNoteCounts } from './synth'

/**
 * Is the sound actually broken, and in which of the two ways?
 *
 * ⚠️ THIS EXISTS BECAUSE CRACKLING CANNOT BE DEBUGGED BY DESCRIPTION. "Crackling" and "popping"
 * name a symptom with two completely different causes, and the fix for one does nothing for the
 * other:
 *
 *   CLIPPING   the signal goes past what the output can represent and the peaks are flattened.
 *              Shows up as `clipped` climbing while `peak` sits at 1. A mixing problem.
 *   DROPOUTS   the audio thread misses its deadline and the buffer it was filling goes out
 *              half-written. Shows up as `dropped` climbing, with peak nowhere near 1. A
 *              machine-is-too-busy problem, and no amount of envelope work will touch it.
 *
 * Both were measured to zero on the development machine while the fault was plainly audible on a
 * phone — which is the whole reason this is in the page rather than in a test. The device that has
 * the problem has to be the device that does the measuring.
 *
 * ON BY DEFAULT, and turned off with ?audio_debug=0. It earned that: four separate audio faults
 * this week were each found by a number rather than by reasoning, and the one that took longest
 * was the one nobody could measure on the device that had it.
 */

export type AudioHealth = {
  /** how far ahead the hardware buffer runs, in ms — the headroom the audio thread has */
  bufferMs: number
  bufferFrames: number
  sampleRate: number
  /** render quanta the audio thread failed to deliver on time since the last read */
  dropped: number
  /** times the gap between quanta was more than a quantum and a half */
  gaps: number
  /** loudest sample seen since the last read, 0..1 */
  peak: number
  /** samples at or above 0.985 — the flattened tops of a clipped waveform */
  clipped: number
  /** notes actually started and stopped at the synth since the last read */
  on: number
  off: number
  /** voices sounding right now — holding one key should read 1 */
  voices: number
  /** ⚠️ LATCHED TOTALS. A dropout lasts a few milliseconds and the per-second figures are back to
   *  zero long before anybody looks up from the keyboard, which is exactly what "I can't tell for
   *  sure" means. These only ever climb, so a glance after the fact still tells the story. */
  droppedTotal: number
  clippedTotal: number
  peakMax: number
  /** ms the audio clock has fallen behind the wall clock since the strip started — real dropouts */
  driftMs: number
  /** loudest sample ARRIVING at the limiter — can exceed 1, and the only honest level here */
  preMax: number
  /** dB the limiter is pulling off right now — 0 is idle, negative is working */
  reduction: number
  /** the most it has pulled off since the strip started */
  reductionWorst: number
  /** the worst thing seen since the strip started, not just in the last second */
  worst: 'clean' | 'DROPOUTS' | 'CLIPPING' | 'LIMITING'
}

let reductionWorst = 0
/**
 * ⚠️ SAMPLED FAST, NOT ONCE A SECOND. readHealth is polled at 1Hz, so it saw the limiter at one
 * instant per second and missed everything between — and limiting on a note lasts tens of
 * milliseconds. That is why the strip read "squash 0dB" on patches that were audibly crackling.
 */
let fastTimer = 0
let preMax = 0

/**
 * The audio clock against the wall clock — the only pair that diverges when the thread stalls.
 *
 * ⚠️ THE WORKLET'S OWN DROPOUT COUNTER COULD NEVER FIRE. It measured `elapsed` as
 * `currentTime - t0`, but currentTime inside a worklet advances one quantum BECAUSE process()
 * ran, so expected always equalled counted. Its `gaps` test had the same defect. That is why the
 * strip read "late 0" through audible trouble.
 *
 * ⚠️ AND MY FIRST REPLACEMENT WAS ALSO WRONG — it climbed on a silent page with nothing playing.
 * It summed every sample's excess into a running total, so two things accumulated that are not
 * dropouts: timer jitter above the floor, and genuine CLOCK SKEW. A sound card's crystal is not
 * the system clock's; a hundred parts per million is ordinary, and that alone is six milliseconds
 * a minute climbing for ever. "It goes up and up without touching a key" is exactly that shape.
 *
 * So this measures divergence WITHIN A SHORT WINDOW and keeps the worst one, rather than adding
 * windows together. Skew over two seconds is a fifth of a millisecond and invisible; a stall of
 * any real size lands inside one window and shows in full. Jitter cancels instead of banking,
 * because both clocks are read at the same instant and the window restarts from scratch.
 */
let baseWall = 0
let baseAudio = 0
let driftWorst = 0
/** How long a window runs before it restarts — short enough that clock skew cannot build up. */
const DRIFT_WINDOW_MS = 2000
/**
 * Below this is jitter and quantisation on currentTime, not lost audio.
 *
 * ⚠️ AND THAT IS A REAL LIMIT, NOT A TUNING CHOICE. A dropout big enough to click is five to ten
 * milliseconds, which is BELOW what this method can resolve — so "late 0" does not mean "no
 * dropouts", it means "none longer than about 15ms". Tried at 6ms over 500ms windows and it
 * reported 16.5ms on a completely healthy idle context: `ctx.currentTime` is only refreshed to
 * the main thread per render quantum and goes stale by several milliseconds whenever that thread
 * is busy, while performance.now() does not, and the difference looks exactly like lost audio.
 *
 * Kept honest at 15ms rather than made sensitive and wrong. To rule out short dropouts, change
 * the buffer instead — see the audio_latency override in context.ts — because a meter that
 * cannot see them cannot clear them either.
 */
const DRIFT_FLOOR_MS = 15
let node: AudioWorkletNode | null = null
let expectedFrom = 0
let counted = 0
let gapCount = 0
let peak = 0
let clipped = 0
let scratch: Uint8Array | null = null
let droppedTotal = 0
let clippedTotal = 0
let peakMax = 0

/**
 * ⚠️ Counts its OWN calls rather than timing them from the main thread. process() runs once per
 * 128 frames on the audio thread; comparing how many actually happened against how many the clock
 * says should have is the only honest measure of a missed deadline, and it cannot be faked by a
 * main thread that is itself stuttering.
 */
const WORKLET = `
class H extends AudioWorkletProcessor {
  constructor () { super(); this.n = 0; this.t0 = currentTime; this.gaps = 0; this.last = currentTime
    this.port.onmessage = () => {
      this.port.postMessage({ n: this.n, elapsed: currentTime - this.t0, gaps: this.gaps })
      this.n = 0; this.gaps = 0; this.t0 = currentTime
    } }
  process () {
    const dt = currentTime - this.last; this.last = currentTime
    if (this.n > 0 && dt > (128 / sampleRate) * 1.5) this.gaps++
    this.n++; return true
  }
}
registerProcessor('audio-health', H)
`

/**
 * ⚠️ TURNED ON FROM THE URL as well as from storage, because the device that has the problem is a
 * phone and a phone has no console. `?audio_debug=1` sticks it in storage so it survives the
 * navigation, and `?audio_debug=0` clears it again; asking somebody to open devtools on a handset
 * is asking them not to bother.
 */
/**
 * The investigation tools — the bare test tones, the tick catcher, the buffer selector and the
 * console handle on the synth.
 *
 * ⚠️ SEPARATE FROM THE STRIP, and off unless asked for. The strip is a status line that earned
 * being on by default: it is one row of numbers and it has found real faults. What got added
 * during the crackle hunt is different — half a dozen buttons that play bare sine waves, reload
 * the page to change the audio buffer, and hang noteOn/noteOff on `window`. That is a workbench,
 * and a workbench does not belong in a room Evan's friends walk into.
 *
 * `localStorage.audio_lab = '1'` brings it back, and everything in it still works.
 */
export function labOn(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('audio_lab')
    if (q === '1') localStorage.setItem('audio_lab', '1')
    if (q === '0') localStorage.removeItem('audio_lab')
    return localStorage.getItem('audio_lab') === '1'
  } catch {
    return false
  }
}

export function healthOn(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('audio_debug')
    if (q === '1') localStorage.setItem('audio_debug', '1')
    if (q === '0') localStorage.setItem('audio_debug', '0')
    // ⚠️ ON unless explicitly turned off. What it costs is one counter incremented per 128-frame
    // quantum on the audio thread, and one scan of 2048 bytes a second on the main one — far
    // below anything either thread will notice. What it buys is that the next time something
    // sounds wrong the answer is already on screen instead of a week of guessing.
    return localStorage.getItem('audio_debug') !== '0'
  } catch {
    return false
  }
}

/** Start measuring. Safe to call twice; does nothing unless the flag is on. */
export async function startHealth(): Promise<boolean> {
  if (node || !healthOn()) return !!node
  const ctx = sharedCtx()
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    node = new AudioWorkletNode(ctx, 'audio-health')
    /**
     * ⚠️ Connected to the destination through a SILENT gain, because a node whose output reaches
     * nothing is never pulled and its process() is never called — the first version of this
     * measured a flat zero for exactly that reason and looked like perfect health.
     */
    const mute = ctx.createGain()
    mute.gain.value = 0
    node.connect(mute).connect(ctx.destination)
    /* 20Hz: often enough to catch a note's worth of limiting, far too cheap to notice */
    /**
     * ⚠️ NOTHING IS LATCHED FOR THE FIRST SECOND. `reduction` is a relaxing envelope, not an
     * instantaneous fact — it reads about -13dB the moment a compressor is created and needs
     * roughly 800ms of quiet to unwind. Latching during that window produced readings like
     * "squash -16.5dB" beside "in 0.341", which cannot both be true: the threshold is 0.708, so
     * an input peaking at 0.341 causes no reduction at all. The number was the compressor waking
     * up, and it made a working meter look broken and a broken one look meaningful.
     */
    const armedAt = performance.now() + 1000
    fastTimer = window.setInterval(() => {
      const p = preLimitPeak()
      if (p > preMax) preMax = p
      if (performance.now() < armedAt) return
      const r = limiterReduction()
      if (p > 0.02 && r < reductionWorst) reductionWorst = r
    }, 50)
    node.port.onmessage = (e: MessageEvent) => {
      const d = e.data as { n: number; elapsed: number; gaps: number }
      const should = Math.round((d.elapsed * ctx.sampleRate) / 128)
      counted = d.n
      expectedFrom = should
      gapCount = d.gaps
    }
    return true
  } catch {
    node = null
    return false
  }
}

/** Clear the latched totals, for measuring one thing at a time. */
export function resetHealth() {
  droppedTotal = 0
  clippedTotal = 0
  peakMax = 0
  reductionWorst = 0
  driftWorst = 0
  preMax = 0
  baseWall = 0
  resetNoteCounts()
}

export function stopHealth() {
  if (fastTimer) {
    window.clearInterval(fastTimer)
    fastTimer = 0
  }
  try {
    node?.disconnect()
  } catch {
    /* already gone */
  }
  node = null
}

/**
 * Take a reading. Ask about once a second — each call resets the worklet's counters, so a faster
 * poll measures a shorter window and a slower one a longer.
 */
export function readHealth(): AudioHealth {
  const ctx = sharedCtx()
  if (!scratch) scratch = new Uint8Array(2048)
  // the tap is post-limiter, so this is what the speakers are actually being asked for
  if (readWaveform('instrument', scratch)) {
    for (let i = 0; i < scratch.length; i++) {
      const v = Math.abs((scratch[i] - 128) / 128)
      if (v > peak) peak = v
      if (v >= 0.985) clipped++
    }
  }
  const dropped = Math.max(0, expectedFrom - counted)
  droppedTotal += dropped
  clippedTotal += clipped
  if (peak > peakMax) peakMax = peak
  /**
   * ⚠️ sampled once per read, so this is the limiter's state at THIS instant rather than the
   * worst of the last second — a fast stab can slip between two reads. The latched worst is what
   * to trust after the fact, exactly like clippedTotal.
   *
   * ⚠️ ONLY LATCHED WHILE SOMETHING IS AUDIBLE, and that guard is load-bearing. `reduction` is a
   * relaxing envelope, not an instantaneous fact: measured, it reads -13.5dB the moment a
   * compressor is created and takes about 800ms of silence to unwind toward zero. Latching it
   * unguarded would light up LIMITING on a silent page before a note was played — the same
   * "meter that always says something" failure as the clip counter that could never fire.
   */
  /* the 20Hz sampler above does the latching; this is only for the "now" line */
  const reduction = limiterReduction()

  /* both clocks read at the same instant, so lateness cancels and only lost audio remains */
  const wall = performance.now()
  const audio = ctx.currentTime
  if (ctx.state !== 'running') {
    baseWall = 0
  } else if (!baseWall) {
    baseWall = wall
    baseAudio = audio
  } else {
    const behind = wall - baseWall - (audio - baseAudio) * 1000
    if (behind > DRIFT_FLOOR_MS && behind > driftWorst) driftWorst = behind
    if (wall - baseWall > DRIFT_WINDOW_MS) {
      baseWall = wall
      baseAudio = audio
    }
  }
  const out: AudioHealth = {
    bufferMs: +(ctx.baseLatency * 1000).toFixed(1),
    bufferFrames: Math.round(ctx.baseLatency * ctx.sampleRate),
    sampleRate: ctx.sampleRate,
    dropped,
    gaps: gapCount,
    peak: +peak.toFixed(3),
    clipped,
    on: noteCounts.on,
    off: noteCounts.off,
    voices: liveVoices(),
    droppedTotal,
    clippedTotal,
    peakMax: +peakMax.toFixed(3),
    driftMs: Math.round(driftWorst),
    preMax: +preMax.toFixed(3),
    reduction: +reduction.toFixed(1),
    reductionWorst: +reductionWorst.toFixed(1),
    /* ⚠️ LIMITING ranks below the other two but above clean, because it is the one that was
       invisible. A dropout or a genuine clip is a worse fault; a limiter leaning on the mix is
       the one that produced a year of "it crackles" with a strip that said everything was fine.
       -1dB is nothing and happens on any loud chord; -3 is being leant on. */
    worst:
      clippedTotal > 0
        ? 'CLIPPING'
        : /* ⚠️ droppedTotal is NOT consulted, deliberately. It comes from the worklet counter
             that compares currentTime against itself and is therefore always zero — but it was
             still in this condition after the display moved to the drift figure, so the strip
             could read "DROPOUTS · late 0ms": a verdict from a dead counter next to a number
             that disagreed with it. Only the measure that can actually fire decides. */
          /* ⚠️ the VERDICT needs more than the floor. Reported repeatedly as
             "DROPOUTS · late 18ms" on a machine that was not dropping anything — 18ms is barely
             over a 15ms floor that exists to absorb currentTime's own staleness, and this method
             cannot resolve the 5-10ms dropouts that actually click anyway. Showing the number is
             honest; shouting DROPOUTS at it is not. */
          driftWorst > 40
          ? 'DROPOUTS'
          : reductionWorst <= -3
            ? 'LIMITING'
            : 'clean',
  }
  node?.port.postMessage('read')
  peak = 0
  clipped = 0
  resetNoteCounts()
  return out
}
