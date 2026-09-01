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
