import { readDrawing, type Drawing } from '../draw/strokes'
import { ASPECT } from './strike'
import { PARK, type Spot } from './walk'
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
}

const MAX_PALETTE = 24
const MAX_PIECES = 400
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
  if (!palette.length) return null

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
  if (!pieces.length) return null

  const name = typeof o.name === 'string' ? o.name.slice(0, 40).trim() : ''
  return { v: 1, name: name || 'Map', palette, pieces }
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
    }
  })
}
