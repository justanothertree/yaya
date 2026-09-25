import { describe, expect, it } from 'vitest'
import { PRESET_GROUPS, PRESETS } from './presets'
import { contrast, derivePalette, parseHex, rate } from './customTheme'

/**
 * Every theme the site ships, put through the same test the appearance screen applies.
 *
 * ⚠️ THE ONE THING A PRESET MUST NOT BE IS UNREADABLE. Somebody choosing a theme is choosing
 * a look, not auditing it, and a preset that fails AA is the site handing out a fault and
 * letting the reader assume it is their eyes. The maths to check it has been in the repository
 * the whole time and was only ever pointed at the colour somebody picked by hand — never at
 * the ones shipped in the box.
 */

const ratioOf = (seed: (typeof PRESETS)[number]['seed'], key: '--text' | '--muted') => {
  const p = derivePalette(seed)
  return contrast(p[key], p['--bg'])
}

describe('every preset in the box', () => {
  it('is a real list with real colours in it', () => {
    expect(PRESETS.length).toBeGreaterThan(10)
    for (const { label, seed } of PRESETS) {
      expect(label.length, 'a preset with no name').toBeGreaterThan(0)
      for (const c of [seed.bg, seed.text, seed.accent]) {
        expect(parseHex(c), `${label} has ${c}`).not.toBeNull()
      }
    }
  })

  it('and no two of them share a name', () => {
    const names = PRESETS.map((p) => p.label.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })

  it('and every group has something in it', () => {
    expect(PRESET_GROUPS.length).toBeGreaterThan(1)
    for (const g of PRESET_GROUPS) {
      expect(g.group.length).toBeGreaterThan(0)
      expect(g.items.length, `${g.group} is empty`).toBeGreaterThan(0)
    }
  })

  it('and the flat list is exactly the groups', () => {
    expect(PRESETS.length).toBe(PRESET_GROUPS.reduce((n, g) => n + g.items.length, 0))
  })

  /**
   * ⚠️ AA ON THE DERIVED PALETTE, NOT ON THE SEED. What a reader actually sees is `--text` on
   * `--bg` after derivePalette has had its say, and that is where a theme can go wrong without
   * anybody choosing badly.
   */
  it('puts its body text on its background at AA', () => {
    for (const { label, seed } of PRESETS) {
      const got = ratioOf(seed, '--text')
      expect(rate(got), `${label}: text is ${got.toFixed(2)}:1`).toBe('aa')
    }
  })

  it('and its muted text at least as far as large text goes', () => {
    for (const { label, seed } of PRESETS) {
      const got = ratioOf(seed, '--muted')
      expect(rate(got), `${label}: muted is ${got.toFixed(2)}:1`).not.toBe('fail')
    }
  })

  /**
   * ⚠️ AND THE GROUP THAT EXISTS FOR THIS HAS TO BE THE BEST AT IT. "Easy to read" was added
   * for people who need more than the standard asks for; if one of its themes ever scored
   * below an ordinary one, the group would be a label rather than a promise.
   */
  it('and the ones that promise readability are the most readable of all', () => {
    const easy = PRESET_GROUPS.find((g) => /easy/i.test(g.group))
    expect(easy, 'the readable group has gone').toBeTruthy()
    const others = PRESETS.filter((p) => !easy!.items.includes(p))
    const worstEasy = Math.min(...easy!.items.map((p) => ratioOf(p.seed, '--text')))
    const bestOther = Math.max(...others.map((p) => ratioOf(p.seed, '--text')))
    expect(worstEasy, `worst easy-to-read ${worstEasy.toFixed(2)}`).toBeGreaterThanOrEqual(
      bestOther - 0.01,
    )
  })

  it('and every one of them has an accent you can see against the page', () => {
    for (const { label, seed } of PRESETS) {
      const p = derivePalette(seed)
      const got = contrast(p['--accent'], p['--bg'])
      /* an accent is a UI boundary and a large label, so 3:1 is its bar rather than 4.5 */
      expect(rate(got), `${label}: accent is ${got.toFixed(2)}:1`).not.toBe('fail')
    }
  })
})
