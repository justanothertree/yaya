import { describe, expect, it } from 'vitest'
import { packSong, readSong, toSong, type Song } from '../audio/songFile'
import type { Layer } from '../audio/looper'
import type { ProfileBlock } from '../sections/ProfileBlocks'
import { CONFIG_LIMIT, PROFILE_LIMIT, configSize } from './blockSize'
import { MAX_BLOCKS, MAX_SONGS, freshBlock, payloadOf, samePage, withSong } from './newBlock'
import { looksFromConfig, songsFromConfig } from './songBlockConfig'

/**
 * A song put on a page from outside the editor. `save_my_profile_blocks` replaces the whole page
 * with what it is sent, so the property that matters most is the one a thin fixture cannot show:
 * that every OTHER block, and every other field of the song block, arrives untouched. So every
 * block here carries a value other than its default in every field.
 */

const part = (midi: number, over: Partial<Layer> = {}): Layer => ({
  id: `p${midi}`,
  instrument: 'keys',
  events: [
    { t: 0, midi, on: true },
    { t: 0.5, midi, on: false },
  ],
  muted: false,
  len: 2,
  fx: { echo: 0.2, echoTime: 0.3, space: 0.4, vibrato: 0.1, glide: 0.2, tone: 0.6 },
  ...over,
})
const song = (name: string, midi = 60): Song => toSong(name, 96, 2, [part(midi), part(midi + 4)])
const packed = (name: string, midi = 60) => packSong(song(name, midi))

/** a page with something other than a default everywhere */
const page = (): ProfileBlock[] => [
  {
    block_type: 'bio',
    size: 'large',
    config: { text: 'hello', font: 'mono', shape: 'square', edge: 'glow', tint: '#123456' },
    visibility: 'friends',
    certain: [],
  },
  {
    block_type: 'song',
    size: 'small',
    config: {
      song: packed('Old single', 55),
      songs: [packed('First', 62), packed('Second', 64)],
      looks: [{ face: 'disc' }, null, { face: 'bars' }],
      autoplay: true,
      font: 'serif',
      shape: 'square',
      edge: 'glow',
      tint: '#abcdef',
    },
    visibility: 'certain',
    certain: ['alex', 'sam'],
  },
  {
    block_type: 'status',
    size: 'small',
    config: { text: 'out', font: 'mono', shape: 'square', edge: 'glow' },
    visibility: 'private',
    certain: [],
  },
]

const names = (b: ProfileBlock) => songsFromConfig(b.config).map((s) => s.name)

describe('putting a song on a page', () => {
  it('adds it to the end of the first song block, and every other block comes back as it went', () => {
    const before = page()
    const r = withSong(before, song('New one', 67))
    expect(r.ok && r.how).toBe('added')
    if (!r.ok) return
    expect(r.name).toBe('New one')
    expect(r.blocks).toHaveLength(3)
    /* the same objects, not copies: nothing the save sends for them can differ */
    expect(r.blocks[0]).toBe(before[0])
    expect(r.blocks[2]).toBe(before[2])
    const b = r.blocks[1]
    expect([b.block_type, b.size, b.visibility, b.certain]).toEqual([
      'song',
      'small',
      'certain',
      ['alex', 'sam'],
    ])
    /* the old single song folded in first, as the editor's picker does, and the new one last */
    expect(names(b)).toEqual(['Old single', 'First', 'Second', 'New one'])
    expect(b.config.song).toBeUndefined()
    for (const k of ['looks', 'autoplay', 'font', 'shape', 'edge', 'tint'])
      expect(b.config[k]).toEqual(before[1].config[k])
    /* the song itself reads back as it was written */
    expect(songsFromConfig(b.config)[3]).toEqual(readSong(packed('New one', 67)))
  })

  it('updates a song of the same name where it is, so it keeps its look', () => {
    const before = page()
    const r = withSong(before, song('First', 71))
    expect(r.ok && r.how).toBe('updated')
    if (!r.ok) return
    const b = r.blocks[1]
    expect(names(b)).toEqual(['Old single', 'First', 'Second'])
    expect(songsFromConfig(b.config)[1]).toEqual(readSong(packed('First', 71)))
    expect(looksFromConfig(b.config)).toEqual(looksFromConfig(before[1].config))
  })

  it('starts a song block at the end of a page that has none, dressed the way the page is', () => {
    const before = page().filter((b) => b.block_type !== 'song')
    const r = withSong(before, song('Only'))
    expect(r.ok && r.how).toBe('new block')
    if (!r.ok) return
    expect(r.blocks.slice(0, 2)).toEqual(before)
    const b = r.blocks[2]
    expect(b).toEqual({ ...freshBlock(before, 'song'), config: { ...b.config } })
    expect([b.block_type, b.size, b.visibility]).toEqual(['song', 'medium', 'members'])
    expect([b.config.font, b.config.shape, b.config.edge]).toEqual(['mono', 'square', 'glow'])
    expect(names(b)).toEqual(['Only'])
  })

  it('refuses a song block already playing all it can, but still updates one in it', () => {
    const full: ProfileBlock[] = [
      {
        block_type: 'song',
        size: 'medium',
        config: { songs: Array.from({ length: MAX_SONGS }, (_, i) => packed(`Track ${i}`)) },
        visibility: 'members',
      },
    ]
    expect(withSong(full, song('One more'))).toEqual({ ok: false, why: 'full' })
    expect(withSong(full, song('Track 3', 70)).ok).toBe(true)
  })

  it('matches a name the way it will be read back: cut to 60 characters and trimmed', () => {
    /* 59 letters and a space at the cut: compared raw, every press added another copy */
    const typed = 'A'.repeat(59) + ' and some words past the cut'
    const once = withSong([], song(typed))
    expect(once.ok && once.name).toBe('A'.repeat(59))
    if (!once.ok) return
    const twice = withSong(once.blocks, song(typed, 72))
    expect(twice.ok && twice.how).toBe('updated')
    if (!twice.ok) return
    expect(names(twice.blocks[0])).toEqual(['A'.repeat(59)])
  })

  it('refuses a song with no notes in it', () => {
    const silent = toSong('Quiet', 96, 2, [part(60, { events: [] })])
    expect(withSong(page(), silent)).toEqual({ ok: false, why: 'empty' })
  })

  it('refuses a twenty-first block', () => {
    const twenty = Array.from({ length: MAX_BLOCKS }, () => page()[0])
    expect(withSong(twenty, song('Nope'))).toEqual({ ok: false, why: 'too many blocks' })
  })

  it('refuses what the server would, measured the way the server measures', () => {
    /* a song block already holding nearly all a block may: a song read back through the song
       reader can only be so long (6,000 events), so this is how a block runs out in practice */
    const longPart = (k: number) =>
      part(40 + k, {
        id: `h${k}`,
        /* long enough to hold its notes, which the song reader keeps only inside the part */
        len: 32,
        events: Array.from({ length: 200 }, (_, i) => ({
          t: i * 0.15,
          midi: 40 + ((i + k) % 30),
          on: i % 2 === 0,
        })),
      })
    const track = (name: string) => packSong(toSong(name, 120, 32, [longPart(1), longPart(2)]))
    let held = 0
    const songs: ReturnType<typeof track>[] = []
    /* as many as fit, so one more of the same size cannot */
    while (configSize({ songs: [...songs, track(`T${held}`)] }) <= CONFIG_LIMIT)
      songs.push(track(`T${held++}`))
    const nearlyFull: ProfileBlock[] = [
      { block_type: 'song', size: 'medium', config: { songs }, visibility: 'members' },
    ]
    expect(configSize(nearlyFull[0].config)).toBeLessThan(CONFIG_LIMIT)
    expect(withSong(nearlyFull, toSong('One more', 120, 32, [longPart(1), longPart(2)]))).toEqual({
      ok: false,
      why: 'too big',
    })
    /* a page whose other blocks already hold nearly all a page may */
    const heavy: ProfileBlock[] = [0, 1, 2].map(() => ({
      ...page()[0],
      config: { text: 'x'.repeat(53_300) },
    }))
    expect(heavy.reduce((n, b) => n + configSize(b.config), 0)).toBeLessThan(PROFILE_LIMIT)
    expect(withSong(heavy, song('Tips it over'))).toEqual({ ok: false, why: 'page too big' })
  })
})

describe('what a save carries', () => {
  it('every field of every block, in order, an absent Certain list as an empty one', () => {
    const p = page()
    const sent = payloadOf([...p, { ...p[2], certain: undefined }])
    expect(sent).toEqual([
      ...p.map(({ block_type, size, config, visibility, certain }) => ({
        block_type,
        size,
        config,
        visibility,
        certain,
      })),
      { ...p[2], certain: [] },
    ])
  })
})

describe('the same page', () => {
  it('as the server would store it: keys in any order, a Certain list in any order and case', () => {
    const mine = page()
    /* what get_profile_blocks hands back: jsonb's own key order, the list sorted and lowered */
    const readBack: ProfileBlock[] = mine.map((b) => ({
      ...b,
      config: Object.fromEntries(Object.entries(b.config).reverse()),
      certain: b.visibility === 'certain' ? ['SAM', 'Alex'] : [],
    }))
    expect(JSON.stringify(payloadOf(readBack))).not.toBe(JSON.stringify(payloadOf(mine)))
    expect(samePage(readBack, mine)).toBe(true)
  })
  it('and not the same when anything a save carries differs', () => {
    const mine = page()
    const changes: ProfileBlock[][] = [
      mine.slice(1),
      mine.map((b, i) => (i === 0 ? { ...b, size: 'small' } : b)),
      mine.map((b, i) => (i === 0 ? { ...b, visibility: 'members' } : b)),
      mine.map((b, i) => (i === 0 ? { ...b, config: { ...b.config, text: 'bye' } } : b)),
      mine.map((b, i) => (i === 1 ? { ...b, certain: ['alex'] } : b)),
      [mine[1], mine[0], mine[2]],
    ]
    for (const c of changes) expect(samePage(c, mine)).toBe(false)
  })
})
