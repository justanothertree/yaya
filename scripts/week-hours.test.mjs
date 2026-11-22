import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The week grid's hour labels, asked of the stylesheet, because that is where they went wrong.
 *
 * ⚠️ ON 549bb15 THE ARITHMETIC WAS RIGHT AND EVERY LABEL WAS IN THE WRONG PLACE. A label sits at a
 * percentage of the gutter and a block at the same percentage of its lane, and
 * `src/chronicle/week.test.ts` holds those two sums to one clock. But the gutter was
 * `height: 240px` with `margin-top: 2.4rem`, copies of the lane's height and a guess at the day
 * heading's, and on 23 Oct the lane grew to 420px on a phone and 620px past 700 while the copies
 * stayed. So the same percentage meant two heights: at 1440, 12p sat 185px above noon's line and
 * 11p 359px above its own, with all twenty-four labels in the top 39% of the grid.
 *
 * Vitest has no layout, so this asks the question the pane measured: does the gutter have a size or
 * an offset of its own that can fall out of step again, or is it the lanes' grid row? Made to fail
 * against the old rule, and against a day column without the subgrid.
 */

const css = readFileSync(join('src', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/* the body of every rule whose selector list names exactly this selector, media queries included */
const rulesFor = (sel) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sels]) => sels.split(',').some((s) => s.trim() === sel))
    .map(([, , body]) => body)

describe('the week grid’s hour labels', () => {
  it('have a column with no height or offset of its own', () => {
    const gutter = rulesFor('.chron-week-hours')
    expect(gutter.length).toBeGreaterThan(0)
    for (const body of gutter) {
      expect(body).not.toMatch(/(^|[\s;])(min-|max-)?height\s*:/)
      expect(body).not.toMatch(
        /(^|[\s;])(margin|margin-top|margin-block|margin-block-start|top)\s*:/,
      )
    }
  })

  it('sit in the lanes’ own grid row', () => {
    expect(rulesFor('.chron-week-hours').join(';')).toMatch(/grid-row:\s*2\s*;/)
    /* and every day column spans both rows on the grid's own tracks, so its lane is in that row */
    const day = rulesFor('.chron-week-col').join(';')
    expect(day).toMatch(/grid-row:\s*1\s*\/\s*span 2\s*;/)
    expect(day).toMatch(/grid-template-rows:\s*subgrid\s*;/)
  })
})
