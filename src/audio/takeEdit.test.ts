import { describe, expect, it } from 'vitest'
import {
  canRedo,
  canUndo,
  clampView,
  cutOut,
  editFrames,
  editLen,
  HISTORY_MAX,
  isWholeEdit,
  JOIN_FADE,
  keepOnly,
  logDo,
  logNow,
  logRedo,
  logUndo,
  loudSpan,
  MIN_SPAN,
  MIN_VIEW,
  normalise,
  panView,
  peaks,
  pickRange,
  readLog,
  renderSamples,
  startLog,
  timeToFrac,
  toPlayed,
  toSource,
  viewAround,
  wholeEdit,
  xToTime,
  zoomView,
  type Edit,
} from './takeEdit'

/**
 * Editing a recording without touching it.
 *
 * ⚠️ THE EXPECTATIONS COME FROM THE AUDIO, not from the arithmetic in takeEdit. "What you hear
 * is as long as the spans say" is a fact about playing a sound; `plan.reduce(...)` is a copy of
 * the implementation. The first catches a rounding path that makes the export disagree with
 * the duration on screen, which is the consistency this pass is about.
 */

const FULL = 10
const whole = () => wholeEdit(FULL)
const spans = (e: Edit) => e.keep.map((s) => [+s.from.toFixed(4), +s.to.toFixed(4)])

const tone = (n: number, hz: number, rate = 48000, amp = 0.8) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate))

describe('the list of kept spans', () => {
  it('starts as the whole recording', () => {
    expect(spans(whole())).toEqual([[0, 10]])
    expect(isWholeEdit(whole(), FULL)).toBe(true)
    expect(editLen(whole())).toBe(10)
  })

  it('orders and merges whatever it is handed', () => {
    const e = normalise(
      [
        { from: 6, to: 8 },
        { from: 1, to: 3 },
        { from: 2, to: 4 },
      ],
      FULL,
    )
    /* ⚠️ merged, because an overlap plays that audio TWICE — a stutter nobody asked for and
       very hard to see in a list of numbers */
    expect(spans(e)).toEqual([
      [1, 4],
      [6, 8],
    ])
  })

  /**
   * ⚠️ A SPAN WHOLLY INSIDE ANOTHER, which the overlap case above does not cover — and
   * perturbing the merge to take the later `to` rather than the greater one stayed green
   * against it. That mistake does not duplicate audio, it SHORTENS the edit: [0,5] with [1,2]
   * folded in would come out as [0,2] and three seconds of the take would quietly stop
   * playing.
   */
  it('swallows a span that is entirely inside another, keeping the longer end', () => {
    expect(
      spans(
        normalise(
          [
            { from: 0, to: 5 },
            { from: 1, to: 2 },
          ],
          FULL,
        ),
      ),
    ).toEqual([[0, 5]])
  })

  it('survives anything a store could hand back', () => {
    for (const bad of [
      null,
      undefined,
      [],
      [{ from: NaN, to: 3 }],
      [{ from: 5, to: 5 }],
      [{ from: -4, to: 99 }],
      [{} as never],
      'nonsense' as never,
    ]) {
      const e = normalise(bad as never, FULL)
      expect(e.keep.length).toBeGreaterThan(0)
      for (const s of e.keep) {
        expect(Number.isFinite(s.from) && Number.isFinite(s.to)).toBe(true)
        expect(s.from).toBeGreaterThanOrEqual(0)
        expect(s.to).toBeLessThanOrEqual(FULL)
        expect(s.to - s.from).toBeGreaterThanOrEqual(MIN_SPAN)
      }
    }
  })
})

describe('keeping a bit', () => {
  it('keeps what was chosen', () => {
    expect(spans(keepOnly(whole(), { from: 2, to: 5 }, FULL))).toEqual([[2, 5]])
    expect(editLen(keepOnly(whole(), { from: 2, to: 5 }, FULL))).toBeCloseTo(3, 9)
  })

  it('keeps only the parts of the choice that are still there', () => {
    const cut = cutOut(whole(), { from: 3, to: 6 }, FULL) // keeps 0-3 and 6-10
    expect(spans(keepOnly(cut, { from: 2, to: 7 }, FULL))).toEqual([
      [2, 3],
      [6, 7],
    ])
  })

  it('leaves the edit alone rather than emptying it when the choice misses everything', () => {
    const cut = cutOut(whole(), { from: 3, to: 6 }, FULL)
    expect(spans(keepOnly(cut, { from: 4, to: 5 }, FULL))).toEqual(spans(cut))
  })
})

describe('cutting a mistake out and closing the gap', () => {
  it('leaves what was on either side', () => {
    expect(spans(cutOut(whole(), { from: 4, to: 6 }, FULL))).toEqual([
      [0, 4],
      [6, 10],
    ])
  })

  /** the whole point: eight seconds of audio where there were ten */
  it('makes the result shorter by exactly what was removed', () => {
    expect(editLen(cutOut(whole(), { from: 4, to: 6 }, FULL))).toBeCloseTo(8, 9)
  })

  it('cuts from the very start and the very end', () => {
    expect(spans(cutOut(whole(), { from: 0, to: 2 }, FULL))).toEqual([[2, 10]])
    expect(spans(cutOut(whole(), { from: 8, to: 10 }, FULL))).toEqual([[0, 8]])
  })

  it('cuts twice, leaving three pieces', () => {
    const once = cutOut(whole(), { from: 2, to: 3 }, FULL)
    const twice = cutOut(once, { from: 6, to: 7 }, FULL)
    expect(spans(twice)).toEqual([
      [0, 2],
      [3, 6],
      [7, 10],
    ])
    expect(editLen(twice)).toBeCloseTo(8, 9)
  })

  it('removes a whole piece when the cut swallows it', () => {
    const two = cutOut(whole(), { from: 4, to: 6 }, FULL) // 0-4, 6-10
    expect(spans(cutOut(two, { from: 3, to: 7 }, FULL))).toEqual([
      [0, 3],
      [7, 10],
    ])
  })

  /**
   * ⚠️ ONE CLUMSY GESTURE MUST NOT EMPTY A TAKE. A drag across the whole picture followed by
   * Cut would otherwise leave a recording that plays nothing — on screen that is
   * indistinguishable from a broken one. Deleting a recording is what ✕ is for, and it asks.
   */
  it('refuses to remove everything', () => {
    expect(spans(cutOut(whole(), { from: 0, to: 10 }, FULL))).toEqual([[0, 10]])
    expect(spans(cutOut(whole(), { from: -5, to: 99 }, FULL))).toEqual([[0, 10]])
  })

  it('ignores a cut too short to be an edit', () => {
    expect(spans(cutOut(whole(), { from: 3, to: 3.001 }, FULL))).toEqual([[0, 10]])
  })
})

describe('two clocks', () => {
  /**
   * ⚠️ SOURCE TIME IS NOT PLAYED TIME, and subtraction cannot convert between them once there
   * are two cuts — they differ by different amounts in different places. The waveform is drawn
   * on the source clock so you can see what was removed; a playing buffer reports the played
   * one.
   */
  const twice = () => cutOut(cutOut(whole(), { from: 2, to: 3 }, FULL), { from: 6, to: 7 }, FULL)

  it('maps a played moment back to where it came from', () => {
    const e = twice() // 0-2, 3-6, 7-10 → plays for 8
    expect(toSource(e, 0)).toBeCloseTo(0, 9)
    expect(toSource(e, 1.5)).toBeCloseTo(1.5, 9)
    expect(toSource(e, 2)).toBeCloseTo(3, 9) // straight over the first cut
    expect(toSource(e, 4.9)).toBeCloseTo(5.9, 9)
    expect(toSource(e, 5)).toBeCloseTo(7, 9) // and the second
    expect(toSource(e, 7.99)).toBeCloseTo(9.99, 9)
  })

  it('has nothing to show past the end of the edited result', () => {
    expect(toSource(twice(), 8.01)).toBeNull()
    expect(toSource(twice(), -1)).toBeNull()
  })

  it('maps the other way, and says when a moment was cut out', () => {
    const e = twice()
    expect(toPlayed(e, 1.5)).toBeCloseTo(1.5, 9)
    expect(toPlayed(e, 2.5)).toBeNull() // inside the first cut
    expect(toPlayed(e, 4)).toBeCloseTo(3, 9)
    expect(toPlayed(e, 6.5)).toBeNull() // inside the second
    /* 2 kept, then 3 kept, then 1 into the third span */
    expect(toPlayed(e, 8)).toBeCloseTo(6, 9)
  })

  it('round trips through both directions on anything still kept', () => {
    const e = twice()
    for (const played of [0, 0.7, 1.99, 2, 3.33, 4.99, 5, 6.2, 7.9]) {
      const src = toSource(e, played)!
      expect(src).not.toBeNull()
      expect(toPlayed(e, src)).toBeCloseTo(played, 6)
    }
  })
})

describe('what you hear is as long as the list says', () => {
  const RATE = 48000

  /**
   * ⚠️ THE CONSISTENCY THIS PASS IS ABOUT, asserted at the arithmetic rather than hoped for in
   * three components. The duration on screen comes from `editLen`; the exported file and the
   * loop's buffer come from `renderSamples`. If those two can disagree, every surface that
   * reads them disagrees too.
   */
  it('renders exactly as many frames as the duration claims', () => {
    for (const e of [
      whole(),
      keepOnly(whole(), { from: 2, to: 5 }, FULL),
      cutOut(whole(), { from: 4, to: 6 }, FULL),
      cutOut(cutOut(whole(), { from: 2, to: 3 }, FULL), { from: 6, to: 7 }, FULL),
    ]) {
      const src = [new Float32Array(FULL * RATE)]
      const got = renderSamples(src, e, FULL, RATE)[0]
      expect(got.length).toBe(Math.round(editLen(e) * RATE))
    }
  })

  it('plans the same frames the renderer uses', () => {
    const e = cutOut(whole(), { from: 4, to: 6 }, FULL)
    const plan = editFrames(e, FULL, RATE)
    expect(plan).toEqual([
      { offset: 0, frames: 4 * RATE },
      { offset: 6 * RATE, frames: 4 * RATE },
    ])
  })

  it('takes the audio from where the span says, not from the start', () => {
    const src = [tone(FULL * RATE, 100)]
    src[0].fill(0, 0, 5 * RATE) // silent first half, tone in the second
    const kept = renderSamples(src, keepOnly(whole(), { from: 6, to: 7 }, FULL), FULL, RATE)[0]
    let peak = 0
    for (const v of kept) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeGreaterThan(0.5)
  })

  /**
   * ⚠️ THE JOIN IS FADED, AND A HARD SPLICE IS WHY. Butting two unrelated waveforms together
   * is a step discontinuity, measured elsewhere in this project at 1.813 against a natural
   * per-sample slew of 0.0288. Here the two sides are deliberately in opposite phase so an
   * unfaded join would jump the full peak-to-peak height.
   */
  it('does not click where two pieces meet', () => {
    const n = FULL * RATE
    const src = [new Float32Array(n)]
    for (let i = 0; i < n; i++) src[0][i] = i < 5 * RATE ? 0.9 : -0.9
    /* cut across the polarity flip so the join puts +0.9 straight against -0.9 */
    const e = cutOut(whole(), { from: 4, to: 6 }, FULL)
    const out = renderSamples(src, e, FULL, RATE)[0]
    let worst = 0
    for (let i = 1; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - out[i - 1]))
    /* one fade step is 0.9 / (fade + 1); a hard splice would be 1.8 */
    const step = 0.9 / (Math.round(JOIN_FADE * RATE) + 1)
    expect(worst).toBeLessThan(step * 3)
    expect(worst).toBeLessThan(0.05)
  })

  it('still fades a span too short to hold two full fades', () => {
    const n = RATE
    const src = [new Float32Array(n).fill(0.9)]
    const e = normalise([{ from: 0.1, to: 0.13 }], 1)
    const out = renderSamples(src, e, 1, RATE)[0]
    expect(out.length).toBeGreaterThan(0)
    expect(Math.abs(out[0])).toBeLessThan(0.9)
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.9)
  })

  it('answers for a rate it cannot use rather than throwing', () => {
    for (const bad of [0, -1, NaN]) expect(editFrames(whole(), FULL, bad)).toEqual([])
  })
})

describe('undo and redo', () => {
  it('walks back and forward through the edits', () => {
    let log = startLog(whole())
    expect(canUndo(log)).toBe(false)
    expect(canRedo(log)).toBe(false)
    log = logDo(log, cutOut(logNow(log), { from: 4, to: 6 }, FULL))
    log = logDo(log, cutOut(logNow(log), { from: 1, to: 2 }, FULL))
    expect(editLen(logNow(log))).toBeCloseTo(7, 9)
    log = logUndo(log)
    expect(editLen(logNow(log))).toBeCloseTo(8, 9)
    log = logUndo(log)
    expect(isWholeEdit(logNow(log), FULL)).toBe(true)
    expect(canUndo(log)).toBe(false)
    log = logRedo(log)
    log = logRedo(log)
    expect(editLen(logNow(log))).toBeCloseTo(7, 9)
    expect(canRedo(log)).toBe(false)
  })

  it('does nothing at either end rather than falling off', () => {
    let log = startLog(whole())
    for (let i = 0; i < 5; i++) log = logUndo(log)
    expect(log.at).toBe(0)
    for (let i = 0; i < 5; i++) log = logRedo(log)
    expect(log.at).toBe(0)
  })

  /**
   * ⚠️ BRANCHING IS THE BEHAVIOUR THAT HAS TO BE RIGHT. Undo twice, make a different edit, and
   * the two steps you had undone are gone — they must not come back on the next Redo, which is
   * the thing a pair of stacks forgets and an index cannot.
   */
  it('throws away the future when you edit after undoing', () => {
    let log = startLog(whole())
    log = logDo(log, cutOut(logNow(log), { from: 1, to: 2 }, FULL))
    log = logDo(log, cutOut(logNow(log), { from: 5, to: 6 }, FULL))
    log = logUndo(log)
    log = logUndo(log)
    expect(canRedo(log)).toBe(true)
    log = logDo(log, keepOnly(logNow(log), { from: 0, to: 4 }, FULL))
    expect(canRedo(log)).toBe(false)
    expect(spans(logNow(log))).toEqual([[0, 4]])
    log = logUndo(log)
    expect(isWholeEdit(logNow(log), FULL)).toBe(true)
  })

  /**
   * ⚠️ BOUNDED BECAUSE IT IS PERSISTED, and the index has to come down with the front of the
   * list. Dropping the oldest step without moving `at` silently rewinds the take to an earlier
   * edit on the step that overflows — a corruption that looks like the app undoing by itself.
   */
  it('forgets the oldest steps and still stands in the right place', () => {
    let log = startLog(whole())
    for (let i = 0; i < HISTORY_MAX + 15; i++) {
      log = logDo(log, normalise([{ from: 0, to: 1 + (i % 8) }], FULL))
    }
    expect(log.steps.length).toBe(HISTORY_MAX)
    expect(log.at).toBe(HISTORY_MAX - 1)
    const last = (HISTORY_MAX + 14) % 8
    expect(spans(logNow(log))).toEqual([[0, 1 + last]])
    expect(canRedo(log)).toBe(false)
    expect(canUndo(log)).toBe(true)
  })
})

describe('coming back after a reload', () => {
  it('reads its own log back', () => {
    let log = startLog(whole())
    log = logDo(log, cutOut(logNow(log), { from: 3, to: 5 }, FULL))
    log = logUndo(log)
    const back = readLog(JSON.parse(JSON.stringify(log)), undefined, FULL)
    expect(back.at).toBe(log.at)
    expect(spans(logNow(back))).toEqual(spans(logNow(log)))
    expect(canRedo(back)).toBe(true)
  })

  /**
   * ⚠️ THE FIRST PASS STORED `trim: {from, to}`, and a take trimmed before this change must not
   * lose it. A migration that drops data is the same failure as an editor that rewrites the
   * blob, only quieter.
   */
  it('understands a take trimmed by the first version, with the whole thing behind it', () => {
    const back = readLog(undefined, { from: 2, to: 5 }, FULL)
    expect(spans(logNow(back))).toEqual([[2, 5]])
    expect(canUndo(back)).toBe(true)
    expect(isWholeEdit(logNow(logUndo(back)), FULL)).toBe(true)
  })

  it('treats a legacy whole-take trim as no edit at all', () => {
    const back = readLog(undefined, { from: 0, to: 10 }, FULL)
    expect(canUndo(back)).toBe(false)
  })

  it('answers with the whole take for anything it cannot read', () => {
    for (const junk of [null, undefined, 5, 'x', {}, { steps: [] }, { steps: 'no' }]) {
      const back = readLog(junk, undefined, FULL)
      expect(isWholeEdit(logNow(back), FULL)).toBe(true)
      expect(back.at).toBe(0)
    }
  })

  it('clamps a stored index that points nowhere', () => {
    const log = { steps: [{ keep: [{ from: 0, to: 10 }] }], at: 99 }
    expect(readLog(log, undefined, FULL).at).toBe(0)
    expect(readLog({ ...log, at: -4 }, undefined, FULL).at).toBe(0)
  })

  it('never reads back more steps than the cap', () => {
    const steps = Array.from({ length: 200 }, (_, i) => ({ keep: [{ from: 0, to: 1 + (i % 5) }] }))
    expect(readLog({ steps, at: 199 }, undefined, FULL).steps.length).toBe(HISTORY_MAX)
  })
})

describe('zooming into a long take', () => {
  it('shows everything by default', () => {
    expect(clampView(null, FULL)).toEqual({ from: 0, to: 10 })
  })

  it('cannot be pushed off either end', () => {
    expect(clampView({ from: -5, to: 3 }, FULL).from).toBe(0)
    expect(clampView({ from: 8, to: 20 }, FULL).to).toBeLessThanOrEqual(10)
    expect(panView({ from: 2, to: 4 }, 99, FULL)).toEqual({ from: 8, to: 10 })
    expect(panView({ from: 2, to: 4 }, -99, FULL)).toEqual({ from: 0, to: 2 })
  })

  it('will not zoom in past the point of being useful, or out past the take', () => {
    let v = { from: 0, to: FULL }
    for (let i = 0; i < 40; i++) v = zoomView(v, 0.5, 5, FULL)
    expect(v.to - v.from).toBeCloseTo(MIN_VIEW, 6)
    for (let i = 0; i < 40; i++) v = zoomView(v, 2, 5, FULL)
    expect(v).toEqual({ from: 0, to: 10 })
  })

  /**
   * ⚠️ ANCHORED, OR YOU CHASE IT. A zoom that recentres moves whatever you were looking at off
   * the edge the moment you are not already centred on it, which on a long take is two or
   * three corrections per press.
   */
  it('keeps the thing under your finger under your finger', () => {
    const v = { from: 0, to: 10 }
    const anchor = 8
    const z = zoomView(v, 0.25, anchor, FULL)
    expect(timeToFrac(anchor, z)).toBeCloseTo(timeToFrac(anchor, v), 6)
  })

  it('puts a chosen span on screen with room around it', () => {
    const v = viewAround({ from: 4, to: 4.5 }, FULL)
    expect(v.from).toBeLessThan(4)
    expect(v.to).toBeGreaterThan(4.5)
    expect(v.to - v.from).toBeLessThan(2)
  })

  it('maps pixels to moments inside the window, not the whole take', () => {
    const v = { from: 4, to: 6 }
    expect(xToTime(0, 300, v)).toBeCloseTo(4, 9)
    expect(xToTime(150, 300, v)).toBeCloseTo(5, 9)
    expect(xToTime(300, 300, v)).toBeCloseTo(6, 9)
    /* ⚠️ reachable: the Browser pane collapses the viewport to 0x0 between calls */
    expect(xToTime(10, 0, v)).toBe(4)
  })

  it('selects within the window, and backwards works', () => {
    const v = { from: 4, to: 6 }
    expect(pickRange(300, 0, 300, v)).toEqual(pickRange(0, 300, 300, v))
    expect(pickRange(75, 225, 300, v)).toEqual({ from: 4.5, to: 5.5 })
  })
})

describe('the picture', () => {
  it('draws silence as a flat line rather than as noise', () => {
    expect([...peaks(new Float32Array(4800), 120)].every((v) => v === 0)).toBe(true)
  })

  it('reaches the full height of a full-scale signal', () => {
    const p = peaks(tone(48000, 80, 48000, 1), 200)
    expect(Math.max(...p)).toBeCloseTo(1, 2)
    expect(Math.min(...p)).toBeCloseTo(-1, 2)
  })

  /**
   * ⚠️ THE ONE THAT CATCHES A STRIDE, and 24037 rather than 24000 because column 50 BEGINS at
   * 24000 — a click placed there is the one position a strided reader always hits, and the
   * first version of this test was green against a stride of 64 for exactly that reason.
   */
  it('shows a one-sample click, in the column it happened in and no other', () => {
    const data = new Float32Array(48000)
    data[24037] = 0.9
    const p = peaks(data, 100)
    const lit = []
    for (let c = 0; c < 100; c++) if (p[c * 2 + 1] > 0.5) lit.push(c)
    expect(lit).toEqual([50])
  })

  it('reaches the very end of the audio, not almost', () => {
    const data = new Float32Array(10007)
    data[10006] = 1
    expect(peaks(data, 97)[96 * 2 + 1]).toBe(1)
  })

  /** zoomed in, it draws only the window — which is the whole point of zooming */
  it('draws only the window it was asked for', () => {
    const data = new Float32Array(10000)
    data.fill(1, 6000, 7000)
    const outside = peaks(data, 50, 0, 5000)
    expect(Math.max(...outside)).toBe(0)
    const inside = peaks(data, 50, 6000, 7000)
    expect(Math.min(...inside)).toBe(1)
  })

  it('is not dragged to the edges by a corrupt sample', () => {
    const p = peaks(new Float32Array([0.2, NaN, -0.1]), 1)
    expect(Number.isFinite(p[0]) && Number.isFinite(p[1])).toBe(true)
    expect(p[1]).toBeCloseTo(0.2, 6)
  })

  it('answers for an empty take instead of throwing', () => {
    expect([...peaks(new Float32Array(0), 8)].every((v) => v === 0)).toBe(true)
    for (const bad of [0, -5, NaN, Infinity])
      expect(peaks(tone(100, 50), bad).length).toBeGreaterThan(0)
  })
})

/**
 * ⚠️ EVERY EXPECTATION HERE IS WRITTEN FROM WHERE THE SOUND IS, never from what the function
 * does with it. "A tone from 2s to 3s, so the span is 2s to 3s give or take the margin" is a
 * claim about the world; comparing against `(first * per) / hz` would be a second copy of the
 * code and would agree with it however wrong it was. CLAUDE.md, §2.
 */
describe('finding the sound in a recording', () => {
  const RATE = 48000

  /** silence, then `amp` of 300Hz between `from` and `to` seconds, then silence */
  const buried = (len: number, from: number, to: number, amp = 0.8, noise = 0) => {
    const d = new Float32Array(Math.round(len * RATE))
    for (let i = 0; i < d.length; i++) {
      const t = i / RATE
      d[i] = noise ? noise * Math.sin((2 * Math.PI * 2000 * i) / RATE) : 0
      if (t >= from && t < to) d[i] += amp * Math.sin((2 * Math.PI * 300 * i) / RATE)
    }
    return [d]
  }

  /**
   * ⚠️ 1.92 AND 3.08, NOT `2 - QUIET_EDGE`. Written against the constant, this and the four
   * assertions like it all stayed GREEN when the margin was perturbed to zero — the
   * expectation moved with the code and cancelled the error out exactly, which is the trap
   * CLAUDE.md names under 'a test built from the same sum as the code'. The claim is 'about
   * eighty milliseconds of room either side'; the numbers say that.
   */
  it('finds a phrase buried in silence, with a margin either side', () => {
    const got = loudSpan(buried(6, 2, 3), 6, RATE)!
    expect(got.from).toBeCloseTo(1.92, 2)
    expect(got.to).toBeCloseTo(3.08, 2)
  })

  /**
   * The invariant the whole threshold decision rests on. Turn the same recording down by a
   * factor of a hundred — a phone at arm's length rather than at the mouth — and the answer
   * must not move. Perturbed with an absolute floor in place of a relative one, this is the
   * test that goes red: the quiet copy reads as silent all the way through.
   */
  it('answers the same for a quiet recording as for a loud one', () => {
    const loud = loudSpan(buried(6, 2, 3, 0.9), 6, RATE)!
    const quiet = loudSpan(buried(6, 2, 3, 0.009), 6, RATE)!
    expect(quiet.from).toBeCloseTo(loud.from, 4)
    expect(quiet.to).toBeCloseTo(loud.to, 4)
  })

  /**
   * ⚠️ TOP AND TAIL, NOT THE FIRST RUN. Two phrases with a gap between them is what a sentence
   * looks like, and the gap is below the floor like the ends are. A function that stopped at
   * the first quiet window would hand back the first word.
   */
  it('keeps the gap between two phrases', () => {
    const d = buried(10, 1, 2)[0]
    for (let i = Math.round(7 * RATE); i < Math.round(8 * RATE); i++)
      d[i] = 0.8 * Math.sin((2 * Math.PI * 300 * i) / RATE)
    const got = loudSpan([d], 10, RATE)!
    expect(got.from).toBeCloseTo(0.92, 2)
    expect(got.to).toBeCloseTo(8.08, 2)
  })

  /**
   * ⚠️ AND IT DOES NOT START ON A WHOLE SECOND, because every other fixture here does and that
   * hid the measuring window completely: perturbed to a window a whole second long, a phrase
   * from 2s to 3s still answered 2s to 3s — it filled exactly one window, so the error had
   * nowhere to show. The same shape as the click planted at sample 24037 further up. A take's
   * words do not line up with anything.
   */
  it('is accurate to a fraction of a second, not to the second', () => {
    const got = loudSpan(buried(6, 2.37, 3.11), 6, RATE)!
    expect(got.from).toBeCloseTo(2.28, 1)
    expect(got.to).toBeCloseTo(3.2, 1)
  })

  it('does not run off either end of the recording', () => {
    const got = loudSpan(buried(4, 0, 4), 4, RATE)!
    expect(got.from).toBe(0)
    expect(got.to).toBe(4)
  })

  /** room noise forty decibels down is silence; a take recorded in a kitchen still trims */
  it('is not fooled by a noise floor', () => {
    const got = loudSpan(buried(6, 2, 3, 0.8, 0.002), 6, RATE)!
    expect(got.from).toBeCloseTo(1.92, 2)
    expect(got.to).toBeCloseTo(3.08, 2)
  })

  it('says nothing rather than something about a silent recording', () => {
    expect(loudSpan([new Float32Array(RATE * 3)], 3, RATE)).toBe(null)
    expect(loudSpan([], 3, RATE)).toBe(null)
    expect(loudSpan([new Float32Array(0)], 3, RATE)).toBe(null)
    for (const bad of [0, -1, NaN, Infinity])
      expect(loudSpan(buried(6, 2, 3), bad, RATE)).toBe(null)
    expect(loudSpan(buried(6, 2, 3), 6, 0)).toBe(null)
  })

  it('reads every channel, not only the first', () => {
    const left = new Float32Array(RATE * 6)
    const right = buried(6, 2, 3)[0]
    const got = loudSpan([left, right], 6, RATE)!
    expect(got.from).toBeCloseTo(1.92, 2)
  })

  /**
   * ⚠️ THE CLAIM IS ABOUT THE THRESHOLD, which is why the recording here is a quiet one. A
   * corrupt sample that reached `loudest` would make the floor NaN, nothing would pass it,
   * and the function would answer 'silent' about a take with a phrase plainly in it — the
   * same shape `peaks` above was bitten by, where a NaN dragged the envelope to the edge.
   */
  it('is not pinned at the top by a corrupt sample', () => {
    const d = buried(6, 2, 3, 0.02)[0]
    d[Math.round(2.5 * RATE)] = NaN
    const got = loudSpan([d], 6, RATE)!
    expect(got.from).toBeCloseTo(1.92, 2)
  })

  /** and the thing the button is for: applied as an ordinary edit, it is one step like any other */
  it('composes with an edit already made, and is undoable like the rest', () => {
    const len = 6
    const loud = loudSpan(buried(len, 2, 3), len, RATE)!
    const log = logDo(startLog(wholeEdit(len)), keepOnly(wholeEdit(len), loud, len))
    expect(editLen(logNow(log))).toBeCloseTo(1.16, 2)
    expect(canUndo(log)).toBe(true)
    expect(isWholeEdit(logNow(logUndo(log)), len)).toBe(true)
  })
})
