/**
 * Is anything still sounding? — paste into the Browser pane, on #instrument.
 *
 * ⚠️ A STUCK NOTE IS THIS PROJECT'S WORST BUG CLASS AND NOTHING COULD ASK ABOUT IT. looper.ts
 * says it plainly: a note-on with no note-off "plays a note that never stops — on every
 * repetition, forever, until Panic", and songFile.ts calls the normaliser that prevents it worth
 * more than all its other checks put together. Those guard the notes where they are DATA. The
 * other half had no way of being asked: after a real sequence of presses, releases, pedal and
 * instrument changes, is the synth actually quiet?
 *
 * `npm run test` cannot answer it — there is no audio in node, which is the whole reason the
 * pure modules are pure. So this is the audio counterpart to `scripts/mobile-audit.js`: a thing
 * you paste into the pane and ask.
 *
 *   const t = tap(await import('/src/audio/audioTap.ts'))   // YOU import it — see below
 *   await t.floor()                  // what silence reads as — 0, and that is load-bearing
 *   await t.hold([0, 2, 4], 600)     // press three keys, hold, let go
 *   await t.settles()                // does it come back down, and how fast
 *
 *
 * ⚠️ IT READS THE ANALYSER, AND THE FIRST VERSION READ PAINTED PIXELS — which was wrong in a way
 * worth recording, because the pixel idea is the obvious one and it very nearly held up.
 *
 * The reasoning was sound: CLAUDE.md says measure through a path that shares no arithmetic with
 * the thing measured, and the embedded visualiser is already drawing the post-limiter analyser.
 * Brightness tracked the keys beautifully — 28 at rest, 93 for three notes, decaying back over
 * about two seconds. Then a run with a progression loaded reported "still sounding" after Stop,
 * which looked like a real find and was not: deleting the layer entirely left the canvas
 * oscillating between 39 and 63 on a five-second cycle, with no audio at all. It was the visual
 * mode's own idle animation, and the five-second period matching the loop length was a
 * coincidence of the loop being five seconds long.
 *
 * So brightness is a proxy for "this mode is animating", which is only a proxy for sound in the
 * modes that sit still when nothing plays. A checker that reports a stuck voice for a silent
 * room is the cry-wolf failure `mobile-audit.js` is built to avoid, so the pixel version is not
 * here. `readLevel` is RMS over the analyser's own waveform: it reads EXACTLY 0 in a silent
 * room, needs no canvas, no visuals panel, no `requestAnimationFrame` stand-in, and does not
 * care which visual mode is selected or whether the pane is hidden.
 *
 *
 * ⚠️ AND YOU IMPORT audioTap, NOT THIS FILE — which looks like an awkward API and is the only
 * one that works. `audioTap` keeps its registry in module scope, so a second copy has an empty
 * map and answers "nothing is playing" for a room that is roaring: the most dangerous wrong
 * answer available here.
 *
 * This file is pasted in, which means it is loaded with a cache-busting query, and VITE
 * PROPAGATES THAT QUERY TO WHAT IT IMPORTS. Measured, in the same breath: the caller's own
 * `import('/src/audio/audioTap.ts')` returned `['ring', 'instrument']` while this module's
 * import of the identical path, from inside a `?fresh=` load, returned `[]`. Same string,
 * different instance, and the empty one looks exactly like silence. Taking the module as an
 * argument moves the import to the console, where it has no query to inherit.
 *
 * The check below stays regardless, because the other half of CLAUDE.md's note still bites: the
 * app may be bound to `…/audioTap.ts?t=1791958465904` after a hot update, and then even a plain
 * import from the console is a different copy. An empty `liveTaps()` is the tell; reload.
 */

/** where the analyser registry lives — the plain path, because that is what the app loaded */
const TAP = '/src/audio/audioTap.ts'

/**
 * The app's analyser registry, or a refusal.
 *
 * ⚠️ IT PROVES IT HAS THE LIVE ONE instead of assuming. An empty `liveTaps()` means this is a
 * second copy of the module — see the header — and every number taken from it would be a
 * confident zero. The instrument registers its tap the moment a note is played, so a room that
 * has never made a sound also reports nothing; press a key first and ask again.
 */
export function tap(mod) {
  if (!mod || typeof mod.liveTaps !== 'function') {
    return { ok: false, live: [], why: 'pass the module in: tap(await import("' + TAP + '"))' }
  }
  const live = mod.liveTaps()
  if (!live.includes('instrument')) {
    return {
      ok: false,
      live,
      why:
        'no instrument tap in this copy of audioTap. Either nothing has played yet — the synth ' +
        'registers on the first note — or this is a second copy of the module and its registry ' +
        'is empty. Play a note, then ask again; if it stays empty, reload the page.',
    }
  }
  const scratch = new Uint8Array(Math.max(2048, mod.fftSize('instrument')))
  const level = () => mod.readLevel('instrument', scratch)
  return { ok: true, live, level, ...probes(level) }
}

const wait = (ms) => new Promise((go) => setTimeout(go, ms))

const peakOver = async (level, ms) => {
  let peak = 0
  const until = performance.now() + ms
  while (performance.now() < until) {
    peak = Math.max(peak, level())
    await wait(40)
  }
  return +peak.toFixed(4)
}

const keyAt = (i) => document.querySelectorAll('.inst-key')[i]

const pointer = (el, type, down) => {
  const r = el.getBoundingClientRect()
  el.dispatchEvent(
    new PointerEvent(type, {
      /* ⚠️ 1 ONLY — Chrome treats it as the live mouse pointer, and every other id throws out of
         `setPointerCapture`, taking the rest of the handler with it. A key that captures before
         it sounds then reads as completely dead; measured, 2 and 99 both raise NotFoundError. */
      pointerId: 1,
      bubbles: true,
      cancelable: true,
      clientX: r.x + r.width / 2,
      clientY: r.y + r.height / 2,
      pointerType: 'mouse',
      button: 0,
      buttons: down ? 1 : 0,
      isPrimary: true,
    }),
  )
}

function probes(level) {
  return {
    /**
     * What silence reads as.
     *
     * ⚠️ 0 IN A GENUINELY IDLE ROOM, which is the property the pixel version could not offer —
     * RMS over a silent analyser is zero, so there is no idle animation to subtract and no slack
     * to tune against one. Measured 0 on a room that had not played since loading.
     *
     * ⚠️ BUT NOT IMMEDIATELY AFTER A NOTE, and the difference matters when reading a trace. A
     * tail decays smoothly through the floor rather than stopping at it: measured 0.0145 some
     * two and a half seconds after one key, against 0.76 for three keys held. So this is a
     * function and not a constant — it tells you what the room is doing now, which may be
     * "still finishing the last thing", and that is exactly what `settles` is for.
     */
    floor: (ms = 800) => peakOver(level, ms),

    /** press some keys by index, hold for `ms`, let go — returns the peak while held */
    hold: async (indices, ms = 600) => {
      const keys = indices.map(keyAt).filter(Boolean)
      if (!keys.length) return { error: 'no keys — is #instrument open?' }
      for (const k of keys) pointer(k, 'pointerdown', true)
      const peak = await peakOver(level, ms)
      for (const k of keys) pointer(k, 'pointerup', false)
      return { pressed: keys.length, peak }
    },

    /**
     * Does it go quiet again, and how long does it take?
     *
     * ⚠️ THREE QUIET READINGS IN A ROW, NOT ONE, and the one-sample version was wrong in the
     * most predictable way available. A progression is deliberately silent for 4% of every slot
     * — `HOLD` is 0.96 so repeats re-articulate — so a single reading at the floor lands in the
     * gap between chords and declares silence. Measured: with a four-chord backing audibly
     * playing, the one-sample version answered `settled: true`. It had found the gap. That is
     * the same mistake the chord hint cost two false readings for on the same evening, built
     * into the tool meant to catch that class of thing.
     *
     * ⚠️ THE THRESHOLD IS 0.02 AND THAT NUMBER IS MEASURED, not picked. A voice does not fade to
     * nothing: it decays fast to a FLAT residual of about **0.0137** and sits there for roughly
     * four seconds before dropping to exactly 0. Traced on a single key with nothing else
     * happening — 0.3176, 0.1518, 0.0801, 0.0437, 0.0213, then thirty samples within a whisker
     * of 0.0137, then 0. A plateau is not a tail; it is the voice's nodes still connected until
     * the stop scheduled at `a + d + r`, and they go silent all at once when it arrives.
     *
     * At roughly 35dB below a played note — three keys peak near 0.76 — none of it is audible.
     * But a threshold under it makes every answer wrong in the same direction: with 0.01, Panic
     * "settled after 5787ms", which reads as a Panic button that takes six seconds. It does not.
     * The audible part was over in under one, and the rest was this.
     *
     * 0.02 clears the residual and is still far below anything a stuck voice could be and remain
     * inaudible — a single held key is ten times it. Checked the other way too: a room that has
     * been quiet a while reads exactly 0, so the floor is real and this is not masking it.
     */
    settles: async (ms = 8000, quiet = 0.02) => {
      const started = performance.now()
      const trail = []
      let run = 0
      while (performance.now() - started < ms) {
        const v = +level().toFixed(4)
        trail.push(v)
        run = v <= quiet ? run + 1 : 0
        if (run >= 3) {
          return { settled: true, after: Math.round(performance.now() - started), trail }
        }
        await wait(120)
      }
      return {
        settled: false,
        after: null,
        peak: Math.max(...trail),
        trail: trail.slice(0, 20),
        note: 'still sounding — look for a voice nothing released',
      }
    },
  }
}
