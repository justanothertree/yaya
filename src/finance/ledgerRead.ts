/**
 * Whether the trades ledger on screen is the one the server holds, and so whether it may write.
 *
 * ⚠️ `insert_allocation` ADDS ROWS. It refuses only an overflow past the trade's total, so an
 * assign made from a picture of the allocations that is out of date writes a second copy of
 * something already assigned, and nothing on the server can tell it was a mistake. The audit of
 * 27 Nov 2026 found the first way that happened: a failed sign-in check read as "no allocations",
 * and every trade said "Nothing assigned yet — all N units are still yours". Reading it closely
 * found two more, and this module is the answer to all three:
 *
 * 1. **A read that failed.** Nothing is written until a read has worked.
 * 2. **A write since the last read.** The tab counts a write when it is SENT, not when it answers,
 *    because a timeout can still land. Only a read that began after the latest write can say what
 *    that write did, so only such a read, having worked, lets the next write through. An assign
 *    that landed while the reload after it failed used to leave the trade looking untouched, the
 *    units still typed in the box, and Assign still live.
 * 3. **Reads answering out of order.** Only the newest read started may answer. An older one
 *    arriving late would put the picture from before a write back on screen.
 *
 * Pure, so each of those can be asked without a browser: see ledgerRead.test.ts.
 */
export type LedgerRead = {
  /** writes sent from this tab, counting the ones that said they failed */
  writes: number
  /** reads started; only the newest one may answer */
  reads: number
  /** the newest read has not answered yet */
  waiting: boolean
  /** `writes` as it stood when the newest read that WORKED began; null before any has */
  readAfter: number | null
  /** what the newest read said went wrong, or null if it worked */
  failed: string | null
}

/** which read this is, and how many writes it began after */
export type ReadTicket = { read: number; writes: number }

export const LEDGER_UNREAD: LedgerRead = {
  writes: 0,
  reads: 0,
  waiting: false,
  readAfter: null,
  failed: null,
}

export function startRead(r: LedgerRead): { next: LedgerRead; ticket: ReadTicket } {
  const ticket = { read: r.reads + 1, writes: r.writes }
  return { next: { ...r, reads: ticket.read, waiting: true }, ticket }
}

/**
 * A read has answered: `failure` is null when it worked. `use` says whether its rows belong on
 * screen, and it is false for a failure (there are none) and for a read a newer one replaced.
 */
export function answerRead(
  r: LedgerRead,
  ticket: ReadTicket,
  failure: string | null,
): { next: LedgerRead; use: boolean } {
  if (ticket.read !== r.reads) return { next: r, use: false }
  if (failure !== null) return { next: { ...r, waiting: false, failed: failure }, use: false }
  return { next: { ...r, waiting: false, failed: null, readAfter: ticket.writes }, use: true }
}

/** a write is about to be sent: what is on screen stops being current until it is read again */
export const wrote = (r: LedgerRead): LedgerRead => ({ ...r, writes: r.writes + 1 })

/** the newest read worked and began after the latest write */
export const mayWrite = (r: LedgerRead): boolean => r.failed === null && r.readAfter === r.writes

/**
 * A trade row's status line.
 *
 * ⚠️ NOT FROM ALLOCATIONS THAT DID NOT LOAD. The ledger's panel said so after a failed read, but
 * the collapsed row above it still worked its status out from the stale list — "⚪ Yours" on a
 * trade that may well be assigned, which is the same failed-read-as-answer this file exists to stop
 * (found in review, 28 Nov 2026).
 */
export function tradeStatus(readOk: boolean, full: boolean, none: boolean): string {
  if (!readOk) return '⚠️ Not loaded'
  return full ? '🟢 Family fund' : none ? '⚪ Yours' : '🟡 Partial'
}
