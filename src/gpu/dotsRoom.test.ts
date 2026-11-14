import { describe, expect, it } from 'vitest'
import { choose, lineCount, takes } from './dots'
import { dotsRules, replay, type DotsGame } from './dotsRoom'

const rules = dotsRules(3)

/** a whole game drawn by dots.ts's own computers through the room's rules */
function playOut(seed: number): DotsGame {
  let s = seed
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
  let d = rules.fresh('versus')
  while (rules.turn(d) !== null) {
    const by = rules.turn(d) as 0 | 1
    const l = choose(d.g, 'easy', rand)
    expect(rules.legal(d, l, by)).toBe(true)
    d = rules.apply(d, l, by)
  }
  return d
}

describe('dots and boxes as a room game, sent as its lines', () => {
  it('plays a whole game, survives the wire, and names the winner by boxes', () => {
    const d = playOut(3)
    expect(d.lines).toHaveLength(lineCount(d.g.b))
    expect(rules.decode(JSON.parse(JSON.stringify(rules.encode(d))))).toEqual(d)
    const [a, b] = d.g.score
    expect(rules.result!(d)).toBe(a > b ? 0 : b > a ? 1 : 'draw')
  })
  it('closing a box keeps the turn, and the room follows it', () => {
    let d = rules.fresh('versus')
    // draw until a line that closes a box is there for the side to move
    let s = 9
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
    for (;;) {
      const take = d.g.drawn.findIndex((x, l) => !x && takes(d.g, l))
      const by = rules.turn(d) as 0 | 1
      if (take >= 0) {
        const after = rules.apply(d, take, by)
        expect(rules.turn(after)).toBe(by)
        expect(after.g.score[by]).toBeGreaterThan(d.g.score[by])
        break
      }
      d = rules.apply(d, choose(d.g, 'easy', rand), by)
    }
  })
  it('refuses a line drawn twice, off the board, out of turn, or a size the toy lacks', () => {
    const d = rules.apply(rules.fresh('versus'), 0, 0)
    expect(rules.legal(d, 0, 1)).toBe(false)
    expect(rules.legal(d, 1, 0)).toBe(false)
    expect(rules.legal(d, lineCount(d.g.b), 1)).toBe(false)
    expect(replay(3, [0, 0])).toBeNull()
    expect(replay(3, [24])).toBeNull()
    expect(rules.decode({ n: 7, lines: [] })).toBeNull()
    expect(rules.decode({ n: 3, lines: 'x' })).toBeNull()
    // the board is the size sent, not the receiver's
    expect(dotsRules(6).decode(rules.encode(d))!.g.b.rows).toBe(3)
  })
  it('the computer plays the second player legally; a game has begun at the first line', () => {
    const d0 = rules.fresh('together')
    expect(rules.begun!(d0)).toBe(false)
    const d1 = rules.apply(d0, 5, 0)
    expect(rules.begun!(d1)).toBe(true)
    const l = rules.computer!.choose(d1, 'hard')
    expect(rules.legal(d1, l, 1)).toBe(true)
    // choosing leaves the room's game as it was
    expect(d1.lines).toEqual([5])
  })
})
