import { readSong, type Song } from '../audio/songFile'

/**
 * A song block's stored config, made safe.
 *
 * ⚠️ Its own file so ProfileMusic.tsx exports only components — a mixed module breaks fast
 * refresh, and this is the one function both the renderer and the editor need.
 *
 * Anything unreadable comes back null and the block renders as nothing at all, rather than as a
 * broken player. The parser refuses whatever it will not vouch for, and a profile is the last
 * place to argue with a visitor about somebody else's data.
 */
export function songFromConfig(cfg: Record<string, unknown>): Song | null {
  return readSong(cfg.song)
}

/**
 * Every song in a block, in order.
 *
 * ⚠️ `song` is still read, and read FIRST. Blocks made before playlists existed hold a single
 * packed song under that key, and they must keep working untouched — so the newer `songs` array
 * is additive and a block with both is simply a block whose first track was set the old way.
 * Each entry goes through readSong for the same reason it always did: this is stored data, which
 * is to say data somebody could have edited.
 */
export function songsFromConfig(cfg: Record<string, unknown>): Song[] {
  const out: Song[] = []
  const one = readSong(cfg.song)
  if (one) out.push(one)
  if (Array.isArray(cfg.songs))
    for (const raw of cfg.songs.slice(0, 24)) {
      const s = readSong(raw)
      if (s) out.push(s)
    }
  return out
}
