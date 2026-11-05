import { describe, expect, it } from 'vitest'
import code from './glass.wgsl?raw'
import { GLASS, LEAD, PASSES, labelAll, packGlass, roseWindow, type Grid } from './glass'
import { wgslLayout } from './wgslLayout'

/** the plain answer: flood fill each pane from scratch */
function floodPanes(g: Grid): Int32Array {
  const pane = new Int32Array(g.w * g.h).fill(-1)
  let n = 0
  for (let s = 0; s < pane.length; s++) {
    if (g.lead[s] || pane[s] >= 0) continue
    const stack = [s]
    pane[s] = n
    while (stack.length) {
      const i = stack.pop()!
      const x = i % g.w
      const y = Math.floor(i / g.w)
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue
        const j = ny * g.w + nx
        if (!g.lead[j] && pane[j] < 0) {
          pane[j] = n
          stack.push(j)
        }
      }
    }
    n++
  }
  return pane
}

/** do the labels split the window into exactly the panes a flood fill finds? */
function samePanes(g: Grid, labels: Uint32Array) {
  const pane = floodPanes(g)
  const byPane = new Map<number, number>()
  const byLabel = new Map<number, number>()
  for (let i = 0; i < labels.length; i++) {
    if (g.lead[i]) {
      if (labels[i] !== LEAD) return false
      continue
    }
    if (byPane.has(pane[i]) && byPane.get(pane[i]) !== labels[i]) return false
    if (byLabel.has(labels[i]) && byLabel.get(labels[i]) !== pane[i]) return false
    byPane.set(pane[i], labels[i])
    byLabel.set(labels[i], pane[i])
  }
  return true
}

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('the shader and this file describe one window', () => {
  const wgsl = wgslLayout(code, 'Glass')
  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = GLASS
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })
  it('writes every field where the shader will look for it', () => {
    const v = new DataView(
      packGlass({
        w: 640,
        h: 480,
        grid: [320, 240],
        sun: [-0.5, 0.75],
        tap: [12.7, 30.2],
        colour: [0.25, 0.5, 0.75],
        dabs: 3,
        brush: 2.5,
        floor: 0.375,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const s = (k: string, i = 0) => v.getInt32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    expect([
      u('size'),
      u('size', 1),
      u('grid'),
      u('grid', 1),
      s('tap'),
      s('tap', 1),
      u('dabs'),
    ]).toEqual([640, 480, 320, 240, 12, 30, 3])
    expect([
      f('sun'),
      f('sun', 1),
      f('colour'),
      f('colour', 1),
      f('colour', 2),
      f('colour', 3),
      f('brush'),
      f('floor'),
    ]).toEqual([-0.5, 0.75, 0.25, 0.5, 0.75, 1, 2.5, 0.375])
    const none = new DataView(
      packGlass({
        w: 1,
        h: 1,
        grid: [1, 1],
        sun: [0, 0],
        tap: null,
        colour: [0, 0, 0],
        dabs: 0,
        brush: 0,
        floor: 0,
      }),
    )
    expect(none.getInt32(wgsl.offsets.tap, true)).toBe(-1)
  })
})

describe('finding the panes', () => {
  it('finds exactly the panes a flood fill finds, in a rose window and in scribbles', () => {
    const rose = roseWindow(120, 90)
    const g: Grid = { w: 120, h: 90, lead: rose.lead }
    expect(samePanes(g, labelAll(g).labels)).toBe(true)
    const rand = lcg(3)
    for (let k = 0; k < 5; k++) {
      const lead = new Uint8Array(80 * 60)
      for (let s = 0; s < 12; s++) {
        let x = rand() * 80
        let y = rand() * 60
        const a = rand() * Math.PI * 2
        for (let t = 0; t < 60; t++) {
          x += Math.cos(a + Math.sin(t * 0.1) * 0.6)
          y += Math.sin(a + Math.sin(t * 0.1) * 0.6)
          if (x >= 0 && y >= 0 && x < 80 && y < 60) lead[Math.floor(y) * 80 + Math.floor(x)] = 1
        }
      }
      const s: Grid = { w: 80, h: 60, lead }
      expect(samePanes(s, labelAll(s).labels), `scribble ${k}`).toBe(true)
    }
  })

  it('crosses a long winding pane in far fewer passes than it has cells, thanks to the jump', () => {
    // a spiral corridor 1 cell wide: the worst shape for passing a label along
    const w = 61
    const lead = new Uint8Array(w * w).fill(1)
    let x = 1
    let y = 1
    let len = w - 3
    const dirs = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]
    let corridor = 0
    for (let d = 0; len > 0; d++) {
      const [dx, dy] = dirs[d % 4]
      for (let k = 0; k < len; k++) {
        lead[y * w + x] = 0
        corridor++
        x += dx
        y += dy
      }
      if (d % 2 === 1) len -= 2
    }
    const g: Grid = { w, h: w, lead }
    const { labels, passes } = labelAll(g)
    expect(samePanes(g, labels)).toBe(true)
    // one cell a pass would take as many passes as the corridor is long
    expect(passes).toBeLessThan(corridor / 8)
    // and an ordinary window settles within a single frame's passes
    const rose = roseWindow(320, 240)
    expect(labelAll({ w: 320, h: 240, lead: rose.lead }).passes).toBeLessThanOrEqual(PASSES)
  })
})
