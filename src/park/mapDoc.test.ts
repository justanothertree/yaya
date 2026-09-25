import { describe, expect, it } from 'vitest'
import { cropToInk, MAX_PIECES, packPieces, placesOf, readMapDoc, worldOf } from './mapDoc'
import type { Piece } from './mapDoc'
import type { Drawing } from '../draw/strokes'
import { ASPECT, outBy, PARK_TALL } from './strike'
import { PARK } from './walk'

/**
 * A map, written down and read back.
 *
 * ⚠️ THIS IS WHERE SOMEBODY'S WORK LIVES. Every other module here can be wrong and be fixed;
 * this one can be wrong and take a map with it. So the tests are about what SURVIVES: a piece
 * through the packer, an old map through the new reader, and junk through the door.
 */

const ink = (x0: number, y0: number, x1: number, y1: number, ratio = 1): Drawing => ({
  v: 1,
  name: 'thing',
  ratio,
  bg: null,
  strokes: [{ t: 'rect', c: '#4a7c3f', a: 1, w: 0.05, p: [x0, y0, x1, y1] }],
})

const piece = (over: Partial<Piece> = {}): Piece => ({
  art: 0,
  at: { x: 0.5, y: 0.5 },
  wide: 0.1,
  kind: 'flat',
  top: 0,
  ...over,
})

const doc = (over: Record<string, unknown> = {}) => ({
  v: 1,
  name: 'A map',
  palette: [ink(0.1, 0.1, 0.9, 0.9)],
  pieces: [piece()],
  ground: null,
  spawn: null,
  block: null,
  doors: [],
  ...over,
})

describe('a piece is six numbers', () => {
  /**
   * ⚠️ THE KEYS WERE BIGGER THAN THE VALUES, which is why this exists at all — and the
   * compaction is only safe if every field comes back. A quantisation that silently dropped
   * `top` would turn every ledge in a map into flat ground with nothing to see.
   */
  it('and all six come back', () => {
    const many: Piece[] = Array.from({ length: 300 }, (_, i) =>
      piece({
        at: { x: +((i % 50) / 50).toFixed(4), y: +(Math.floor(i / 50) / 40).toFixed(4) },
        wide: +(0.02 + (i % 17) * 0.004).toFixed(5),
        kind: i % 3 === 0 ? 'wall' : i % 3 === 1 ? 'rocks' : 'flat',
        top: i % 3 === 1 ? 0.5 : 0,
      }),
    )
    const back = readMapDoc(doc({ pieces: packPieces(many) }))!
    expect(back.pieces).toHaveLength(many.length)
    back.pieces.forEach((p, i) => {
      const want = many[i]
      expect(p.art).toBe(want.art)
      expect(p.kind, `kind of piece ${i}`).toBe(want.kind)
      expect(p.at.x).toBeCloseTo(want.at.x, 4)
      expect(p.at.y).toBeCloseTo(want.at.y, 4)
      expect(p.wide).toBeCloseTo(want.wide, 5)
      expect(p.top).toBeCloseTo(want.top, 2)
    })
  })

  it('and it is worth doing: a packed map is a fraction of the spelled-out one', () => {
    const many = Array.from({ length: 500 }, () => piece())
    const fat = JSON.stringify(many).length
    const thin = JSON.stringify(packPieces(many)).length
    expect(thin * 2).toBeLessThan(fat)
  })

  /**
   * ⚠️ A FORMAT THAT CANNOT READ ITS OWN PAST EATS WORK. Every map saved before the packer is
   * objects, and they are still out there in somebody's localStorage.
   */
  it('and the old spelled-out shape still loads', () => {
    const back = readMapDoc(doc({ pieces: [piece({ kind: 'wall', top: 0 })] }))!
    expect(back.pieces).toHaveLength(1)
    expect(back.pieces[0].kind).toBe('wall')
    expect(back.pieces[0].at.x).toBeCloseTo(0.5, 4)
  })

  it('and a kind index survives, so a wall does not arrive as a pond', () => {
    for (const kind of ['pond', 'grove', 'ring', 'rocks', 'wall', 'flat'] as const) {
      const back = readMapDoc(doc({ pieces: packPieces([piece({ kind })]) }))!
      expect(back.pieces[0].kind, kind).toBe(kind)
    }
  })
})

describe('the door is shut to junk', () => {
  it('and nothing at all is not a map', () => {
    expect(readMapDoc(null)).toBeNull()
    expect(readMapDoc('a map')).toBeNull()
    expect(readMapDoc(42)).toBeNull()
    expect(readMapDoc({})).toBeNull()
  })

  it('and a map with nothing on it is not a map either', () => {
    expect(readMapDoc(doc({ pieces: [] }))).toBeNull()
  })

  it('but ground alone, or zones alone, IS a map', () => {
    const ground = ink(0.2, 0.2, 0.8, 0.8, 1.6)
    expect(readMapDoc(doc({ pieces: [], palette: [], ground }))).not.toBeNull()
  })

  it('and a piece pointing at a picture that is not there is dropped', () => {
    const back = readMapDoc(doc({ pieces: [piece({ art: 9 }), piece({ art: 0 })] }))!
    expect(back.pieces).toHaveLength(1)
  })

  it('and positions off the paper are pulled back onto it', () => {
    const back = readMapDoc(doc({ pieces: [piece({ at: { x: 40, y: -12 } })] }))!
    expect(back.pieces[0].at.x).toBeLessThanOrEqual(1)
    expect(back.pieces[0].at.x).toBeGreaterThanOrEqual(0)
    expect(back.pieces[0].at.y).toBeGreaterThanOrEqual(0)
  })

  it('and more pieces than a map holds are cut off rather than kept', () => {
    const tooMany = Array.from({ length: MAX_PIECES + 40 }, () => piece())
    const back = readMapDoc(doc({ pieces: packPieces(tooMany) }))!
    expect(back.pieces.length).toBeLessThanOrEqual(MAX_PIECES)
  })

  it('and a door to nowhere in particular is refused, but a named one is kept', () => {
    const back = readMapDoc(
      doc({
        doors: [
          { at: { x: 0.5, y: 0.5 }, wide: 0.05 },
          { at: { x: 0.5, y: 0.5 }, wide: 0.05, to: '   ' },
          { at: { x: 0.2, y: 0.2 }, wide: 0.05, to: 'Cellar' },
        ],
      }),
    )!
    expect(back.doors).toHaveLength(1)
    expect(back.doors[0].to).toBe('Cellar')
  })
})

describe('a stamp is the thing, not the page it was drawn on', () => {
  /**
   * ⚠️ MEASURED ON THE PATH, AND THE INK IS WIDER THAN THE PATH. A line has thickness,
   * so inkBox takes in half a stroke-width past each end and the cropped PATH stops short of
   * the frame by exactly that much — 0.75 of it here, for a stroke 0.05 wide. The first
   * version of this test expected 1 and was simply wrong about what it was measuring.
   */
  it('so a small drawing in the corner comes back filling its frame', () => {
    const before = ink(0.05, 0.05, 0.2, 0.2)
    const after = cropToInk(before)
    const spread = (d: Drawing, axis: 0 | 1) => {
      const ns = d.strokes[0].p.filter((_, i) => i % 2 === axis)
      return Math.max(...ns) - Math.min(...ns)
    }
    expect(spread(before, 0)).toBeCloseTo(0.15, 6)
    expect(spread(after, 0)).toBeGreaterThan(0.7)
    expect(spread(after, 0)).toBeLessThanOrEqual(1)
    expect(spread(after, 1)).toBeCloseTo(spread(after, 0), 6)
  })

  it('and something already filling its frame is left exactly alone', () => {
    const tight = ink(0, 0, 1, 1)
    expect(cropToInk(tight)).toBe(tight)
  })

  /**
   * ⚠️ AND THE STROKE WIDTHS COME WITH IT. `w` is a fraction of the SHORT SIDE, so cropping
   * the paper without rescaling makes every line thinner in proportion — zoom into a quarter of
   * a page and the same line is a quarter as thick relative to what is around it.
   */
  it('and its lines stay as thick against the ink as they were', () => {
    const before = ink(0.25, 0.25, 0.5, 0.5)
    const after = cropToInk(before)
    expect(after.strokes[0].w).toBeGreaterThan(before.strokes[0].w * 2)
  })
})

describe('a piece becomes somewhere you can walk', () => {
  /**
   * ⚠️ THE ONE PLACE A WIDTH BECOMES A `size`, and the last version of this sum had two of its
   * three factors missing and nearly cancelling — 25% out rather than obviously broken. So this
   * asks it in creatures: a piece ONE CREATURE wide has to come out one creature wide on screen.
   */
  it('at the size it was stamped, measured in creatures', () => {
    const [place] = placesOf(readMapDoc(doc({ pieces: [piece({ wide: outBy(1) })] }))!)
    /* the renderer draws size*2 of the field's HEIGHT, which is size*2 screen-heights */
    expect(place.size * 2).toBeCloseTo(PARK_TALL, 6)
  })

  it('and three creatures wide is three times that', () => {
    const [one] = placesOf(readMapDoc(doc({ pieces: [piece({ wide: outBy(1) })] }))!)
    const [three] = placesOf(readMapDoc(doc({ pieces: [piece({ wide: outBy(3) })] }))!)
    expect(three.size / one.size).toBeCloseTo(3, 6)
  })

  it('and its box is the square it was stamped in, in world units', () => {
    const [place] = placesOf(
      readMapDoc(doc({ pieces: [piece({ at: { x: 0.4, y: 0.6 }, wide: 0.2 })] }))!,
    )
    expect(place.box.x0).toBeCloseTo(0.3, 6)
    expect(place.box.x1).toBeCloseTo(0.5, 6)
    expect(place.box.y0).toBeCloseTo(0.5, 6)
    expect(place.box.y1).toBeCloseTo(0.7, 6)
  })

  /* ⚠️ a Mark is keyed by name, and fifty copies of one drawing are fifty separate things */
  it('and fifty copies of one picture are fifty places with fifty names', () => {
    const fifty = Array.from({ length: 50 }, () => piece())
    const places = placesOf(readMapDoc(doc({ pieces: packPieces(fifty) }))!)
    expect(new Set(places.map((p) => p.name)).size).toBe(50)
  })

  it('and it carries its picture, or the park draws its own mound instead', () => {
    const [place] = placesOf(readMapDoc(doc())!)
    expect(place.art).toBeTruthy()
  })
})

describe('how big a world a map needs', () => {
  it('is never smaller than the park everybody shares', () => {
    const small = worldOf(readMapDoc(doc({ pieces: [piece({ at: { x: 0.1, y: 0.1 } })] }))!)
    expect(small.across).toBe(PARK.across)
    expect(small.down).toBe(PARK.down)
  })

  it('and grows when something is placed past the edge of it', () => {
    const edge = worldOf(readMapDoc(doc({ pieces: [piece({ at: { x: 1, y: 1 }, wide: 0.2 })] }))!)
    expect(edge.across).toBeGreaterThan(PARK.across)
  })

  /**
   * ⚠️ AND NOTHING READS IT YET, WHICH IS THE POINT OF SAYING SO HERE. The park is a fixed
   * three by three; this answers what a map would NEED. While that is true the map maker's
   * "N×N screens" readout can promise room the park will not give — a known gap, written down
   * rather than asserted away, so that the day the world can grow this is the test that stops
   * being a wart and starts being a requirement.
   */
  it('though the park itself is still a fixed three by three', () => {
    expect(PARK.across).toBe(3)
    expect(PARK.down).toBe(3)
    expect(ASPECT).toBeCloseTo(1.6, 10)
  })
})
