/**
 * A result attached to a Lab comment as a "Recorded" card: the words are the person's own, and
 * the result is what the toy kept in their browser (bests.ts reads it), never typed.
 *
 * ⚠️ IT LIVES IN THE COMMENT'S TEXT, AS ITS LAST LINE, because a comment is text and nothing else
 * (lab_comments has no other column, and this was built with no SQL — Evan, 14 Nov). The line is
 * `⟦recorded <toy>⟧ <result>`; this page draws it as a card, and anything older simply shows the
 * line. The server's own rules still hold: 500 characters, nine lines, plain text.
 *
 * ⚠️ "RECORDED" IS NOT "CHECKED". The card says the game recorded it on the player's device —
 * which a determined person could edit — and nothing more. A checked card (the server replaying
 * the run, docs/2026-11-13-lab-social-plan.md steps 9–11) is a different, later thing. What this
 * does guarantee is that the page's own compose box cannot be used to type one: scrub() defuses
 * the marker in anything typed, so only the Share button attaches a card.
 */
export type Card = { toy: string; line: string }

const OPEN = '⟦recorded '
const LINE_MAX = 160
const TOY = /^[a-z0-9][a-z0-9-]{0,39}$/
/** the comment's limits, as the server keeps them (feedback.ts) */
const MAX = 500
const MAX_BREAKS = 8

/** the marker made harmless in typed text: the bracket becomes an ordinary one */
export const scrub = (text: string) => text.replaceAll('⟦', '[')

/** the comment to send: the person's words, trimmed to leave room, then the card as the last line */
export function attach(text: string, card: Card | null): string {
  const words = text.replace(/\r\n?/g, '\n').trim()
  if (!card) return words
  const tail = `${OPEN}${card.toy}⟧ ${card.line.slice(0, LINE_MAX)}`
  // room for the card: characters and lines both, so the server never refuses the whole comment
  const room = MAX - tail.length - 1
  let kept = words.slice(0, Math.max(0, room)).trim()
  const lines = kept.split('\n')
  if (lines.length > MAX_BREAKS) kept = lines.slice(0, MAX_BREAKS).join('\n').trim()
  return kept ? `${kept}\n${tail}` : tail
}

/** a comment as text and, if its last line is a card for this toy, the card */
export function split(body: string, toy: string): { text: string; card: Card | null } {
  const at = body.lastIndexOf('\n')
  const last = body.slice(at + 1)
  const m = /^⟦recorded ([^⟧]{1,40})⟧ (.+)$/u.exec(last)
  if (!m || m[1] !== toy || !TOY.test(m[1]) || m[2].length > LINE_MAX || !m[2].trim())
    return { text: body, card: null }
  return { text: at < 0 ? '' : body.slice(0, at).trim(), card: { toy: m[1], line: m[2] } }
}
