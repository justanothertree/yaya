import { packSong, readSong, type Song } from '../audio/songFile'
import type { ProfileBlock } from '../sections/ProfileBlocks'
import { CONFIG_LIMIT, PROFILE_LIMIT, configSize } from './blockSize'
import { songsFromConfig } from './songBlockConfig'

/**
 * A profile page's blocks as data: what a new block starts as, what a save sends, and a song added
 * from outside the editor.
 *
 * ⚠️ MOVED OUT OF THE EDITOR (21 Nov 2026) BECAUSE A SECOND PLACE NOW ADDS TO A PAGE. "Put it on
 * my profile" in the Instrument room writes a song block without the editor open, and
 * `save_my_profile_blocks` deletes every block and inserts the payload, so the two writers have to
 * agree exactly on what a block starts as and what a save carries. One copy of each, here.
 */

/** the most blocks a page may have; the server refuses a twenty-first */
export const MAX_BLOCKS = 20
/** the most songs one song block plays: songsFromConfig reads the first 24 of `songs` */
export const MAX_SONGS = 24

type Block = ProfileBlock
type Tier = ProfileBlock['visibility']

/**
 * Who a new block is visible to before anybody chooses.
 *
 * 'members' means anyone with ANY account on the site — fine for a bio or a status, but
 * activity and stats surface circuit-flavoured detail (workout logs, trophies) to people who may
 * have signed up for an unrelated module and have no context for it. 'friends' at least requires
 * an accepted mutual friendship first. The circuit_log rows themselves are separately restricted
 * to viewers who actually share that circuit (get_member_activity checks membership per row) —
 * this default is about avoiding an accidentally-broad START, not a gap in what the row-level
 * check already covers.
 *
 * ⚠️ One function, because the layouts add blocks too and a second copy of this rule is a
 * second place for it to be wrong.
 */
export function defaultTier(type: Block['block_type']): Tier {
  /* ⚠️ chronicle joins the two that were already here, and has the strongest claim of the three:
     it is a record of how somebody spends their days. 'members' would start it at anyone with any
     account on the site. The server refuses 'public' for it outright — see
     docs/2026-10-14-chronicle-profile-block.sql — so the widest it can ever go is members. */
  return type === 'activity' || type === 'stats' || type === 'chronicle' ? 'friends' : 'members'
}

/**
 * The look the page mostly has, for a block that has just arrived: the value of a style setting
 * most of its blocks share, or null when that is the default.
 *
 * ⚠️ BECAUSE "USE THIS LOOK EVERYWHERE" ONLY REACHES THE BLOCKS THAT EXIST. Square off a
 * page of ten, add an eleventh, and it arrives rounded — so every addition quietly undoes the
 * consistency you just pressed a button for, and you have to press it again forever. A new
 * block joining the majority is what somebody means by "my page is square".
 *
 * ⚠️ The MOST COMMON value, not the first block's. A page with one deliberate odd block out
 * would otherwise hand its oddity to everything added afterwards.
 */
export function prevailing(blocks: readonly Block[], key: string, fallback: string): string | null {
  const counts = new Map<string, number>()
  for (const b of blocks) {
    const v = typeof b.config?.[key] === 'string' ? (b.config[key] as string) : fallback
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best = fallback
  let most = 0
  for (const [v, n] of counts) if (n > most) [best, most] = [v, n]
  return best === fallback ? null : best
}

/** a new block of `type` for this page: medium, dressed the way the rest of the page is */
export function freshBlock(blocks: readonly Block[], type: Block['block_type']): Block {
  const config: Record<string, unknown> = {}
  for (const [key, dflt] of [
    ['font', 'page'],
    ['shape', 'round'],
    ['edge', 'plain'],
  ] as const) {
    const v = prevailing(blocks, key, dflt)
    if (v) config[key] = v
  }
  return { block_type: type, size: 'medium', config, visibility: defaultTier(type) }
}

/** what a save sends for each block, in page order; the server matches Certain lists by position */
export const payloadOf = (list: readonly Block[]) =>
  list.map(({ block_type, size, config, visibility, certain }) => ({
    block_type,
    size,
    config,
    visibility,
    certain: certain ?? [],
  }))

/** a value with every object's keys in one order, as a comparison needs and jsonb does not keep */
const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
        )
      : v

/**
 * Whether two pages are the same page as the server would store them.
 *
 * ⚠️ NOT `JSON.stringify(a) === JSON.stringify(b)`, which is never true of a page read back: jsonb
 * keeps an object's keys in its own order, so a config written `{text, font}` comes back
 * `{font, text}`, and a Certain list comes back sorted and lower-cased. Compared as strings, every
 * page read back from the server looked changed.
 */
export function samePage(a: readonly Block[], b: readonly Block[]): boolean {
  const canon = (list: readonly Block[]) =>
    JSON.stringify(
      list.map(({ block_type, size, config, visibility, certain }) =>
        sorted({
          block_type,
          size,
          config,
          visibility,
          certain:
            visibility === 'certain' ? [...(certain ?? [])].map((n) => n.toLowerCase()).sort() : [],
        }),
      ),
    )
  return canon(a) === canon(b)
}

export type WithSong =
  | { ok: true; blocks: Block[]; how: 'added' | 'updated' | 'new block'; name: string }
  | { ok: false; why: 'empty' | 'full' | 'too many blocks' | 'too big' | 'page too big' }

/**
 * The page with `song` on it: in place of a song of the same name in its first song block, at the
 * end of that block's list, or in a new song block at the end of the page.
 *
 * ⚠️ EVERY OTHER BLOCK IS RETURNED AS IT CAME, the same objects, because the save that follows
 * replaces the whole page and anything it does not carry is gone.
 *
 * ⚠️ THE BLOCK'S OWN LIST IS REWRITTEN THE WAY THE EDITOR'S PICKER DOES IT: whatever it plays,
 * packed again, a single old `song` folded in first. Looks are matched to songs by position, so a
 * song updated in place keeps its look and a new one is added at the end with none.
 *
 * ⚠️ AND THE SONG IS READ THE WAY IT WILL BE READ BACK before it is compared or stored. A stored
 * song comes back through readSong, which cuts a name to 60 characters and trims it; compared
 * raw, a typed name of 59 letters and a space never matched its own stored copy, so every press
 * added another, and two long names alike to the 60th character replaced each other while the
 * line said the uncut one. `name` in the answer is the name as stored.
 */
export function withSong(blocks: readonly Block[], song: Song): WithSong {
  /* null for a song with no notes in it, which is nothing to put on a page */
  const clean = readSong(song)
  if (!clean) return { ok: false, why: 'empty' }
  const packed = packSong(clean)
  const at = blocks.findIndex((b) => b.block_type === 'song')
  let next: Block[]
  let how: 'added' | 'updated' | 'new block'
  if (at < 0) {
    if (blocks.length >= MAX_BLOCKS) return { ok: false, why: 'too many blocks' }
    const b = freshBlock(blocks, 'song')
    next = [...blocks, { ...b, config: { ...b.config, songs: [packed] } }]
    how = 'new block'
  } else {
    const block = blocks[at]
    const queue = songsFromConfig(block.config).map(packSong)
    const same = queue.findIndex((q) => q.name === packed.name)
    if (same < 0 && queue.length >= MAX_SONGS) return { ok: false, why: 'full' }
    const songs = same >= 0 ? queue.map((q, i) => (i === same ? packed : q)) : [...queue, packed]
    const config: Record<string, unknown> = { ...block.config, songs }
    delete config.song
    next = blocks.map((b, i) => (i === at ? { ...block, config } : b))
    how = same >= 0 ? 'updated' : 'added'
  }
  const changed = next[at < 0 ? next.length - 1 : at]
  if (configSize(changed.config) > CONFIG_LIMIT) return { ok: false, why: 'too big' }
  if (next.reduce((n, b) => n + configSize(b.config), 0) > PROFILE_LIMIT)
    return { ok: false, why: 'page too big' }
  return { ok: true, blocks: next, how, name: packed.name }
}
