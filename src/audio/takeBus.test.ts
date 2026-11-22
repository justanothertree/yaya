import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/**
 * Where a recording's level is decided. The stems and ⬇ Export song tap the take bus beside the
 * synth, and they tap the synth BEFORE the instrument fader, so a file is the song rather than
 * how loud this device is turned up. A take has to reach the bus at the level it was recorded,
 * then, and only the speakers may hear the fader. Asked of a fake graph, because the question is
 * which node the fader is on, and that needs no sound.
 */

type Fake = {
  gain: { value: number; setTargetAtTime: (v: number) => void }
  to: Fake[]
  connect: (n: Fake) => Fake
  disconnect: () => void
}
const fake = vi.hoisted(() => {
  const node = (): Fake => {
    const n: Fake = {
      gain: { value: 1, setTargetAtTime: (v: number) => void (n.gain.value = v) },
      to: [],
      connect: (m: Fake) => (n.to.push(m), m),
      disconnect: () => void (n.to = []),
    }
    return n
  }
  const destination = node()
  return { destination, ctx: { createGain: node, destination, currentTime: 0 } }
})
vi.mock('./context', () => ({ sharedCtx: () => fake.ctx }))

const disk = new Map<string, string>()
beforeEach(() => {
  vi.resetModules()
  disk.clear()
  /* mixer.ts announces a moved slider on window and keeps it in storage */
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => disk.get(k) ?? null,
    setItem: (k: string, v: string) => void disk.set(k, v),
    removeItem: (k: string) => void disk.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

/** every gain from a node to the speakers, multiplied: what the speakers hear of 1 put in */
function toSpeakers(n: Fake): number {
  if (n === fake.destination) return 1
  expect(n.to).toHaveLength(1)
  return n.gain.value * toSpeakers(n.to[0])
}

for (const fader of ['0', '0.7']) {
  it(`a take reaches the tap as it was recorded and the speakers at the fader, at ${fader}`, async () => {
    disk.set('mix_instrument_v1', fader)
    const { takeBus } = await import('./takeBus')
    const bus = takeBus() as unknown as Fake
    /* the tap is the bus's own output: whatever the bus passes, at its own gain */
    expect(bus.gain.value).toBe(1)
    expect(toSpeakers(bus)).toBeCloseTo(Number(fader), 9)
  })
}

it('and the speakers follow the fader as it moves, while the tap does not', async () => {
  const { takeBus } = await import('./takeBus')
  const { setVolume } = await import('./mixer')
  const bus = takeBus() as unknown as Fake
  setVolume('instrument', 0.2)
  expect(bus.gain.value).toBe(1)
  expect(toSpeakers(bus)).toBeCloseTo(0.2, 9)
})
