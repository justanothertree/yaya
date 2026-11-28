import { describe, expect, it } from 'vitest'
import {
  LEDGER_UNREAD,
  answerRead,
  mayWrite,
  startRead,
  wrote,
  type LedgerRead,
  type ReadTicket,
} from './ledgerRead'

/**
 * When the trades ledger may write, asked as the admin would meet it.
 *
 * ⚠️ `insert_allocation` ADDS ROWS, so assigning from a picture of the allocations that is not
 * what the server holds writes a second copy. The picture is wrong in three ways and each is a
 * test below: the read failed and showed nothing as "nothing assigned"; an assign landed and the
 * read after it failed, so the trade still looked unassigned; and an older read answered after a
 * newer one and put the pre-assign picture back.
 */

/** start a read and answer it, the way the tab does on a good round trip */
function readOk(r: LedgerRead): LedgerRead {
  const { next, ticket } = startRead(r)
  return answerRead(next, ticket, null).next
}
function readFails(r: LedgerRead, why = 'Failed to fetch'): LedgerRead {
  const { next, ticket } = startRead(r)
  return answerRead(next, ticket, why).next
}

describe('before anything has been read', () => {
  it('nothing can be written while the first read is out', () => {
    const { next } = startRead(LEDGER_UNREAD)
    expect(mayWrite(next)).toBe(false)
  })

  it('a first read that failed refuses every write, and says why', () => {
    const r = readFails(LEDGER_UNREAD, 'Failed to fetch')
    expect(mayWrite(r)).toBe(false)
    expect(r.failed).toBe('Failed to fetch')
  })

  it('a first read that worked allows writing', () => {
    expect(mayWrite(readOk(LEDGER_UNREAD))).toBe(true)
  })

  it('a reload that fails refuses writing, even with nothing written since the last good one', () => {
    // the screen says it could not load; it must not also offer to write from what it shows
    const r = readFails(readOk(LEDGER_UNREAD))
    expect(mayWrite(r)).toBe(false)
  })

  it('a retry that works after a failure allows writing again', () => {
    const r = readOk(readFails(LEDGER_UNREAD))
    expect(mayWrite(r)).toBe(true)
    expect(r.failed).toBeNull()
  })
})

describe('after an assign is sent', () => {
  const loaded = readOk(LEDGER_UNREAD)

  it('nothing more can be assigned until the ledger has been read again', () => {
    expect(mayWrite(wrote(loaded))).toBe(false)
  })

  it('a read after it that worked allows the next one', () => {
    expect(mayWrite(readOk(wrote(loaded)))).toBe(true)
  })

  it('a read after it that FAILED refuses the next one, though an earlier read worked', () => {
    // the duplicate: the assign landed, the reload did not, and the trade still looked unassigned
    const r = readFails(wrote(loaded))
    expect(mayWrite(r)).toBe(false)
    expect(r.failed).toBe('Failed to fetch')
  })

  it('a read that began BEFORE it does not count, even if it answers after', () => {
    // its picture predates the write, so it cannot say what the write did
    const { next, ticket } = startRead(loaded)
    const afterWrite = wrote(next)
    const answered = answerRead(afterWrite, ticket, null).next
    expect(mayWrite(answered)).toBe(false)
  })

  it('an assign that SAID it failed still needs a read before the next', () => {
    // a timeout can land: the tab counts the write when it is sent, not when it answers
    expect(mayWrite(wrote(loaded))).toBe(false)
  })

  it('two writes need a read after the second, not just after the first', () => {
    const first = readOk(wrote(loaded))
    expect(mayWrite(wrote(first))).toBe(false)
  })
})

describe('reads answering out of order', () => {
  it('an older read that answers after a newer one is not used', () => {
    const loaded = readOk(LEDGER_UNREAD)
    const older = startRead(wrote(loaded))
    const newer = startRead(wrote(older.next))
    const newerAnswered = answerRead(newer.next, newer.ticket, null)
    expect(newerAnswered.use).toBe(true)
    const olderAnswered = answerRead(newerAnswered.next, older.ticket, null)
    // its rows are from before the second write; putting them back would show it undone
    expect(olderAnswered.use).toBe(false)
    expect(mayWrite(olderAnswered.next)).toBe(true)
  })

  it('an older read that FAILS after a newer one worked does not refuse anything', () => {
    const loaded = readOk(LEDGER_UNREAD)
    const older = startRead(wrote(loaded))
    const newer = startRead(older.next)
    const newerAnswered = answerRead(newer.next, newer.ticket, null)
    const olderFailed = answerRead(newerAnswered.next, older.ticket, 'Failed to fetch')
    expect(olderFailed.use).toBe(false)
    expect(olderFailed.next.failed).toBeNull()
    expect(mayWrite(olderFailed.next)).toBe(true)
  })

  it('a failed read hands back nothing to show', () => {
    const { next, ticket }: { next: LedgerRead; ticket: ReadTicket } = startRead(LEDGER_UNREAD)
    expect(answerRead(next, ticket, 'Failed to fetch').use).toBe(false)
  })
})

describe('whether a read is still out', () => {
  it('is waiting from the start of a read until it answers', () => {
    const { next, ticket } = startRead(readFails(LEDGER_UNREAD))
    expect(next.waiting).toBe(true)
    expect(answerRead(next, ticket, 'Failed to fetch').next.waiting).toBe(false)
  })
})
