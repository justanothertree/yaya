import { describe, expect, it } from 'vitest'
import { loadSong, loopState, setBars, setTransport } from './looper'

/**
 * A jam partner's transport, adopted — at the length the room itself offers.
 *
 * ⚠️ THE EXPECTATION IS setBars'S, NOT A NUMBER TYPED IN. The claim is that following somebody
 * cannot give you a loop you could not have set yourself, and cannot take away one you could:
 * so ask setBars what the room allows and compare against that, rather than writing 32 here and
 * agreeing with whatever constant the code happens to hold.
 */
const roomAllows = (bars: number) => {
  loadSong(120, 2, [])
  setBars(bars)
  return loopState().bars
}

describe("a partner's transport", () => {
  it('takes a sixteen-bar loop as sixteen, because the room offers sixteen', () => {
    expect(roomAllows(16)).toBe(16)
    loadSong(120, 2, [])
    setTransport({ bpm: 120, bars: 16, playing: false, origin: 0 })
    expect(loopState().bars).toBe(16)
  })

  it('and stops where the room stops, at both ends', () => {
    for (const asked of [32, 33, 400, 0, -3]) {
      const own = roomAllows(asked)
      loadSong(120, 2, [])
      setTransport({ bpm: 120, bars: asked, playing: false, origin: 0 })
      expect(loopState().bars, `asked for ${asked}`).toBe(own)
    }
  })
})
