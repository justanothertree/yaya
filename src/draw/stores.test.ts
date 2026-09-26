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
   * ⚠️ A FULL QUOTA NO LONGER PASSES IN SILENCE. `write` still catches — a keep that
   * threw would be worse than one that half-works — but "it stays for this visit" is only an
   * acceptable bargain if somebody is told it is the bargain they got.
   */
  it('and when storage is full it keeps going, and says the work is only in memory', async () => {
    const g = await theGallery()
    expect(g.gallerySaved()).toBe(true)
    vi.stubGlobal('localStorage', {
      ...fakeStorage,
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() => g.saveArt(art('doomed'))).not.toThrow()
    expect(g.gallery(), 'it is there for this visit').toHaveLength(1)
    expect(store.get('paint_gallery_v1'), 'nothing was written down').toBeUndefined()
    expect(g.gallerySaved(), 'and the room can find out').toBe(false)
  })

  it('and says so again once a write does land', async () => {
    const g = await theGallery()
    vi.stubGlobal('localStorage', {
      ...fakeStorage,
      setItem: () => {
        throw new Error('quota')
      },
    })
    g.saveArt(art('doomed'))
    expect(g.gallerySaved()).toBe(false)
    vi.stubGlobal('localStorage', fakeStorage)
    g.saveArt(art('fine'))
    expect(g.gallerySaved()).toBe(true)
  })

  /**
   * ⚠️ PACKED ON DISK, WHICH IS WORTH ABOUT 1.75x. The store's only limit is a COUNT,
   * so how much room 120 drawings need is decided entirely by how they are spelled. Measured on
   * a realistic creature rather than asserted as a constant, because the ratio is a property of
   * the format rather than a number anybody chose.
   */
  it('and writes drawings packed, which is most of the room it needs', async () => {
    const g = await theGallery()
    const big: Drawing = {
      ...art('Clawbert'),
      strokes: Array.from({ length: 200 }, (_, i) =>
        stroke({
          l: i % 3,
          p: Array.from({ length: 80 }, (_, j) => +Math.abs(Math.sin(i * 7 + j)).toFixed(4)),
        }),
      ),
      layers: ['body', 'wing', 'head'],
    }
    g.saveArt(big)
    const onDisk = store.get('paint_gallery_v1')!.length
    const readable = JSON.stringify([{ id: 'x', at: 0, art: big }]).length
    expect(onDisk).toBeLessThan(readable * 0.75)
  })

  it('and still reads back everything it packed', async () => {
    const g = await theGallery()
    const d: Drawing = {
      ...art('Detailed'),
      bg: '#112233',
      layers: ['body', 'wing'],
      strokes: [stroke({ l: 0, k: 6, e: 2, a: 0.42 }), stroke({ l: 1, t: 'text', x: 'hi' })],
    }
    g.saveArt(d)
    vi.resetModules()
    const back = (await theGallery()).gallery()[0].art
    expect(back.name).toBe('Detailed')
    expect(back.bg).toBe('#112233')
    expect(back.layers).toEqual(['body', 'wing'])
    expect(back.strokes[0].k).toBe(6)
    expect(back.strokes[0].e).toBe(2)
    expect(back.strokes[0].a).toBeCloseTo(0.42, 2)
    expect(back.strokes[1].x).toBe('hi')
  })

  /**
   * ⚠️ AND A GALLERY WRITTEN THE OLD WAY STILL OPENS. readDrawing has always taken both
   * forms, which is the whole reason this was a change rather than a migration — but "whole
   * reason" is a claim, and this is the test of it.
   */
  it('and opens a gallery written the readable way, before any of this', async () => {
    const old = art('Ancient')
    store.set(
      'paint_gallery_v1',
      JSON.stringify([{ id: 'old-1', name: 'Ancient', at: 1, art: old }]),
    )
    const back = (await theGallery()).gallery()
    expect(back).toHaveLength(1)
    expect(back[0].name).toBe('Ancient')
    expect(back[0].art.strokes.length).toBeGreaterThan(0)
  })

  /**
   * ⚠️ A CACHE THAT MAKES ROOM IS A CACHE THAT DELETES, AND THIS ONE REACHED THE ACCOUNT.
   * `write` used to `slice(0, MAX_ITEMS)`, so keeping a 121st picture dropped the oldest out of
   * the list without a word. That is bad on its own; what makes it data loss is that this store
   * is SYNCED. library/cloud.ts watchLibrary compares localRows() against the previous snapshot
   * and sends `library_drop` for every slot that has gone, because while it is watching, "gone
   * from here" can only mean somebody deleted it — the one thing a cold sync cannot establish
   * and the reason sync itself never deletes. An eviction is indistinguishable from a deletion,
   * so the browser tidying up took the real copy off the account with it.
   *
   * So the test is not "the cap holds". It is that NOTHING THAT WAS THERE HAS GONE, which is
   * the precondition watchLibrary reads.
   */
  it('and a keep past the cap is refused rather than made room for', async () => {
    const g = await theGallery()
    for (let i = 0; i < g.GALLERY_LIMIT.items; i++) g.saveArt(art(`pic ${i}`))
    expect(g.gallery()).toHaveLength(g.GALLERY_LIMIT.items)

    const before = g.gallery().map((a) => a.name)
    expect(g.saveArt(art('one too many')), 'it should not have been kept').toBeNull()
    expect(g.keepTrouble()).toBe('full')
    expect(
      g.gallery().map((a) => a.name),
      'something disappeared, and a sync would drop it',
    ).toEqual(before)
    expect(before, 'the oldest is the one eviction used to take').toContain('pic 0')
  })

  it('and replacing a name you already have still works when it is full', async () => {
    const g = await theGallery()
    for (let i = 0; i < g.GALLERY_LIMIT.items; i++) g.saveArt(art(`pic ${i}`))
    const again = g.saveArt({ ...art('pic 7'), bg: '#123456' })
    expect(again, 'replacing takes no new room').not.toBeNull()
    expect(g.gallery()).toHaveLength(g.GALLERY_LIMIT.items)
    expect(g.gallery().find((a) => a.name === 'pic 7')!.art.bg).toBe('#123456')
  })

  /**
   * ⚠️ AND A BUDGET IN BYTES, because a count decides nothing about room. 120 items was
   * the only limit this store had, so how much of the origin it could take was settled entirely
   * by how the items were spelled — measured, 120 detailed creatures is 7.9MB packed against a
   * typical five-megabyte quota.
   */
  it('and one enormous picture is refused on its own', async () => {
    const g = await theGallery()
    const monster: Drawing = {
      ...art('Monster'),
      strokes: Array.from({ length: 400 }, (_, i) =>
        stroke({
          p: Array.from({ length: 400 }, (_, j) => +Math.abs(Math.sin(i * 3 + j)).toFixed(4)),
        }),
      ),
    }
    expect(g.artBytes(monster)).toBeGreaterThan(g.GALLERY_LIMIT.one)
    expect(g.saveArt(monster)).toBeNull()
    expect(g.keepTrouble()).toBe('too-big')
    expect(g.gallery(), 'and nothing was disturbed getting there').toHaveLength(0)
  })

  it('and the budget is a total, not only a per-picture ceiling', async () => {
    const g = await theGallery()
    const chunky = (n: string): Drawing => ({
      ...art(n),
      strokes: Array.from({ length: 120 }, (_, i) =>
        stroke({
          p: Array.from({ length: 200 }, (_, j) => +Math.abs(Math.sin(i * 5 + j)).toFixed(4)),
        }),
      ),
    })
    let kept = 0
    for (let i = 0; i < g.GALLERY_LIMIT.items; i++) {
      if (!g.saveArt(chunky(`big ${i}`))) break
      kept++
    }
    expect(kept, 'the item cap was reached before the byte one').toBeLessThan(g.GALLERY_LIMIT.items)
    expect(g.keepTrouble()).toBe('full')
    expect(g.galleryRoom().bytes).toBeLessThanOrEqual(g.GALLERY_LIMIT.bytes)
  })

  it('and the size it reports is the size it writes', async () => {
    const g = await theGallery()
    g.saveArt(art('One'))
    g.saveArt(art('Two'))
    expect(g.galleryRoom().bytes).toBe(store.get('paint_gallery_v1')!.length)
    expect(g.galleryRoom().items).toBe(2)
  })
})

/**
 * ⚠️ THE SAME EVICTION LIVED IN EVERY STORE THAT SYNCS, which is what turns one bug into
 * a rule. Songs, minions and saved looks all capped by slicing in `write`, all four are kinds in
 * library/cloud.ts, and watchLibrary reads all of them the same way. Fixing one and leaving three
 * would be worse than leaving all four: a data-loss path you have half-closed is one nobody looks
 * at again.
 */
describe('no synced store makes room by dropping something', () => {
  it('minions refuse the one past the cap rather than losing the first', async () => {
    const m = await import('../pets/pets')
    /* ⚠️ BOUNDED, because a while() that stops when the store refuses is a while() that
       never stops if the store goes back to evicting — which is exactly the state this test
       has to survive being run in. The probe that proves it must fail, not hang. */
    let n = 0
    while (n < 500 && m.savePet(`Minion ${n}`, art(`Minion ${n}`))) n++
    expect(n, 'it kept saving forever, so it is still making room').toBeLessThan(500)
    const before = m.pets().map((p) => p.name)
    expect(m.savePet('One too many', art('One too many'))).toBeNull()
    expect(
      m.pets().map((p) => p.name),
      'a minion disappeared, and a sync would drop it',
    ).toEqual(before)
    expect(before).toContain('Minion 0')
  })

  it('and the song library does the same', async () => {
    const l = await import('../audio/library')
    /* ⚠️ the shape readSong actually wants — layers with a note that is ON, since
       songNotes counts those and refuses a song with none */
    const song = (name: string) => ({
      v: 1,
      name,
      bpm: 120,
      bars: 1,
      layers: [
        {
          instrument: 'pad',
          muted: false,
          len: 2,
          fx: {},
          events: [
            { t: 0, midi: 60, on: true },
            { t: 0.5, midi: 60, on: false },
          ],
        },
      ],
    })
    let n = 0
    while (n < 500 && l.saveToLibrary('song', song(`Song ${n}`) as never)) n++
    expect(n, 'it kept saving forever, so it is still making room').toBeLessThan(500)
    const before = l.library().map((i) => i.name)
    expect(l.saveToLibrary('song', song('One too many') as never)).toBeNull()
    expect(l.library().map((i) => i.name)).toEqual(before)
    expect(before).toContain('Song 0')
  })

  it('and so do the saved looks', async () => {
    const v = await import('../audio/vizPresets')
    let n = 0
    while (n < 500) {
      const was = v.readPresets().length
      v.savePreset(`Look ${n}`, { hue: n })
      if (v.readPresets().length === was) break
      n++
    }
    expect(n, 'it kept saving forever, so it is still making room').toBeLessThan(500)
    const before = v.readPresets().map((p) => p.name)
    v.savePreset('One too many', { hue: 999 })
    expect(v.readPresets().map((p) => p.name)).toEqual(before)
    expect(before).toContain('Look 0')
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

  /**
   * ⚠️ AND REFUSES THE ONE PAST THE CAP RATHER THAN DROPPING THE OLDEST, which matters
   * more here than anywhere: maps are not a kind in library/cloud.ts, so this store IS the copy.
   * An eviction in the gallery costs you a trip to the server; an eviction here is the end of
   * that map.
   */
  it('and refuses the one past the cap rather than losing the first', async () => {
    const m = await theMaps()
    for (let i = 0; i < m.MAP_LIMIT.items; i++) expect(m.saveMap(mapDoc(`map ${i}`))).not.toBeNull()
    const before = m.parkMaps().map((x) => x.name)
    expect(m.saveMap(mapDoc('one too many'))).toBeNull()
    expect(
      m.parkMaps().map((x) => x.name),
      'a map disappeared, and nothing has a copy',
    ).toEqual(before)
    expect(before).toContain('map 0')
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
