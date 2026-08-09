/**
 * Challenging a friend to a game of Snake.
 *
 * A challenge is just a chat message. There is no invites table, no pending-challenge state to
 * expire, and nothing to reconcile if someone never answers — the message is the invite, it
 * lives in the conversation where you'd expect to find it, and it works from a phone, a
 * notification, or a link pasted anywhere. The room link this builds is the same
 * `#snake?room=` link the room panel already offers to copy.
 *
 * The one piece of real logic is recognising a challenge on the way back in, so chat can offer
 * a Join button instead of showing a raw URL.
 */

/** Rooms are the ids the relay hands out: letters, digits, dash, underscore. */
const ROOM_RE = /#snake\?room=([A-Za-z0-9_-]+)/
/**
 * Same thing, but swallowing any scheme+host in front of it. Stripping only the fragment left
 * the bare origin sitting in the middle of the sentence ("join here http://localhost:5173/
 * now"), because a link pasted mid-message isn't at the end of a line.
 */
const LINK_RE = /(?:https?:\/\/\S*?)?#snake\?room=[A-Za-z0-9_-]+/g

export function challengeLink(roomId: string): string {
  return `${location.origin}${location.pathname}#snake?room=${encodeURIComponent(roomId)}`
}

/**
 * The text that gets posted. Deliberately plain English with the link on its own line: if it
 * ever renders as raw text — an old client, a notification preview, a copy-paste into a text
 * message — it still reads as an invitation and the link is still tappable.
 */
export function challengeMessage(roomId: string, roomLabel?: string): string {
  const where = roomLabel ? ` in “${roomLabel}”` : ''
  return `🎮 Snake challenge! Join my game${where}:\n${challengeLink(roomId)}`
}

/** The room id inside a message, or null if this isn't a challenge. */
export function challengeRoomOf(body: string): string | null {
  const m = ROOM_RE.exec(body)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

/**
 * The message with the link taken out, so the card can show the human part without repeating
 * a URL underneath it. Returns null when nothing readable is left.
 */
export function challengeText(body: string): string | null {
  const rest = body
    .replace(LINK_RE, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
  return rest.length ? rest : null
}
