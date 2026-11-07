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
 * Did the press actually REACH the synth? — `counting(await import('/src/audio/synth.ts'))`
 *
 * ⚠️ THE QUESTION THAT COST THIS SESSION FOUR CALLS AND NEARLY A WRONG CONCLUSION. Driving the
 * keyboard with synthetic pointer events works until it does not, and when it stops the silence
 * is indistinguishable from the instrument being broken. Measured: seventy-five press-and-
 * release pairs dispatched at `.inst-key` elements produced **zero** noteOns — `noteCounts.on`
 * did not move once — on a room that had been sounding normally minutes earlier. Everything
 * downstream then reads as "nothing is playing", which is true and says nothing about the synth.
 *
 * `synth.ts` already counts what arrives, and its own comment says why: "counts what ACTUALLY
 * reached the synth, not what the UI meant to send… every attempt to answer it by reasoning
 * about pointer events failed". This exposes that to a probe, so a run can tell three states
 * apart that otherwise look identical — the press never landed, the press landed and made no
 * sound, and the sound happened and stopped.
 *
 * ⚠️ `liveVoices` IS THE OTHER HALF AND IS BETTER THAN RMS WHERE IT APPLIES. It is a count, not
 * a level: a four-chord pad reads a steady **3** — one triad at a time — dropping to 0 for a
 * single sample in the gap `HOLD` leaves between chords. No threshold, no floor, no residual.
 * Use it for "how many voices" and `settles` for "is it audible", because a voice can be in the
 * map while inaudible and a reverb tail can be audible with the map empty.
 *
 * ⚠️⚠️ TRUST THIS LESS THAN `tap()`, AND HERE IS THE RECEIPT. `synth.ts` keeps `voices` and
 * `noteCounts` in module scope, and unlike `audioTap` there is no cheap way to prove you hold
 * the app's copy — `liveTaps()` naming a live producer is self-evidently the real registry,
 * while a count of 3 looks exactly like a count of 3 from anywhere.
 *
 * It cost most of a session. Readings taken a second apart gave `on: 3`, then `on: 0`, then
 * `on: 3` — impossible for a counter that only ever increments, and the tell that successive
 * `import()` calls were landing on different copies. Along the way the numbers described a
 * progression that fired three noteOns and then stopped, holding three voices for ever, which
 * is a serious bug and is not happening: `loopState()` from the same import said
 * `{ playing: false, layers: 0 }` about a room that was audibly playing a layer. Every number
 * was fiction, and the fiction was self-consistent enough to have been written up.
 *
 * So: cross-check anything from here against `tap()`, which can prove itself, and treat a
 * `noteCounts` that goes DOWN as proof you are holding more than one copy. A level that moves
 * when you press a key is worth more than any count that cannot show its provenance.
 */
export function counting(synth) {
  if (!synth || !synth.noteCounts || typeof synth.liveVoices !== 'function') {
    return { ok: false, why: 'pass the module in: counting(await import("/src/audio/synth.ts"))' }
  }
  return {
    ok: true,
    voices: () => synth.liveVoices(),
    /** run something and report what the synth actually received while it ran */
    during: async (fn) => {
      const before = { ...synth.noteCounts }
      const peak = { voices: synth.liveVoices() }
      const watch = setInterval(() => {
        peak.voices = Math.max(peak.voices, synth.liveVoices())
      }, 30)
      try {
        await fn()
      } finally {
        clearInterval(watch)
      }
      const on = synth.noteCounts.on - before.on
      const off = synth.noteCounts.off - before.off
      return {
        on,
        off,
        peakVoices: peak.voices,
        /**
         * ⚠️ BOTH SIGNALS, BECAUSE ONE OF THEM CRIED WOLF IMMEDIATELY. The first version warned
         * on `on === 0` alone and fired on a backing that was demonstrably working — `on: 0`
         * but `peakVoices: 3`, one triad in the map. A count of live voices is positive
         * evidence that something reached the synth, whatever the counter says, and a warning
         * that fires on a healthy room is the failure this whole file is built to avoid.
         */
        ...(on === 0 && peak.voices === 0
          ? { warning: 'the synth received nothing — whatever drove this never reached it' }
          : {}),
      }
    },
  }
}

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
  /**
   * ⚠️ A SECOND READING, IN THE UNIT THE SIGNAL IS ACTUALLY IN. `readLevel` is a DISPLAY
   * figure: RMS multiplied by 2.5 and clamped at 1, which is right for a meter and wrong for
   * anything comparing two loudnesses. The clamp is the problem — above 0.4 RMS every answer
   * is 1, so two readings that differ can come back identical, and a ratio taken from them is
   * silently a lie. Everything below that needs a ratio, so it uses this.
   */
  const floats = mod.readFloatWave
    ? new Float32Array(Math.max(2048, mod.fftSize('instrument')))
    : null
  const raw = () => {
    if (!floats || !mod.readFloatWave('instrument', floats)) return { peak: 0, rms: 0 }
    let peak = 0
    let sumsq = 0
    for (let i = 0; i < floats.length; i++) {
      const v = floats[i] < 0 ? -floats[i] : floats[i]
      if (v > peak) peak = v
      sumsq += floats[i] * floats[i]
    }
    return { peak, rms: Math.sqrt(sumsq / floats.length) }
  }
  return { ok: true, live, level, raw, ...probes(level, raw) }
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

/**
 * How much quieter your own hands get when a backing is loaded, measured against a backing
 * that is making NO SOUND.
 *
 * ⚠️ THE SILENT BACKING IS THE WHOLE EXPERIMENT, and it is what makes the answer unarguable.
 * Comparing a held note against a backing you can hear proves nothing: the limiter is working,
 * the polyphony scaling is working, both are supposed to take something off, and no reading
 * separates "correctly ducked" from "ducked too far". With every layer fader at zero the
 * backing contributes exactly nothing — measured, peak 0.0015 against 0.5188 for the key — so
 * any difference at all is the instrument reacting to signal that does not exist.
 *
 * ⚠️ IT VALIDATES ITSELF, because a checker that has not been shown reading zero is a checker
 * reporting that it ran. Three guards come back in the result and all three must hold or the
 * number is void: the room was silent before each half (`quietBefore`), the backing really was
 * inaudible (`backingPeak`, must be at the floor), and the alone reading repeats afterwards
 * (`aloneAgain`, within a couple of percent). With the backing stopped in both halves this
 * reports about 0dB, which is the null control and the thing to run first if a result surprises
 * you.
 *
 * ⚠️ AND IT PUTS THE FADERS BACK. A probe that leaves the room changed is one you cannot run
 * twice, and layer gains are the thing it has to move.
 */
/**
 * The bench both loudness probes stand on: one key, every layer fader, and the discipline about
 * when a reading is allowed to be taken.
 *
 * ⚠️ IT PUTS THE FADERS BACK, through `restore`. A probe that leaves the room changed is one
 * you cannot run twice, and layer gains are the thing these have to move.
 */
function rig(raw, keyIndex) {
  const el = keyAt(keyIndex)
  if (!el) return { error: 'no keys — is #instrument open?' }
  const faders = [...document.querySelectorAll('.inst-layers input[type=range]')]
  if (!faders.length) return { error: 'no layers — load a backing first' }
  const was = faders.map((f) => f.value)
  const vset = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  const write = (f, v) => {
    vset.call(f, String(v))
    f.dispatchEvent(new Event('input', { bubbles: true }))
    f.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const hold = (down) => pointer(el, 'pointerdown', down)
  const peakFor = async (ms) => {
    let peak = 0
    const until = performance.now() + ms
    while (performance.now() < until) {
      peak = Math.max(peak, raw().peak)
      await wait(15)
    }
    return +peak.toFixed(4)
  }
  return {
    faders,
    setAll: (v) => faders.forEach((f) => write(f, v)),
    restore: () => faders.forEach((f, i) => write(f, was[i])),
    down: () => hold(true),
    /* released on WINDOW, which is where the room listens — see the note in InstrumentRoom
       about capture being dropped so a press can slide between keys */
    up: () => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })),
    peakFor,
    /** hold the key, wait out the attack, and report the highest sample while it is down */
    press: async (ms) => {
      hold(true)
      await wait(250)
      const peak = await peakFor(ms)
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
      return peak
    },
  }
}

async function duckProbe(raw, keyIndex) {
  const r = rig(raw, keyIndex)
  if (r.error) return r
  const { setAll, press } = r
  /**
   * ⚠️ "THE ANALYSER IS QUIET" IS NOT "NOTHING IS COUNTED", and that caught this probe out on
   * its first run — the guards refused the reading and they were right.
   *
   * A released voice's entry in synth.ts outlives its audible tail on purpose: the ring is
   * dropped at `at + a + d + r`, and the comment there records a bell whose entry "lived for 3.8
   * seconds". So a press taken as soon as the room sounds silent is still being ducked by the
   * press before it. Measured on the first run: four identical presses read 0.256, 0.209, 0.259
   * and 0.527 — getting louder as the gaps got longer, with the LAST one matching a key pressed
   * into a genuinely idle room.
   *
   * That is this probe measuring the very thing it exists to measure, as a confound. So it waits
   * out the longest envelope and then wants THREE consecutive quiet reads, for the same reason
   * `settles` does: one reading can land in a gap.
   */
  const SETTLE_MS = 4500
  const untilQuiet = async () => {
    await wait(SETTLE_MS)
    let run = 0
    let last = 1
    for (let i = 0; i < 40; i++) {
      last = raw().peak
      run = last < 0.01 ? run + 1 : 0
      if (run >= 3) return +last.toFixed(4)
      await wait(150)
    }
    return null
  }
  const press2 = (label) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)

  try {
    setAll(0)
    await wait(300)
    /**
     * ⚠️ ONE THROWAWAY PRESS FIRST. On the very first run after a backing has been built, the
     * opening measurement comes back low — 0.3245 against 0.5334 for the identical press at the
     * end — and the `repeatable` guard duly refused the reading. Run again immediately and all
     * four presses agree to the last digit.
     *
     * I have not established WHY the room needs to have played once and fully settled before it
     * answers consistently, so this is a workaround and is labelled as one rather than dressed
     * up as a reason. What matters is that the guards caught it rather than letting a 1.6x
     * difference pass as a result.
     */
    await press(400)
    const quietBefore = await untilQuiet()
    const alone = await press(1200)
    const quietBetween = await untilQuiet()

    /**
     * ⚠️ THE NULL CONTROL, AND IT IS THE REASON TO BELIEVE THE OTHER NUMBER. Same backing, same
     * key, same code path — only the transport is stopped, so nothing of the backing is ringing
     * and the polyphony scaling has nothing to count. This must come back at about 0dB. If it
     * does not, the probe is measuring its own machinery and both figures are void.
     */
    const overLoadedButStopped = await press(1200)
    await untilQuiet()

    press2('▶ Play')?.click()
    await wait(2500)
    let backingPeak = 0
    const until = performance.now() + 1500
    while (performance.now() < until) {
      backingPeak = Math.max(backingPeak, raw().peak)
      await wait(15)
    }
    const overSilentBacking = await press(1200)
    press2('⏹ Stop')?.click()
    await untilQuiet()
    const aloneAgain = await press(1200)
    const dBof = (v) => (alone > 0 && v > 0 ? +(20 * Math.log10(v / alone)).toFixed(2) : null)
    const dB = dBof(overSilentBacking)
    const controlDb = dBof(overLoadedButStopped)
    const sound = alone > 0 && aloneAgain > 0
    return {
      alone,
      overSilentBacking,
      dB,
      guards: {
        quietBefore,
        quietBetween,
        backingPeak: +backingPeak.toFixed(4),
        backingReallySilent: backingPeak < 0.01,
        aloneAgain,
        repeatable: sound && Math.abs(aloneAgain - alone) / alone < 0.05,
        /* the null control: loaded but not running, so there is nothing to count */
        overLoadedButStopped,
        controlDb,
        controlIsFlat: controlDb != null && Math.abs(controlDb) < 1,
      },
      reading: !sound
        ? 'no sound from the key at all — nothing here is a measurement'
        : dB < -1
          ? 'your hands are ducked by a backing that cannot be heard'
          : 'no ducking from a silent backing',
    }
  } finally {
    r.restore()
  }
}

/**
 * Does the room hand the headroom BACK? — the transition `ducking()` structurally cannot see.
 *
 * ⚠️ THE SAME BUG HAS A TRANSIENT FORM AND IT IS THE WORSE ONE. `ducking()` compares two
 * steady states, so it would go green for a fix that carried the layer gain into the sum at
 * note-on and left it there. Layer gain rides the part's BUS — `setLayerGain` says so — so a
 * gain remembered on the voice disagrees with the signal for as long as that voice lasts.
 *
 * This holds one key over an AUDIBLE backing and then pulls every fader to zero underneath it,
 * without letting go and without striking anything new. The backing goes; the question is where
 * the key ends up. Measured 7 Nov with the fix: **0.4838** against **0.5253** for that key alone,
 * which is 0.71dB. Measured the same morning without it: **0.2198**, 7.7dB down and STAYING
 * there, because nothing was ever going to re-strike it.
 *
 * `alone` is taken first, with the transport stopped, so the comparison is against this room on
 * this run rather than against a number written down here.
 */
async function recoverProbe(raw, keyIndex, from) {
  const r = rig(raw, keyIndex)
  if (r.error) return r
  const play = (label) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
  try {
    r.setAll(from)
    await wait(300)
    const alone = await r.press(1200)
    await wait(4500)
    play('▶ Play')?.click()
    await wait(2500)
    r.down()
    await wait(600)
    const overBacking = await r.peakFor(400)
    /* the only thing that moves is the fader — the key is still down */
    r.setAll(0)
    await wait(500)
    const afterwards = await r.peakFor(600)
    r.up()
    play('⏹ Stop')?.click()
    const dB =
      alone > 0 && afterwards > 0 ? +(20 * Math.log10(afterwards / alone)).toFixed(2) : null
    return {
      alone,
      overBacking,
      afterwards,
      dB,
      reading:
        dB == null
          ? 'no sound from the key at all — nothing here is a measurement'
          : dB < -2
            ? 'the key is still ducked by a backing that has been turned off'
            : 'the headroom came back without a new note',
    }
  } finally {
    r.restore()
  }
}

function probes(level, raw) {
  return {
    /** see duckProbe — hold one key alone, then over a backing at fader zero */
    ducking: (keyIndex = 7) => duckProbe(raw, keyIndex),
    /** see recoverProbe — pull the faders to zero under a key that is still held down */
    recovers: (keyIndex = 7, from = 1) => recoverProbe(raw, keyIndex, from),
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
