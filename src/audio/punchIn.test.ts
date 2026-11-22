import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { landing, punchIn, roundTrip, sungOver, type Transport } from './punchIn'

/**
 * Where a recording lands in the song. The expectations are written from the song's shape — a
 * playhead so many seconds in, a voice arriving so many milliseconds late — never from the sum
 * the function does.
 */

/* a song of four bars at 120 bpm: a pass is 8 seconds, a beat half of one, and the loop began at 10
   on the audio clock */
const song: Transport = { playing: true, origin: 10, len: 8, beat: 0.5 }

describe('where a recording lands', () => {
  it('where the playhead was, less the round trip', () => {
    /* begun 3.2s into the song, a voice arriving 80ms behind what was heard */
    expect(punchIn({ startedAt: 13.2, lag: 0.08 }, song)).toBe(3.12)
    /* with nothing reported, the playhead itself */
    expect(punchIn({ startedAt: 13.2, lag: 0 }, song)).toBe(3.2)
  })

  it('in the second pass, where it was sung in that pass', () => {
    /* 8s pass: 22.5 on the clock is 4.5s into the second time round */
    expect(punchIn({ startedAt: 22.5, lag: 0 }, song)).toBe(4.5)
  })

  it('nowhere when the song was not playing', () => {
    expect(punchIn({ startedAt: 13.2, lag: 0.08 }, { ...song, playing: false })).toBeNull()
  })

  it('at the top when the round trip reaches back before it', () => {
    expect(punchIn({ startedAt: 10.05, lag: 0.08 }, song)).toBe(0)
    expect(punchIn({ startedAt: 9, lag: 0 }, song)).toBe(0)
  })
})

describe('where a kept recording goes', () => {
  it('mid-song, where it was sung, with nothing left out', () => {
    expect(landing({ startedAt: 13.2, lag: 0.08 }, song, 2)).toEqual({ at: 3.12, skip: 0 })
  })

  it('begun in the last beat and sung on past the end, at the top, the pre-roll left out', () => {
    /* pressed 7.7s into the pass to sing from bar 1: the 0.38s before the downbeat is breath */
    expect(landing({ startedAt: 17.7, lag: 0.08 }, song, 3)).toEqual({ at: 0, skip: 0.38 })
    /* the same, read against the previous pass's origin (the transport is read once a tick) */
    expect(landing({ startedAt: 25.7, lag: 0.08 }, song, 3)).toEqual({ at: 0, skip: 0.38 })
  })

  it('begun in the last beat and stopped before the end, where it was sung', () => {
    expect(landing({ startedAt: 17.7, lag: 0.08 }, song, 0.3)).toEqual({ at: 7.62, skip: 0 })
  })

  it('begun earlier than a beat before the end, where it was sung, however long it runs', () => {
    expect(landing({ startedAt: 17, lag: 0 }, song, 4)).toEqual({ at: 7, skip: 0 })
  })

  it('begun during a count-in, on beat one with the count-in left out, never late', () => {
    expect(landing({ startedAt: 9, lag: 0 }, song, 3)).toEqual({ at: 0, skip: 1 })
  })

  it('nowhere when nothing was sung after the downbeat, or the song was not playing', () => {
    expect(landing({ startedAt: 9, lag: 0 }, song, 0.8)).toBeNull()
    expect(landing({ startedAt: 13, lag: 0 }, { ...song, playing: false }, 3)).toBeNull()
  })

  it('never at the very end of the pass, where it would play nothing', () => {
    /* 7.9998s rounds to 8.000, the length of the pass */
    expect(landing({ startedAt: 17.9998, lag: 0 }, song, 0.0001)).toEqual({ at: 0, skip: 0 })
  })
})

describe('what a new take is sung over', () => {
  it('the unmuted takes whose sound overlaps it, and nothing that only touches it', () => {
    const placed = [
      { id: 'a', at: 1, dur: 2 },
      { id: 'b', at: 2.5, dur: 1, muted: true },
      { id: 'c', at: 3, dur: 1 },
      { id: 'd', at: 0, dur: 1 },
    ]
    expect(sungOver(placed, 2.9, 4)).toEqual(['a', 'c'])
    expect(sungOver(placed, 4, 5)).toEqual([])
  })
})

describe('the round trip', () => {
  it('is the output latency and the microphone’s, bounded', () => {
    expect(roundTrip({ outputLatency: 0.05, baseLatency: 0.01 }, 0.03)).toBeCloseTo(0.08, 9)
    /* no output latency reported (Safari): the context's own buffer stands in */
    expect(roundTrip({ baseLatency: 0.01 }, undefined)).toBeCloseTo(0.01, 9)
    /* a broken report does not move a take further than anybody could have sung */
    expect(roundTrip({ outputLatency: 4 }, 3)).toBe(0.5)
    expect(roundTrip({ outputLatency: -1 }, Number.NaN)).toBe(0)
  })
})

/* ── the recorder itself, with a stand-in microphone ─────────────────────────────────────────── */

const fake = vi.hoisted(() => ({
  ctx: { currentTime: 0, outputLatency: 0.05, baseLatency: 0.01 },
  /** how long the recorder takes to say it has begun, on the audio clock */
  startDelay: 0.004,
}))
vi.mock('./context', () => ({ sharedCtx: () => fake.ctx }))

class FakeRecorder {
  static isTypeSupported = () => true
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onstart: (() => void) | null = null
  start() {
    /* a moment later, as a real one does */
    queueMicrotask(() => {
      fake.ctx.currentTime += fake.startDelay
      this.onstart?.()
    })
  }
  stop() {
    this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
}

beforeEach(() => {
  vi.resetModules()
  fake.ctx.currentTime = 0
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => ({
        getTracks: () => [{ stop: () => {} }],
        getAudioTracks: () => [{ getSettings: () => ({ latency: 0.03 }) }],
      }),
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('a recording started in the middle of the song', () => {
  it('lands where the playhead was when it was started, less the round trip', async () => {
    const { recordTake } = await import('./recordTake')
    /* the song has been playing since 10 on the audio clock; the take is begun 3.2s in */
    fake.ctx.currentTime = 13.2
    const rec = (await recordTake())!
    await Promise.resolve()
    const start = rec.start()
    /* the moment it was started, not its start event: measured in Chrome, the first sample kept is
       within about 10ms of the call and 70ms ahead of the event (recordTake.ts says how) */
    expect(start.startedAt).toBeCloseTo(13.2, 9)
    /* 50ms out to the speaker, 30ms in from the microphone */
    expect(start.lag).toBeCloseTo(0.08, 9)
    expect(punchIn(start, song)).toBe(3.12)
    expect(await rec.stop()).not.toBeNull()
  })
})
