import { describe, expect, it } from 'vitest'
import { DRUM_PATTERNS, drumGenres, genreOf, genreShown } from './drumPatterns'

/**
 * The Beat row is one genre at a time (Evan, 10 Nov 2026: "an easier, cleaner UI"). These are
 * the promises that make one row as good as the ten it replaced: every beat is reachable, and the
 * row opens on the beat you are hearing.
 */
describe('the Beat row shows one genre', () => {
  const first = (genre: string) => DRUM_PATTERNS.find((p) => p.genre === genre)!.id

  it('every beat belongs to a genre the menu offers, so none is unreachable', () => {
    const genres = drumGenres()
    for (const p of DRUM_PATTERNS) {
      expect(genres, p.name).toContain(p.genre)
      expect(genreOf(p.id), p.name).toBe(p.genre)
    }
    expect(genreOf(null)).toBeNull()
    expect(genreOf('a-beat-from-a-later-bundle')).toBeNull()
  })

  it('opens on the genre of the beat you are hearing', () => {
    expect(genreShown(first('Funk'), null)).toBe('Funk')
    expect(genreShown(first('Reggae'), null)).toBe('Reggae')
  })

  it('browsing another genre lasts until the beat changes, then follows the new beat', () => {
    const browsing = { forBeat: first('Rock'), genre: 'Jazz' }
    expect(genreShown(first('Rock'), browsing)).toBe('Jazz')
    /* a Style, or a beat from the genre you browsed, changed what is loaded: show that */
    expect(genreShown(first('Latin'), browsing)).toBe('Latin')
  })

  it('with no beat, it shows what you last browsed, or the first genre', () => {
    expect(genreShown(null, null)).toBe(drumGenres()[0])
    expect(genreShown(null, { forBeat: null, genre: 'Metal' })).toBe('Metal')
    /* a beat that was cleared since you browsed: what you browsed is still the best guess */
    expect(genreShown(null, { forBeat: first('Rock'), genre: 'Pop' })).toBe('Pop')
  })
})
