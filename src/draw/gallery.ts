import { keptAt } from '../library/kept'
import { packDrawing, readDrawing, type Drawing } from './strokes'

/**
 * The pictures you have kept.
 *
 * Deliberately the same shape as the instrument's library — save, list, rename, delete, and every
 * item re-validated on the way OUT as well as in. localStorage is editable by anything on this
 * origin, so what a trusted path wrote is not necessarily what comes back, and this is the path
 * that ends up rendered on somebody else's profile.
 *
 * ⚠️ NOT LOCAL ANY MORE, WHICH THIS FILE WENT ON CLAIMING FOR MONTHS. It used to say
 * "local for now, like the song library" and that stopped being true the day library/cloud.ts
 * arrived: a signed-in member's pictures are rows in member_library, 400 items and 20MB of them,
 * and this store is the COPY THE APP READS. Which is the right shape — every room still reads
 * localStorage synchronously and knows nothing about the network, so the paint room works
 * offline, works signed out, and a keep cannot fail. But it means the numbers below are a CACHE
 * budget, not the size of anybody's gallery, and reading them as the latter is what made the
 * next note necessary.
 *
 * ⚠️ AND THE CACHE MUST NEVER EVICT, WHICH IS THE BUG THIS FIXES. `write` used to
 * `slice(0, MAX_ITEMS)`, so keeping a 121st picture dropped the oldest out of the cache without
 * a word. That is bad on its own and much worse downstream: watchLibrary compares localRows()
 * against the previous snapshot and sends `library_drop` for anything that has gone, because
 * while it is running "gone from here" can only mean somebody deleted it. It cannot mean that
 * any more. The eviction reached the account and took the real copy with it, so keeping your
 * 121st picture silently deleted your first — everywhere, not just in this browser.
 *
 * So nothing is ever dropped to make room. A keep that will not fit is REFUSED and says so,
 * which is a wall somebody can understand instead of a loss they find out about later.
 */

const KEY = 'paint_gallery_v1'

/**
 * ⚠️ A COUNT AND TWO CEILINGS, because a count alone decides nothing about room. This
 * store's only limit was 120 items, so how much of the origin it could take was settled entirely
 * by how the items were spelled: measured, a detailed creature of 200 strokes at 40 points is
 * 67KB packed, so 120 of them is 7.9MB against a typical five-megabyte quota. A budget nobody
 * can exceed is worth more than a count nobody can interpret.
 */
const MAX_ITEMS = 120
/**
 * ⚠️ ONE PICTURE'S CEILING, reasoned from the worst case like the maps store beside it:
 * a single drawing reaches about 80KB at the stroke limit, and this is comfortably above that,
 * so it is not a limit anybody drawing will meet. It is the one that stops a single pasted
 * monster taking the whole budget.
 */
const MAX_ONE = 200 * 1024
/**
 * ⚠️ AND WHAT ALL OF THEM MAY TAKE TOGETHER. Five megabytes is the whole origin and the
 * pictures share it with the songs, the minions, the maps and the saved looks — the maps store
 * alone can want 2.4MB at its own worst case. Two is this store's share of that, and it is a
 * cache budget rather than a gallery size: a signed-in member's account holds 20MB, and what
 * happens at this wall is that older pictures live on the account and come back on the next
 * sync rather than being carried about in the browser.
 */
const MAX_BYTES = 2 * 1024 * 1024

export const GALLERY_LIMIT = { items: MAX_ITEMS, bytes: MAX_BYTES, one: MAX_ONE }

export type Art = { id: string; name: string; at: number; art: Drawing }

let cache: Art[] | null = null
const listeners = new Set<() => void>()

export function subscribeGallery(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function gallery(): Art[] {
  if (cache) return cache
  let raw: unknown
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    raw = []
  }
  const out: Art[] = []
  if (Array.isArray(raw)) {
    for (const v of raw.slice(0, MAX_ITEMS)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      const art = readDrawing(o.art)
      if (!art || !art.strokes.length) continue
      out.push({
        id: typeof o.id === 'string' ? o.id.slice(0, 40) : String(Math.random()),
        name: art.name,
        at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0,
        art,
      })
    }
  }
  out.sort((a, b) => b.at - a.at)
  cache = out
  return out
}

/**
 * One item as it is written down.
 *
 * ⚠️ PACKED, WHICH THE MAPS STORE HAS ALWAYS DONE AND THIS DID NOT. A drawing written
 * the readable way is about 1.75 times the size of the same drawing packed — measured across
 * three shapes, and the ratio barely moves. That matters here because this store's only limit
 * is a COUNT: 120 items, and a detailed creature of 200 strokes at 40 points is 118KB written
 * out long, so the cap is 13.8MB against a typical five-megabyte quota. Packed it is 67KB.
 *
 * ⚠️ IT IS NOT A MIGRATION, because readDrawing has always taken both forms. Everything
 * already saved keeps reading exactly as it did, new writes are smaller, and the nine places
 * that use this module go through gallery() and saveArt() rather than the key — so none of them
 * can tell the difference.
 *
 * ⚠️ AND THE NAME IS NOT STORED, because it never was read. gallery() takes the name off
 * the DRAWING; the copy beside it was a second answer to the same question, free to disagree
 * and never consulted.
 */
const onDisk = (a: Art) => ({ id: a.id, at: a.at, art: packDrawing(a.art) })

/**
 * Whether the last write actually reached the disk.
 *
 * ⚠️ BECAUSE A FULL QUOTA USED TO BE SILENT, and silence is what turns a limit into a
 * loss. The catch below is right — a keep that throws would be worse than one that half-works
 * — but "it stays for this visit" is only an acceptable bargain if somebody is told it is the
 * bargain they got. This is the flag; saying so is the room's job.
 */
const disk = keptAt(KEY)

/** Did the last keep reach this browser's storage, or only this visit's memory? */
export const gallerySaved = (): boolean => disk.landed()

/**
 * Why the last keep did not happen, or null when it did.
 *
 * ⚠️ THE SAME SHAPE AS gallerySaved ABOVE, and for the same reason: the store is the only
 * thing that knows which wall was hit, and the room is the only thing that can say so. A second
 * copy of these rules in the room would be free to disagree with them.
 */
let trouble: 'empty' | 'too-big' | 'full' | null = null

/** Which wall the last keep hit, or null when it did not hit one — see saveArt. */
export const keepTrouble = () => trouble

/** Everything, as it goes to disk — one place, so a size and a write cannot disagree. */
const bodyOf = (items: Art[]) => JSON.stringify(items.map(onDisk))

/** How much room the gallery is using, so a room can say why rather than failing quietly. */
export const galleryRoom = (): { items: number; bytes: number } => {
  const items = gallery()
  return { items: items.length, bytes: bodyOf(items).length }
}

/** How big one picture would be once kept — the same function that writes it, not a second sum. */
export const artBytes = (art: Drawing): number => JSON.stringify(packDrawing(art)).length

/**
 * ⚠️ NO SLICE. It used to cap here, which made every caller's list advisory and the
 * oldest picture disposable — see the note at the top of this file for where that ended up.
 * The cap is enforced where a keep is decided, so nothing silently disappears from a list this
 * was handed.
 */
function write(items: Art[], body = bodyOf(items)) {
  cache = items
  disk.put(body)
  listeners.forEach((l) => l())
}

export function saveArt(art: Drawing): Art | null {
  const clean = readDrawing(art)
  if (!clean || !clean.strokes.length) {
    trouble = 'empty'
    return null
  }
  if (artBytes(clean) > MAX_ONE) {
    trouble = 'too-big'
    return null
  }
  const item: Art = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: clean.name,
    at: Date.now(),
    art: clean,
  }
  /**
   * ⚠️ ONE NAME, ONE PICTURE — the same rule savePet has always had, and the two stores
   * disagreeing was the bug. Keeping under a name that is already here REPLACES it; this simply
   * prepended, so the same gesture updated a minion and accumulated pictures. Measured: three
   * keeps of one name gave three gallery entries and one minion.
   *
   * ⚠️ WHICH MATTERS MOST WHERE BOTH ARE WRITTEN AT ONCE. Finishing a minion saves to both, so
   * editing a creature three times left one creature and three copies of its drawing — and the
   * name prompt now offers the existing name back, which makes pressing OK the normal thing to do.
   *
   * ⚠️ CASE-INSENSITIVE, because "Flappy" and "flappy" are one picture to everybody except a
   * string comparison.
   */
  const rest = gallery().filter((a) => a.name.toLowerCase() !== clean.name.toLowerCase())
  /**
   * ⚠️ REFUSED RATHER THAN MADE ROOM FOR. Dropping the oldest is the obvious thing and
   * it is the thing that deleted people's work off their accounts — see the top of this file.
   * Replacing a name you already have is always allowed, because that takes no new room.
   */
  /* ⚠️ the count first, because it is free and the budget costs a stringify of everything */
  if (rest.length >= MAX_ITEMS) {
    trouble = 'full'
    return null
  }
  const next = [item, ...rest]
  const body = bodyOf(next)
  if (body.length > MAX_BYTES) {
    trouble = 'full'
    return null
  }
  trouble = null
  write(next, body)
  return item
}

export function removeArt(id: string) {
  write(gallery().filter((a) => a.id !== id))
}
