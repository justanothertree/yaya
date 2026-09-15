import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient, isSessionDefinitelyDead } from './client'

/**
 * Session helpers.
 *
 * RLS policies that reference `auth.uid()` only work when a valid user session
 * exists and the browser is sending the JWT (handled by supabase-js automatically).
 */

export async function getUser(): Promise<User | null> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.auth.getUser()
  if (error) throw error
  return data.user
}

/** The locally-persisted session's user — no network round-trip, so it resolves
 *  near-instantly on boot. Use for UI gating (nav tabs); RLS still guards all data,
 *  and the auth listener corrects if the session turns out stale. */
export async function getSessionUser(): Promise<User | null> {
  const sb = getSupabaseClient()
  const { data } = await sb.auth.getSession()
  return data.session?.user ?? null
}

/**
 * The live session's user — and, when there isn't one, whether that is FINAL.
 *
 * ⚠️ getSessionUser() throws the error away, which is the whole difficulty: "no session"
 * covers both a refresh the server rejected and a refresh that never left the building. The
 * caller has to tell them apart before deciding whether to bin the stored token.
 */
export async function readLiveSession(): Promise<{ user: User | null; dead: boolean }> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.auth.getSession()
  if (data.session?.user) return { user: data.session.user, dead: false }
  return { user: null, dead: isSessionDefinitelyDead(error) }
}

/** Synchronous peek at the persisted session's user id — no client, no network, no
 *  await. For boot-time decisions (nav shape, which Circuit adapter) before supabase-js
 *  even initializes. A stale value only mispaints for a beat: RLS still guards every
 *  byte, and the auth listener corrects the UI. */
export function peekPersistedUserId(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !/^sb-.+-auth-token$/.test(k)) continue
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const s = JSON.parse(raw) as {
        user?: { id?: string }
        expires_at?: number
        refresh_token?: string
      }
      if (!s.user?.id) continue
      // usable if still valid or refreshable
      if ((s.expires_at ?? 0) * 1000 > Date.now() || s.refresh_token) return s.user.id
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Did this fail because of WHO WE ARE, rather than because of what we asked for?
 *
 * ⚠️ Postgres words, not ours. 42501 is insufficient_privilege, which PostgREST returns as
 * 403, and its message is the literal "permission denied for function get_my_portfolio" — which
 * is what the Investments page printed in red at a member whose session had quietly died. The
 * shape is worth naming because the words are not something to show anybody.
 */
export function isAuthDenial(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code
  if (code === '42501' || code === 'PGRST301') return true
  const msg = (e as { message?: unknown })?.message
  return typeof msg === 'string' && /permission denied for |jwt (expired|.*invalid)/i.test(msg)
}

/**
 * Enforces “authenticated-only” usage for finance operations.
 *
 * Even if SELECT is allowed in Supabase, this prevents accidental anonymous reads
 * of user-specific tables from the UI.
 */
export async function requireUser(): Promise<User> {
  const user = await getUser()
  if (!user)
    throw new Error('[finance] Not authenticated. Sign in required for finance operations.')
  return user
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const sb = getSupabaseClient()
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  const sb = getSupabaseClient()
  const { error } = await sb.auth.signOut()
  if (error) throw error
}

export async function updateUserEmail(email: string): Promise<User> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.auth.updateUser({ email })
  if (error) throw error
  if (!data.user) throw new Error('[finance] Failed to update user email (no user returned).')
  return data.user
}

export async function updateUserPassword(password: string): Promise<User> {
  const sb = getSupabaseClient()
  const { data, error } = await sb.auth.updateUser({ password })
  if (error) throw error
  if (!data.user) throw new Error('[finance] Failed to update user password (no user returned).')
  return data.user
}

/**
 * The mark a reset link lands with — see sendPasswordReset for why it is a QUERY and not a hash.
 *
 * ⚠️ READ AT IMPORT, because App takes it out of the address bar as soon as it has acted on it,
 * and SignIn is lazy — by the time that chunk arrives the URL is already clean. Both read this
 * constant instead of the URL, so they cannot disagree about how the page was opened.
 */
const LANDED_FROM_RESET =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('reset') === '1'

/** Was this page opened from a password-reset email? */
export function cameFromPasswordReset(): boolean {
  return LANDED_FROM_RESET
}

/** Take `?reset=1` out of the address bar once it has been acted on, so a refresh is an ordinary load. */
export function forgetResetMark(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('reset')) return
  url.searchParams.delete('reset')
  window.history.replaceState(window.history.state, '', url.toString())
}

/**
 * Send a password-reset email.
 *
 * ⚠️ Deliberately says nothing about whether the address exists. Answering that turns the sign-in
 * page into a way to test whether someone is a member here, which for a site whose members are
 * one person's friends and family is a real leak — "is <name> in this circle?" — not a
 * theoretical one. The caller shows the same sentence either way.
 *
 * ⚠️ THE DESTINATION IS A QUERY PARAM, AND IT HAS TO BE. This used to ask for
 * `…/#account-settings`, and it had never once worked: supabase-js runs the IMPLICIT flow (still
 * the library default), which hands back the session in the URL FRAGMENT — so the browser was
 * given `/#account-settings#access_token=…`. A URL has exactly one fragment, everything after the
 * FIRST `#`, so the library parsed `account-settings#access_token=…` and found its first key was
 * named `account-settings#access_token`. No key called `access_token` meant it did not recognise
 * the page as a callback at all: no session, no error, no message, and a route this app has never
 * heard of. A query param cannot collide with the fragment, so the tokens get it to themselves.
 *
 * ⚠️ And the address must be on the project's Redirect URLs allow-list, or GoTrue silently
 * DISCARDS it and falls back to the Site URL — which is how every link this ever sent ended up
 * pointing at `http://localhost:3000`, a dev server on the reader's own machine.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const sb = getSupabaseClient()
  const redirectTo = `${window.location.origin}${window.location.pathname}?reset=1`
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo })
  // Rate limiting and genuinely broken configuration are worth surfacing; "no such user" is not,
  // and Supabase does not report it here anyway.
  if (error) throw error
}

export function onAuthStateChange(callback: (event: string, session: Session | null) => void) {
  const sb = getSupabaseClient()
  return sb.auth.onAuthStateChange((event, session) => callback(event, session))
}
