import { describe, expect, it } from 'vitest'
import {
  BLOCK_EDGES,
  BLOCK_FONTS,
  BLOCK_SHAPES,
  BLOCK_TILTS,
  PAGE_GAPS,
  PAGE_WIDTHS,
  TEXT_ALIGNS,
  TEXT_SIZES,
  TINT_HUES,
  blockEdge,
  blockFont,
  blockHeading,
  blockKeepEmpty,
  blockShape,
  blockTilt,
  hueFor,
  pageStyleAttrs,
  readPageStyle,
  textAlign,
  textSize,
  textStyle,
} from './look'

/**
 * What a block wears, read back out of free-form jsonb.
 *
 * Every one of these settings lives in a profile block's `config`, which the server accepts as
 * jsonb and does not validate — so a reader here is the only thing between what is stored and
 * what reaches the DOM, and "the reader cannot assume the writer was the only way in" is this
 * file's own sentence about it.
 *
 * ⚠️ THE SWEEP IS THE POINT, AND IT IS ABOUT DRIFT RATHER THAN ABOUT JUNK. The pickers in the
 * appearance panel are built from the exported lists below; the readers decide what is legal.
 * Three readers used to hold a hand-written copy of their list — `v === 'small' || v === 'big'
 * || v === 'huge'` beside a `TEXT_SIZES` that already said so — and all three copies were
 * complete, which is exactly why nothing would ever have said otherwise. The day an id is added
 * to a list and missed in a copy, the control offers a choice and choosing it does nothing:
 * silent, in a settings panel, about somebody's own page. So the test is "every id of every list
 * survives its reader", derived from the lists, which is the one form that cannot go stale.
 */

/** Each pair: the list the picker is built from, the key it is stored under, and its reader. */
const SETTINGS = [
  { name: 'textSize', ids: TEXT_SIZES.map((x) => x.id), key: 'textSize', read: textSize },
  { name: 'textAlign', ids: TEXT_ALIGNS.map((x) => x.id), key: 'align', read: textAlign },
  { name: 'blockEdge', ids: BLOCK_EDGES.map((x) => x.id), key: 'edge', read: blockEdge },
  { name: 'blockShape', ids: BLOCK_SHAPES.map((x) => x.id), key: 'shape', read: blockShape },
  { name: 'blockFont', ids: BLOCK_FONTS.map((x) => x.id), key: 'font', read: blockFont },
  { name: 'blockTilt', ids: BLOCK_TILTS.map((x) => x.id), key: 'tilt', read: blockTilt },
] as const

/* a config is somebody else's jsonb: every one of these has been possible to store */
const JUNK: unknown[] = [
  undefined,
  null,
  '',
  'nonsense',
  0,
  1,
  -1,
  true,
  false,
  {},
  [],
  'PLAIN',
  'Small',
  ' small ',
]

describe('every choice a picker offers, read back', () => {
  for (const { name, ids, key, read } of SETTINGS) {
    it(`${name} keeps all ${ids.length} of its own ids`, () => {
      expect(ids.length).toBeGreaterThan(1)
      for (const id of ids) expect(read({ [key]: id })).toBe(id)
    })

    it(`${name} answers its default for anything else`, () => {
      /* whatever the default is, it is what an unset config reads as — taken from the reader
         rather than written down here, so this stays true if a default ever changes */
      const fallback = read(undefined)
      expect(ids).toContain(fallback)
      for (const bad of JUNK) {
        if (ids.includes(bad as never)) continue
        expect(read({ [key]: bad } as Record<string, unknown>), `${name} ← ${String(bad)}`).toBe(
          fallback,
        )
      }
    })

    it(`${name} ignores the other settings' values`, () => {
      /* ⚠️ A CONFIG HOLDS ALL OF THESE AT ONCE, so a reader reaching the wrong key would look
         fine against a fixture that sets one thing at a time. Fed every OTHER list's ids under
         this key, and every id under the WRONG key, it has to answer the default both ways. */
      const fallback = read(undefined)
      for (const other of SETTINGS) {
        if (other.key === key) continue
        for (const id of other.ids) {
          if (ids.includes(id as never)) continue
          expect(read({ [key]: id } as Record<string, unknown>)).toBe(fallback)
          expect(read({ [other.key]: id } as Record<string, unknown>)).toBe(fallback)
        }
      }
    })
  }

  it('reads a whole config at once, every setting at a non-default value', () => {
    /* ⚠️ CLAUDE.md §2's fixture rule: a reader sweep that only ever sets one key cannot show a
       reader picking up its neighbour's value. So every setting is set, all of them away from
       their default, and each is asked for separately. */
    const config: Record<string, unknown> = {}
    const want = new Map<string, unknown>()
    for (const { name, ids, key, read } of SETTINGS) {
      const away = ids.find((id) => id !== read(undefined))
      expect(away, `${name} has only its default`).toBeDefined()
      config[key] = away
      want.set(name, away)
    }
    for (const { name, key, read } of SETTINGS) {
      expect(read(config), `${name} from a full config`).toBe(want.get(name))
      void key
    }
  })
})

describe('the page style', () => {
  it('keeps every width and gap a picker offers', () => {
    for (const w of PAGE_WIDTHS) expect(readPageStyle({ width: w.id }).width).toBe(w.id)
    for (const g of PAGE_GAPS) expect(readPageStyle({ gap: g.id }).gap).toBe(g.id)
  })

  it('falls back to the page everyone had before this existed', () => {
    expect(readPageStyle(undefined)).toEqual({ width: 'wide', gap: 'normal' })
    expect(readPageStyle(null)).toEqual({ width: 'wide', gap: 'normal' })
    expect(readPageStyle('column')).toEqual({ width: 'wide', gap: 'normal' })
    expect(readPageStyle({ width: 'enormous', gap: 7 })).toEqual({ width: 'wide', gap: 'normal' })
  })

  it('writes no attribute for the default, so a default page carries nothing', () => {
    /* the grid's CSS keys off the absence, so "wide + normal" must produce an empty object
       rather than data attributes that say what was already true */
    expect(pageStyleAttrs({ width: 'wide', gap: 'normal' })).toEqual({})
    expect(pageStyleAttrs(undefined)).toEqual({})
    expect(pageStyleAttrs({ width: 'column', gap: 'airy' })).toEqual({
      'data-page-w': 'column',
      'data-page-g': 'airy',
    })
    /* and one of each, which is the common case and the one a both-or-nothing bug survives */
    expect(pageStyleAttrs({ width: 'column', gap: 'normal' })).toEqual({ 'data-page-w': 'column' })
    expect(pageStyleAttrs({ width: 'wide', gap: 'tight' })).toEqual({ 'data-page-g': 'tight' })
  })
})

describe('a block heading', () => {
  it('trims, and an empty one is no heading rather than an empty one', () => {
    expect(blockHeading({ heading: '  My week  ' })).toBe('My week')
    expect(blockHeading({ heading: '   ' })).toBeNull()
    expect(blockHeading({ heading: '' })).toBeNull()
    expect(blockHeading(undefined)).toBeNull()
  })

  it('is not a number, an object or a boolean however it was stored', () => {
    for (const bad of [0, 1, true, {}, [], null]) {
      expect(blockHeading({ heading: bad } as Record<string, unknown>)).toBeNull()
    }
  })

  it('caps at 60 characters, counted after the trim', () => {
    /* a heading is one line on a card; what stops a pasted paragraph becoming the page's
       biggest text is this cap and nothing else */
    expect(blockHeading({ heading: 'x'.repeat(200) })).toHaveLength(60)
    expect(blockHeading({ heading: '  ' + 'y'.repeat(70) + '  ' })).toHaveLength(60)
  })
})

describe('keeping a block empty on purpose', () => {
  it('is true only for a stored true, never for something truthy', () => {
    /* ⚠️ THE TWO STATES LOOK IDENTICAL ON SCREEN AND MEAN OPPOSITE THINGS — a deliberate blank
       band, or somebody's unfinished sentence. This file says a guess that is wrong either
       publishes a mistake or deletes an intention, so only an explicit `true` counts. */
    expect(blockKeepEmpty({ keep: true })).toBe(true)
    for (const nearly of ['true', 1, 'yes', {}, [], 'on'])
      expect(blockKeepEmpty({ keep: nearly } as Record<string, unknown>)).toBe(false)
    expect(blockKeepEmpty(undefined)).toBe(false)
  })
})

describe('the colour somebody gets', () => {
  const NAMES = ['evan', 'ktos', 'a', 'zzzz', 'Mo', 'granny', 'seedowner', '🙂', 'a_b-c']

  it('is the same colour every time, and the same in any case', () => {
    /* case matters: the same person is `Evan` in one place and `evan` in another, and an avatar
       that changes colour between two screens reads as two people */
    for (const n of NAMES) {
      expect(hueFor(n)).toBe(hueFor(n))
      expect(hueFor(n.toUpperCase())).toBe(hueFor(n.toLowerCase()))
    }
  })

  it('is always one of the swatch hues, which is the whole reason for the stops', () => {
    /* ⚠️ TWO EXPORTS AGREEING, not a restatement of either. The file's own comment says a block
       tinted "mine" must sit in the same family as the picked ones — so an identity hue that is
       not a swatch hue would put somebody's avatar between two swatches, which is the
       "slightly wrong colour" that whole design avoids. */
    for (const n of NAMES) expect(TINT_HUES).toContain(hueFor(n))
  })

  it('is a hue, so it stays inside the wheel', () => {
    for (const n of [...NAMES, '']) {
      const h = hueFor(n)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(360)
    }
  })

  it('does not put everybody on the same stop', () => {
    /* the floor: a hash that collapsed would pass every assertion above */
    const spread = new Set(NAMES.map(hueFor))
    expect(spread.size).toBeGreaterThan(3)
  })
})

describe('what a run of words wears', () => {
  it('leaves the normal size with no font-size at all', () => {
    /* so a default block inherits the page rather than hard-coding 1em over it */
    expect(textStyle(undefined).fontSize).toBeUndefined()
    expect(textStyle({ textSize: 'normal' }).fontSize).toBeUndefined()
  })

  it('gives every other size the em its own list names', () => {
    for (const s of TEXT_SIZES) {
      if (s.id === 'normal') continue
      expect(textStyle({ textSize: s.id }).fontSize).toBe(`${s.em}em`)
    }
  })
})
