import { describe, it, expect } from 'vitest'
import { readCertain, mayChangeCertain } from './certainRead'

/**
 * A Certain list read that failed must never become a list somebody can tap.
 *
 * ⚠️ THE TAP IS A REPLACE, NOT AN ADD. `visibility_certain_set` deletes the item's whole list and
 * inserts exactly what it is sent, so a picker that read a failure as "nobody chosen" turns one
 * tap on one friend into every other friend losing sight of the thing — and before that, it has
 * already told the owner "only you" about an item their friends can see. supabase-js answers a
 * network blip, a timeout or a refusal with `data: null` rather than throwing, which is how the
 * 27 Nov 2026 audit found it (docs/2026-11-27-supabase-failure-audit.md).
 */
const failed = { data: null, error: { message: 'Failed to fetch' } }

describe('readCertain', () => {
  it('reads a failed reply as not knowing the list, never as an empty one', () => {
    expect(readCertain(failed)).toEqual({ ok: false })
    /* the error is the answer, whatever else came with it */
    expect(readCertain({ data: [], error: failed.error })).toEqual({ ok: false })
  })

  /* the function always answers an array on success (`coalesce(..., '[]'::jsonb)`), so anything
     else came from somewhere that was not it */
  it('reads a reply that is not a list as not knowing the list', () => {
    expect(readCertain({ data: null, error: null })).toEqual({ ok: false })
    expect(readCertain({ data: { username: 'ana' }, error: null })).toEqual({ ok: false })
  })

  it('reads an empty list the server sent as nobody chosen', () => {
    expect(readCertain({ data: [], error: null })).toEqual({ ok: true, names: [] })
  })

  it('reads the usernames the server sent', () => {
    expect(
      readCertain({
        data: [
          { username: 'ana', name: 'Ana' },
          { username: 'bo', name: 'Bo' },
        ],
        error: null,
      }),
    ).toEqual({ ok: true, names: ['ana', 'bo'] })
  })
})

describe('mayChangeCertain', () => {
  it('refuses a tap while the list is still loading', () => {
    expect(mayChangeCertain(null)).toBe(false)
  })

  it('refuses a tap on a list that came from a failed read', () => {
    expect(mayChangeCertain(readCertain(failed))).toBe(false)
  })

  it('allows a tap once the server has said who is on the list, even nobody', () => {
    expect(mayChangeCertain(readCertain({ data: [], error: null }))).toBe(true)
    expect(mayChangeCertain(readCertain({ data: [{ username: 'ana' }], error: null }))).toBe(true)
  })
})
