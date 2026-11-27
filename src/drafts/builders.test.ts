import { describe, expect, it } from 'vitest'
import type { Drawing } from '../draw/strokes'
import { readHoleDraft, type HoleDraft } from '../gpu/putt'
import { readDrawing as readWall, type Drawing as Wall } from '../gpu/wallpaper'
import { readMapDoc, type MapDoc } from '../park/mapDoc'
import { blankZone, brushZone, packZone, readZone } from '../park/zone'
import { makeDrafts, memoryBackend } from './drafts'

/**
 * A builder's unsaved work, a reload, and the work back — for the three builders that used to
 * hold it nowhere but in React state: the Putt hole builder, the Wallpaper toy and the map maker.
 *
 * ⚠️ A RELOAD IS A FRESH STORE OVER THE SAME ROWS, copied on the way in and out as IndexedDB does,
 * and each fixture sets every field to something other than its default (CLAUDE.md §2), so a
 * reader that dropped one would go red here rather than on somebody's phone.
 */

const ann = () => 'ann'
async function reload<T>(
  kind: 'putt' | 'wallpaper' | 'map',
  body: unknown,
  parse: (raw: unknown) => T | null,
) {
  const rows = new Map<string, unknown>()
  await makeDrafts(memoryBackend(rows), ann).write(kind, body)
  return {
    back: (await makeDrafts(memoryBackend(rows), ann).read(kind, parse))?.body ?? null,
    stranger: await makeDrafts(memoryBackend(rows), () => 'bo').read(kind, parse),
  }
}

describe('Putt: a hole half-built', () => {
  /* ten across, fifteen down; deliberately NOT playable — two tees, no cup — because a hole
     half-made is exactly the work worth bringing back */
  const tiles =
    'x'.repeat(10) + ('xgsswwggtx'.repeat(13) + 'xggggggtgx').slice(0, 130) + 'x'.repeat(10)

  it('comes back tile for tile, with the kept hole it was an edit of', async () => {
    expect(tiles).toHaveLength(150)
    const body: HoleDraft = { draft: tiles, editing: 4 }
    const { back, stranger } = await reload('putt', body, readHoleDraft)
    expect(back).toEqual(body)
    expect(stranger).toBeNull()
  })

  it('a new hole is not an edit of anything, and an index that names no kept hole is dropped', () => {
    expect(readHoleDraft({ draft: tiles, editing: null })?.editing).toBeNull()
    expect(readHoleDraft({ draft: tiles, editing: 9 })?.editing).toBeNull()
    expect(readHoleDraft({ draft: tiles, editing: 1.5 })?.editing).toBeNull()
  })

  it('refuses what is not a hole', () => {
    for (const junk of [
      null,
      'x',
      {},
      { draft: tiles.slice(1) },
      { draft: tiles.replace('g', 'q') },
      { draft: 7 },
    ])
      expect(readHoleDraft(junk)).toBeNull()
  })
})

describe('Wallpaper: a pattern being drawn', () => {
  const wall: Wall = {
    group: 'p6m',
    background: 2,
    strokes: [
      {
        colour: 3,
        width: 0.05,
        points: [
          [0.1, 0.2],
          [0.35, 0.4],
          [0.6, 0.45],
        ],
      },
      { colour: 5, width: 0.012, points: [[-0.2, 1.3]] },
    ],
  }

  it('comes back stroke for stroke, in its group and on its background', async () => {
    const { back, stranger } = await reload('wallpaper', wall, readWall)
    expect(back).toEqual(wall)
    expect(stranger).toBeNull()
  })
})

describe('the map maker: a map not yet kept', () => {
  const ink = (c: string): Drawing => ({
    v: 1,
    name: 'stone',
    ratio: 1.2,
    bg: null,
    strokes: [{ t: 'rect', c, a: 0.8, w: 0.04, p: [0.1, 0.1, 0.8, 0.9] }],
  })
  const zone = blankZone()
  brushZone(zone, 0.3, 0.4, 0.05, true)
  const map: MapDoc = {
    v: 1,
    name: 'Cellar garden',
    palette: [ink('#4a7c3f'), ink('#7c3f4a')],
    pieces: [{ art: 1, at: { x: 0.3, y: 0.7 }, wide: 0.12, kind: 'wall', top: 0.4, life: 'boss' }],
    ground: { ...ink('#3f4a7c'), name: 'ground' },
    spawn: { x: 0.4, y: 0.6 },
    block: packZone(zone),
    doors: [{ at: { x: 0.9, y: 0.5 }, wide: 0.06, to: 'Cellar' }],
  }

  it('comes back whole — name, drawings, pieces, ground, spawn, the no-walk zone and the doors', async () => {
    const { back, stranger } = await reload('map', map, readMapDoc)
    expect(stranger).toBeNull()
    expect(back).not.toBeNull()
    const m = back!
    expect(m.name).toBe('Cellar garden')
    expect(m.palette.map((d) => d.strokes[0].c)).toEqual(['#4a7c3f', '#7c3f4a'])
    expect(m.pieces).toHaveLength(1)
    expect(m.pieces[0].art).toBe(1)
    expect(m.pieces[0].kind).toBe('wall')
    expect(m.pieces[0].life).toBe('boss')
    expect(m.pieces[0].at.x).toBeCloseTo(0.3, 2)
    expect(m.pieces[0].at.y).toBeCloseTo(0.7, 2)
    expect(m.pieces[0].wide).toBeCloseTo(0.12, 2)
    expect(m.pieces[0].top).toBeCloseTo(0.4, 1)
    expect(m.ground?.strokes[0].c).toBe('#3f4a7c')
    expect(m.spawn).toEqual({ x: 0.4, y: 0.6 })
    /* the zone, cell for cell — measured through its own reader, not compared as text */
    expect(Array.from(readZone(m.block)!)).toEqual(Array.from(zone))
    expect(zone.some(Boolean)).toBe(true)
    expect(m.doors).toEqual([{ at: { x: 0.9, y: 0.5 }, wide: 0.06, to: 'Cellar' }])
  })
})
