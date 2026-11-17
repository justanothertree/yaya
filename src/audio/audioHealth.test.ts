import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/**
 * The health strip's start, asked without a browser: a fake context whose worklet takes a moment
 * to load, which is the window two starts used to share. The worklet is made to fail to load, so
 * nothing past it (the synth, the mixer, the timers) is needed to ask the one question here: how
 * many times was it loaded.
 */

const fake = vi.hoisted(() => ({
  ctx: {
    audioWorklet: {
      addModule: vi.fn(
        () => new Promise<void>((_, no) => setTimeout(() => no(new Error('no worklet here')), 5)),
      ),
    },
  },
}))
vi.mock('./context', () => ({ sharedCtx: () => fake.ctx }))

beforeEach(() => {
  /* healthOn reads the address and storage, neither of which node has */
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  fake.ctx.audioWorklet.addModule.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

it('two starts at once load the worklet once, and both hear how it went', async () => {
  const { startHealth } = await import('./audioHealth')
  const both = await Promise.all([startHealth(), startHealth()])
  /* ⚠️ twice was a second registerProcessor('audio-health') — an error on every visit in Firefox */
  expect(fake.ctx.audioWorklet.addModule).toHaveBeenCalledTimes(1)
  expect(both).toEqual([false, false])
})

it('a start after one has finished is a fresh try', async () => {
  const { startHealth } = await import('./audioHealth')
  await startHealth()
  await startHealth()
  expect(fake.ctx.audioWorklet.addModule).toHaveBeenCalledTimes(2)
})
