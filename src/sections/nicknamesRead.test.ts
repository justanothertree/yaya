import { describe, it, expect } from 'vitest'
import { readNicknames, maySaveNicknames } from './nicknamesRead'

/**
 * Save names may only send boxes that were filled from the member's own row.
 *
 * ⚠️ ALL THREE GO EVERY TIME. `set_my_nicknames` writes nickname, circuit_nickname and
 * snake_nickname together and stores a blank as NULL, so a box left empty by a failed read is not
 * "no change" — it is an instruction to erase. A member who opens Account on a bad connection,
 * fills in one name and presses Save loses the other two. supabase-js answers a failure with
 * `data: null` instead of throwing, which is how the 27 Nov 2026 audit found it
 * (docs/2026-11-27-supabase-failure-audit.md).
 */
const ME = '6f1c1a52-0000-4000-8000-000000000001'
const SOMEBODY_ELSE = '6f1c1a52-0000-4000-8000-000000000002'
const failed = { data: null, error: { message: 'Failed to fetch' } }

/* every field away from its default, so a dropped one cannot pass by being blank anyway */
const mine = {
  user_id: ME,
  nickname: 'Ev',
  circuit_nickname: 'CrewCaptain',
  snake_nickname: 'SSSnek',
}

describe('readNicknames', () => {
  it('reads a failed reply as not knowing the names, never as three blanks', () => {
    expect(readNicknames(failed, ME)).toEqual({ ok: false })
    /* the error is the answer, whatever else came with it */
    expect(readNicknames({ data: mine, error: failed.error }, ME)).toEqual({ ok: false })
  })

  it('reads all three names from my own row', () => {
    expect(readNicknames({ data: mine, error: null }, ME)).toEqual({
      ok: true,
      names: { nickname: 'Ev', circuitNickname: 'CrewCaptain', snakeNickname: 'SSSnek' },
    })
  })

  it('reads a name I have not set as a blank box', () => {
    expect(
      readNicknames(
        { data: { ...mine, circuit_nickname: null, snake_nickname: null }, error: null },
        ME,
      ),
    ).toEqual({ ok: true, names: { nickname: 'Ev', circuitNickname: '', snakeNickname: '' } })
  })

  /* ⚠️ `profiles_select` lets an ADMIN read every row, so an unfiltered read can come back with
     somebody else's — and Save would then write their names onto the admin */
  it('does not take somebody else’s row as my names', () => {
    expect(readNicknames({ data: { ...mine, user_id: SOMEBODY_ELSE }, error: null }, ME)).toEqual({
      ok: false,
    })
  })

  it('does not read anything as my names without knowing who I am', () => {
    expect(readNicknames({ data: mine, error: null }, null)).toEqual({ ok: false })
    expect(readNicknames({ data: null, error: null }, null)).toEqual({ ok: false })
  })

  /* a signed-in account with no profile row (not a member yet) really has no names, and
     `set_my_nicknames` updates nothing for it, so there is nothing a save could erase */
  it('reads no row at all, with no error, as no names set', () => {
    expect(readNicknames({ data: null, error: null }, ME)).toEqual({
      ok: true,
      names: { nickname: '', circuitNickname: '', snakeNickname: '' },
    })
  })
})

describe('maySaveNicknames', () => {
  it('refuses to save while the names are still loading', () => {
    expect(maySaveNicknames(null, false)).toBe(false)
  })

  it('refuses to save boxes that came from a failed read', () => {
    expect(maySaveNicknames(readNicknames(failed, ME), false)).toBe(false)
  })

  it('allows a save once my names have loaded', () => {
    expect(maySaveNicknames(readNicknames({ data: mine, error: null }, ME), false)).toBe(true)
  })

  it('refuses a second save while one is going', () => {
    expect(maySaveNicknames(readNicknames({ data: mine, error: null }, ME), true)).toBe(false)
  })
})
