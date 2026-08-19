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

/* ── beating someone's best ─────────────────────────────────────────────── */

/**
 * The OTHER kind of challenge: not "join my room now", but "beat what I already did".
 *
 * A room invite needs both of you online at the same moment. A score doesn't — it's sitting on
 * their profile whether they're around or not, which makes it the challenge a profile can
 * actually offer. Same shape as the room link so both are one glance to recognise.
 */
export function beatLink(score: number, who: string): string {
  return `${location.origin}${location.pathname}#snake?beat=${score}&by=${encodeURIComponent(who)}`
}

/** Their target from a hash, or null. `by` is a display name, so it's read loosely. */
export function beatTargetOf(hash: string): { score: number; who: string } | null {
  const s = /[?&]beat=(\d{1,9})\b/.exec(hash)
  if (!s) return null
  const w = /[?&]by=([^&]+)/.exec(hash)
  let who = 'them'
  if (w) {
    try {
      who = decodeURIComponent(w[1])
    } catch {
      who = w[1]
    }
  }
  return { score: Number(s[1]), who: who.slice(0, 40) }
}

/** What gets sent when you actually beat it. Plain English, and never automatic — see Snake. */
export function beatMessage(theirScore: number, myScore: number): string {
  return `🐍 Beat your ${theirScore} — I got ${myScore}.`
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
