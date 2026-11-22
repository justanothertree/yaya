/**
 * Chat for a match by turns: the rules of a line.
 *
 * Lines are kept with the match (docs/2026-11-18-lab-match-chat.DRAFT.sql) and the server is the
 * judge: lab_match_say refuses anything this would, and more, in a sentence the player is shown as
 * it stands (errors.ts passes it on). Per match, from each seat: "slow down: twenty lines a minute
 * is the most", and at five hundred lines "this match's chat is full". Per member, across every
 * match they play — from whichever seat, and counting the lines in declined ones: "slow down:
 * thirty lines a minute across your matches is the most" and "five hundred lines a day across your
 * matches is the most", the day a rolling 24 hours. And "this challenge was declined", "this
 * account cannot chat". Only the match's two players see the chat or can write in it.
 *
 * A live game in a call has no chat of its own: it uses the call's (src/voice/CallChat.tsx, opened
 * from the dock or from the table's "Call chat" button), which is not limited to the two players —
 * everybody in the call reads it, and a DM or circuit call keeps it in that conversation.
 *
 * Pure, so chat.test.ts can ask it things without a page.
 */
export const LINE_MAX = 300

/** a line as somebody typed it, made ready to send: trimmed, one line, 1–300 characters; else null */
export function cleanLine(text: string): string | null {
  const t = text.trim()
  // eslint-disable-next-line no-control-regex
  if (!t || t.length > LINE_MAX || /[\u0000-\u001f\u007f]/.test(t)) return null
  return t
}

/** one line of a match's chat, as the page shows it */
export type ChatLine = { id: number; seat: 0 | 1; body: string; mine: boolean; at: string }

/** a line as lab_match_say and lab_match_lines answer it, or null for anything else */
export function readLine(x: unknown): ChatLine | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const { id, seat, body, mine, at } = o
  if (!Number.isInteger(id) || (id as number) < 1) return null
  if (seat !== 0 && seat !== 1) return null
  if (typeof body !== 'string' || cleanLine(body) !== body) return null
  if (typeof mine !== 'boolean' || typeof at !== 'string') return null
  return { id: id as number, seat, body, mine, at }
}

/** the lines held so far and the ones just read, as one list in order, once each, the last `keep` */
export function mergeLines(held: ChatLine[], more: ChatLine[], keep = 100): ChatLine[] {
  const byId = new Map<number, ChatLine>()
  for (const l of [...held, ...more]) byId.set(l.id, l)
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-keep)
}
