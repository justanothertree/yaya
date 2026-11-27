import { describe, expect, it } from 'vitest'
import { makeDrafts, memoryBackend } from '../drafts/drafts'
import { contentSig, EMPTY_SIG, offerFor, packPaintDraft, readPaintDraft } from './paintDraft'
import type { PaintSession } from './session'
import type { Stroke } from './strokes'

/**
 * A Paint draft, round-tripped through a reload.
 *
 * ⚠️ EVERY FIELD IS SOMETHING OTHER THAN ITS DEFAULT (CLAUDE.md §2). A round trip is only worth
 * the fields its fixture fills, so this minion has a background, a hidden layer, named layers,
 * frames, a rate, a shape, a name, and one of each kind of move map — and every stroke sets every
 * field a stroke has. Drop any of them from packPaintDraft and the first test goes red.
 */

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  t: 'brush',
  c: '#ff6600',
  a: 0.7,
  w: 0.02,
  k: 4,
  e: 2,
  l: 1,
  f: 2,
  x: 'roar',
  p: [0.1, 0.2, 0.3, 0.4, 0.5, 0.25],
  ...over,
})

const MINION: PaintSession = {
  strokes: [
    stroke(),
    { t: 'line', c: '#00aa88', a: 0.5, w: 0.05, k: 6, e: 3, l: 0, f: 0, p: [0.6, 0.6, 0.9, 0.1] },
  ],
  bg: '#112233',
  hidden: [1],
  layerNames: ['body', 'wing'],
  ratio: 0.8,
  name: 'Clawbert',
  fps: 12,
  hits: { wing: 'slam' },
  acts: { '1': 'wing' },
  poses: { '2': 'tell' },
  spells: { '1': 'bolt' },
}

describe('a minion drawn, a reload, and the minion back', () => {
  it('comes back field for field, guide and all', async () => {
    const rows = new Map<string, unknown>()
    await makeDrafts(memoryBackend(rows), () => 'ann').write('paint', packPaintDraft(MINION, true))
    /* the reload: nothing in memory, a fresh store on the same rows */
    const back = await makeDrafts(memoryBackend(rows), () => 'ann').read('paint', readPaintDraft)
    expect(back?.body.minion).toBe(true)
    const s = back!.body.session
    expect(s.strokes).toEqual(MINION.strokes)
    expect(s.bg).toBe('#112233')
    expect(s.hidden).toEqual([1])
    expect(s.layerNames).toEqual(['body', 'wing'])
    expect(s.ratio).toBeCloseTo(0.8)
    expect(s.name).toBe('Clawbert')
    expect(s.fps).toBe(12)
    expect(s.hits).toEqual({ wing: 'slam' })
    expect(s.acts).toEqual({ '1': 'wing' })
    expect(s.poses).toEqual({ '2': 'tell' })
    expect(s.spells).toEqual({ '1': 'bolt' })
    expect(contentSig(s)).toBe(contentSig(MINION))
  })

  it('a picture made without the guide comes back as a picture', () => {
    expect(readPaintDraft(packPaintDraft(MINION, false))?.minion).toBe(false)
  })

  it('a page on Free comes back on Free, with no name, not 1.5 and "Untitled"', () => {
    const free: PaintSession = { strokes: [stroke()], bg: null, hidden: [], layerNames: [] }
    const s = readPaintDraft(packPaintDraft(free, false))!.session
    expect(s.ratio).toBeUndefined()
    expect(s.name).toBeUndefined()
  })

  it('an empty page is not offered — there is nothing to lose', () => {
    expect(readPaintDraft(packPaintDraft({ ...MINION, strokes: [] }, true))).toBeNull()
  })

  it('goes through the gallery’s reader: what a file may not hold, a draft may not either', () => {
    const tampered = packPaintDraft(MINION, true) as {
      drawing: { bg: string; strokes: unknown[] }
      hidden: unknown[]
    }
    tampered.drawing.bg = 'url(javascript:x)'
    tampered.drawing.strokes = [{ t: 'not-a-tool', p: [0, 0, 1, 1] }, ...tampered.drawing.strokes]
    tampered.hidden = [1, -3, 99, 'x', 1.5, 1]
    const s = readPaintDraft(tampered)!.session
    expect(s.bg).toBeNull()
    expect(s.strokes).toHaveLength(2)
    expect(s.hidden).toEqual([1])
  })

  it('junk is null, never a throw', () => {
    for (const junk of [
      null,
      undefined,
      3,
      'x',
      {},
      { drawing: 'x' },
      { drawing: { strokes: 'x' } },
    ])
      expect(readPaintDraft(junk)).toBeNull()
  })
})

describe('contentSig: what counts as unsaved', () => {
  const base = { strokes: [stroke()], bg: null, layerNames: ['body'] }

  it('an edit is a change: a stroke, the paper, a layer’s name, the rate, a move', () => {
    const s = contentSig(base)
    expect(contentSig({ ...base, strokes: [stroke(), stroke()] })).not.toBe(s)
    expect(contentSig({ ...base, bg: '#000000' })).not.toBe(s)
    expect(contentSig({ ...base, layerNames: ['wing'] })).not.toBe(s)
    expect(contentSig({ ...base, fps: 12 })).not.toBe(s)
    expect(contentSig({ ...base, hits: { body: 'slam' } })).not.toBe(s)
    expect(contentSig({ ...base, acts: { '0': 'wing' } })).not.toBe(s)
    expect(contentSig({ ...base, poses: { '0': 'tell' } })).not.toBe(s)
    expect(contentSig({ ...base, spells: { '0': 'bolt' } })).not.toBe(s)
  })

  it('every field of a stroke is part of the picture', () => {
    const s = contentSig(base)
    const changes: Partial<Stroke>[] = [
      { t: 'line' },
      { c: '#000000' },
      { a: 0.3 },
      { w: 0.09 },
      { k: 6 },
      { e: 1 },
      { l: 2 },
      { f: 0 },
      { x: 'hiss' },
      { p: [0.1, 0.2, 0.3, 0.41] },
    ]
    for (const c of changes)
      expect(contentSig({ ...base, strokes: [stroke(c)] }), JSON.stringify(c)).not.toBe(s)
  })

  it('a stroke read back by the gallery’s reader is the same picture as the one drawn', () => {
    const drawn: Stroke = { t: 'brush', c: '#ff6600', a: 1, w: 0.01, p: [0, 0, 1, 1] }
    const back = readPaintDraft(
      packPaintDraft({ strokes: [drawn], bg: null, hidden: [], layerNames: [] }, false),
    )!
    expect(contentSig(back.session)).toBe(
      contentSig({ strokes: [drawn], bg: null, layerNames: [] }),
    )
  })

  it('the two spellings of nothing are the same picture', () => {
    const s = contentSig(base)
    const bare: Stroke = { t: 'brush', c: '#ff6600', a: 1, w: 0.01, p: [0, 0, 1, 1] }
    const one = (k: Stroke) => contentSig({ ...base, strokes: [k] })
    /* no layer IS layer 0 and no symmetry or echo is 0 — but no frame means every frame */
    expect(one({ ...bare, l: 0, k: 0, e: 0 })).toBe(one(bare))
    expect(one({ ...bare, f: 0 })).not.toBe(one(bare))
    expect(contentSig({ ...base, fps: 8 })).toBe(s)
    expect(contentSig({ ...base, hits: {}, acts: {}, poses: {}, spells: {} })).toBe(s)
    expect(contentSig({ ...base, layerNames: ['body', '', ''] })).toBe(s)
    expect(contentSig({ ...base, hits: { b: 'x', a: 'y' } })).toBe(
      contentSig({ ...base, hits: { a: 'y', b: 'x' } }),
    )
  })

  it('a stroke’s call id is not part of the picture', () => {
    expect(contentSig({ ...base, strokes: [stroke({ id: 'peer-7' })] })).toBe(contentSig(base))
  })

  it('the empty page is the baseline', () => {
    expect(contentSig({ strokes: [], bg: null, layerNames: [] })).toBe(EMPTY_SIG)
    expect(contentSig(base)).not.toBe(EMPTY_SIG)
  })
})

describe('the room across a reload: offer, bring back, save, and nothing left over', () => {
  const ann = () => 'ann'
  const page = (strokes: Stroke[]): PaintSession => ({
    strokes,
    bg: null,
    hidden: [],
    layerNames: ['body'],
  })

  it('a minion drawn and not saved is offered on the empty page after a reload, and only once saved is it gone', async () => {
    const rows = new Map<string, unknown>()
    /* drawing: the room keeps a draft of the unsaved page */
    await makeDrafts(memoryBackend(rows), ann).write('paint', packPaintDraft(MINION, true))

    /* reload: nothing in memory, the page empty — the draft is offered */
    const first = await makeDrafts(memoryBackend(rows), ann).read('paint', readPaintDraft)
    expect(offerFor(first?.body ?? null, EMPTY_SIG)).toBe(true)

    /* brought back: the page IS the draft, so a second look offers nothing */
    const pageSig = contentSig(first!.body.session)
    expect(offerFor(first!.body, pageSig)).toBe(false)

    /* saved: the room drops the draft — and the next reload has nothing to offer */
    await makeDrafts(memoryBackend(rows), ann).drop('paint')
    const after = await makeDrafts(memoryBackend(rows), ann).read('paint', readPaintDraft)
    expect(offerFor(after?.body ?? null, EMPTY_SIG)).toBe(false)
  })

  it('walking to Games and back is not a reload: the page and its draft agree, so nothing is asked', async () => {
    const rows = new Map<string, unknown>()
    await makeDrafts(memoryBackend(rows), ann).write('paint', packPaintDraft(MINION, true))
    const d = await makeDrafts(memoryBackend(rows), ann).read('paint', readPaintDraft)
    expect(offerFor(d!.body, contentSig(MINION))).toBe(false)
  })

  it('a saved creature opened to edit does not hide an unsaved draft underneath it', async () => {
    const rows = new Map<string, unknown>()
    await makeDrafts(memoryBackend(rows), ann).write('paint', packPaintDraft(MINION, true))
    const d = await makeDrafts(memoryBackend(rows), ann).read('paint', readPaintDraft)
    expect(offerFor(d!.body, contentSig(page([stroke({ c: '#123456' })])))).toBe(true)
  })

  it('somebody else signing in on the same browser is offered nothing', async () => {
    const rows = new Map<string, unknown>()
    await makeDrafts(memoryBackend(rows), ann).write('paint', packPaintDraft(MINION, true))
    const theirs = await makeDrafts(memoryBackend(rows), () => 'bo').read('paint', readPaintDraft)
    expect(offerFor(theirs?.body ?? null, EMPTY_SIG)).toBe(false)
  })
})
