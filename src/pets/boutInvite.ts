/**
 * Inviting somebody to a scrap by message.
 *
 * ⚠️ THE MESSAGE IS THE INVITE, which is the bargain Snake's challenge and the circuit's join link
 * already make — see src/game/challenge.ts. No invites table, nothing to expire, and nothing to
 * reconcile if it is never answered. It lives in the conversation where you would look for it, it
 * survives a notification preview, and it works from a phone.
 *
 * ⚠️ THE SAME CODE YOU WOULD HAVE PASTED YOURSELF. The link carries the bout code the room already
 * offers to copy, so this adds no second way into a fight — it wraps the existing one in something
 * tappable. Asked for directly: he has this for Snake and wanted it for a scrap.
 *
 * ⚠️ AND NO NETWORK IN HERE, deliberately. boutRoom.ts owns the socket and pulls in the whole relay
 * client; chat has to recognise one of these to draw the Join card, and a chat window has no
 * business loading a game's netcode to do it. So the two link functions live here, where the only
 * thing they depend on is the current URL.
 */

/** Bout codes are made by boutCode(): lowercase letters and digits, no vowels. */
const CODE_RE = /#games\?play=fight&bout=([A-Za-z0-9]+)/
/**
 * Same thing, but swallowing any scheme and host in front of it, so taking the link out of a
 * sentence does not leave a bare origin sitting in the middle of it.
 */
const LINK_RE = /(?:https?:\/\/\S*?)?#games\?play=fight&bout=[A-Za-z0-9]+/g

export const boutLink = (code: string): string =>
  `${location.origin}${location.pathname}#games?play=fight&bout=${encodeURIComponent(code)}`

/** The bout a hash is asking for, or null. */
export function boutFromHash(hash: string): string | null {
  const q = new URLSearchParams(hash.split('?')[1] ?? '')
  const code = (q.get('bout') ?? '').trim().toLowerCase()
  return /^[a-z0-9]{4,16}$/.test(code) ? code : null
}

/**
 * What gets posted.
 *
 * ⚠️ PLAIN ENGLISH WITH THE LINK ON ITS OWN LINE, the same as the other two. If it ever renders as
 * raw text — an older client, a notification, a copy into a text message — it still reads as an
 * invitation and the link is still tappable.
 */
export function boutMessage(code: string): string {
  return `⚔️ Scrap! Bring a minion and fight me:\n${boutLink(code)}`
}

/** The bout code inside a message, or null if this is not an invite to one. */
export function boutCodeOf(body: string): string | null {
  const m = CODE_RE.exec(body)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

/**
 * The message with the link taken out, so a card can show the human part without repeating a URL
 * underneath it. Null when nothing readable is left.
 */
export function boutInviteText(body: string): string | null {
  const rest = body
    .replace(LINK_RE, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
  return rest.length ? rest : null
}
