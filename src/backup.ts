import { library, saveToLibrary } from './audio/library'
import { packSong, readSong } from './audio/songFile'
import { gallery, saveArt } from './draw/gallery'
import { packDrawing, readDrawing } from './draw/strokes'
import { readPresets, savePreset } from './audio/vizPresets'
import { packPet, pets, readPet, savePet } from './pets/pets'
import { mergeWins, packWins } from './park/records'

/**
 * Everything you have made here, as one file you can keep.
 *
 * ⚠️ NO LONGER THE ONLY WAY OUT, AND STILL WORTH HAVING. This file was written when the song
 * library, the paint gallery, the saved looks and the minions were localStorage and nothing
 * else, and it said so at length: a stopgap until a real server copy existed. That copy exists
 * now — library/cloud.ts keeps all of them, and the park's records, level on your account. What
 * this is FOR changed with it. It is no longer the thing standing between somebody and losing
 * a year of songs; it is the copy that does not need an account, does not need this site to
 * still be up, and does not need anybody's permission — which is a different job, and one the
 * sync cannot do.
 *
 * ⚠️ WHAT SIGNED-OUT MEANS IS UNCHANGED. The sync is for members; a visitor who draws something
 * on the Paint page still has it in one browser only, and this file is still their whole answer.
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
  /**
   * ⚠️ `minions`, not `pets`, and that is the rule rather than an inconsistency. Every other
   * stored word in this codebase still says `pet` — the localStorage key, the library kind, the
   * profile block type — because those were written down before the rename, in places belonging
   * to people who cannot be asked to rewrite them. This field has never been written by anybody,
   * so it gets the real name. A stored word is frozen at the moment it is first written, not
   * before.
   *
   * ⚠️ REQUIRED HERE AND OPTIONAL ON THE WAY IN, which is not a contradiction: a backup this
   * app WRITES always has it, and both readers take a `Partial<Backup>` and check every field
   * with Array.isArray — so a file made before today restores exactly as it did.
   */
  minions: unknown[]
  /**
   * ⚠️ ADDED THE DAY THE PARK STARTED KEEPING ANY, and optional on the way in for the same
   * reason `minions` is: a file written before today has none, and must restore exactly as it
   * did. The mistake this field is avoiding is the one `minions` records above — a store
   * arrived and nobody came back here, so a person who backed up and restored got everything
   * except the thing they had made most recently.
   */
  wins?: unknown[]
}

export function makeBackup(): Backup {
  return {
    v: VERSION,
    at: Date.now(),
    songs: library().map((i) => ({ kind: i.kind, song: packSong(i.song) })),
    art: gallery().map((a) => packDrawing(a.art)),
    looks: readPresets().map((p) => ({ name: p.name, s: p.s })),
    minions: pets().map(packPet),
    wins: packWins(),
  }
}

/** `evancook-backup-2026-09-14.json` — dated, because you will end up with several. */
export function backupName(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `evancook-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}

export type Restored = {
  songs: number
  art: number
  looks: number
  minions: number
  wins: number
  skipped: number
}

/**
 * Put a backup back.
 *
 * ⚠️ ADDS, NEVER REPLACES, and skips anything already here by name. Restoring is something people
 * do when they are worried, often twice, and sometimes onto a machine that already has half of
 * it — none of those should cost you what you already had, and none of them should leave you
 * with everything twice.
 */
export function restoreBackup(raw: unknown): Restored {
  const out: Restored = { songs: 0, art: 0, looks: 0, minions: 0, wins: 0, skipped: 0 }
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

  /* ⚠️ through readPet, like everything else here: a backup comes off a disk and is exactly
     as trustworthy as a file from a stranger — see the note at the top */
  if (Array.isArray(b.minions)) {
    const have = new Set(pets().map((p) => p.name))
    for (const packed of b.minions.slice(0, 200)) {
      const m = readPet(packed)
      if (!m || have.has(m.name)) {
        out.skipped++
        continue
      }
      if (savePet(m.name, m.art)) {
        have.add(m.name)
        out.minions++
      } else out.skipped++
    }
  }

  /* ⚠️ merged rather than counted-and-skipped like the rest, because a record is not a thing
     you can already have a copy of — see mergeWins, which takes the better of the two. It is
     the same function the account sync uses, so a file and a second browser cannot disagree
     about whose time was quicker. */
  if (Array.isArray(b.wins)) out.wins = mergeWins(b.wins)

  return out
}

/** What a backup holds, for showing before anything is written. */
export function countBackup(
  raw: unknown,
): { songs: number; art: number; looks: number; minions: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Partial<Backup>
  if (
    !Array.isArray(b.songs) &&
    !Array.isArray(b.art) &&
    !Array.isArray(b.looks) &&
    !Array.isArray(b.minions)
  )
    return null
  return {
    songs: Array.isArray(b.songs) ? b.songs.length : 0,
    art: Array.isArray(b.art) ? b.art.length : 0,
    looks: Array.isArray(b.looks) ? b.looks.length : 0,
    minions: Array.isArray(b.minions) ? b.minions.length : 0,
  }
}
