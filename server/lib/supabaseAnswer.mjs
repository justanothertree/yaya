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

/**
 * How long Supabase's 'yes' about an access token may be kept: `ttl`, or until the token's own
 * `exp` if that comes sooner — never negative, so 0 is "do not keep it".
 *
 * ⚠️ A CACHE THAT OUTLIVES THE TOKEN IS A TOKEN NOBODY ELSE BELIEVES. The relay kept every yes for
 * a minute, so a token said yes to in its last minute was believed here after it had expired, and
 * every question asked with it afterwards was a 401 that the relay paid a round trip to hear.
 *
 * ⚠️ READ, NEVER BELIEVED. The payload is not verified here — Supabase verified the token, and is
 * asked again once this lapses — so what it says can only make the relay forget SOONER: a token
 * claiming to live for ever is kept `ttl`, as every token was, and one with no `exp` that reads as
 * a number (no payload, not JSON, not a JWT at all) is kept `ttl` too.
 */
export function keepYes(token, now, ttl) {
  const exp = expOf(token)
  return exp === null ? ttl : Math.max(0, Math.min(ttl, exp * 1000 - now))
}

/** A JWT's `exp`, in seconds, if it has one that is a finite number; otherwise null. */
function expOf(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const exp = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null
  } catch {
    return null
  }
}
