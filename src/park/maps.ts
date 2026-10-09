import { keptAt } from '../library/kept'
import { packDrawing } from '../draw/strokes'
import { packPieces, readMapDoc, type MapDoc } from './mapDoc'

/**
 * The maps you have made.
 *
 * ⚠️ THE SAME SHAPE AS THE GALLERY, deliberately: save, list, delete, one name one thing, and
 * every item re-validated on the way OUT as well as in. localStorage is editable by anything on
 * this origin, so what a trusted path wrote is not necessarily what comes back — and a map is
 * read straight into the world somebody then walks around in.
 *
 * ⚠️ A SEPARATE STORE RATHER THAN A CORNER OF THE GALLERY. A map is no longer a drawing: it is
 * a list of placements with a palette of drawings inside it, so keeping it beside the pictures
 * would mean every reader of the gallery having to ask which kind of thing it had. The gallery
 * stays what it says it is.
 */

const KEY = 'park_maps_v1'

/**
 * ⚠️ FEWER THAN THE GALLERY KEEPS, because a map is heavier than a picture by a whole palette.
 * The gallery holds 120 items of one drawing each; a map holds up to twenty-four drawings, so
 * the same generosity here would be twenty-four times the worst case on a store that has to
 * share five megabytes with the pictures, the songs and the minions.
 */
const MAX_ITEMS = 7

/**
 * ⚠️ AND A CEILING PER MAP, reasoned from the worst case rather than the normal one. A single
 * drawing can reach about eighty kilobytes at the stroke limit, so a palette of twenty-four of
 * them is near two megabytes — one map able to fill the entire origin on its own. A map of a
 * rock, a tree and a pond is a few kilobytes, so this is not a limit anybody drawing a map will
 * meet; it is the one somebody pasting a creature in as scenery would.
 */
/**
 * ⚠️ 320KB, UP FROM 200, BECAUSE THE FIRST REAL MAP HIT IT. The note above says this "is not a
 * limit anybody drawing a map will meet" — it was met on a first serious attempt, at 264KB, and
 * an assumption that use has disproved is worth replacing rather than arguing with.
 *
 * ⚠️ AND THE TOTAL BUDGET DID NOT GROW, WHICH IS THE PART THAT MATTERS. localStorage is about
 * five megabytes for the whole origin and maps SHARE it with the gallery, the songs and the
 * minions — so what is bounded is items × bytes, not either alone. Twelve at 200KB was 2.4MB;
 * seven at 320KB is 2.24MB, slightly less. Bigger maps, fewer of them, same ceiling.
 *
 * ⚠️ FEWER IS SAFE TO LOWER because nothing here evicts: saveMap REFUSES a thirteenth rather
 * than dropping the oldest (see the note on write), so somebody already holding nine keeps all
 * nine and is simply asked to delete one before adding another.
 */
const MAX_BYTES = 320 * 1024

export type ParkMap = { id: string; name: string; at: number; doc: MapDoc }

let cache: ParkMap[] | null = null
const listeners = new Set<() => void>()

export function subscribeMaps(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function parkMaps(): ParkMap[] {
  if (cache) return cache
  let raw: unknown
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    raw = []
  }
  const out: ParkMap[] = []
  if (Array.isArray(raw)) {
    for (const v of raw.slice(0, MAX_ITEMS)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      /* ⚠️ readMapDoc, not a cast. It is the same boundary readDrawing is for art, and it
         unpacks a packed palette on the way through without being asked — see below. */
      const doc = readMapDoc(o.doc)
      if (!doc) continue
      out.push({
        id: typeof o.id === 'string' ? o.id.slice(0, 40) : String(Math.random()),
        name: doc.name,
        at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0,
        doc,
      })
    }
  }
  out.sort((a, b) => b.at - a.at)
  cache = out
  return out
}

const disk = keptAt(KEY)

/**
 * Did the last map reach this browser's storage, or only this visit's memory?
 *
 * ⚠️ IT MATTERS MOST HERE, because a map is not a kind in library/cloud.ts — there is no
 * account copy to fall back on, so a keep that did not land is the only copy not landing.
 */
export const mapsSaved = (): boolean => disk.landed()

function write(items: ParkMap[]) {
  /* ⚠️ no slice — see saveMap for why a store that makes room is a store that deletes */
  cache = items
  disk.put(JSON.stringify(cache.map(packed)))
  listeners.forEach((l) => l())
}

/**
 * ⚠️ THE PALETTE GOES DOWN PACKED, and readDrawing takes it back without being told. A map
 * carries whole drawings rather than references, which is what makes it unbreakable from
 * outside — and the bill for that is paid here instead, where packDrawing is several times
 * smaller than the readable form. The pieces are already small; they are numbers.
 */
/**
 * ⚠️ EXPORTED, SO THE CLOUD CANNOT WRITE A SECOND PACKER. The note on mapBytes below says why
 * in its own words — the two used to be written out separately and would have drifted the moment
 * either grew a key. A published map and a kept map are the same bytes by construction now, and
 * readMapDoc takes either without being told which it is holding.
 */
export const packMapDoc = (doc: MapDoc) => ({
  v: 1,
  name: doc.name,
  palette: doc.palette.map(packDrawing),
  /* six numbers each rather than five repeated words — see packPieces, which is what makes
     two thousand of them fit in a map at all */
  pieces: packPieces(doc.pieces),
  /* the ground is a drawing like any other, so it is packed like any other */
  ground: doc.ground ? packDrawing(doc.ground) : null,
  spawn: doc.spawn,
  doors: doc.doors,
  /* already a string — see MapDoc.block, which is packed in memory for exactly this reason */
  block: doc.block,
})

const packed = (m: ParkMap) => ({ id: m.id, at: m.at, doc: packMapDoc(m.doc) })

/**
 * How big this map would be once kept, so a caller can say why rather than failing quietly.
 *
 * ⚠️ THE SAME FUNCTION THAT WRITES IT, not a second sum of the same fields. The two used to
 * be written out separately and would have drifted the moment either grew a key — which is
 * exactly what the ground was, and the editor would have reported a size that was not the one
 * being stored.
 */
export function mapBytes(doc: MapDoc): number {
  return JSON.stringify(packMapDoc(doc)).length
}

export const MAP_LIMIT = { items: MAX_ITEMS, bytes: MAX_BYTES }

/**
 * Where a map's bytes actually are.
 *
 * ⚠️ BECAUSE "USE SIMPLER DRAWINGS" MIGHT NOT BE TRUE. That was the whole of the refusal, and a
 * map is four very different things in one document: the palette, the ground painted under it,
 * the pieces, and the no-walk grid. The grid is a flat 3.8KB whatever is painted and the pieces
 * are numbers, so the weight is always the palette or the ground — and telling somebody to
 * simplify their stamps when the ground is nine tenths of the file is advice that cannot work.
 *
 * ⚠️ MEASURED THROUGH THE SAME PACKER THAT WRITES IT, for the reason mapBytes gives in its own
 * note: a second sum of the same fields drifts the moment either grows a key.
 */
export function mapParts(doc: MapDoc): {
  total: number
  palette: number
  ground: number
  pieces: number
  zone: number
} {
  const packed = packMapDoc(doc)
  const size = (v: unknown) => JSON.stringify(v ?? null).length
  return {
    total: JSON.stringify(packed).length,
    palette: size(packed.palette),
    ground: size(packed.ground),
    pieces: size(packed.pieces),
    zone: size(packed.block),
  }
}

/** The part to blame, in words somebody can act on. Null when nothing dominates. */
export function biggestPart(doc: MapDoc): { what: string; bytes: number } | null {
  const p = mapParts(doc)
  const named: Array<[string, number]> = [
    ['the drawings you stamped', p.palette],
    ['the ground you painted', p.ground],
    ['the things you placed', p.pieces],
  ]
  named.sort((a, b) => b[1] - a[1])
  const [what, bytes] = named[0]
  /* ⚠️ only worth naming when it actually dominates — "it is all of them a bit" is not advice */
  /* ⚠️ 0.6, NOT 0.45, AND A TEST CHOSE IT. Two parts of roughly equal weight are 50% each,
     so a 45% bar names one of them and blames the wrong half as often as the right one. A clear
     majority is the only case where naming a part is advice rather than a guess. */
  return bytes > p.total * 0.6 ? { what, bytes } : null
}

/**
 * Keep one. Returns null when it will not fit, so the room can say which of the two reasons.
 *
 * ⚠️ ONE NAME, ONE MAP, case-insensitively — the rule the gallery and the minions already
 * share, and the bug that taught it to both: keeping under a name already there has to REPLACE,
 * or the same gesture quietly accumulates copies nobody chose to keep.
 */
/**
 * No room for another one.
 *
 * ⚠️ SO THE ROOM CAN SAY WHICH, rather than guessing why null came back. A refusal now
 * means either "there was nothing worth keeping" or "this is full", and those want two
 * different things done about them. The rule stays here, where the cap is, so the room cannot
 * hold a second copy of it that is free to disagree.
 */
export const mapsFull = (): boolean => parkMaps().length >= MAX_ITEMS

export function saveMap(doc: MapDoc): ParkMap | null {
  const clean = readMapDoc(doc)
  if (!clean) return null
  if (mapBytes(clean) > MAX_BYTES) return null
  const item: ParkMap = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: clean.name,
    at: Date.now(),
    doc: clean,
  }
  const rest = parkMaps().filter((m) => m.name.toLowerCase() !== clean.name.toLowerCase())
  /**
   * ⚠️ REFUSED RATHER THAN MADE ROOM FOR, AND HERE IT IS THE ONLY COPY. `write` used to
   * `slice` to the cap, so keeping a thirteenth map dropped the oldest without a word — and
   * unlike the gallery, the songs and the minions, maps are not a kind in library/cloud.ts.
   * There is no account copy to come back, so an eviction here is the end of that map. Saying
   * no is the kindest thing this can do.
   */
  if (rest.length >= MAX_ITEMS) return null
  write([item, ...rest])
  return item
}

export function removeMap(id: string) {
  write(parkMaps().filter((m) => m.id !== id))
}
