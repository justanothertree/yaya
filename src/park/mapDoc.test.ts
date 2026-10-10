import { describe, expect, it } from 'vitest'
import {
  cropToInk,
  livesOf,
  MAX_PIECES,
  packPieces,
  placesOf,
  readMapDoc,
  worldOf,
  stampFrame,
} from './mapDoc'
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

/**
 * A creature you stamped.
 *
 * ⚠️ THE CLAIM THAT MATTERS IS THE COMPATIBILITY ONE. Everything else here is new behaviour
 * nobody has yet relied on; "a map saved before creatures existed still reads, and still packs
 * to exactly what it did" is a claim about work that already exists on people's machines.
 */
describe('a stamp can be alive', () => {
  it('leaves a map of scenery packed exactly as it was', () => {
    // ⚠️ six numbers, not seven — the old shape, byte for byte
    expect(packPieces([piece()])[0]).toHaveLength(6)
    expect(packPieces([piece({ kind: 'wall', top: 0.5 })])[0]).toHaveLength(6)
  })

  it('reads a six-number piece as scenery', () => {
    const old = readMapDoc(doc({ pieces: [[0, 5000, 5000, 10000, 5, 0]] }))
    expect(old?.pieces[0].life).toBeUndefined()
    expect(placesOf(old!)).toHaveLength(1)
    expect(livesOf(old!)).toHaveLength(0)
  })

  it('carries a role through the packer and back', () => {
    for (const as of ['minion', 'boss'] as const) {
      const packed = packPieces([piece({ life: as })])
      expect(packed[0]).toHaveLength(7)
      const back = readMapDoc(doc({ pieces: packed }))
      expect(back?.pieces[0].life).toBe(as)
    }
  })

  it('keeps a creature out of the ground', () => {
    /* ⚠️ the whole reason `life` is not a PlaceKind: a boss is not something you stand on,
       collide with, or are told is a landmark nearby */
    const d = readMapDoc(doc({ pieces: [piece(), piece({ life: 'boss' })] }))!
    expect(d.pieces).toHaveLength(2)
    expect(placesOf(d)).toHaveLength(1)
    expect(livesOf(d)).toHaveLength(1)
    expect(livesOf(d)[0].as).toBe('boss')
  })

  it('hands the room a drawing, at the spot it was stamped', () => {
    const at = { x: 0.25, y: 0.75 }
    const d = readMapDoc(doc({ pieces: [piece({ at, life: 'minion', wide: 0.08 })] }))!
    const [one] = livesOf(d)
    expect(one.at).toEqual(at)
    expect(one.wide).toBeCloseTo(0.08, 4)
    // the palette is the map's business, not the park's — see livesOf
    expect(one.art.strokes.length).toBeGreaterThan(0)
  })

  it('drops a creature whose drawing is missing rather than handing back a hole', () => {
    const d = readMapDoc(doc({ pieces: [piece({ art: 0, life: 'boss' })], palette: [] }))
    // no palette means no art for it to be; the map still reads
    expect(d === null || livesOf(d).length === 0).toBe(true)
  })

  it('refuses a role it does not know, rather than inventing one', () => {
    const d = readMapDoc(doc({ pieces: [{ ...piece(), life: 'dragon' }] }))
    expect(d?.pieces[0].life).toBeUndefined()
    expect(livesOf(d!)).toHaveLength(0)
  })
})

/**
 * Which frame an animated stamp shows.
 *
 * ⚠️ IT IS TESTED BECAUSE TWO CANVASES READ IT. The park's Scenery and the map maker's own
 * stamp layer both bake a strip per picture and both ask this which one to blit — so a change
 * here shows up as a piece that animates differently while you place it than when you walk it,
 * which is the most confusing possible version of this feature and the reason the arithmetic is
 * not written twice.
 */
describe('which frame a stamp is showing', () => {
  const at = { x: 0.31, y: 0.62 }

  it('is always frame 0 for a drawing that is not an animation', () => {
    for (const t of [0, 0.3, 7.5, 1000]) {
      expect(stampFrame(1, 8, at, t)).toBe(0)
      expect(stampFrame(0, 8, at, t)).toBe(0)
    }
  })

  it('and never leaves the strip, at any time or rate', () => {
    for (const frames of [2, 3, 7, 24, 60]) {
      for (const fps of [undefined, 1, 8, 24, 1000, 0, -5]) {
        for (const t of [0, 0.016, 1.5, 93.7, 86400]) {
          const i = stampFrame(frames, fps, at, t)
          expect(Number.isInteger(i)).toBe(true)
          expect(i).toBeGreaterThanOrEqual(0)
          expect(i).toBeLessThan(frames)
        }
      }
    }
  })

  /**
   * ⚠️ THE RATE IS THE CREATURES' RATE, which is why this asks the clock rather than the code:
   * at 8fps a second of time is eight frames, so a two-frame loop has come back to where it
   * started and a three-frame loop has gone round twice and landed on the same rung. Asked that
   * way the claim is about playback speed; asked as "does it equal this expression" it would
   * only be a copy of the line above it.
   */
  it('and advances at fps frames a second', () => {
    for (const frames of [2, 4, 8]) {
      /* 8fps for exactly one second is 8 steps, which is a whole number of loops for each of
         these — so the frame must be the one it started on, whatever the phase happens to be */
      expect(stampFrame(frames, 8, at, 1)).toBe(stampFrame(frames, 8, at, 0))
    }
    /* and half that time at half the rate is the same place again */
    expect(stampFrame(4, 4, at, 1)).toBe(stampFrame(4, 8, at, 0.5))
  })

  /**
   * ⚠️ THE SAME STAMP IN THE SAME PLACE IS THE SAME EVERYWHERE, which is the property the park
   * depends on: two people in one room are standing on one drawing, so a phase taken from
   * anything but the position would give them two different-looking maps.
   */
  it('and depends on nothing but the frame count, the rate, the place and the clock', () => {
    const a = { x: 0.2, y: 0.8 }
    expect(stampFrame(5, 8, a, 3.3)).toBe(stampFrame(5, 8, { x: 0.2, y: 0.8 }, 3.3))
  })

  it('and two stamps in different places are not locked together', () => {
    /* a lake of identical water should not pulse as one tile — so somewhere across a loop, two
       positions must disagree. Asked across time rather than at one instant, because any two
       phases agree on some frames. */
    const a = { x: 0.2, y: 0.2 }
    const b = { x: 0.77, y: 0.41 }
    const ever = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5].some(
      (t) => stampFrame(6, 8, a, t) !== stampFrame(6, 8, b, t),
    )
    expect(ever).toBe(true)
  })
})
