import type { VoicePeer } from './voiceSession'

/**
 * How a call describes itself, in plain words, in one place so the in-chat bar and the
 * floating dock can never disagree.
 *
 * The rule: never let a failure look like an absence. "Waiting for someone to join" and
 * "we tried to reach Josh and his network blocked it" are completely different situations
 * and used to render identically, which is the worst possible outcome for someone who
 * isn't going to open a console to find out why they can't hear anyone.
 */

export function peerWord(p: VoicePeer): string {
  switch (p.status) {
    case 'connecting':
      return `${p.name} — connecting…`
    case 'reconnecting':
      return `${p.name} — reconnecting…`
    case 'failed':
      return `${p.name} — couldn’t connect`
    default:
      return p.name
  }
}

/** One line summarising the whole call, for the dock and the bar. */
export function callWord(peers: VoicePeer[]): string {
  if (peers.length === 0) return 'Waiting for someone to join…'
  const live = peers.filter((p) => p.status === 'connected')
  const trying = peers.filter((p) => p.status === 'connecting' || p.status === 'reconnecting')
  const failed = peers.filter((p) => p.status === 'failed')

  // A failure must never hide behind someone else's success. If Josh is connected and Cam
  // couldn't get in, "Josh" alone is a lie by omission — you'd sit there wondering where
  // Cam went. Failures are always named, whoever else is working.
  const failedNote = failed.length ? `${failed.map((p) => p.name).join(', ')} couldn’t connect` : ''

  if (live.length) {
    const parts = [live.map((p) => p.name).join(', ')]
    if (trying.length) parts.push(`${trying.length} connecting`)
    if (failedNote) parts.push(failedNote)
    return parts.join(' · ')
  }
  if (trying.length) {
    // Distinguish "never connected" from "was fine a second ago" — the second is far less
    // alarming and usually fixes itself.
    const back = trying.every((p) => p.status === 'reconnecting')
    const verb = back ? 'Reconnecting to' : 'Connecting to'
    const rest = failedNote ? ` · ${failedNote}` : ''
    return `${verb} ${trying.map((p) => p.name).join(', ')}…${rest}`
  }
  if (failed.length) return `Couldn’t connect to ${failed.map((p) => p.name).join(', ')}`
  return 'Waiting for someone to join…'
}

/**
 * Shown only when everyone we tried has failed. Says what to do rather than what broke —
 * the cause is almost always a network that can't do peer-to-peer, which is not something
 * the person on the other end can be expected to diagnose.
 */
export function callHelp(peers: VoicePeer[]): string | null {
  if (!peers.length) return null
  const allFailed = peers.every((p) => p.status === 'failed')
  if (!allFailed) return null
  return 'Some networks block direct calls. Try wifi instead of mobile data, or text instead.'
}
