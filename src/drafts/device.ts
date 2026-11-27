import { peekPersistedUserId } from '../finance/auth'
import { idbBackend, makeDrafts } from './drafts'

/**
 * This device's drafts, for whoever is signed in at the moment of each call.
 *
 * ⚠️ peekPersistedUserId, NOT A HOOK, because the answer has to be right at the instant of a
 * write — a draft written a beat after somebody signs out must land in the signed-out row, not
 * in the account that just left. It reads the session Supabase keeps in localStorage, which the
 * sign-in and sign-out themselves rewrite.
 *
 * Kept apart from drafts.ts so the tests there never import the auth client.
 */
export const drafts = makeDrafts(idbBackend(), peekPersistedUserId)
