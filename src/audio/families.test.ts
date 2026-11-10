import { describe, expect, it } from 'vitest'
import { FAMILIES, familyOf, familyVoices } from './families'
import { INSTRUMENTS } from './synth'

/**
 * The instrument menu shows one family at a time, so a voice with no family is a voice nobody can
 * reach, and a voice in two families is a menu that lies about which one it is.
 */
describe('every voice on the picker has a family', () => {
  const offered = INSTRUMENTS.map(([id]) => id)

  it('exactly one each', () => {
    const lost: string[] = []
    const twice: string[] = []
    for (const id of offered) {
      const homes = FAMILIES.filter((f) => f.members.includes(id))
      if (homes.length === 0) lost.push(id)
      if (homes.length > 1) twice.push(id)
    }
    expect(lost).toEqual([])
    expect(twice).toEqual([])
  })

  it('and every family shows at least one voice, so no tab opens onto nothing', () => {
    for (const f of FAMILIES) expect(familyVoices(f.id, offered).length, f.name).toBeGreaterThan(0)
  })

  it('and together the families show every voice once — none dropped, none doubled', () => {
    const shown = FAMILIES.flatMap((f) => familyVoices(f.id, offered))
    expect(shown.length).toBe(offered.length)
    expect(new Set(shown)).toEqual(new Set(offered))
  })

  /* one row of tiles is the point: eight columns at 1440 */
  it('and no family is more than a row on a desktop', () => {
    for (const f of FAMILIES)
      expect(familyVoices(f.id, offered).length, f.name).toBeLessThanOrEqual(8)
  })

  it('a bass is in Bass, a bell in Bells, and the kit in Drums', () => {
    expect(familyOf('bass')).toBe('bass')
    expect(familyOf('sub')).toBe('bass')
    expect(familyOf('vibes')).toBe('bells')
    expect(familyOf('drums')).toBe('drums')
    /* something nobody has filed opens on Keys rather than on nothing */
    expect(familyOf('kazoo')).toBe('keys')
  })

  it('a voice this bundle does not have is not shown', () => {
    expect(familyVoices('bass', ['bass', 'sub'])).toEqual(['bass', 'sub'])
  })
})
