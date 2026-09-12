/**
 * The one way the front page is allowed to touch the synth.
 *
 * ⚠️ THE FRONT PAGE MUST NEVER BE THE REASON THE SYNTH SHIPS. A static import from any of the
 * home toys would quietly make this page an importer of audio/synth.ts, so the day somebody
 * untangles the other nine, the front door would be the thing still pinning it to first paint.
 * Everything here loads it on first touch and never on render.
 *
 * ⚠️ AND ONE LOAD, NOT THREE. The hero keys, the sequencer and the visualiser each carried a
 * private copy of this — three `let pending` module-level promises, so three toys on one page
 * each started their own import and each held their own reference to the result. Identical code
 * in three files is also three places to fix when the loading rule changes, and the comment
 * explaining WHY it is dynamic only survived in two of them.
 */
type SynthMod = typeof import('../audio/synth')

let mod: SynthMod | null = null
let pending: Promise<SynthMod> | null = null

/**
 * Run something against the synth, loading it if this is the first touch.
 *
 * ⚠️ Called straight through once loaded, so no key press after the first has an async hop in
 * it — a note that waits for a microtask is a note that feels late.
 */
export function withSynth(fn: (s: SynthMod) => void) {
  if (mod) return fn(mod)
  if (!pending) pending = import('../audio/synth').then((m) => (mod = m))
  void pending.then(fn)
}

/**
 * Subscribe to the stop broadcast — the dock's stop button, and anything else that means "quiet".
 *
 * ⚠️ Subscribing needs the module, so this waits for whatever load is already happening rather
 * than starting one. Before a single tap there is no synth and nothing to stop, so there is
 * nothing to miss — and the front page still does not pull the synth in on render.
 */
export function onStopAll(fn: () => void): () => void {
  let off: (() => void) | null = null
  let dead = false
  withSynth((s) => {
    if (dead) return
    off = s.onStopAll(fn)
  })
  return () => {
    dead = true
    off?.()
  }
}
