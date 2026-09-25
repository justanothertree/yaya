import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Drawing, Stroke } from './strokes'
import type { MapDoc } from '../park/mapDoc'

/**
 * The two stores that hold what people have actually made.
 *
 * ⚠️ EVERY OTHER MODULE CAN BE WRONG AND BE FIXED; THESE CAN BE WRONG AND TAKE SOMEBODY'S WORK
 * WITH THEM. Both carry a recorded bug in their own comments: keeping under a name that already
 * exists has to REPLACE, and it used to prepend — so finishing a minion three times left one
 * creature and three copies of its drawing. "Measured: three keeps of one name gave three
 * gallery entries and one minion."
 *
 * ⚠️ AND BOTH RE-VALIDATE ON THE WAY OUT AS WELL AS IN, because localStorage is editable by
 * anything on this origin: what a trusted path wrote is not necessarily what comes back.
 *
 * ⚠️ A FRESH MODULE PER TEST, because each store caches. Once `gallery()` has read, it never
 * reads again — so a test that wrote through the back door would be talking to a stale cache.
 * vi.resetModules plus a dynamic import is the only honest way to ask these anything twice.
 */

const store = new Map<string, string>()

const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}

beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', fakeStorage)
  vi.resetModules()
})

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  t: 'brush',
  c: '#4a7c3f',
  a: 1,
  w: 0.03,
  p: [0.3, 0.3, 0.7, 0.7],
  ...over,
})

const art = (name: string): Drawing => ({
  v: 1,
  name,
  ratio: 1,
  bg: null,
  strokes: [stroke()],
})

const mapDoc = (name: string): MapDoc => ({
  v: 1,
  name,
  palette: [art('rock')],
  pieces: [{ art: 0, at: { x: 0.5, y: 0.5 }, wide: 0.1, kind: 'flat', top: 0 }],
  ground: null,
  spawn: null,
  block: null,
  doors: [],
})

const theGallery = () => import('./gallery')
const theMaps = () => import('../park/maps')

describe('the gallery', () => {
  it('starts empty and keeps what you give it', async () => {
    const g = await theGallery()
    expect(g.gallery()).toEqual([])
    expect(g.saveArt(art('Clawbert'))).toBeTruthy()
    expect(g.gallery().map((a) => a.name)).toEqual(['Clawbert'])
  })

  /**
   * ⚠️ THE RECORDED BUG. Three keeps of one name gave three gallery entries and one minion,
   * which is the two stores disagreeing about what a name means — and it matters most exactly
   * where both are written at once, because finishing a minion saves to both.
   */
  it('and keeping the same name again replaces rather than piling up', async () => {
    const g = await theGallery()
    g.saveArt(art('Flappy'))
    g.saveArt(art('Flappy'))
    g.saveArt(art('Flappy'))
    expect(g.gallery()).toHaveLength(1)
  })

  /* ⚠️ "Flappy" and "flappy" are one picture to everybody except a string comparison */
  it('and it does not care about capitals', async () => {
    const g = await theGallery()
    g.saveArt(art('Flappy'))
    g.saveArt(art('FLAPPY'))
    g.saveArt(art('flappy'))
    expect(g.gallery()).toHaveLength(1)
  })

  it('but two different names are two pictures', async () => {
    const g = await theGallery()
    g.saveArt(art('one'))
    g.saveArt(art('two'))
    expect(g.gallery()).toHaveLength(2)
  })

  it('and the newest is at the front', async () => {
    const g = await theGallery()
    g.saveArt(art('older'))
    g.saveArt(art('newer'))
    expect(g.gallery()[0].name).toBe('newer')
  })

  it('and refuses a drawing with nothing on it', async () => {
    const g = await theGallery()
    expect(g.saveArt({ ...art('empty'), strokes: [] })).toBeNull()
    expect(g.gallery()).toEqual([])
  })

  it('and taking one out leaves the others', async () => {
    const g = await theGallery()
    const keep = g.saveArt(art('keep'))!
    g.saveArt(art('bin'))
    const bin = g.gallery().find((a) => a.name === 'bin')!
    g.removeArt(bin.id)
    expect(g.gallery().map((a) => a.name)).toEqual(['keep'])
    expect(g.gallery()[0].id).toBe(keep.id)
  })

  it('and survives a reload, because it actually wrote something down', async () => {
    const g = await theGallery()
    g.saveArt(art('Persist'))
    vi.resetModules()
    const again = await theGallery()
    expect(again.gallery().map((a) => a.name)).toEqual(['Persist'])
  })

  /**
   * ⚠️ VALIDATED ON THE WAY OUT, which is the rule this file states and the reason it states
   * it. Anything on this origin can write to localStorage, so what comes back is not
   * necessarily what a trusted path put there.
   */
  it('and shrugs off rubbish somebody else wrote into storage', async () => {
    store.set('paint_gallery_v1', 'not json at all')
    expect((await theGallery()).gallery()).toEqual([])
    vi.resetModules()
    store.set('paint_gallery_v1', JSON.stringify({ not: 'an array' }))
    expect((await theGallery()).gallery()).toEqual([])
    vi.resetModules()
    store.set('paint_gallery_v1', JSON.stringify([1, 'two', null, { art: 'nope' }]))
    expect((await theGallery()).gallery()).toEqual([])
  })

  it('and tells whoever is listening that something changed', async () => {
    const g = await theGallery()
    let told = 0
    const stop = g.subscribeGallery(() => told++)
    g.saveArt(art('a'))
    g.saveArt(art('b'))
    expect(told).toBe(2)
    stop()
    g.saveArt(art('c'))
    expect(told).toBe(2)
  })

  /**
   * ⚠️ WHAT HAPPENS WHEN STORAGE IS FULL, WRITTEN DOWN BECAUSE IT IS A WAY TO LOSE
   * WORK. `write` catches the quota error and carries on — "storage full or blocked, it stays
   * for this visit" — so the drawing is in memory, absent from disk, and gone on reload with
   * nothing said. This test asserts that as it IS rather than as it should be, so that the day
   * somebody gives the gallery a byte budget or a way to complain, this is what turns red.
   *
   * ⚠️ AND IT IS REACHABLE, NOT THEORETICAL. Measured: a detailed drawing — 200 strokes
   * of 40 points — is 118KB written the way this store writes it, so the 120-item cap is 13.8MB
   * against a typical 5MB quota. The sibling maps store carries BOTH a byte ceiling and a packed
   * palette for exactly this reason, and says so in its own comments; the gallery has neither.
   * Packing alone would buy 1.75x and still not be enough, which is why this is a finding to
   * decide about rather than a line to change.
   */
  it('and when storage is full it keeps going, but the work is only in memory', async () => {
    const g = await theGallery()
    vi.stubGlobal('localStorage', {
      ...fakeStorage,
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() => g.saveArt(art('doomed'))).not.toThrow()
    expect(g.gallery(), 'it is there for this visit').toHaveLength(1)
    /* but nothing reached disk, so a reload loses it and nobody was told */
    expect(store.get('paint_gallery_v1'), 'nothing was written down').toBeUndefined()
  })

  it('and the gallery has no byte budget, unlike the maps beside it', async () => {
    const m = await theMaps()
    const g = await theGallery()
    /* maps knows how big it is allowed to be; the gallery counts items only */
    expect(m.MAP_LIMIT.bytes).toBeGreaterThan(0)
    expect('GALLERY_LIMIT' in g || 'galleryBytes' in g, 'the gallery grew a byte cap').toBe(false)
  })
})

describe('the maps store', () => {
  it('keeps one and gives it back', async () => {
    const m = await theMaps()
    expect(m.parkMaps()).toEqual([])
    expect(m.saveMap(mapDoc('Hall'))).toBeTruthy()
    expect(m.parkMaps().map((x) => x.name)).toEqual(['Hall'])
  })

  it('and one name is one map, whatever the capitals', async () => {
    const m = await theMaps()
    m.saveMap(mapDoc('Hall'))
    m.saveMap(mapDoc('HALL'))
    expect(m.parkMaps()).toHaveLength(1)
  })

  it('and deleting one leaves the rest', async () => {
    const m = await theMaps()
    m.saveMap(mapDoc('keep'))
    const bin = m.saveMap(mapDoc('bin'))!
    m.removeMap(bin.id)
    expect(m.parkMaps().map((x) => x.name)).toEqual(['keep'])
  })

  /**
   * ⚠️ A CEILING PER MAP, REASONED FROM THE WORST CASE. A single drawing can reach about
   * eighty kilobytes at the stroke limit, so a palette of twenty-four is near two megabytes —
   * one map able to fill the whole origin on its own.
   */
  it('and refuses one too big to keep, rather than failing quietly', async () => {
    const m = await theMaps()
    const huge = mapDoc('Huge')
    huge.palette = [
      {
        ...art('vast'),
        strokes: Array.from({ length: 900 }, (_, i) =>
          stroke({ p: Array.from({ length: 200 }, (_, j) => ((i * j) % 1000) / 1000) }),
        ),
      },
    ]
    expect(m.mapBytes(huge)).toBeGreaterThan(m.MAP_LIMIT.bytes)
    expect(m.saveMap(huge)).toBeNull()
    expect(m.parkMaps()).toEqual([])
  })

  it('and keeps no more than its cap however many you save', async () => {
    const m = await theMaps()
    for (let i = 0; i < m.MAP_LIMIT.items + 5; i++) m.saveMap(mapDoc(`map ${i}`))
    expect(m.parkMaps().length).toBeLessThanOrEqual(m.MAP_LIMIT.items)
  })

  it('and survives a reload with its palette intact', async () => {
    const m = await theMaps()
    m.saveMap(mapDoc('Cellar'))
    vi.resetModules()
    const again = await theMaps()
    const back = again.parkMaps()[0]
    expect(back.name).toBe('Cellar')
    expect(back.doc.palette).toHaveLength(1)
    expect(back.doc.palette[0].strokes.length).toBeGreaterThan(0)
    expect(back.doc.pieces).toHaveLength(1)
  })

  it('and shrugs off rubbish somebody else wrote into storage', async () => {
    store.set('park_maps_v1', '{{{')
    expect((await theMaps()).parkMaps()).toEqual([])
    vi.resetModules()
    store.set('park_maps_v1', JSON.stringify([{ id: 'x', doc: { palette: 'no' } }, 42]))
    expect((await theMaps()).parkMaps()).toEqual([])
  })

  it('and tells whoever is listening', async () => {
    const m = await theMaps()
    let told = 0
    const stop = m.subscribeMaps(() => told++)
    m.saveMap(mapDoc('a'))
    expect(told).toBe(1)
    stop()
    m.saveMap(mapDoc('b'))
    expect(told).toBe(1)
  })
})

describe('the two stores agree about what a name means', () => {
  /**
   * ⚠️ THIS IS THE RULE THE RECORDED BUG BROKE. The gallery and the minions disagreeing about
   * whether a name replaces is what left one creature and three copies of its drawing, and the
   * maps store was written to the same rule on purpose. If one of them ever drifts, the other
   * is where you find out.
   */
  it('so saving the same name three times leaves one of each', async () => {
    const g = await theGallery()
    const m = await theMaps()
    for (let i = 0; i < 3; i++) {
      g.saveArt(art('Same'))
      m.saveMap(mapDoc('Same'))
    }
    expect(g.gallery()).toHaveLength(1)
    expect(m.parkMaps()).toHaveLength(1)
  })
})
