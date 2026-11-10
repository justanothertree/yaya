import { describe, expect, it } from 'vitest'
import { BASS_PRESETS, presetOf } from './bassPresets'
import { BASS_STYLES } from './chordPatterns'
import { BASS_VOICES } from './synth'

/** Evan, 10 Nov 2026: "bass presets" — a line and a voice that belong together, in one press. */
describe('bass presets', () => {
  it('each is a line the Bass row offers on a voice the Bass row offers', () => {
    const lines = BASS_STYLES.map((s) => s.id)
    for (const p of BASS_PRESETS) {
      expect(lines, p.name).toContain(p.style)
      expect(BASS_VOICES, p.name).toContain(p.voice)
    }
  })

  /* two presets that set the same two controls are one preset with two names, and the menu could
     only ever show one of them as loaded */
  it('no two set the same pairing, and no two share a name', () => {
    const pairs = BASS_PRESETS.map((p) => `${p.style}/${p.voice}`)
    expect(new Set(pairs).size).toBe(pairs.length)
    expect(new Set(BASS_PRESETS.map((p) => p.name)).size).toBe(BASS_PRESETS.length)
    expect(new Set(BASS_PRESETS.map((p) => p.id)).size).toBe(BASS_PRESETS.length)
  })

  it('the lines written for a style are each in a preset, on the voice that style is played on', () => {
    expect(presetOf('funk', 'slap')?.name).toBe('Funk')
    expect(presetOf('walk', 'upright')?.name).toBe('Walking')
    expect(presetOf('dub', 'sub')?.name).toBe('Dub')
    expect(presetOf('bossa', 'upright')?.name).toBe('Bossa')
  })

  it('the menu reads what is loaded: a pairing of your own is no preset', () => {
    for (const p of BASS_PRESETS) expect(presetOf(p.style, p.voice)).toBe(p)
    expect(presetOf('walk', '808')).toBeNull()
    expect(presetOf(null, 'slap')).toBeNull()
    expect(presetOf('funk', null)).toBeNull()
  })

  it('every bass voice but the plain Bass has a preset to be found by', () => {
    const used = new Set(BASS_PRESETS.map((p) => p.voice))
    /* the plain Bass is the row's default and needs no preset to reach it */
    for (const v of BASS_VOICES) if (v !== 'bass') expect(used.has(v), v).toBe(true)
  })
})
