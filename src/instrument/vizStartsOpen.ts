/**
 * Whether the room's visuals start open: what somebody chose, if they ever chose, and otherwise
 * open on a bigger screen and closed on a phone.
 *
 * ⚠️ CLOSED ON A PHONE UNLESS ASKED FOR — Evan, 12 Nov 2026 (flow map item 7). Below the keyboard
 * on a phone the theatre was 582px with a scrolling grid of modes before anything had played,
 * between the room and its help — and, open, it runs a whole drawing pipeline for somebody who
 * came to play the keys. A stored '1' or '0' is a decision and always wins.
 */
export function vizStartsOpen(stored: string | null, phone: boolean): boolean {
  if (stored === '1') return true
  if (stored === '0') return false
  return !phone
}
