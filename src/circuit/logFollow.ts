// What a message log does when a message arrives, as two questions that need no browser to ask.
// The component (ui/MessageLog) owns the scroll position; the decisions live here so they can be
// tested, the same split the park's physics makes for the same reason.

/** how close to the bottom still counts as "at the bottom", in pixels */
export const NEAR_BOTTOM = 48

export const atBottom = (scrollHeight: number, scrollTop: number, clientHeight: number) =>
  scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM

/**
 * Whether the log should jump to its newest message.
 *
 * A reader at the bottom follows the conversation. A reader who has scrolled up is READING, and
 * somebody else speaking must not take the page out from under them — they keep their place and
 * are told something arrived. Two things override that: your own message (you sent it to see it
 * land) and a different conversation (which always opens at its newest).
 */
export function shouldJump(s: { pinned: boolean; lastIsMine: boolean; roomChanged: boolean }) {
  return s.roomChanged || s.pinned || s.lastIsMine
}

/**
 * How many messages from other people arrived after the last one the reader has seen.
 *
 * ⚠️ BY THE ID OF THE LAST SEEN MESSAGE, NOT BY A COUNT. A count of "how many there were" goes
 * wrong the moment the list changes shape underneath it — the first read landing after a
 * realtime row, or an older page being put on the front. An id is still the same message.
 *
 * ⚠️ AND NOTHING IS NEW WHEN THE MARK IS MISSING: no mark yet, or a mark that is no longer in
 * the list (another room's). Counting everything in that case would greet every conversation
 * with a pill claiming its whole history had just arrived.
 */
export function unseenAfter(msgs: readonly { id: string; mine: boolean }[], seenId: string | null) {
  if (!seenId) return 0
  const at = msgs.findIndex((m) => m.id === seenId)
  if (at < 0) return 0
  let n = 0
  for (let i = at + 1; i < msgs.length; i++) if (!msgs[i].mine) n++
  return n
}

/** the pill's words */
export const newMessagesLabel = (n: number) => (n === 1 ? '1 new message' : `${n} new messages`)
