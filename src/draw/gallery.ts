import { packDrawing, readDrawing, type Drawing } from './strokes'

/**
 * The pictures you have kept.
 *
 * Deliberately the same shape as the instrument's library — save, list, rename, delete, and every
 * item re-validated on the way OUT as well as in. localStorage is editable by anything on this
 * origin, so what a trusted path wrote is not necessarily what comes back, and this is the path
 * that ends up rendered on somebody else's profile.
 *
 * ⚠️ Local for now, like the song library. It works today with no migration against a live
 * database and no new way for one person's data to reach another; putting a drawing on a profile
 * copies it into the block, so visitors never touch this at all.
 */

const KEY = 'paint_gallery_v1'
const MAX_ITEMS = 120

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
let landed = true

/** Did the last keep reach this browser's storage, or only this visit's memory? */
export const gallerySaved = (): boolean => landed

function write(items: Art[]) {
  cache = items.slice(0, MAX_ITEMS)
  try {
    localStorage.setItem(KEY, JSON.stringify(cache.map(onDisk)))
    landed = true
  } catch {
    /* storage full or blocked — it stays for this visit, and gallerySaved() says so */
    landed = false
  }
  listeners.forEach((l) => l())
}

export function saveArt(art: Drawing): Art | null {
  const clean = readDrawing(art)
  if (!clean || !clean.strokes.length) return null
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
  write([item, ...gallery().filter((a) => a.name.toLowerCase() !== clean.name.toLowerCase())])
  return item
}

export function removeArt(id: string) {
  write(gallery().filter((a) => a.id !== id))
}
