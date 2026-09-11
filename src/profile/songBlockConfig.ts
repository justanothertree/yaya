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

/**
 * A look a particular track should play with.
 *
 * ⚠️ PER TRACK, not per block. A song block already had visualiser settings and a visual block
 * already had its own — but both were one setting for the whole block, so a playlist of six
 * tracks played all six through one look. The thing people actually want is that a track brings
 * its own, which is a property of the track rather than of the surface drawing it.
 *
 * ⚠️ EVERY FIELD OPTIONAL, and absent means "whatever the visual block was already set to". That
 * is what makes this additive: a block written before this existed has no looks, so every track
 * falls through to the block's own settings and nothing changes for anybody.
 *
 * ⚠️ The mode is only checked for SHAPE here, not against the list of real modes. This module is
 * deliberately free of audio imports so the block editor can use it without pulling the visual
 * engine in; ProfileMusic already re-checks the id against VISUALS and falls back, which is the
 * check that matters and the one place it cannot be skipped.
 */
export type SongLook = {
  mode?: string
  palette?: string
  mirror?: number
  trail?: number
  bloom?: number
  punch?: number
  echo?: number
}

const slug = (v: unknown): string | undefined =>
  typeof v === 'string' && /^[a-z0-9_-]{1,40}$/i.test(v) ? v : undefined

const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined

/**
 * Read one look, or null if there is nothing usable in it.
 *
 * ⚠️ Clamped, for the same reason the visual block clamps its own: this is stored config that
 * renders on a stranger's machine, and a mirror count of 9,999 is a frozen browser rather than an
 * unusual page. Returning null for an empty object matters too — an entry that says nothing must
 * not count as an override, or it would pin the track to the defaults.
 */
export function readLook(v: unknown): SongLook | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const look: SongLook = {
    mode: slug(o.mode),
    palette: slug(o.palette),
    mirror: num(o.mirror, 1, 8),
    trail: num(o.trail, 0, 0.97),
    bloom: num(o.bloom, 0, 1),
    punch: num(o.punch, 0, 1),
    echo: num(o.echo, 0, 1),
  }
  for (const k of Object.keys(look) as Array<keyof SongLook>)
    if (look[k] === undefined) delete look[k]
  return Object.keys(look).length ? look : null
}

/**
 * The looks for a block's tracks, aligned by position with songsFromConfig.
 *
 * ⚠️ A PARALLEL ARRAY, and the alignment is the price of not touching the song format. Looks
 * cannot ride inside the packed song — readSong would drop them — and re-keying the songs array
 * into objects would break every block already stored. So position is the join, and the editor
 * is responsible for reordering and removing looks alongside their tracks. Anything past the end
 * is simply absent, which is the same as no override.
 */
export function looksFromConfig(cfg: Record<string, unknown>): Array<SongLook | null> {
  if (!Array.isArray(cfg.looks)) return []
  return cfg.looks.slice(0, 25).map(readLook)
}

/**
 * Set one field of one track's look, and give back a whole new config.
 *
 * ⚠️ PADDED to the track's position rather than pushed. The array is joined to the songs by
 * index, so a look for track 4 has to actually sit at index 4 even when tracks 0-3 have none —
 * pushing would put it at index 0 and quietly dress the wrong song.
 *
 * ⚠️ An empty value REMOVES the field, and a look with nothing left in it becomes null, and an
 * array of nothing but nulls is dropped entirely. Without that last step, choosing a mode and
 * then changing your mind would leave `looks: [null, null, null]` stored on the profile forever
 * — config that means nothing but still counts against the block's size limit.
 */
export function setLook(
  cfg: Record<string, unknown>,
  at: number,
  field: keyof SongLook,
  v: string,
): Record<string, unknown> {
  const looks = looksFromConfig(cfg)
  while (looks.length <= at) looks.push(null)
  const next: SongLook = { ...(looks[at] ?? {}) }
  if (v) next[field] = v as never
  else delete next[field]
  looks[at] = Object.keys(next).length ? next : null
  return { ...cfg, looks: looks.some(Boolean) ? looks : undefined }
}

/**
 * Put a whole saved look on one track, replacing whatever it had.
 *
 * ⚠️ THE VALUES ARE COPIED IN, not a reference to the preset. Presets live in the browser that
 * made them, so a block pointing at one by name would render differently for every visitor and
 * not at all for most — the profile has to carry what it means on its own.
 *
 * ⚠️ Straight through readLook, which is what keeps this honest: a preset is a snapshot of the
 * whole visualiser panel and carries settings a profile block has no idea about — source, gain,
 * the auto-path. readLook keeps the seven a visual block actually honours, clamps them, and
 * drops the rest, so nothing arrives here that cannot be drawn.
 */
export function applyLookPreset(
  cfg: Record<string, unknown>,
  at: number,
  preset: unknown,
): Record<string, unknown> {
  const looks = looksFromConfig(cfg)
  while (looks.length <= at) looks.push(null)
  looks[at] = readLook(preset)
  return { ...cfg, looks: looks.some(Boolean) ? looks : undefined }
}
