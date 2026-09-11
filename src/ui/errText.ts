/**
 * Whatever went wrong, as something a person can read.
 *
 * ⚠️ `e instanceof Error ? e.message : String(e)` IS THE BUG THIS REPLACES, and it looks correct
 * until you meet the errors this app actually throws. Supabase hands back plain objects —
 * `{ message, details, hint, code }` — which are not Error instances, so the check falls through
 * to String(e) and the screen says **[object Object]**. Seen live on the Investments page, in red,
 * where the words were supposed to explain why a portfolio would not load.
 *
 * ⚠️ It reads `.message` off anything that has one rather than testing the class, because the
 * class is the part that varies: an Error, a Supabase error, a fetch failure and a thrown literal
 * all reach a catch block here, and only one of them is an Error.
 *
 * ⚠️ Never returns an empty string. A blank red line is worse than a clumsy one — it reads as a
 * rendering fault rather than as something that went wrong, and there is nothing to tell anybody.
 */
export function errText(e: unknown, fallback = 'Something went wrong.'): string {
  if (!e) return fallback
  if (typeof e === 'string') return e.trim() || fallback
  const msg = (e as { message?: unknown }).message
  if (typeof msg === 'string' && msg.trim()) return msg
  /* a shape with no message at all: say so plainly rather than printing its type name */
  return fallback
}
