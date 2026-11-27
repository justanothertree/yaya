import { sureOf } from './supabaseAnswer.mjs'

/**
 * Who owns a hosted park, and what the relay may remember of the answer.
 *
 * ⚠️ THE RELAY IS THE ONLY PLACE A HOST CAN BE ESTABLISHED, because it is the only place a
 * socket is tied to an account Supabase has verified. A client saying "I am the host" is a
 * client saying anything it likes; the room's owner is a row, and this is the only code that
 * can read the row and the socket's identity at the same time. ws-server.js asks it for every
 * `scene`, and refuses the scene unless the sender is the owner.
 *
 * ⚠️ "NOBODY OWNS IT" AND "SUPABASE DID NOT ANSWER" WERE ONE VALUE, AND THE RELAY KEPT BOTH FOR
 * EVER. The lookup sat in a try/catch, but supabase-js does not throw: a dropped network, a 500
 * or an aborted request comes back as `{ data: null, error, status: 0 }`, so the catch never ran
 * and `data?.owner ?? null` read the failure as a room with no owner. That null went into a
 * cache with no expiry, so one blip while a host was moving between maps refused every scene
 * that room's host sent until the relay restarted, silently, because a refused scene is silent
 * by design. And nothing bounded the wait: postgrest-js retries a GET with back-off, and nothing
 * gave up on it.
 *
 * So, the same rule as `sureOf` everywhere else in the relay: only an ANSWER is kept.
 *  - an owner, or a definite "no such room", is kept for good. park_rooms.id never changes hands,
 *    and a room that is not a hosted map must not cost a round trip per message;
 *  - anything else (an error, a non-2xx, a timeout, no service key) answers null now, meaning
 *    the scene is refused, and is asked again once `retryMs` has passed. It is remembered for
 *    that long, not forgotten at once, because any member in a park can send a scene, and
 *    during an outage each one would otherwise be another call to a Supabase that is already
 *    struggling: one question per room per window, whoever is asking.
 */
export const OWNER_RETRY_MS = 30_000

/**
 * The question, put to Supabase: `{ owner }` when it answered (`owner` null when there is no
 * such room), or null when it did not.
 *
 * ⚠️ THE TIMEOUT IS OURS, NOT ONLY THE LIBRARY'S. The signal cancels the request and the
 * retries' back-off inside postgrest-js, and the race makes the wait end at `timeoutMs` even
 * if some version of the client stops honouring it.
 */
export async function ownerOfRoom(sb, id, timeoutMs) {
  if (!sb) return null
  const signal = AbortSignal.timeout(timeoutMs)
  const gaveUp = new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve(null), { once: true }),
  )
  const query = sb.from('park_rooms').select('owner').eq('id', id).abortSignal(signal).maybeSingle()
  const result = await Promise.race([query, gaveUp])
  if (!result || result.error || sureOf(result.status) !== 'yes') return null
  return { owner: result.data?.owner ?? null }
}

/**
 * `hostOf(id)` → the owner's user id, or null. `ask(id)` is `ownerOfRoom` with its client and
 * timeout bound. `now` is a parameter so a test can move time without waiting thirty seconds.
 *
 * Two callers asking about one room at once share one question: during a slow answer, every
 * scene sent meanwhile would otherwise start another. Bounded by dropping the oldest entry, as
 * capMap does in ws-server.js, because a room id is whatever anybody typed into a hello.
 */
export function makeParkHosts({ ask, now = Date.now, retryMs = OWNER_RETRY_MS, max = 500 }) {
  const known = new Map() // id -> { owner, until }
  const asking = new Map() // id -> the question in flight
  const keep = (id, owner, until) => {
    known.delete(id)
    known.set(id, { owner, until })
    while (known.size > max) known.delete(known.keys().next().value)
  }
  const lookUp = async (id) => {
    let answer = null
    try {
      answer = await ask(id)
    } catch {
      answer = null
    }
    if (answer) keep(id, answer.owner ?? null, Infinity)
    else keep(id, null, now() + retryMs)
    return answer?.owner ?? null
  }
  return function hostOf(id) {
    const hit = known.get(id)
    if (hit && now() < hit.until) return Promise.resolve(hit.owner)
    const pending = asking.get(id)
    if (pending) return pending
    /* .finally runs after the set below, even when ask fails at once */
    const question = lookUp(id).finally(() => asking.delete(id))
    asking.set(id, question)
    return question
  }
}
