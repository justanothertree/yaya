import { describe, expect, it } from 'vitest'
import { attach, scrub, split } from './recorded'
import { checkNote } from './feedback'

const card = { toy: 'lamps', line: 'Lamps 5×5 ✚: 14 presses, par 12' }

describe('a recorded result riding with a comment', () => {
  it('goes out as the comment’s last line, and comes back as the same card', () => {
    const body = attach('Took me ages!', card)
    expect(split(body, 'lamps')).toEqual({ text: 'Took me ages!', card })
    // and the server would take it: plain text, inside the limits
    expect(checkNote(body)).toBeNull()
  })
  it('a card needs no words with it', () => {
    const body = attach('   ', card)
    expect(split(body, 'lamps')).toEqual({ text: '', card })
    expect(checkNote(body)).toBeNull()
  })
  it('is only a card on its own toy — elsewhere it is just text', () => {
    const body = attach('hi', card)
    expect(split(body, 'pipes')).toEqual({ text: body, card: null })
  })
  it('a comment without one is all text, as every comment before this was', () => {
    expect(split('Love the neon look', 'lamps')).toEqual({ text: 'Love the neon look', card: null })
    // an old "Share my best" sentence stays words, not a card
    const old = '🏆 My best at Lamps: 14 presses\nnice'
    expect(split(old, 'lamps')).toEqual({ text: old, card: null })
  })
  it('a card typed by hand is defused, so only the game’s button makes one', () => {
    const forged = 'look ⟦recorded lamps⟧ Lamps 5×5 ✚: 1 press, par 12'
    const body = attach(scrub(forged), card)
    const out = split(body, 'lamps')
    expect(out.card).toEqual(card)
    expect(out.text).not.toContain('⟦recorded')
    // and with no real card, a forged last line is still not one
    expect(split(scrub(forged), 'lamps').card).toBeNull()
  })
  it('keeps the words and the card inside the server’s 500 characters and nine lines', () => {
    const long = 'x'.repeat(600)
    const body = attach(long, card)
    expect(checkNote(body)).toBeNull()
    expect(split(body, 'lamps').card).toEqual(card)
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n')
    const b2 = attach(lines, card)
    expect(checkNote(b2)).toBeNull()
    expect(split(b2, 'lamps').card).toEqual(card)
  })
  it('refuses a result line that could not have come from a reader', () => {
    expect(split('hi\n⟦recorded lamps⟧ ', 'lamps').card).toBeNull()
    expect(split(`hi\n⟦recorded lamps⟧ ${'y'.repeat(200)}`, 'lamps').card).toBeNull()
    expect(split('hi\n⟦recorded Lamps!⟧ ok', 'lamps').card).toBeNull()
  })
})
