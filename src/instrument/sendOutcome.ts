import { sendSong, songTitle } from '../circuit/chatSongs'

/**
 * How the last 💬 Send in a chat went, kept outside every component that shows it.
 *
 * ⚠️ A SEND OUTLIVES THE PICKER THAT STARTED IT. An upload is seconds long, and in those seconds
 * the picker can be toggled shut and open again (which reset its line), a new export can replace
 * the one being sent (which unmounts the picker), or 📁 Songs can close or the room be left (which
 * unmounts the export row). The send carries on regardless and adds its message to the chat —
 * but its outcome was component state, so "Sent" or the server's refusal landed on nothing, and
 * the person was left with "Sending…" or a blank line and no way to know. So the outcome lives
 * here, where whatever mounts next reads it.
 *
 * ⚠️ ONE AT A TIME, ACROSS EXPORTS: a second send waits for the first to land. The claim takes one
 * lock per account anyway, and one line can only tell one story.
 *
 * ⚠️ AND A SETTLED OUTCOME IS FORGOTTEN ONLY BY A NEWER SEND OR A NEW EXPORT, never by the picker
 * opening: reopening is how somebody comes back to read it. One still in flight is kept even
 * through a new export, because its answer is still news when it lands.
 */
export type SendOutcome = {
  /** the export it was a send of */
  of: Blob
  state: 'sending' | 'sent' | 'failed'
  text: string
  /** the chat it went to, once it has gone — the line links to it */
  room?: { id: string; name: string }
}

let now: SendOutcome | null = null
const listeners = new Set<() => void>()

function put(next: SendOutcome | null) {
  now = next
  for (const fn of listeners) fn()
}

export const sendOutcome = () => now

export function subscribeSendOutcome(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Send an export into a chat, keeping how it went here. Resolves true when it went, and false when
 * it did not — or when another send was already going, in which case nothing was started.
 *
 * @param seconds the file's length, measured once the line already says "Sending…" (decoding a
 *   recording to measure it is not instant)
 */
export async function sendToChat(
  of: Blob,
  room: { id: string; name: string },
  name: string,
  seconds: () => Promise<number>,
): Promise<boolean> {
  if (now?.state === 'sending') return false
  put({ of, state: 'sending', text: 'Sending…' })
  try {
    const r = await sendSong(room.id, of, name, await seconds())
    if ('why' in r) {
      put({ of, state: 'failed', text: r.why })
      return false
    }
    put({ of, state: 'sent', text: `Sent “${songTitle(name)}” to ${room.name}.`, room })
    return true
  } catch {
    put({ of, state: 'failed', text: 'That song didn’t send.' })
    return false
  }
}

/** A new export was made: a settled outcome is old news now. One still sending is not. */
export function newExport() {
  if (now && now.state !== 'sending') put(null)
}
