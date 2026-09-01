import { readSong, songNotes, type Song } from './songFile'

/**
 * The things you have made and kept.
 *
 * Two kinds, and the difference is what you do with them rather than how they are stored:
 *
 *   A SONG is a whole arrangement — load it and you are back where you left off.
 *   A LOOP is one part — a drum pattern, a bassline — meant to be dropped INTO something else.
 *
 * ⚠️ Same format for both, deliberately. A loop is a song with one layer, so saving a loop is
 * `toSong(name, bpm, bars, layers, thatLayerId)` and nothing else, and everything that can read a
 * song can read a loop. Two formats would mean two parsers, two validators and two ways for a
 * malformed file to reach the synth — and the parser is the security boundary here, so having one
 * of it matters more than the tidiness of separate types.
 *
 * ⚠️ LOCAL FOR NOW, on purpose. This is localStorage, so a library lives in one browser and does
 * not follow you between machines. That is a real limitation and it is the right first step:
 * saving works today with no schema change, no migration against a live database, and no new way
 * for one person's data to reach another person. Putting a song on your profile is the step that
 * needs the server, and it can read exactly this format when it arrives.
 */

const KEY = 'inst_library_v1'
/** A generous ceiling that still cannot fill a browser's storage quota on its own. */
const MAX_ITEMS = 200

export type LibraryItem = {
  id: string
  /** a whole arrangement, or one part meant to be reused */
  kind: 'song' | 'loop'
  name: string
  /** ms since epoch, for sorting newest first */
  at: number
  song: Song
}

let cache: LibraryItem[] | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function subscribeLibrary(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Read the library.
 *
 * ⚠️ Every stored song goes back through readSong on the way out, not just on the way in.
 * localStorage is editable by anything running on this origin and by the person themselves, so
 * what was written by a trusted path is not what is necessarily read back — and this is the path
 * that ends in oscillators. Re-validating on read costs a millisecond and removes a whole class
 * of "but we checked it when we saved it" reasoning.
 */
export function library(): LibraryItem[] {
  if (cache) return cache
  let raw: unknown
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    raw = []
  }
  const out: LibraryItem[] = []
  if (Array.isArray(raw)) {
    for (const v of raw.slice(0, MAX_ITEMS)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      const song = readSong(o.song)
      if (!song) continue
      out.push({
        id: typeof o.id === 'string' ? o.id.slice(0, 40) : String(Math.random()),
        kind: o.kind === 'loop' ? 'loop' : 'song',
        name: song.name,
        at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : 0,
        song,
      })
    }
  }
  out.sort((a, b) => b.at - a.at)
  cache = out
  return out
}

function write(items: LibraryItem[]) {
  cache = items.slice(0, MAX_ITEMS)
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* storage full or blocked — it stays for this visit, which is better than throwing */
  }
  emit()
}

/** Keep something. Returns the saved item, or null when there was nothing worth keeping. */
export function saveToLibrary(kind: 'song' | 'loop', song: Song): LibraryItem | null {
  const clean = readSong(song)
  if (!clean || !songNotes(clean)) return null
  const item: LibraryItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    name: clean.name,
    at: Date.now(),
    song: clean,
  }
  write([item, ...library()])
  return item
}

export function renameInLibrary(id: string, name: string) {
  const trimmed = name.slice(0, 60).trim()
  if (!trimmed) return
  write(
    library().map((i) =>
      i.id === id ? { ...i, name: trimmed, song: { ...i.song, name: trimmed } } : i,
    ),
  )
}

export function removeFromLibrary(id: string) {
  write(library().filter((i) => i.id !== id))
}
