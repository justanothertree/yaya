import { keptAt } from '../library/kept'
/**
 * Saved visualiser arrangements, by name.
 *
 * ⚠️ THE SAME SHAPE THE SHARED WINDOW ALREADY SENDS, deliberately. The visualiser could already
 * snapshot its settings and read one back — that is how following somebody's window works — and
 * a preset is the same object with a name on it. Reusing it means presets validate through the
 * same checks a peer's settings do, and a control added to the panel appears in presets without
 * anybody remembering to add it here.
 *
 * ⚠️ LOCAL, not on the server. These are somebody's own arrangements of their own screen, and
 * putting them in a table would mean a migration, a policy and a round trip for something that
 * is worth exactly as much as the browser it was made in. Applying one to a PROFILE copies its
 * values into that block, so what a visitor sees never depends on a preset they cannot read.
 */

const KEY = 'viz_presets_v1'
const MAX = 40
/** Room for a good few dozen arrangements; one is a hundred bytes or so. */
const MAX_BYTES = 60_000

export type VizPreset = {
  id: string
  name: string
  /** the snapshot, checked on the way back in by the panel's own reader */
  s: Record<string, unknown>
}

const clean = (v: unknown): VizPreset | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = typeof o.id === 'string' && /^[a-z0-9]{1,32}$/i.test(o.id) ? o.id : null
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 40) : ''
  if (!id || !name || !o.s || typeof o.s !== 'object') return null
  return { id, name, s: o.s as Record<string, unknown> }
}

export function readPresets(): VizPreset[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? (arr.slice(0, MAX).map(clean).filter(Boolean) as VizPreset[]) : []
  } catch {
    return []
  }
}

/**
 * Anybody who wants to know when the saved looks change.
 *
 * ⚠️ Added for the server copy (see library/cloud.ts), which keeps itself level by WATCHING
 * the stores rather than by wrapping their savers — a network call inside savePreset would make
 * saving a look something that can fail, and it must not be.
 */
const listeners = new Set<() => void>()

export function subscribePresets(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const disk = keptAt(KEY)

/** Did the last look reach this browser's storage, or only this visit's memory? — see keptAt */
export const presetsSaved = (): boolean => disk.landed()

function write(list: VizPreset[]): VizPreset[] {
  /* ⚠️ no slice — see savePreset for why a store that makes room is a store that deletes */
  disk.put(JSON.stringify(list))
  listeners.forEach((l) => l())
  return list
}

/**
 * Save the current arrangement under a name.
 *
 * ⚠️ SAME NAME REPLACES, case-insensitively. Somebody tuning a look saves it a dozen times while
 * they get it right, and a list with nine entries called "warm" is not a feature. Re-saving is
 * the ordinary gesture here; a second copy is the surprising one.
 */
export function savePreset(name: string, s: Record<string, unknown>): VizPreset[] {
  const clean = name.trim().slice(0, 40)
  if (!clean) return readPresets()
  if (JSON.stringify(s).length > MAX_BYTES) return readPresets()
  const list = readPresets()
  const at = list.findIndex((p) => p.name.toLowerCase() === clean.toLowerCase())
  const entry: VizPreset = {
    id: at >= 0 ? list[at].id : Math.random().toString(36).slice(2, 10),
    name: clean,
    s,
  }
  if (at >= 0) list[at] = entry
  else {
    /**
     * ⚠️ REFUSED RATHER THAN MADE ROOM FOR, AND THAT IS A DATA-LOSS FIX. `write` used to
     * `slice` the list to the cap, so saving one past it dropped the oldest without a word — and
     * this store is synced. watchLibrary compares localRows() against the previous snapshot and
     * sends `library_drop` for anything that has gone, because while it is running "gone from here"
     * can only mean somebody deleted it. An eviction looks exactly like a deletion, so the cache
     * making room reached the account and took the real copy with it.
     */
    if (list.length >= MAX) return list
    list.unshift(entry)
  }
  return write(list)
}

export function deletePreset(id: string): VizPreset[] {
  return write(readPresets().filter((p) => p.id !== id))
}
