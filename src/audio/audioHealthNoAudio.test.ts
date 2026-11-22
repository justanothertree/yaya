import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/**
 * The health strip in a browser with no Web Audio at all: WebKit builds without it, locked-down
 * webviews. The strip is on by default and asks readHealth once a second, and building the
 * context threw `new Ctor()` into the page each time. The real context module here, not the mock
 * the other file uses, because the throw was in it.
 */

beforeEach(() => {
  /* a fresh context module each time: it keeps the one context it built */
  vi.resetModules()
  /* healthOn reads the address and storage, neither of which node has */
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
})
afterEach(() => vi.unstubAllGlobals())

it('reads nothing, quietly, where there is no Web Audio', async () => {
  vi.stubGlobal('window', {})
  const { readHealth, startHealth } = await import('./audioHealth')
  expect(readHealth()).toBeNull()
  await expect(startHealth()).resolves.toBe(false)
  expect(readHealth()).toBeNull()
})

it('reads the context where there is one', async () => {
  /* the control: the same path with a context to build, so a readHealth that always said null
     would fail here */
  class Context {
    currentTime = 0
    state = 'suspended'
    baseLatency = 0.01
    sampleRate = 48000
  }
  vi.stubGlobal('window', { AudioContext: Context })
  const { readHealth } = await import('./audioHealth')
  expect(readHealth()).toMatchObject({ sampleRate: 48000, bufferMs: 10, bufferFrames: 480 })
})
