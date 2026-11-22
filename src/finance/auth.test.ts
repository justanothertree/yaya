import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `onAuthStateChange` is subscribed on every page as the site loads (PresenceBeacon, App), so
 * whether it throws without a Supabase env decides whether a checkout with no `.env.local` can
 * render anything at all. Both halves are asked: with no env it must hand back something the
 * callers can unsubscribe from, and with the env it must still be Supabase's own subscription.
 *
 * ⚠️ THE ENV IS MOCKED AT `./env`, NOT STUBBED WITH `vi.stubEnv`. env.ts reads
 * `(import.meta as …).env` through a cast, and measured, a stubbed variable is visible in the
 * test's own `import.meta.env` and NOT to env.ts — so a stub-based "env present" case silently
 * ran with no env and failed for a reason that had nothing to do with the code under test.
 * Mocking the module answers the question both ways regardless of what the machine has.
 */
function withEnv(present: boolean) {
  vi.resetModules()
  vi.doMock('./env', () => ({
    hasFinanceSupabaseEnv: () => present,
    getFinanceEnv: () => {
      if (!present) throw new Error('[finance] Missing Supabase env.')
      return { supabaseUrl: 'http://127.0.0.1:9', supabaseAnonKey: 'placeholder-anon-key' }
    },
  }))
}

afterEach(() => {
  vi.doUnmock('./env')
  vi.resetModules()
})

describe('onAuthStateChange', () => {
  it('does not throw without a Supabase env, and gives back a subscription that can be dropped', async () => {
    withEnv(false)
    const { onAuthStateChange } = await import('./auth')
    const callback = vi.fn()
    const { data } = onAuthStateChange(callback)
    expect(() => data.subscription.unsubscribe()).not.toThrow()
    // nobody can sign in to a build with no Supabase, so nothing is ever reported
    await new Promise((r) => setTimeout(r, 0))
    expect(callback).not.toHaveBeenCalled()
  })

  it('is still the real Supabase subscription when the env is present', async () => {
    withEnv(true)
    const { onAuthStateChange } = await import('./auth')
    const { data } = onAuthStateChange(() => {})
    // supabase-js's subscription carries an id (a string or a symbol) and the wrapped callback;
    // the no-env stand-in has neither, only `unsubscribe`
    const sub = data.subscription as { id?: unknown; callback?: unknown }
    expect(['string', 'symbol']).toContain(typeof sub.id)
    expect(typeof sub.callback).toBe('function')
    data.subscription.unsubscribe()
  })
})
