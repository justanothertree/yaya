import { sureOf } from './supabaseAnswer.mjs'

/**
 * The relay's `auth` frame: what Supabase's answers mean, and when to ask again.
 *
 * ⚠️ ONE FRAME, AND ITS FIRST ANSWER WAS ITS ONLY ONE. The client sends `auth` once per socket
 * (src/game/net.ts) and nothing ever sends it again, so a single 503 or timeout while the relay
 * checked it read as "not signed in" for the whole life of the socket: a Snake round under a
 * claimed handle went uncredited, and a member in a park or a bout was never let in and was told
 * at PARK_VOUCH_MS that the room is for people with an account. The relay already knew the
 * difference — tokenAnswer and standingAnswer say 'unsure' for exactly this — and then read
 * 'unsure' as a refusal anyway, because every caller asked only "a user, or null?".
 *
 * So the decisions live here, where server/lib/signIn.test.mjs can ask them, and ws-server.js
 * only does what they say. The rule is the one parkHost.mjs keeps (#471): only a real answer is
 * believed. A definite no — a refused token, a suspended account — is final, as it always was. A
 * doubt is asked again, a few times, with the waits growing, inside the same window the park
 * already gives a socket to prove itself; and it is never a yes.
 */

/**
 * `is_suspended`'s answer for the account the token belongs to: 'yes' when it is in good
 * standing, 'no' when it is suspended (or Supabase refused the token), 'unsure' otherwise.
 *
 * ⚠️ A 2xx IS NOT AN ANSWER UNLESS IT SAYS SOMETHING. This was `body === true ? 'no' : 'yes'`,
 * which made every 2xx that was not `true` good standing — and `is_suspended` answers NULL when
 * the caller asks about somebody else and is not an admin (migration 20261030134148). The relay
 * always asks about the token's own account, so that NULL should never arrive; if it does, the
 * question was not answered, and the one door here that failed OPEN would have let them in. Only
 * a boolean is an answer. Anything else is 'unsure': retried, never cached, never a yes.
 */
export function standingOf(status, body) {
  const sure = sureOf(status)
  if (sure !== 'yes') return sure
  if (body === false) return 'yes'
  if (body === true) return 'no'
  return 'unsure'
}

/**
 * What one attempt at signing in comes to, from the token's answer and — in a park or a bout,
 * which carry drawings onto other people's screens — the account's standing:
 *
 *   'signed-in' — Snake: the token is good, and that is all Snake needs to credit a handle
 *   'vouched'   — a park or a bout: a good token AND a good standing; this is being let in
 *   'refused'   — a definite no: the token was refused, or the account is suspended. Final.
 *   'retry'     — anything Supabase did not answer. Asked again (nextTry), never let in on.
 *
 * ⚠️ ONLY 'no' IS A REFUSAL, and only 'yes' is a yes. Anything else — 'unsure', or a standing
 * that was never asked because something before it failed — is a question still open.
 */
export function signInStep({ token, standing, needsStanding }) {
  if (token === 'no') return 'refused'
  if (token !== 'yes') return 'retry'
  if (!needsStanding) return 'signed-in'
  if (standing === 'yes') return 'vouched'
  if (standing === 'no') return 'refused'
  return 'retry'
}

/**
 * The waits before the second, third and fourth attempts.
 *
 * ⚠️ GROWING, AND FEW. A blip is a second or two, and these ride one out; an outage is not a
 * blip, and every socket that joins during one is asking — so the waits back off and run out
 * rather than adding a steady stream of calls to a Supabase that is already struggling. At most
 * four attempts per auth frame, each one of them bounded by OUTBOUND_TIMEOUT_MS, and the frame's
 * own allowance (one in flight, five a minute) is held for all of them.
 */
export const SIGN_IN_RETRY_MS = Object.freeze([1000, 2000, 4000])

/**
 * How long to wait before attempt `attempt + 1`, or null to stop asking. `startedAt` is when the
 * auth frame arrived, `now` is when attempt `attempt` came back, and `windowMs` is how long a
 * sign-in may take (PARK_VOUCH_MS).
 *
 * ⚠️ NO ATTEMPT STARTS AFTER THE WINDOW HAS CLOSED. In a park that is when the socket is told it
 * has not proved itself, and an answer that lands after it is not wasted — the roster still
 * clears the message — but asking past it would turn a bounded wait into an open-ended one. A
 * first attempt that hangs for the whole OUTBOUND_TIMEOUT_MS still leaves room for a second.
 */
export function nextTry(attempt, startedAt, now, windowMs, waits = SIGN_IN_RETRY_MS) {
  const wait = waits[attempt - 1]
  if (wait === undefined) return null
  if (now + wait - startedAt >= windowMs) return null
  return wait
}
