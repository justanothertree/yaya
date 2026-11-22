import type { MatchView } from './cloud'
import { toyName } from './names'

/**
 * What a match says, in words: its status line, its row in Your games, and its bell entry. Pure,
 * so words.test.ts can ask every state a match can be in without a server or a browser.
 */

/** the match's own address: it opens straight into the match, for its two players only */
export const matchHash = (demo: string, id: string) =>
  `#lab?${new URLSearchParams({ demo, match: id })}`

/** the other player's name, as the server gave it */
export const otherName = (v: MatchView) => v.seats[v.you === 0 ? 1 : 0].name ?? 'your friend'

/** does this match wait on the viewer: their move, or a challenge to answer */
export const waitsOnYou = (v: MatchView) =>
  (v.status === 'active' && v.turn === v.you) || (v.status === 'invited' && v.you === 1)

/** how long ago, the way a list says it: "5 min", "3 h", "Tue", "12 Nov" */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const min = Math.max(0, Math.round((now - t) / 60000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min`
  if (min < 60 * 24) return `${Math.round(min / 60)} h`
  const d = new Date(t)
  if (now - t < 6 * 24 * 3600 * 1000) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** who won, from the viewer's side of the board */
export function resultWords(v: MatchView): string {
  const r = v.result
  if (!r) return ''
  const score = r.score ? `, ${r.score}` : ''
  const them = otherName(v)
  if (r.winner === 'draw') return `A draw${score}.`
  if (v.mode === 'together')
    return r.winner === 0
      ? `🏆 You and ${them} beat the computer${score}.`
      : r.how === 'resigned'
        ? `Resigned. The computer wins${score}.`
        : `The computer wins${score}.`
  const won = r.winner === v.you
  if (r.how === 'resigned')
    return won ? `🏆 ${them} resigned. You win.` : `You resigned. ${them} wins.`
  if (r.how === 'timeout')
    return won
      ? `🏆 You claimed the win: ${them} didn’t move for 7 days.`
      : `${them} claimed the win.`
  return won ? `🏆 You win${score}!` : `${them} wins${score}.`
}

/** the match's status line, for the match itself */
export function matchLine(v: MatchView, pending = false): string {
  const them = otherName(v)
  switch (v.status) {
    case 'invited':
      return v.you === 1
        ? `${them} challenged you to ${toyName(v.demo)}${v.mode === 'together' ? ', the two of you against the computer' : ''}.`
        : `Waiting for ${them} to accept your challenge.`
    case 'expired':
      return 'This challenge expired before it was accepted.'
    case 'declined':
      return v.you === 1 ? 'You declined this challenge.' : `${them} declined.`
    case 'ended':
      return 'This match ended.'
    case 'finished':
      return resultWords(v)
    case 'active':
      if (v.turn === v.you)
        return pending
          ? 'Send your move, or undo it and choose again.'
          : v.mode === 'together'
            ? 'Your turn to move for the two of you.'
            : 'Your move.'
      if (v.canClaim)
        return `${them} hasn’t moved in 7 days. You can claim the win, or keep waiting.`
      return `${them}’s move${v.turnSince ? ` · since ${ago(v.turnSince)}` : ''}.`
  }
}

/** one row of Your games */
export function rowWords(v: MatchView): { title: string; state: string; urgent: boolean } {
  const them = otherName(v)
  const title = `${toyName(v.demo)} with ${them}`
  const urgent = waitsOnYou(v)
  const state =
    v.status === 'invited'
      ? v.you === 1
        ? `${them} challenged you`
        : 'Waiting to be accepted'
      : v.status === 'active'
        ? v.turn === v.you
          ? `Your move · ${ago(v.turnSince)}`
          : `${them}’s move · ${ago(v.turnSince)}`
        : v.status === 'finished'
          ? resultWords(v).replace(/^🏆 /, '')
          : v.status === 'expired'
            ? 'Expired'
            : v.status === 'declined'
              ? 'Declined'
              : 'Ended'
  return { title, state, urgent }
}

/** the bell's entry for a match, or null if it does not wait on you */
export function noticeText(v: MatchView): string | null {
  if (!waitsOnYou(v)) return null
  const them = otherName(v)
  return v.status === 'invited'
    ? `${them} challenged you to ${toyName(v.demo)}`
    : `Your move in ${toyName(v.demo)} with ${them}`
}
