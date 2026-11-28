import { describe, expect, it } from 'vitest'
import { autoPlayerName, nextIdFrom } from './playerId'

/* what supabase-js resolves with when the request never got an answer — it does not throw */
const offline = { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }
/* and what a refusal looks like: still no throw, still data: null */
const refused = { message: 'permission denied for table player_registry', code: '42501' }

describe('the next PlayerN number', () => {
  it('is not known when the read failed', () => {
    expect(nextIdFrom(null, offline)).toBeNull()
    expect(nextIdFrom(null, refused)).toBeNull()
  })

  it('is not known when the read answered with something that is not a list', () => {
    expect(nextIdFrom({ id: 3 }, null)).toBeNull()
  })

  it('is 1 for a registry that really is empty', () => {
    expect(nextIdFrom([], null)).toBe(1)
  })

  it('is the one after the highest id', () => {
    expect(nextIdFrom([{ id: 41 }], null)).toBe(42)
  })
})

describe('renaming an automatic player on mount', () => {
  /**
   * ⚠️ THE CASE THIS EXISTS FOR. A failed read used to answer 1, so an automatic player became
   * "Player1" — a handle somebody already has — and that was written to this browser for good.
   */
  it('never happens when the read failed', () => {
    for (const cur of ['Player7x2a', 'Player57', ''])
      expect(autoPlayerName(cur, 'auto', nextIdFrom(null, offline))).toBeNull()
  })

  it('gives an automatic player the next number when the read worked', () => {
    expect(autoPlayerName('Player7x2a', 'auto', nextIdFrom([{ id: 41 }], null))).toBe('Player42')
  })

  it('heals a player the old bug named Player1, on the next read that works', () => {
    expect(autoPlayerName('Player1', 'auto', 42)).toBe('Player42')
  })

  it('never replaces a name somebody typed', () => {
    expect(autoPlayerName('Evan', 'custom', 42)).toBeNull()
    expect(autoPlayerName('PlayerOne', 'custom', 42)).toBeNull()
    expect(autoPlayerName('Evan', 'auto', 42)).toBeNull()
  })
})
