import { useSyncExternalStore } from 'react'
import { getSupabaseClient } from './client'
import { onAuthStateChange } from './auth'
import { hasFinanceSupabaseEnv } from './env'

/**
 * Noticing when realtime has come back, and telling everything that depends on it to try again.
 *
 * ⚠️ THIS EXISTS BECAUSE SUBSCRIPTIONS WERE SET UP ONCE AND NEVER AGAIN. Reported from a real
 * session: a friend had the site open, and neither an incoming call nor a new message reached
 * them until they reloaded the page. Both ride realtime — messages through the `notif:chat`
 * postgres_changes channel, calls through the per-room `vp:<id>` presence channels — so one dead
 * connection takes out both, which is exactly the pair of symptoms that showed up.
 *
 * There are three ways to arrive at a dead connection, and the app had no answer to any of them:
 *
 *   THE TOKEN EXPIRES. Every one of these channels is private, so joining is authorised against
 *   the access token. Tokens last about an hour. The socket refreshes its own token, but a
 *   channel that was refused, or that dropped and rejoined while the token was stale, does not
 *   retry on its own.
 *
 *   THE SOCKET DROPS. A laptop sleeps, wifi changes, a phone locks. realtime-js reconnects the
 *   socket, and channels that were healthy rejoin with it — but a rejoin refused for the reason
 *   above simply stays refused.
 *
 *   THE SUBSCRIPTION RACES THE SESSION. `authed` can be true from a persisted user id before
 *   supabase-js has finished putting the restored session on the realtime socket. A private
 *   channel that subscribes in that window is refused, and nothing ever asks again.
 *
 * The fix is not to chase each cause separately. It is to publish a NUMBER that goes up whenever
 * the connection might be different from the one a subscription was made on, and let every
 * realtime hook put that number in its dependency list. Then a hook that missed its chance simply
 * tears down and tries again, and the three causes above collapse into one behaviour.
 *
 * ⚠️ Deliberately NOT a heartbeat that resubscribes on a timer. Resubscribing a healthy channel
 * costs a join round trip and drops any presence you were tracking for a moment — doing that
 * every minute to a room full of people would be its own bug. This only fires on a transition
 * that could plausibly have invalidated a subscription.
 */

let generation = 0
const listeners = new Set<() => void>()
let started = false
let wasConnected = true

function bump(why: string) {
  generation++
  if (import.meta.env.DEV) console.info(`[realtime] reconnecting subscriptions — ${why}`)
  listeners.forEach((l) => l())
}

function start() {
  if (started) return
  started = true
  /**
   * ⚠️ Guarded, because this runs for EVERYONE.
   *
   * Both hooks that use it are mounted for every visitor, signed in or not, and
   * getSupabaseClient() throws when the site is built without Supabase configured. An
   * unguarded call here would turn a missing environment variable into a blank page for a
   * stranger reading the portfolio — a connection watchdog must never be able to do that.
   */
  let sb: ReturnType<typeof getSupabaseClient>
  try {
    if (!hasFinanceSupabaseEnv()) return
    sb = getSupabaseClient()
  } catch {
    return
  }

  /**
   * A new token means every private channel needs to be joined again on it.
   *
   * ⚠️ TOKEN_REFRESHED matters more than SIGNED_IN here. Signing in is loud and rare; the token
   * refreshing is silent, happens every hour the tab is open, and is the one that was quietly
   * ending people's evenings.
   */
  onAuthStateChange((event, session) => {
    if (!session) return
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
      bump(event)
  })

  /**
   * Watch the socket for a false → true transition.
   *
   * Polled rather than hooked to realtime-js's own open/close callbacks: those are internal
   * surface that has moved between versions, and a five-second read of a boolean is cheap enough
   * that being version-proof is worth more than being elegant.
   */
  const check = () => {
    let now = false
    try {
      now = sb.realtime.isConnected()
    } catch {
      return
    }
    if (now && !wasConnected) bump('socket reconnected')
    wasConnected = now
  }
  wasConnected = (() => {
    try {
      return sb.realtime.isConnected()
    } catch {
      return true
    }
  })()
  window.setInterval(check, 5000)

  /**
   * Coming back to the tab checks immediately rather than waiting out the interval.
   *
   * A backgrounded tab has its timers throttled hard, so the poll above may not have run for
   * minutes — and returning to the tab is precisely the moment somebody wants to know whether
   * anything happened while they were away.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  window.addEventListener('online', () => bump('back online'))
}

/** The current generation. Put this in a realtime effect's deps and it will rebuild when needed. */
export function realtimeGeneration(): number {
  return generation
}

export function subscribeRealtimeLife(fn: () => void) {
  start()
  listeners.add(fn)
  /**
   * ⚠️ The watcher is never torn down, only the listener.
   *
   * An earlier version stopped the poll and cleared `started` when the last subscriber left,
   * which reads as tidy and is wrong twice over: the auth and visibility listeners registered in
   * start() were not removed with it, so the next start() would register a second copy of each
   * and bump the generation twice per event; and the whole point of this module is to notice a
   * reconnect that happened while nothing was watching. It is one interval for the life of the
   * tab, which is the correct size for a thing that watches the connection the tab depends on.
   */
  return () => {
    listeners.delete(fn)
  }
}

/**
 * The generation, as a React value.
 *
 * Add it to the dependency list of any effect that subscribes to a realtime channel. It changes
 * rarely — a token refresh, a reconnect, coming back online — and each change costs one rebuild
 * of that subscription.
 */
export function useRealtimeLife(): number {
  return useSyncExternalStore(subscribeRealtimeLife, realtimeGeneration, realtimeGeneration)
}
