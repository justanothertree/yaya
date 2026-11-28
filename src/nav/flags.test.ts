import { describe, expect, it } from 'vitest'
import { settleNavFlag, type CheckAnswer, type NavFlags } from './flags'

/**
 * supabase-js does not throw. A dropped connection, a 5xx, a timeout and an abort all RESOLVE,
 * as `{ data: null, error }` — and `null` is exactly what "not an admin", "no features" and "not
 * paused" look like once a check reads only `data`. So every expectation below is about what the
 * member is left holding after an answer, written from what that answer MEANS.
 */

const UID = 'member-1'
/* every flag away from its default, so a check that quietly resets one cannot hide behind it */
const known: NavFlags = { uid: UID, admin: true, finance: true, suspended: true }
const failed: CheckAnswer = {
  data: null,
  error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' },
}

/** What the app holds afterwards: the new answer when there was one, otherwise what it had. */
function heldAfter(stored: NavFlags, key: keyof Omit<NavFlags, 'uid'>, res: CheckAnswer) {
  const r = settleNavFlag(stored, UID, key, res)
  return { shown: r ? r.value : stored[key], stored: r ? r.flags : stored, wrote: r !== null }
}

describe('a check that failed teaches nothing', () => {
  it('a failed is_admin keeps an admin an admin, on screen and in storage', () => {
    const after = heldAfter(known, 'admin', failed)
    expect(after.shown).toBe(true)
    expect(after.stored.admin).toBe(true)
  })

  it('a failed my_features keeps Investments for a member who has it', () => {
    const after = heldAfter(known, 'finance', failed)
    expect(after.shown).toBe(true)
    expect(after.stored.finance).toBe(true)
  })

  it('a failed my_account keeps a paused member paused', () => {
    const after = heldAfter(known, 'suspended', failed)
    expect(after.shown).toBe(true)
    expect(after.stored.suspended).toBe(true)
  })

  it('a failed check writes nothing for the next visit to paint from', () => {
    for (const key of ['admin', 'finance', 'suspended'] as const) {
      expect(heldAfter(known, key, failed).wrote).toBe(false)
    }
  })

  it('an answer that is not the shape asked for is not an answer either', () => {
    /* no error, but nothing a real reply looks like: is_admin says yes or no, the other two
       answer with rows */
    expect(heldAfter(known, 'admin', { data: null, error: null }).wrote).toBe(false)
    expect(heldAfter(known, 'finance', { data: null, error: null }).wrote).toBe(false)
    expect(heldAfter(known, 'suspended', { data: null, error: null }).wrote).toBe(false)
  })
})

describe('a check that answered is believed', () => {
  const ok = (data: unknown): CheckAnswer => ({ data, error: null })

  it('is_admin saying no takes Admin away', () => {
    const after = heldAfter(known, 'admin', ok(false))
    expect(after.shown).toBe(false)
    expect(after.stored).toEqual({ ...known, admin: false })
  })

  it('my_features without finance takes Investments away, and with it gives it back', () => {
    const off = heldAfter(known, 'finance', ok([{ feature: 'other', enabled: true }]))
    expect(off.shown).toBe(false)
    expect(off.stored).toEqual({ ...known, finance: false })
    expect(heldAfter(known, 'finance', ok([])).shown).toBe(false)

    const none: NavFlags = { ...known, finance: false }
    const on = heldAfter(none, 'finance', ok([{ feature: 'finance', enabled: true }]))
    expect(on.shown).toBe(true)
    expect(on.stored).toEqual(known)
  })

  it('my_account lifting a pause opens the member UI again', () => {
    const after = heldAfter(known, 'suspended', ok([{ suspended: false }]))
    expect(after.shown).toBe(false)
    expect(after.stored).toEqual({ ...known, suspended: false })
    /* no account row is not a pause */
    expect(heldAfter(known, 'suspended', ok([])).shown).toBe(false)
  })

  it('one answer changes only its own flag', () => {
    const after = heldAfter(known, 'admin', ok(false))
    expect(after.stored.finance).toBe(true)
    expect(after.stored.suspended).toBe(true)
  })

  it("someone else's stored flags are never carried over to this member", () => {
    const theirs: NavFlags = { uid: 'member-2', admin: true, finance: true, suspended: true }
    const r = settleNavFlag(theirs, UID, 'admin', ok(false))
    expect(r?.flags).toEqual({ uid: UID, admin: false, finance: false, suspended: false })
  })
})
