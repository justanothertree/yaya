import { library, saveToLibrary } from './audio/library'
import { packSong, readSong } from './audio/songFile'
import { gallery, saveArt } from './draw/gallery'
import { packDrawing, readDrawing } from './draw/strokes'
import { readPresets, savePreset } from './audio/vizPresets'

/**
 * Everything you have made that lives only in this browser, as one file.
 *
 * ⚠️ THREE STORES ARE LOCAL AND ONLY LOCAL: the song library, the paint gallery and the saved
 * looks. That is written down as a deliberate first step in each of them — it works with no
 * schema change and no new way for one person's data to reach another — and the bill for it
 * came due twice in one week. Somebody lost songs they made weeks ago without changing browser
 * or clearing anything, which is a browser evicting site data and is entirely normal; and a song
 * made in one browser could not be edited from another, because the library is not there.
 *
 * ⚠️ THIS IS NOT THE FIX, it is the thing that means the fix is not urgent enough to rush. A
 * library on the server is the real answer and it is a migration against a live database. Until
 * then, work that can be carried to another machine and put back after a wipe is work that is
 * not one browser setting away from gone.
 *
 * ⚠️ PACKED, and restored through the same readers a file from a stranger goes through. A backup
 * comes back off a disk, which makes it exactly as trustworthy as anything else that arrives from
 * outside — readSong and readDrawing are the security boundary and this does not go around them.
 */

const VERSION = 1

export type Backup = {
  v: number
  at: number
  songs: Array<{ kind: 'song' | 'loop'; song: unknown }>
  art: unknown[]
  looks: Array<{ name: string; s: Record<string, unknown> }>
}

export function makeBackup(): Backup {
  return {
    v: VERSION,
    at: Date.now(),
    songs: library().map((i) => ({ kind: i.kind, song: packSong(i.song) })),
    art: gallery().map((a) => packDrawing(a.art)),
    looks: readPresets().map((p) => ({ name: p.name, s: p.s })),
  }
}

/** `evancook-backup-2026-09-14.json` — dated, because you will end up with several. */
export function backupName(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `evancook-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}

export type Restored = { songs: number; art: number; looks: number; skipped: number }

/**
 * Put a backup back.
 *
 * ⚠️ ADDS, NEVER REPLACES, and skips anything already here by name. Restoring is something people
 * do when they are worried, often twice, and sometimes onto a machine that already has half of
 * it — none of those should cost you what you already had, and none of them should leave you
 * with everything twice.
 */
export function restoreBackup(raw: unknown): Restored {
  const out: Restored = { songs: 0, art: 0, looks: 0, skipped: 0 }
  if (!raw || typeof raw !== 'object') return out
  const b = raw as Partial<Backup>

  if (Array.isArray(b.songs)) {
    const have = new Set(library().map((i) => i.name))
    for (const entry of b.songs.slice(0, 500)) {
      const e = entry as { kind?: unknown; song?: unknown }
      const song = readSong(e?.song)
      if (!song) {
        out.skipped++
        continue
      }
      if (have.has(song.name)) {
        out.skipped++
        continue
      }
      if (saveToLibrary(e?.kind === 'loop' ? 'loop' : 'song', song)) {
        have.add(song.name)
        out.songs++
      } else out.skipped++
    }
  }

  if (Array.isArray(b.art)) {
    const have = new Set(gallery().map((a) => a.name))
    for (const packed of b.art.slice(0, 500)) {
      const d = readDrawing(packed)
      if (!d) {
        out.skipped++
        continue
      }
      if (have.has(d.name)) {
        out.skipped++
        continue
      }
      if (saveArt(d)) {
        have.add(d.name)
        out.art++
      } else out.skipped++
    }
  }

  if (Array.isArray(b.looks)) {
    const have = new Set(readPresets().map((p) => p.name))
    for (const entry of b.looks.slice(0, 200)) {
      const l = entry as { name?: unknown; s?: unknown }
      if (typeof l?.name !== 'string' || !l.name.trim()) {
        out.skipped++
        continue
      }
      if (have.has(l.name)) {
        out.skipped++
        continue
      }
      if (!l.s || typeof l.s !== 'object') {
        out.skipped++
        continue
      }
      savePreset(l.name, l.s as Record<string, unknown>)
      have.add(l.name)
      out.looks++
    }
  }

  return out
}

/** What a backup holds, for showing before anything is written. */
export function countBackup(raw: unknown): { songs: number; art: number; looks: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Partial<Backup>
  if (!Array.isArray(b.songs) && !Array.isArray(b.art) && !Array.isArray(b.looks)) return null
  return {
    songs: Array.isArray(b.songs) ? b.songs.length : 0,
    art: Array.isArray(b.art) ? b.art.length : 0,
    looks: Array.isArray(b.looks) ? b.looks.length : 0,
  }
}
