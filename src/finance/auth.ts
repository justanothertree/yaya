import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient } from './client'

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

export function onAuthStateChange(callback: (event: string, session: Session | null) => void) {
  const sb = getSupabaseClient()
  return sb.auth.onAuthStateChange((event, session) => callback(event, session))
}
