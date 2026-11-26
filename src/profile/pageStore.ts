import type { ProfileBlock } from '../sections/ProfileBlocks'
import { openness } from '../components/visibilityLabels'
import { CONFIG_LIMIT, PROFILE_LIMIT, configSize } from './blockSize'
import { MAX_BLOCKS, MAX_SONGS } from './newBlock'

/**
 * What the server says a member's page is — the only things a page writer may believe.
 *
 * ⚠️ PURE, AND IT RESTS ON THREE SERVER CONTRACTS, read from the live definitions on 21 Nov 2026
 * and pinned by the faithful double in src/dev/profileServerDouble.ts. If any of them changes,
 * this file is wrong in the dangerous direction, so they are written down:
 *
 * 1. `get_profile_blocks` gives the OWNER an array in `certain` on every block (`[]` when there are
 *    no names) and everybody else `null`. That is how a read proves it is the owner's.
 * 2. `save_my_profile_blocks` deletes the caller's page, inserts what it was sent with
 *    `position = 1..n`, clamps each tier to the member's ceiling, keeps at most 50 Certain names
 *    per block (btrimmed, lower-cased, distinct, accepted friends only, never yourself), and
 *    RETURNS `[{position, visibility}]` read after the insert — what was stored, not what was
 *    asked for. It takes no lock and no expected state.
 * 3. Type, size and config are stored as sent (`coalesce(config, '{}')`).
 */

type Block = ProfileBlock
type Tier = Block['visibility']

/** the most Certain names a block keeps (the server's own cap) */
export const MAX_NAMES = 50

/**
 * Whose page a `get_profile_blocks` answer is.
 *
 * `'empty'` is not proof of anything: the server answers `[]` for a page with no blocks AND for a
 * name nobody has, so an empty read is proved by asking `get_member_profile` after it (seedGate).
 */
export function ownerOf(data: unknown): 'owner' | 'not-yours' | 'empty' | 'invalid' {
  if (!Array.isArray(data)) return 'invalid'
  if (!data.length) return 'empty'
  for (const b of data)
    if (!b || typeof b !== 'object' || !Array.isArray((b as { certain?: unknown }).certain))
      return 'not-yours'
  return 'owner'
}

/** A value with every object's keys in one order, as a comparison needs and jsonb does not keep. */
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

/** a Certain name as the server keeps it */
const nameKey = (n: string) => n.trim().toLowerCase()

/** what a block's list of names becomes once stored: the first 50, trimmed, lower-cased, distinct */
export function storedNames(names: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const n of (names ?? []).slice(0, MAX_NAMES)) {
    const k = nameKey(String(n))
    if (k && !out.includes(k)) out.push(k)
  }
  return out.sort()
}

/**
 * Whether a page read back is the page expected.
 *
 * - `exact`: the same in every field the server keeps, comparing configs with their keys in one
 *   order (jsonb does not keep yours) and Certain lists by their lower-cased names.
 * - `sent`: as exact, except that each Certain list read back may be SHORTER than the one sent,
 *   because the server drops names that are not accepted friends and cannot be predicted.
 * - `at-most`: as `sent`, and each tier read back may be NARROWER than the one sent, because the
 *   server clamps to the member's ceiling — for a save whose answer never came back.
 */
export function sameStored(
  read: readonly Block[],
  page: readonly Block[],
  mode: 'exact' | 'sent' | 'at-most',
): boolean {
  if (read.length !== page.length) return false
  for (let i = 0; i < read.length; i++) {
    const r = read[i]
    const p = page[i]
    if (r.block_type !== p.block_type || r.size !== p.size) return false
    if (JSON.stringify(sorted(r.config ?? {})) !== JSON.stringify(sorted(p.config ?? {})))
      return false
    if (mode === 'at-most') {
      if (openness(r.visibility) > openness(p.visibility)) return false
    } else if (r.visibility !== p.visibility) return false
    const rn = r.visibility === 'certain' ? storedNames(r.certain) : []
    const pn = p.visibility === 'certain' ? storedNames(p.certain) : []
    if (mode === 'exact') {
      if (rn.join('\n') !== pn.join('\n')) return false
    } else if (!rn.every((n) => pn.includes(n))) return false
  }
  return true
}

/** What a save's own answer says was stored. */
export type Expected =
  | { kind: 'ok'; page: Block[]; lists: 'exact' | 'sent'; narrowed: number[] }
  /** more rows came back than were sent, or positions with gaps: two saves overlapped */
  | { kind: 'collided' }
  /** no answer to read */
  | { kind: 'unacknowledged' }

/**
 * The page the server stored, from what was sent and the save's own answer.
 *
 * ⚠️ NEVER THE SENT COPY ON ITS OWN. A tier may have been clamped and a Certain list cut, and a
 * page believed from what was asked for is wrong the first time either happens — then every later
 * check refuses a save as "changed somewhere else". The answer carries each stored tier, so those
 * are taken from it; a list is predicted where it can be (the first 50, trimmed, lower-cased,
 * distinct) and marked `sent` when it holds names, because which names were friends is unknown.
 */
export function expectStored(sent: readonly Block[], ret: unknown): Expected {
  if (!Array.isArray(ret)) return { kind: 'unacknowledged' }
  if (ret.length !== sent.length) return { kind: 'collided' }
  const byPos = new Map<number, Tier>()
  for (const row of ret) {
    const pos = (row as { position?: unknown })?.position
    const vis = (row as { visibility?: unknown })?.visibility
    if (typeof pos !== 'number' || typeof vis !== 'string' || byPos.has(pos))
      return { kind: 'collided' }
    byPos.set(pos, vis as Tier)
  }
  const narrowed: number[] = []
  let lists: 'exact' | 'sent' = 'exact'
  const page: Block[] = []
  for (let i = 0; i < sent.length; i++) {
    const tier = byPos.get(i + 1)
    if (!tier) return { kind: 'collided' }
    const b = sent[i]
    if (tier !== b.visibility) narrowed.push(i)
    const names = tier === 'certain' ? storedNames(b.certain) : []
    if (names.length) lists = 'sent'
    page.push({
      block_type: b.block_type,
      size: b.size,
      config: b.config ?? {},
      visibility: tier,
      certain: names,
    })
  }
  return { kind: 'ok', page, lists, narrowed }
}

/** Two rows claiming one place on the page: the trace of two saves that overlapped. */
export function duplicatePositions(read: readonly Block[]): boolean {
  const seen = new Set<number>()
  for (const b of read) {
    const pos = (b as { position?: unknown }).position
    if (typeof pos !== 'number') continue
    if (seen.has(pos)) return true
    seen.add(pos)
  }
  return false
}

/**
 * What an answer from the server means for a page writer.
 *
 * - `unreachable`: no answer, or a server that failed (status 0 — the network, or an abort — and
 *   5xx). The request may or may not have happened; a save in this state is "unacknowledged".
 * - `auth`: the session is not one the server will act for.
 * - `refused`: the server answered and said no (it rolled back); sending it again gets the same.
 */
export function classify(r: {
  status?: number
  error: unknown
}): 'ok' | 'unreachable' | 'auth' | 'refused' {
  const s = r.status ?? 0
  if (!r.error && s >= 200 && s < 300) return 'ok'
  if (!r.error && s === 0) return 'ok'
  if (s === 0 || s >= 500) return 'unreachable'
  if (s === 401 || s === 403) return 'auth'
  const msg = String((r.error as { message?: unknown } | null)?.message ?? '')
  if (/not authenticated/i.test(msg)) return 'auth'
  return 'refused'
}

/**
 * "No such function": a server from before the function existed, or after a rollback. Nothing ran,
 * so it is never an answer about the page. PostgREST says PGRST202 when its schema cache has no such
 * function; in the moment after a rollback, while the cache still lists it, Postgres itself answers
 * 42883 (undefined function) through the same 404.
 */
export function missingFunction(r: { status?: number; error: unknown }): boolean {
  const e = r.error as { code?: unknown; message?: unknown } | null
  if (!e) return false
  return e.code === 'PGRST202' || e.code === '42883'
}

/**
 * The save's own refusal: the page is no longer the version this copy was checked against, because
 * something wrote it in between (`save_my_profile_blocks`, PT409 → HTTP 409, "page changed").
 */
export function pageChanged(r: { status?: number; error: unknown }): boolean {
  const e = r.error as { code?: unknown; message?: unknown } | null
  if (!e) return false
  return e.code === 'PT409' || String(e.message ?? '') === 'page changed'
}

/** Why a page cannot be sent, said before the server says it about the whole page. */
export type Preflight =
  | { why: 'block too big'; at: number }
  | { why: 'page too big' }
  | { why: 'too many blocks' }
  | { why: 'too many songs'; at: number }

/**
 * What the server would refuse, checked first so the refusal can name what to fix.
 *
 * ⚠️ THE SERVER REFUSES THE ENTIRE PAGE for any one of these, with a message about nothing in
 * particular, so finding out from it stops every later edit saving.
 */
export function preflight(blocks: readonly Block[]): Preflight | null {
  if (blocks.length > MAX_BLOCKS) return { why: 'too many blocks' }
  for (let i = 0; i < blocks.length; i++) {
    if (configSize(blocks[i].config) > CONFIG_LIMIT) return { why: 'block too big', at: i }
    /* the raw list, not songsFromConfig: that reads only the first 24 of `songs`, so a 25th is
       stored and then silently never played */
    const songs = blocks[i].config?.songs
    if (blocks[i].block_type === 'song' && Array.isArray(songs) && songs.length > MAX_SONGS)
      return { why: 'too many songs', at: i }
  }
  if (blocks.reduce((n, b) => n + configSize(b.config), 0) > PROFILE_LIMIT)
    return { why: 'page too big' }
  return null
}
