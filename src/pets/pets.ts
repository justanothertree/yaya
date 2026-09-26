import { packDrawing, readDrawing, type Drawing } from '../draw/strokes'

/**
 * The pets you have, kept the way the gallery keeps pictures.
 *
 * ⚠️ A PET IS A DRAWING WITH A NAME. Not a drawing plus a rig, plus a sprite sheet, plus a state
 * file — one drawing, and everything else is read out of it (see rig.ts). That is what makes a
 * pet something you can make in four minutes in a room that already exists, and what stops this
 * module needing a format of its own that would then have to be versioned, validated, migrated
 * and kept in step with the picture it describes.
 *
 * ⚠️ RE-VALIDATED ON THE WAY OUT AS WELL AS IN, the same rule the gallery follows for the same
 * reason: localStorage is editable by anything on this origin, a pet ends up rendered on somebody
 * else's profile, and what a trusted path wrote is not necessarily what comes back.
 */

const KEY = 'pets_v1'
const MAX_PETS = 40

export type Pet = { id: string; name: string; at: number; art: Drawing }

/** the shape that travels — to the server, into a backup file, onto a profile block */
export type PackedPet = { n: string; a: ReturnType<typeof packDrawing> }

export const packPet = (p: Pet): PackedPet => ({ n: p.name, a: packDrawing(p.art) })

/** A pet from anywhere, or null. Never throws, never trusts. */
export function readPet(v: unknown): { name: string; art: Drawing } | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const art = readDrawing(o.a ?? o.art)
  if (!art || !art.strokes.length) return null
  const raw = typeof o.n === 'string' ? o.n : typeof o.name === 'string' ? o.name : ''
  const name = raw.trim().slice(0, 40) || art.name || 'Minion'
  return { name, art }
}

let cache: Pet[] | null = null
const listeners = new Set<() => void>()

export function subscribePets(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function pets(): Pet[] {
  if (cache) return cache
  let raw: unknown
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    raw = []
  }
  const out: Pet[] = []
  if (Array.isArray(raw)) {
    for (const v of raw.slice(0, MAX_PETS)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      const pet = readPet(o)
      if (!pet) continue
      out.push({
        id: typeof o.id === 'string' ? o.id.slice(0, 40) : String(Math.random()),
        name: pet.name,
        at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0,
        art: pet.art,
      })
    }
  }
  out.sort((a, b) => b.at - a.at)
  cache = out
  return out
}

function write(items: Pet[]) {
  /* ⚠️ no slice — see savePet for why a cache that makes room is a cache that deletes */
  cache = items
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(cache.map((p) => ({ id: p.id, at: p.at, ...packPet(p) }))),
    )
  } catch {
    /* storage full or blocked — it stays for this visit */
  }
  listeners.forEach((l) => l())
}

/**
 * ⚠️ BY NAME, like every other store here. Keeping two pets called Bingo is not a thing anybody
 * wants, and it is the rule the library sync depends on — its slots are keyed on a lowercased
 * name, so a store that allowed duplicates would produce a pet that vanished on the next sync.
 */
export function savePet(name: string, art: Drawing): Pet | null {
  const clean = readPet({ n: name, a: packDrawing(art) })
  if (!clean) return null
  const item: Pet = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: clean.name,
    at: Date.now(),
    art: clean.art,
  }
  const rest = pets().filter((p) => p.name.toLowerCase() !== clean.name.toLowerCase())
  /**
   * ⚠️ REFUSED RATHER THAN MADE ROOM FOR, AND THAT IS A DATA-LOSS FIX. `write` used to
   * `slice` the list to the cap, so saving one past it dropped the oldest without a word — and
   * this store is synced. watchLibrary compares localRows() against the previous snapshot and
   * sends `library_drop` for anything that has gone, because while it is running "gone from here"
   * can only mean somebody deleted it. An eviction looks exactly like a deletion, so the cache
   * making room reached the account and took the real copy with it.
   */
  if (rest.length >= MAX_PETS) return null
  write([item, ...rest])
  return item
}

export function renamePet(id: string, name: string) {
  const to = name.trim().slice(0, 40)
  if (!to) return
  write(pets().map((p) => (p.id === id ? { ...p, name: to, at: Date.now() } : p)))
}

export function removePet(id: string) {
  write(pets().filter((p) => p.id !== id))
}
