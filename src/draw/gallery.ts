import { readDrawing, type Drawing } from './strokes'

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

function write(items: Art[]) {
  cache = items.slice(0, MAX_ITEMS)
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* storage full or blocked — it stays for this visit */
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
  write([item, ...gallery()])
  return item
}

export function removeArt(id: string) {
  write(gallery().filter((a) => a.id !== id))
}
