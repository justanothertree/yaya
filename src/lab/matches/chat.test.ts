import { describe, expect, it } from 'vitest'
import {
  LINE_MAX,
  LIVE_BURST,
  LIVE_WINDOW_MS,
  cleanLine,
  mayTalk,
  mergeLines,
  readLine,
  readLiveLine,
  type ChatLine,
} from './chat'

const line = (id: number, over: Partial<ChatLine> = {}): ChatLine => ({
  id,
  seat: 1,
  body: `line ${id}`,
  mine: false,
  at: '2026-11-18T12:00:00Z',
  ...over,
})

describe('a chat line', () => {
  it('is trimmed, one line, and 1 to 300 characters — the same rule lab_match_say keeps', () => {
    expect(LINE_MAX).toBe(300)
    expect(cleanLine('  good game  ')).toBe('good game')
    expect(cleanLine('x'.repeat(300))).toBe('x'.repeat(300))
    for (const bad of [
      '',
      '   ',
      'x'.repeat(301),
      'one\ntwo',
      'tab\there',
      'bell\u0007',
      'del\u007f',
    ])
      expect(cleanLine(bad), JSON.stringify(bad)).toBeNull()
  })

  it('reads back from the server only in exactly the shape it is sent, every field off its default', () => {
    const l = { id: 7, seat: 0, body: 'your move', mine: true, at: '2026-11-18T12:00:00Z' }
    expect(readLine(l)).toEqual(l)
    for (const bad of [
      null,
      'x',
      { ...l, id: 0 },
      { ...l, id: 1.5 },
      { ...l, seat: 2 },
      { ...l, body: ' padded ' },
      { ...l, body: 'two\nlines' },
      { ...l, mine: 'yes' },
      { ...l, at: 5 },
    ])
      expect(readLine(bad), JSON.stringify(bad)).toBeNull()
  })

  it('merges what was held with what was just read: in order, once each, the last hundred', () => {
    const held = [line(1), line(2), line(3)]
    expect(
      mergeLines(held, [line(3, { body: 'line 3' }), line(5), line(4)]).map((l) => l.id),
    ).toEqual([1, 2, 3, 4, 5])
    const many = Array.from({ length: 150 }, (_, i) => line(i + 1))
    const kept = mergeLines([], many)
    expect(kept).toHaveLength(100)
    expect(kept[0].id).toBe(51)
    expect(kept.at(-1)!.id).toBe(150)
  })
})

describe('a live line, on the call’s channel', () => {
  it('is for one toy, carries the text and nothing else', () => {
    expect(readLiveLine({ sub: 'chess', text: 'nice' }, 'chess')).toBe('nice')
    for (const bad of [
      { sub: 'reversi', text: 'nice' },
      { sub: 'chess' },
      { sub: 'chess', text: 'nice', name: 'Ann' },
      { sub: 'chess', text: ' padded ' },
      { sub: 'chess', text: 'x'.repeat(301) },
      null,
    ])
      expect(readLiveLine(bad, 'chess'), JSON.stringify(bad)).toBeNull()
  })

  it('goes at most five in four seconds, as the snake games’ relay allows', () => {
    expect([LIVE_BURST, LIVE_WINDOW_MS]).toEqual([5, 4000])
    let times: number[] = []
    const sent: boolean[] = []
    for (let i = 0; i < 8; i++) {
      const r = mayTalk(times, i * 100)
      times = r.times
      sent.push(r.ok)
    }
    expect(sent).toEqual([true, true, true, true, true, false, false, false])
    // once the first has aged out of the window, one more may go
    expect(mayTalk(times, 4000).ok).toBe(true)
  })
})
