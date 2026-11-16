import { expect, it } from 'vitest'

/**
 * A browser with no AudioWorklet still gets the site.
 *
 * ⚠️ NODE HAS NO AudioWorkletNode EITHER, which is what makes this an honest test of it.
 * voiceSession is imported by App.tsx, and the noise suppressor it uses declares
 * `class … extends AudioWorkletNode` at the top of its module — so while that import was static,
 * importing this module threw "AudioWorkletNode is not defined" here, exactly as it threw in
 * Playwright's WebKit and left the whole site blank (15 Nov 2026).
 */
it('loads where there is no AudioWorkletNode, and leaves the denoiser for a call to fetch', async () => {
  expect((globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode).toBeUndefined()
  const { voiceSession } = await import('./voiceSession')
  expect(typeof voiceSession).toBe('object')
})
