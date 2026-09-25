import { readDrawing, type Drawing } from '../draw/strokes'
import { inkBox } from '../pets/rig'
import { ASPECT } from './strike'
import { PARK, type Spot } from './walk'
import { readZone } from './zone'
import type { Place, PlaceKind } from './mapOf'

/**
 * A map as a list of things you placed, rather than a drawing read for layer names.
 *
 * ⚠️ WHY THIS EXISTS ALONGSIDE mapOf. That reader takes a drawing and treats each named layer
 * as one place, which was cheap to build because the paint room already had layers and names —
 * and is the wrong container for a map. Asked for as wanting to "draw things and then stamp
 * them all over", which layers cannot do: twenty rocks would be twenty layers against a cap of
 * twenty-four, and each one would have to be named again. An instance list has no such ceiling
 * and nothing to name twice.
 *
 * ⚠️ AND IT CARRIES ITS OWN ART. The pieces point at drawings kept WITH the map rather than at
 * the gallery by name. Both were on the table: a reference would mean editing a rock updated
 * every map that used it, which is lovely right up until somebody renames or deletes it and a
 * map loses its ground. Keeping copies makes a map a complete thing that cannot be broken from
 * outside — and costs nothing per stamp, because the palette is per map and the pieces are
 * indices into it, so fifty rocks are fifty positions and one drawing.
 */

/** one thing, placed */
export type Piece = {
  /** which of the map's own drawings this is — an index into `palette` */
  art: number
  /** where its middle sits, in world units across the whole park */
  at: Spot
  /**
   * How wide it is, in WORLD UNITS.
   *
   * ⚠️ SAID ONCE, HERE, AND CONVERTED ONLY IN placesOf. The old reader stored this as
   * `Place.size`, which is a radius in screen-HEIGHTS, and computed it as a full width in
   * screen-WIDTHS — two conversions missing at once, and because a half and a sixteen-tenths
   * very nearly cancel, the result was 25% out rather than obviously broken. A number whose
   * unit is only implied is a number that gets multiplied by the wrong thing eventually.
   */
  wide: number
  kind: PlaceKind
  /** how high you stand on it, in pet-heights; 0 is the grass */
  top: number
}

export type MapDoc = {
  v: 1
  name: string
  /** the drawings this map is made of, kept with it */
  palette: Drawing[]
  pieces: Piece[]
  /**
   * What is painted on the ground, under every piece — one drawing across the whole world.
   *
   * ⚠️ BECAUSE STAMPING IS NOT DRAWING, and only one of the two was here. Asked for as
   * "raw drawing on a massive map", and reported the short way round as the paint tools not
   * working in the map editor — which was true: the editor was a field you pressed, with no
   * surface to draw on at all. A stamp is a thing somebody made ONCE and repeated; a path
   * worn through grass, a shoreline, a patch of sand are none of them things you make once.
   *
   * ⚠️ AND IT IS A Drawing, SO IT COSTS NOTHING NEW. Same strokes, same reader, same
   * renderer, same packing — the ground is drawn by paintDrawing exactly as a creature is.
   * A bitmap here would have been the one thing in this project that could not be resized,
   * could not be undone with pop(), and could not fit in a hundred kilobytes.
   *
   * ⚠️ ITS PAPER IS THE WORLD, which is the whole reason MAP_GUIDE.paper exists. Points are
   * fractions of the world the same way a Piece's `at` is, so a stroke at 0.5,0.5 is the
   * middle of the park — and `ratio` is the world's own shape, so a circle stays a circle.
   */
  ground: Drawing | null
  /**
   * Where you land when you walk in, or null for the room to decide.
   *
   * ⚠️ BECAUSE THE GUESS CAN ONLY EVER BE A GUESS. Without one, the park starts you at
   * the average of everything placed — which cannot strand you, and that is the whole of what
   * it is good for. A map of two clusters starts you between them, in the empty middle; a map
   * with a gate at one end starts you nowhere near the gate. Saying where a map begins is a
   * thing only the person who drew it knows.
   *
   * ⚠️ A POINT, AND THE ROOM SPREADS AROUND IT. Asked for as a spawn AREA, and an area
   * is what it has to become on arrival anyway — two people landing on one pixel is the bug
   * the random spread already exists to stop. So this is the middle of that spread rather than
   * a second rectangle to draw and keep in step.
   */
  spawn: Spot | null
  /**
   * Where you may not walk, painted as a grid — see zone.ts, which owns the format.
   *
   * ⚠️ PACKED EVEN IN MEMORY, unlike every other field here. The other parts of a map
   * are the shapes you worked with; this is 23040 cells, and the editor keeps the Uint8Array it
   * is painting while the document keeps the string. Storing the array would mean a MapDoc that
   * cannot be compared, cannot be JSON'd without a custom step, and has a mutable buffer inside
   * a value everything else treats as frozen.
   */
  block: string | null
}

/**
 * The same drawing with the empty paper around it taken off.
 *
 * ⚠️ BECAUSE A STAMP IS THE THING, NOT THE PAGE IT WAS DRAWN ON. Somebody draws a small
 * tree in the corner of a big sheet, stamps it, and gets a mostly-empty square with a tree in
 * one corner of it — the transparent paper is placed just as faithfully as the ink. Reported
 * exactly that way. A creature does not have this problem because the pet renderer already
 * crops to the ink; a map piece had nothing doing that for it.
 *
 * ⚠️ TIGHT, WITH NO HEADROOM. inkBox's `room` adds 12% for a creature to animate inside;
 * a rock does not flap, and the headroom would be exactly the empty margin this exists to
 * remove.
 *
 * ⚠️ AND THE STROKE WIDTHS COME WITH IT. `w` is a fraction of the SHORT SIDE, so cropping
 * the paper without rescaling it makes every line thinner in proportion — zoom into a quarter
 * of a page and the same line is a quarter as thick relative to what is around it. The factor
 * is the short side before over the short side after, which is 1 when nothing was cropped.
 */
export function cropToInk(d: Drawing): Drawing {
  const b = inkBox(d, [], false)
  if (!b) return d
  const bw = b.x1 - b.x0
  const bh = b.y1 - b.y0
  if (!(bw > 0) || !(bh > 0)) return d
  /* already tight: nothing to gain, and a no-op keeps the palette's identity checks simple */
  if (bw > 0.985 && bh > 0.985) return d
  const ratio = d.ratio > 0.05 && d.ratio < 20 ? d.ratio : 1
  const shortBefore = Math.min(ratio, 1)
  const shortAfter = Math.min(bw * ratio, bh)
  const fat = shortAfter > 0 ? shortBefore / shortAfter : 1
  return {
    ...d,
    ratio: (ratio * bw) / bh,
    strokes: d.strokes.map((k) => ({
      ...k,
      w: k.w * fat,
      /* every pair in `p` is a point, including a fill's recorded region — see paintStroke */
      p: k.p.map((n, i) => (i % 2 === 0 ? (n - b.x0) / bw : (n - b.y0) / bh)),
    })),
  }
}

const MAX_PALETTE = 24
export const MAX_PIECES = 400
const KINDS: PlaceKind[] = ['pond', 'grove', 'ring', 'rocks', 'wall', 'flat']

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback

/**
 * Read one, from anywhere.
 *
 * ⚠️ VALIDATED ON THE WAY OUT AS WELL AS IN, which is the rule the gallery states and the
 * reason it states it: localStorage is editable by anything on this origin, so what a trusted
 * path wrote is not necessarily what comes back. Every drawing in the palette goes through
 * readDrawing, which is the security boundary for art and already refuses everything it should.
 */
export function readMapDoc(v: unknown): MapDoc | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.palette) || !Array.isArray(o.pieces)) return null

  const palette: Drawing[] = []
  for (const raw of o.palette.slice(0, MAX_PALETTE)) {
    const art = readDrawing(raw)
    if (art && art.strokes.length) palette.push(art)
  }

  /* ⚠️ readDrawing, which caps strokes and points and refuses everything it should — the
     ground is ink from the same boundary as every other drawing, not a special case */
  const read = o.ground ? readDrawing(o.ground) : null
  const ground = read && read.strokes.length ? read : null

  const pieces: Piece[] = []
  for (const raw of o.pieces.slice(0, MAX_PIECES)) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>
    const art = num(p.art, 0, palette.length - 1, -1)
    /* a piece pointing at a drawing that did not survive validation is a piece with no picture */
    if (art < 0 || !Number.isInteger(art)) continue
    const at = p.at as { x?: unknown; y?: unknown } | undefined
    const wide = num(p.wide, 0.001, 1, 0)
    if (!(wide > 0)) continue
    pieces.push({
      art,
      at: { x: num(at?.x, 0, 1, 0.5), y: num(at?.y, 0, 1, 0.5) },
      wide,
      kind: KINDS.includes(p.kind as PlaceKind) ? (p.kind as PlaceKind) : 'flat',
      top: num(p.top, 0, 4, 0),
    })
  }
  /* ⚠️ EITHER ONE IS A MAP. It used to insist on pieces, which was right when stamping was
     the only thing this room could do; a map that is a painted island and nothing else is a
     map, and refusing it would have silently eaten somebody's drawing on the way back in. */
  if (!pieces.length && !ground && !readZone(o.block)) return null

  const at = o.spawn as { x?: unknown; y?: unknown } | undefined
  const spawn =
    at && typeof at === 'object' && typeof at.x === 'number' && typeof at.y === 'number'
      ? { x: num(at.x, 0, 1, 0.5), y: num(at.y, 0, 1, 0.5) }
      : null

  /* readZone is the boundary: wrong length, wrong alphabet and wrong type all come back null */
  const block = readZone(o.block) ? (o.block as string) : null

  const name = typeof o.name === 'string' ? o.name.slice(0, 40).trim() : ''
  return { v: 1, name: name || 'Map', palette, pieces, ground, spawn, block }
}

/**
 * How big the world has to be to hold what was placed.
 *
 * ⚠️ COMPUTED, NOT STORED, so "it expands as far as you draw" is a fact about the pieces
 * rather than a second number that can disagree with them. Move the furthest rock back and the
 * world shrinks again, which is the same answer read the other way round.
 *
 * ⚠️ AND NEVER SMALLER THAN THE PARK EVERYBODY SHARES. A map with three things near the middle
 * is still somewhere to walk, and a world that hugged them would be a field with no room to run
 * up to anything.
 */
export function worldOf(doc: MapDoc): { across: number; down: number } {
  let x1 = 0
  let y1 = 0
  for (const p of doc.pieces) {
    x1 = Math.max(x1, p.at.x + p.wide / 2)
    y1 = Math.max(y1, p.at.y + p.wide / 2)
  }
  return {
    across: Math.max(PARK.across, Math.ceil(x1 * PARK.across)),
    down: Math.max(PARK.down, Math.ceil(y1 * PARK.down)),
  }
}

/**
 * The pieces as the places the park already knows how to walk.
 *
 * ⚠️ THE ONE PLACE A WIDTH BECOMES A `size`, and the only reason this function exists rather
 * than the editor writing `size` directly. `Place.size` is a RADIUS in screen-HEIGHTS: the
 * renderer draws `(size * 2) / ASPECT` of the field's width and `size * 2` of its height, which
 * is what makes a round pond round. So a width in world units becomes
 *
 *     size = wide * PARK.across * ASPECT / 2
 *
 * — across to turn world units into screenfuls, ASPECT to turn a width into a height, and the
 * half to turn a diameter into a radius. Written out, because the last version of this had two
 * of those three missing and nearly cancelling.
 */
export function placesOf(doc: MapDoc): Place[] {
  return doc.pieces.map((p, i) => {
    const size = ((p.wide * PARK.across) / 2) * ASPECT
    const half = p.wide / 2
    return {
      /* ⚠️ unique, because a Mark is keyed by name and two rocks are two things. The index is
         what makes fifty copies of one drawing fifty separate places you can stand on. */
      name: `${doc.palette[p.art]?.name || 'place'} ${i + 1}`,
      at: p.at,
      size,
      kind: p.kind,
      top: p.top,
      /* the box is in world units and always has been — see solid.ts, where a wall is its box */
      box: { x0: p.at.x - half, y0: p.at.y - half, x1: p.at.x + half, y1: p.at.y + half },
      /* ⚠️ AND THE PICTURE ITSELF, which is the whole point of stamping one. Without this the
         park draws its own mound for the kind and the drawing never appears anywhere but the
         editor — two views of one map that do not agree. */
      art: doc.palette[p.art],
    }
  })
}
