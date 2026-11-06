import { describe, expect, it } from 'vitest'
import code from './loom.wgsl?raw'
import {
  AT,
  DRAFTS,
  LOOM,
  MAX_FLOAT,
  MAX_REPEAT,
  SHAFTS,
  TREADLES,
  drawdown,
  ends,
  fits,
  flipAt,
  floatAt,
  layoutFor,
  longestFloat,
  packDraft,
  packLoom,
  picks,
  spotAt,
  thread,
  tie,
  treadle,
  warpUp,
  type Draft,
  type DraftId,
} from './loom'
import { wgslLayout } from './wgslLayout'

const draft = (id: DraftId): Draft => DRAFTS[id].draft
const plain: Draft = {
  threading: [0, 1],
  treadling: [0, 1],
  tieup: [1, 2, 0, 0, 0, 0, 0, 0],
  warp: [0],
  weft: [1],
  colours: [
    [1, 0, 0],
    [0, 0, 1],
  ],
}
const rows = (d: Draft, n = picks(d), m = ends(d)) => {
  const dd = drawdown(d, n, m)
  return Array.from({ length: n }, (_, i) => [...dd.slice(i * m, (i + 1) * m)].join(''))
}

describe('the shader and this file describe one loom', () => {
  const wgsl = wgslLayout(code, 'Loom')
  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = LOOM
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })
  it('agrees about where every part of the draft lives in its buffer', () => {
    const consts = Object.fromEntries(
      [...code.matchAll(/const AT_(\w+) = (\d+)u;/g)].map((m) => [m[1].toLowerCase(), +m[2]]),
    )
    expect(consts).toEqual(AT)
    expect(code).toContain(`const REPEAT = ${MAX_REPEAT}u;`)
    expect(code).toContain(`const MAX_FLOAT = ${MAX_FLOAT}u;`)
    expect(code).toContain(`const SHAFTS = ${SHAFTS}.0;`)
  })
  it('writes every field where the shader will look for it', () => {
    const v = new DataView(
      packLoom({ w: 800, h: 600, cell: 12, woven: 7.25, first: 3, floats: 5, light: [0.3, -0.6] }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    expect([u('size'), u('size', 1), u('first'), u('floats')]).toEqual([800, 600, 3, 5])
    expect([f('cell'), f('woven'), f('light'), f('light', 1)]).toEqual(
      [12, 7.25, 0.3, -0.6].map(Math.fround),
    )
  })
  it('packs a draft repeated out to 64 a part, and every colour as 0xRRGGBB', () => {
    const u = packDraft(draft('houndstooth'))
    expect(u.length).toBe(AT.words)
    for (let k = 0; k < MAX_REPEAT; k++) {
      expect(u[AT.threading + k]).toBe(k % 4)
      expect(u[AT.treadling + k]).toBe(k % 4)
      // four dark, four light
      expect(u[AT.warp + k]).toBe(k % 8 < 4 ? 0x212433 : 0xede3cc)
    }
    expect([...u.slice(AT.tieup, AT.tieup + TREADLES)]).toEqual([3, 6, 12, 9, 0, 0, 0, 0])
    // ⚠️ and a draft whose every treadle is tied: the twill's last four are 0, which a packer that
    // stopped at four would write too
    const satin = draft('satin')
    expect([...packDraft(satin).slice(AT.tieup, AT.tieup + TREADLES)]).toEqual(satin.tieup)
    expect(satin.tieup.every((t) => t !== 0)).toBe(true)
  })
})

describe('the drawdown', () => {
  it('of plain weave is a checkerboard', () => {
    expect(rows(plain, 4, 6)).toEqual(['101010', '010101', '101010', '010101'])
  })
  it('of a 2/2 twill is a diagonal that steps one end a pick', () => {
    const d = draft('houndstooth')
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++) expect(warpUp(d, i + 1, j + 1)).toBe(warpUp(d, i, j))
    expect(rows(d, 4, 4)).toEqual(['1100', '0110', '0011', '1001'])
  })
  it('of herringbone runs one way and then, with a clean break, the other', () => {
    const d = draft('herringbone')
    const r = rows(d, 1, 16)[0]
    expect(r.slice(0, 8)).toBe('11001100')
    // past the turn the diagonal runs back: pick 1 against pick 0 steps the other way
    for (let j = 9; j < 15; j++) expect(warpUp(d, 1, j)).toBe(warpUp(d, 0, j + 1))
    for (let j = 0; j < 7; j++) expect(warpUp(d, 1, j + 1)).toBe(warpUp(d, 0, j))
  })
  it('of a satin crosses once a row, never beside the last crossing', () => {
    const d = draft('satin')
    const dd = rows(d)
    for (const r of dd) expect([...r].filter((c) => c === '0')).toHaveLength(1)
    const at = dd.map((r) => r.indexOf('0'))
    for (let i = 0; i < 8; i++) expect(Math.abs(at[i] - at[(i + 1) % 8]) % 7).not.toBe(1)
    expect(new Set(at).size).toBe(8)
  })
  it('of rosepath is symmetric both ways about its point', () => {
    const d = draft('rosepath')
    const dd = rows(d, 8, 8)
    // about end 4 and pick 4 (the point at index 4 mirrors 3..1 onto 5..7)
    for (let i = 0; i < 8; i++) for (let k = 1; k < 4; k++) expect(dd[i][4 + k]).toBe(dd[i][4 - k])
    for (let k = 1; k < 4; k++) expect(dd[4 + k]).toBe(dd[4 - k])
  })
  it('repeats: every draft fits evenly in 64, so the shader needs one modulus', () => {
    for (const id of Object.keys(DRAFTS) as DraftId[]) {
      expect(fits(draft(id))).toBe(true)
      const d = draft(id)
      expect(drawdown(d, MAX_REPEAT, MAX_REPEAT).slice(0, 64)).toEqual(
        drawdown(d, MAX_REPEAT * 2, MAX_REPEAT).slice(MAX_REPEAT * 64, MAX_REPEAT * 64 + 64),
      )
    }
    expect(fits({ ...plain, warp: [0, 1, 0] })).toBe(false)
  })
})

describe('floats', () => {
  it('are 1 everywhere in plain weave, 2 in a 2/2 twill, 7 in an eight-shaft satin', () => {
    expect(longestFloat(plain)).toBe(1)
    expect(longestFloat(draft('houndstooth'))).toBe(2)
    expect(longestFloat(draft('satin'))).toBe(7)
    expect(floatAt(draft('satin'), 0, 1)).toBe(7)
  })
  it('run along the warp when the warp is up and along the pick when the weft is', () => {
    // one treadle lifts shaft 0 only: end 0 warp-up all the way down; the rest weft-up across
    const d: Draft = {
      ...plain,
      threading: [0, 1, 1, 1],
      treadling: [0],
      tieup: [1, 0, 0, 0, 0, 0, 0, 0],
    }
    expect(floatAt(d, 0, 0)).toBe(2 * MAX_FLOAT + 1)
    expect(floatAt(d, 0, 2)).toBe(3)
  })
})

describe('editing', () => {
  it('a tap flips exactly the cells that share its shaft and its treadle, and a second puts it back', () => {
    const d = draft('rosepath')
    const before = drawdown(d)
    const after = drawdown(flipAt(d, 2, 5))
    const s = d.threading[5]
    const t = d.treadling[2]
    for (let i = 0; i < picks(d); i++)
      for (let j = 0; j < ends(d); j++)
        expect(after[i * 8 + j] !== before[i * 8 + j]).toBe(
          d.threading[j] === s && d.treadling[i] === t,
        )
    expect(drawdown(flipAt(flipAt(d, 2, 5), 2, 5))).toEqual(before)
    expect(d.tieup).toEqual(DRAFTS.rosepath.draft.tieup)
  })
  it('threading, treadling and the tie-up change one thing each, where the repeat says', () => {
    const d = draft('houndstooth')
    expect(thread(d, 9, 7).threading).toEqual([0, 7, 2, 3, 0, 1, 2, 3])
    expect(treadle(d, -1, 5).treadling.at(-1)).toBe(5)
    expect(tie(d, 4, 2).tieup).toEqual([3, 6, 12, 9, 4, 0, 0, 0])
    expect(d.threading[1]).toBe(1)
  })
})

describe('the canvas is laid out like a draft on paper', () => {
  const W = 600
  const H = 400
  const c = 10
  const { margin, cols, rows: n } = layoutFor(W, H, c)
  it('measures its parts', () => {
    expect([margin, cols, n]).toEqual([90, 51, 31])
  })
  it('knows what every point is on', () => {
    expect(spotAt(5, 95, W, H, c)).toEqual({ at: 'cloth', row: 0, col: 0 })
    expect(spotAt(505, 395, W, H, c)).toEqual({ at: 'cloth', row: 30, col: 50 })
    // shaft 1 is the threading's bottom row, as drafts draw it
    expect(spotAt(25, 75, W, H, c)).toEqual({ at: 'threading', col: 2, shaft: 0 })
    expect(spotAt(25, 5, W, H, c)).toEqual({ at: 'threading', col: 2, shaft: 7 })
    expect(spotAt(W - 5, 5, W, H, c)).toEqual({ at: 'tieup', treadle: 7, shaft: 7 })
    expect(spotAt(W - 75, 75, W, H, c)).toEqual({ at: 'tieup', treadle: 0, shaft: 0 })
    expect(spotAt(W - 75, 205, W, H, c)).toEqual({ at: 'treadling', row: 11, treadle: 0 })
    // the gutters between are nothing: the column before the treadles, the row under the threading
    expect(spotAt(W - 85, 205, W, H, c)).toEqual({ at: 'none' })
    expect(spotAt(W - 85, 5, W, H, c)).toEqual({ at: 'none' })
    expect(spotAt(25, 85, W, H, c)).toEqual({ at: 'none' })
  })
})
