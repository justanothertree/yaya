import { describe, expect, it } from 'vitest'
import { hashParam, toyHash } from './links'

describe('the toy in the address', () => {
  it('names the toy picked, on the Lab page', () => {
    expect(toyHash('#lab', 'lamps')).toBe('#lab?demo=lamps')
    expect(toyHash('', 'lamps')).toBeNull()
    expect(toyHash('#lab?demo=swarm', 'fourrow')).toBe('#lab?demo=fourrow')
  })
  it("drops the last toy's own settings when another is picked", () => {
    // a "beat my run" link carries a seed for Stackfall, which means nothing to Lamps
    expect(toyHash('#lab?demo=stack&beat=abc', 'lamps')).toBe('#lab?demo=lamps')
  })
  it('leaves the address alone when it already names that toy, settings and all', () => {
    expect(toyHash('#lab?demo=stack&beat=abc', 'stack')).toBeNull()
  })
  it('never moves a page that is not the Lab', () => {
    // the Lab can open in a canvas window over another page: its address is that page's
    expect(toyHash('#home', 'lamps')).toBeNull()
    expect(toyHash('#paint?x=1', 'lamps')).toBeNull()
    expect(toyHash('#laboratory', 'lamps')).toBeNull()
  })
  it('round-trips through the reader the Lab opens with', () => {
    const h = toyHash('#lab', 'fourrow')!
    expect(hashParam('demo', h)).toBe('fourrow')
  })
})
