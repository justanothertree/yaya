/**
 * The Lab tour: friends on the same call seeing each other on the Lab's toys, the way players see
 * each other on a board. Pure, so tour.test.ts can ask it without a call or a page —
 * docs/2026-11-22-lab-tour.md has the plan, and why none of it adds a message to the wire.
 */

/**
 * "with Ann", "with Ann and Bo", "with Ann, Bo and Cy", "with Ann, Bo and 2 more" — who is on your
 * toy, said in the line above it, so a phone player scrolled down to the stage can see who is
 * there without scrolling back up to the picker. Empty for nobody: a line that says "with nobody"
 * only states what the screen already does.
 */
export function withWords(names: readonly string[]): string {
  const n = names.length
  if (n === 0) return ''
  if (n === 1) return `with ${names[0]}`
  if (n <= 3) return `with ${names.slice(0, -1).join(', ')} and ${names[n - 1]}`
  return `with ${names[0]}, ${names[1]} and ${n - 2} more`
}
