/**
 * A link into Chronicle's Day log on one particular day: `#chronicle?day=2026-11-06`.
 *
 * ⚠️ IT EXISTS BECAUSE THE CIRCUIT SENDS PEOPLE HERE. A cell that holds sessions says "15 from
 * Chronicle sessions · change them there", and a total typed below them is refused with "lower them
 * in Chronicle, in that day's log" (OPEN-DECISIONS §19g: "a discoverable way to correct the
 * underlying sessions"). The link used to be plain `#chronicle`, which opens the room on today with
 * its aims showing — so the way to correct Thursday was a link to Sunday, and the rest of the route
 * was left for somebody to work out.
 */
export const dayHref = (day: string): string => `#chronicle?day=${day}`

/**
 * The day a `#chronicle?day=` link asks for, or null.
 *
 * ⚠️ ONLY A DATE THAT EXISTS. A hash is typed, pasted and kept in history, and `2026-02-30` would
 * otherwise reach a stepper that adds and subtracts days from it; JavaScript would quietly roll it
 * over to the 2nd of March and the room would show a day nobody asked for.
 */
export function dayAsked(hash: string): string | null {
  const raw = (hash || '').replace(/^#/, '')
  const [base, query] = raw.split('?')
  if (base !== 'chronicle') return null
  const day = new URLSearchParams(query ?? '').get('day')
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const [y, m, d] = day.split('-').map(Number)
  const at = new Date(y, m - 1, d, 12)
  return at.getFullYear() === y && at.getMonth() === m - 1 && at.getDate() === d ? day : null
}
