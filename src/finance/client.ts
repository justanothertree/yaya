import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getFinanceEnv, hasFinanceSupabaseEnv } from './env'

let _supabase: SupabaseClient | null = null

/**
 * Returns a singleton Supabase client.
 *
 * - Uses the anon key (safe to ship to browsers).
 * - Never bypasses RLS; all access is mediated by Auth JWT + RLS policies.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_supabase) return _supabase

  const { supabaseUrl, supabaseAnonKey } = getFinanceEnv()

  _supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // For an app/dashboard, keep sessions across refresh so the JWT is present.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      // every PostgREST call passes through here — see noteRefusal below
      fetch: async (input, init) => {
        const res = await fetch(input, init)
        if (res.status === 401 || res.status === 403) noteRefusal(urlOf(input))
        return res
      },
    },
  })

  return _supabase
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return (input as Request).url ?? ''
}

/**
 * Is a check already running? One at a time — a page that fires six gated calls at once would
 * otherwise ask six times and race itself into signing out mid-refresh.
 */
let checkingSession = false

/**
 * The server refused us. WAS IT THIS USER, OR NO USER AT ALL?
 *
 * ⚠️ A DEAD SESSION USED TO LOOK EXACTLY LIKE A LIVE ONE. The app boots optimistically from
 * the persisted session so a returning member does not flash "Sign in" — and peekPersistedUserId
 * counts a session as usable if it merely HAS a refresh token, without knowing whether that token
 * still works. When it does not (signed out on another device, password changed, 30 days away),
 * nothing ever found out: supabase-js leaves the dead token in localStorage, getSession() quietly
 * returns nothing, and App's confirmSignedOut() bails because the dead token is still sitting
 * there. The whole signed-in UI renders, every gated call goes out as anon, and the Investments
 * page says "permission denied for function get_my_portfolio" — the raw Postgres refusal — with
 * no way to tell the app you are not actually signed in. Verified by planting a session with a
 * dead refresh token: full nav, no sign-in prompt, red Postgres error.
 *
 * ⚠️ TWO SIGNALS, NEVER ONE. A 403 on its own is ordinary: it is what RLS returns to a
 * perfectly valid member writing a row that is not theirs, and signing those people out would be
 * far worse than the bug being fixed. So the refusal only counts when getSession() ALSO comes up
 * empty — and getSession() awaits a refresh in flight, so a healthy cold load resolves to a real
 * session and nothing happens.
 *
 * ⚠️ Skips /auth/v1/ or it eats itself: getSession and signOut make their own requests through
 * this same fetch, and a 400 from the refresh endpoint would re-enter here forever.
 *
 * signOut({ scope: 'local' }) rather than a bespoke purge, because it clears the stored token AND
 * emits SIGNED_OUT — which App already listens for. The UI drops to signed-out on its own.
 */
function noteRefusal(url: string): void {
  if (checkingSession || url.includes('/auth/v1/')) return
  const sb = _supabase
  if (!sb) return
  checkingSession = true
  void (async () => {
    try {
      const { data, error } = await sb.auth.getSession()
      if (data.session?.access_token) return // a real session: that 403 was RLS, not auth
      if (!isSessionDefinitelyDead(error)) return // could not ask — see below
      console.warn('[auth] the stored session is dead — signing out locally')
      await sb.auth.signOut({ scope: 'local' })
      forgetPersistedSession()
    } catch {
      /* if we cannot even ask, leave the session alone — guessing here logs people out */
    } finally {
      checkingSession = false
    }
  })()
}

/**
 * Does this mean the stored session is RUBBISH, or only that we could not ask?
 *
 * ⚠️ "The server said no" and "I could not reach the server" must never be treated alike.
 * Throwing the session away on a network failure would hard-log-out a member who opened the site
 * on a train — and they could not sign back in either, because there is no network. auth-js
 * raises AuthRetryableFetchError for that case, having already retried it; a refresh the server
 * actually rejected comes back as an AuthApiError instead.
 *
 * ⚠️ No error AND no session is not death either: that is an ordinary signed-out visitor, who
 * has nothing stored to throw away.
 */
export function isSessionDefinitelyDead(error: unknown): boolean {
  if (!error) return false
  return (error as { name?: unknown }).name !== 'AuthRetryableFetchError'
}

/**
 * Delete the stored session blob.
 *
 * ⚠️ signOut() IS NOT ENOUGH ON ITS OWN, which is the part that took the longest to see.
 * It reports `{ error: null }` and the `sb-<ref>-auth-token` key is still sitting in
 * localStorage afterwards — so the next page load peeks it, believes a member is signed in, and
 * the whole thing starts again. Anything holding the dead session in memory (a second client, a
 * refresh timer mid-flight) can write it straight back.
 *
 * ⚠️ Only ever called where getSession() has JUST come up empty. It is not a sign-out button:
 * removing a live session's token here would log somebody out for a 403 that RLS returned to a
 * perfectly valid member.
 */
export function forgetPersistedSession(): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (/^sb-.+-auth-token$/.test(k)) localStorage.removeItem(k)
    }
  } catch {
    /* private mode, storage disabled: nothing to clear */
  }
}

/**
 * The client, or null when this build has no Supabase at all.
 *
 * ⚠️ getSupabaseClient() THROWS on a build with no env, which is correct for the finance
 * screens — they cannot exist without it — and wrong for anything that also renders signed out
 * or in the demo sandbox. Those callers were each writing their own hasFinanceSupabaseEnv()
 * guard, and a component that forgets one takes the whole page down with an exception thrown
 * during render.
 */
export function getSupabaseClientOrNull(): SupabaseClient | null {
  if (!hasFinanceSupabaseEnv()) return null
  try {
    return getSupabaseClient()
  } catch {
    return null
  }
}

/**
 * Subscribe to a realtime channel and SAY SO when it fails.
 *
 * `channel.subscribe()` with no callback is the quiet kind of broken: if the socket errors, times
 * out, or the channel is closed under you, live updates simply stop. Nothing throws, nothing
 * logs, and the page keeps showing whatever it had — so "the board stopped syncing" and "chat
 * went quiet" look identical to "nothing has happened yet".
 *
 * This project has already been bitten by exactly that: realtime-js dedupes channels BY TOPIC,
 * so re-subscribing to a topic mid-teardown returns the dying instance and `subscribe()` silently
 * no-ops. That took a long time to find precisely because it was silent.
 *
 * Deliberately only WARNS — it does not retry or surface UI. Every caller here is a
 * nice-to-have live layer over data that is also fetched normally, so a dead channel should
 * degrade to "not live", not to an error page. The point is that it stops being invisible.
 */
export function subscribeLogged(
  channel: { subscribe: (cb?: (status: string, err?: Error) => void) => unknown },
  label: string,
) {
  return channel.subscribe((status, err) => {
    if (status === 'SUBSCRIBED') return
    // CLOSED is normal on teardown; the rest mean live updates are not happening
    if (status === 'CLOSED') return
    console.warn(`[realtime] ${label}: ${status}${err ? ` — ${err.message}` : ''} (not live)`)
  })
}
