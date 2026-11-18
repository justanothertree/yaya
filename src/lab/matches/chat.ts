/**
 * Chat for a match, by turns or live in a call: the rules of a line, the same in both.
 *
 * By turns, lines are kept with the match (docs/2026-11-18-lab-match-chat.DRAFT.sql) and the
 * server is the judge: lab_match_say refuses anything this would, and more (twenty a minute, five
 * hundred a match, a declined challenge). Live in a call, nothing is kept: a line travels on the
 * call's own channel like every other live message and is gone when the page is, as the snake
 * games' chat is. Either way only the match's two players see the chat or can write in it.
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

/**
 * Live in a call, a line is `{ sub, text }` as the party's `labchat` kind: the toy it belongs to
 * and what was said. Anything else, or a line for another toy, is not one.
 */
export type LiveLine = { sub: string; text: string }
export function readLiveLine(x: unknown, sub: string): string | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || Object.keys(o).sort().join() !== 'sub,text') return null
  if (o.sub !== sub || typeof o.text !== 'string') return null
  return cleanLine(o.text) === o.text ? o.text : null
}

/**
 * A live line is kept off the call's channel when the sender has said this many in the window
 * before: the relay's own limit for the snake games' chat (server/ws-server.js, CHAT_BURST and
 * CHAT_WINDOW_MS), so the two chats feel the same. By turns the server keeps its own count.
 */
export const LIVE_BURST = 5
export const LIVE_WINDOW_MS = 4000
/** whether one more line may go now, given when the last ones went; and the times to keep */
export function mayTalk(times: number[], now: number): { ok: boolean; times: number[] } {
  const recent = times.filter((t) => now - t < LIVE_WINDOW_MS)
  if (recent.length >= LIVE_BURST) return { ok: false, times: recent }
  return { ok: true, times: [...recent, now] }
}
