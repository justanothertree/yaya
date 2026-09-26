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
const MAX_ITEMS = 12

/**
 * ⚠️ AND A CEILING PER MAP, reasoned from the worst case rather than the normal one. A single
 * drawing can reach about eighty kilobytes at the stroke limit, so a palette of twenty-four of
 * them is near two megabytes — one map able to fill the entire origin on its own. A map of a
 * rock, a tree and a pond is a few kilobytes, so this is not a limit anybody drawing a map will
 * meet; it is the one somebody pasting a creature in as scenery would.
 */
const MAX_BYTES = 200 * 1024

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
const onDisk = (doc: MapDoc) => ({
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

const packed = (m: ParkMap) => ({ id: m.id, at: m.at, doc: onDisk(m.doc) })

/**
 * How big this map would be once kept, so a caller can say why rather than failing quietly.
 *
 * ⚠️ THE SAME FUNCTION THAT WRITES IT, not a second sum of the same fields. The two used to
 * be written out separately and would have drifted the moment either grew a key — which is
 * exactly what the ground was, and the editor would have reported a size that was not the one
 * being stored.
 */
export function mapBytes(doc: MapDoc): number {
  return JSON.stringify(onDisk(doc)).length
}

export const MAP_LIMIT = { items: MAX_ITEMS, bytes: MAX_BYTES }

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
