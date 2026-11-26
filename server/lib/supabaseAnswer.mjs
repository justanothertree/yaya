/**
 * Whether Supabase ANSWERED, as distinct from what it answered.
 *
 * ⚠️ "NO" AND "COULD NOT ASK" WERE ONE VALUE, AND THE RELAY CACHED BOTH. `verifyToken` treated
 * every non-2xx the same way — `if (!r.ok)` — and kept the refusal for a minute. That was right
 * for the case it was written for (an expired token from a tab left open overnight cannot become
 * valid by asking again) and wrong for a 503: a Supabase blip of one second locked every member
 * who happened to join during it out of the park for sixty, with nothing on either side to say
 * the refusal was about Supabase rather than about them.
 *
 * ⚠️ AND IT MATTERS MORE FOR WHAT COMES NEXT. A friends-only door that cannot tell "these two are
 * not friends" from "the database did not answer" will one day tell two friends they are not
 * friends. So the decision lives here, by itself, where a test can ask it about every case:
 *
 *   'yes'    — a 2xx: Supabase answered, and the body is the answer (read it)
 *   'no'     — a 401 or 403: a definite refusal of THIS request
 *   'unsure' — everything else: a 5xx, a 429, any other status, a network error, a timeout
 *              (`AbortSignal.timeout` rejects with a TimeoutError), or nothing to ask with
 *              (no config — pass null)
 *
 * Only 'yes' and 'no' may be cached. 'unsure' is the one answer that asking again can change.
 *
 * ⚠️ 'no' IS NARROW ON PURPOSE. A 404 from an RPC is a function that is not deployed and a 400 is
 * a request this relay built wrongly; neither is a fact about the person, so neither may be told
 * to them as one. Both fail closed — nobody is let in on 'unsure' — they are just not remembered.
 */
export function sureOf(statusOrError) {
  if (typeof statusOrError !== 'number') return 'unsure'
  if (statusOrError >= 200 && statusOrError < 300) return 'yes'
  if (statusOrError === 401 || statusOrError === 403) return 'no'
  return 'unsure'
}
