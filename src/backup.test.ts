import { describe, expect, it } from 'vitest'
import { backupSays, backupTotal, countBackup, type BackupCounts } from './backup'

/**
 * ⚠️ EVERY FIELD NON-DEFAULT, AND ALL DIFFERENT. A fixture of zeros makes a missing kind invisible,
 * which is exactly how the bug got in — and equal counts would let a sentence read the wrong field
 * and still agree. Five distinct numbers mean any mix-up shows up as the wrong number.
 */
const some: BackupCounts = { songs: 3, art: 7, looks: 2, minions: 5, wins: 11 }

/** The numbers the sentence actually says, read back out of it. */
const numbersIn = (s: string): number[] => (s.match(/\d+/g) ?? []).map(Number)

describe('what the copy will contain, said on the card', () => {
  /**
   * ⚠️ THE ONE THAT MATTERS, and it is the bug. The line was written by hand as three kinds while
   * the number enabling the Save button summed four, so an account holding nothing but minions
   * showed a live button over "0 songs · 0 drawings · 0 looks".
   *
   * It is asked by SUM rather than by naming the kinds, so it stays true when a sixth kind is
   * added — a test listing the kinds is a second copy of the list that has to be kept level, which
   * is the thing that broke.
   */
  it('accounts for every item the file holds', () => {
    expect(numbersIn(backupSays(some)).reduce((a, b) => a + b, 0)).toBe(backupTotal(some))
  })

  it('leaves nothing out when only one kind has anything in it', () => {
    for (const k of Object.keys(some) as Array<keyof BackupCounts>) {
      const only = { songs: 0, art: 0, looks: 0, minions: 0, wins: 0, [k]: 4 }
      expect(backupTotal(only)).toBe(4)
      expect(numbersIn(backupSays(only))).toEqual([4])
      /* and it says a word about it, not just the number */
      expect(backupSays(only).replace(/[\d\s·]/g, '').length).toBeGreaterThan(2)
    }
  })

  /** "0 songs" is a fact about songs nobody asked for; the line says what the file will hold */
  it('says nothing about a kind you have none of', () => {
    const s = backupSays({ songs: 2, art: 0, looks: 0, minions: 0, wins: 0 })
    expect(s).toBe('2 songs')
    expect(s).not.toMatch(/0/)
  })

  it('is empty when there is nothing to copy, so the card can say so in its own words', () => {
    expect(backupSays({ songs: 0, art: 0, looks: 0, minions: 0, wins: 0 })).toBe('')
    expect(backupTotal({ songs: 0, art: 0, looks: 0, minions: 0, wins: 0 })).toBe(0)
  })

  /** "1 songs" is the kind of thing that makes a page look unfinished */
  it('counts one of a thing in the singular', () => {
    const s = backupSays({ songs: 1, art: 1, looks: 1, minions: 1, wins: 1 })
    expect(s).toBe('1 song · 1 drawing · 1 look · 1 minion · 1 park record')
  })

  it('reads in the order the card has always listed them', () => {
    expect(backupSays(some)).toBe('3 songs · 7 drawings · 2 looks · 5 minions · 11 park records')
  })

  /**
   * ⚠️ PARK RECORDS ARE IN THE FILE. `makeBackup` has packed them since it was written and the
   * restore reports them arriving, but nothing counted them on the way out — so a member whose
   * only keepsake was a run of records had Save disabled and no way to take them anywhere.
   */
  it('is willing to make a file of park records alone', () => {
    const onlyWins = { songs: 0, art: 0, looks: 0, minions: 0, wins: 6 }
    expect(backupTotal(onlyWins)).toBeGreaterThan(0)
    expect(backupSays(onlyWins)).toBe('6 park records')
  })

  /** a count read off a file somebody hands you is not a count of what is here */
  it('still refuses a file that is not a backup at all', () => {
    expect(countBackup(null)).toBe(null)
    expect(countBackup({ hello: 1 })).toBe(null)
    expect(countBackup({ songs: [], art: [], looks: [], minions: [] })).toEqual({
      songs: 0,
      art: 0,
      looks: 0,
      minions: 0,
    })
  })
})
