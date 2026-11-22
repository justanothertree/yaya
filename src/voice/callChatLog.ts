import type { Msg } from '../circuit/chatRooms'

/**
 * The decisions a call's loose chat makes, with no store and no browser around them.
 *
 * ⚠️ THEY LIVE HERE SO THEY CAN BE ASKED A QUESTION. `callChatStore.ts` is a module-level
 * singleton that wires itself to `voiceSession` on first subscribe and hands its state out
 * through `useSyncExternalStore` — so every rule inside it (what counts as a chat line, how many
 * are kept, when they are thrown away) was reachable only by rendering a React hook, and this
 * repository has no DOM in its test environment. Moved out, each one is a function with an
 * answer. Same move as `src/finance/designation.ts` and `supabase/functions/pictures/verdict.ts`.
 */

/** the room_id every message here carries — there is no room, but MessageLog keys a thread on one */
export const ROOM = 'call'

/** the most text one line may carry onto the wire or off it */
export const MAX_TEXT = 2000

/** how many lines are kept; a long call's chat should not grow without end in a tab's memory */
export const KEEP = 300

/**
 * What a chat line has to be before it is believed.
 *
 * ⚠️ EVERYTHING HERE WAS PUT ON THE WIRE BY ANOTHER MEMBER'S BROWSER, and the client that put it
 * there is one anybody can rewrite. `voice:<room>` is gated server-side, so the audience is by
 * construction the audience that can already hear you — but "allowed to speak" is not "sent what
 * I expected". Take a string, bound it, and let the renderer treat it as text.
 */
export function readChatText(m: { kind?: unknown; body?: unknown } | null): string | null {
  if (!m || m.kind !== 'chat') return null
  const text = (m.body as { text?: unknown } | null)?.text
  if (typeof text !== 'string') return null
  const body = text.trim()
  return body ? body.slice(0, MAX_TEXT) : null
}

/** A sender's display name, bounded, never trusted as an identity. */
export function readChatName(name: unknown): string {
  return String(name ?? '').slice(0, 40) || 'Someone'
}

/** Append one line, keeping at most `keep`. The oldest go first. */
export function appendCapped(msgs: Msg[], m: Msg, keep: number = KEEP): Msg[] {
  return [...msgs, m].slice(-keep)
}

/**
 * Whether the call has changed under us — a different call, or none, is a different (empty) chat.
 * Returns the room to remember, and whether what is held should be dropped.
 */
export function roomChange(
  prev: string | null,
  next: string | null,
  held: number,
): { changed: boolean; clear: boolean } {
  const changed = prev !== next
  return { changed, clear: changed && held > 0 }
}

/**
 * How fast one sender's lines are taken, and nothing about anyone else's.
 *
 * ⚠️ IT DROPS RATHER THAN COALESCES, WHICH IS THE ONE DELIBERATE DIFFERENCE FROM `nudge.ts`.
 * `coalesce` there keeps the LATEST value and runs it when the gap is up, which is exactly right
 * for a nudge: every nudge means the same thing ("look again"), so the last one stands for all of
 * them. Two chat lines are two different sentences. Merging them would silently publish the
 * second and swallow the first, and delaying them would reorder a conversation against the voices
 * saying the same words aloud. So a line over the rate is refused outright and the burst below is
 * sized so an ordinary exchange never meets it.
 *
 * ⚠️ AND NOTHING ELSE LIMITS THIS. The channel's policy says only WHO may speak on a call's topic;
 * it has no opinion on how often. Every line heard is a `push` and a render of the panel, so a
 * page that hears a thousand renders a thousand. The cap in `KEEP` bounds the MEMORY and does
 * nothing about the churn.
 *
 * A bucket per sender: `burst` lines at once, refilling one per `refillMs`. Five and a second
 * means a normal flurry of typing goes straight through and a flood costs one line a second.
 */
export const CHAT_BURST = 5
export const CHAT_REFILL_MS = 1000

/** the most senders tracked at once, so a stream of invented ids cannot grow this without end */
export const CHAT_SENDERS = 64

export type Clock = { now: () => number }

export function senderGate(
  {
    burst = CHAT_BURST,
    refillMs = CHAT_REFILL_MS,
    senders = CHAT_SENDERS,
  }: { burst?: number; refillMs?: number; senders?: number } = {},
  clock: Clock = { now: () => Date.now() },
) {
  const buckets = new Map<string, { tokens: number; at: number }>()
  return {
    /** true if this line is taken; false if the sender is over their rate */
    allow(from: string): boolean {
      const now = clock.now()
      const b = buckets.get(from)
      /* fractional tokens on purpose: whole-number refill stalls a sender whose gaps are each
         just under refillMs, which is ordinary typing rather than a flood */
      const tokens = b ? Math.min(burst, b.tokens + (now - b.at) / refillMs) : burst
      const ok = tokens >= 1
      buckets.delete(from)
      buckets.set(from, { tokens: ok ? tokens - 1 : tokens, at: now })
      /* Map keeps insertion order, and the delete/set above moves a live sender to the end — so
         the first key is the least recently heard from, which is the one to forget */
      while (buckets.size > senders) {
        const oldest = buckets.keys().next().value
        if (oldest === undefined) break
        buckets.delete(oldest)
      }
      return ok
    },
    /** for tests and for anyone wondering whether this leaks */
    size: () => buckets.size,
    forget: () => buckets.clear(),
  }
}

/**
 * How many of these you have not seen, given how many you had.
 *
 * ⚠️ YOUR OWN LINES NEVER COUNT. The badge exists to say somebody spoke to you.
 */
export function unseenOf(msgs: Msg[], seen: number | null): number {
  if (seen === null) return 0
  return msgs.slice(seen).filter((m) => !m.mine).length
}

/**
 * The mark to move to, or null to leave it where it is.
 *
 * ⚠️ `null` UNTIL THE FIRST READ LANDS, which is the difference between "three new messages" and
 * "the fifty that were already in this room before you rang" — a count that starts at the room's
 * whole history is a badge that is wrong from the first second of every call. And a list that has
 * got SHORTER is a different list (the call ended, or moved), so the mark follows it down rather
 * than leaving `slice` reading past the end.
 */
export function nextSeen(a: {
  ready: boolean
  open: boolean
  length: number
  seen: number | null
}): number | null {
  if (!a.ready) return null
  if (a.seen === null || a.open || a.length < a.seen) return a.length
  return null
}
