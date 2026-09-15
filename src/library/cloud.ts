import { getSupabaseClient } from '../finance/client'
import { library, saveToLibrary, subscribeLibrary } from '../audio/library'
import { packSong, readSong } from '../audio/songFile'
import { gallery, saveArt, subscribeGallery } from '../draw/gallery'
import { packDrawing, readDrawing } from '../draw/strokes'
import { readPresets, savePreset, subscribePresets } from '../audio/vizPresets'

/**
 * The library, on your account instead of in one browser.
 *
 * ⚠️ THIS IS THE FIX THE BACKUP BUTTON WAS A STOPGAP FOR. Songs, drawings and saved looks were
 * localStorage and only localStorage, which is documented in each of those files as a deliberate
 * first step — and it was, until the bill came due twice in a week: songs made weeks earlier gone
 * with no browser change and nothing cleared, because browsers evict site data from sites you have
 * not visited lately; and a song made in Firefox impossible to edit from Chrome, because the
 * library is not there.
 *
 * ⚠️ LOCAL STAYS THE SOURCE THE APP READS. Every room still reads localStorage synchronously and
 * knows nothing about this file — which is what keeps the instrument and paint rooms working
 * offline, working while signed out, and working exactly as fast as they did. The server is a
 * copy that is kept level, not a thing the UI waits for.
 *
 * ⚠️ SYNC NEVER DELETES. Merging is add-only in both directions, keyed by name. "Missing on this
 * machine" is ambiguous — it means both "I deleted it" and "I have never seen it" — and without
 * tombstones to tell those apart, a tidy-looking two-way delete would quietly eat work the first
 * time somebody signed in on a fresh browser. Deletions travel only as they happen, while the app
 * is open and watching.
 */

type Kind = 'song' | 'loop' | 'art' | 'look'
type Row = { kind: Kind; name: string; body: unknown }

const KINDS: Kind[] = ['song', 'loop', 'art', 'look']
const isKind = (v: unknown): v is Kind => typeof v === 'string' && (KINDS as string[]).includes(v)

/** Everything kept on this machine, in the shape the server stores. */
function localRows(): Row[] {
  const out: Row[] = []
  for (const i of library()) out.push({ kind: i.kind, name: i.name, body: packSong(i.song) })
  for (const a of gallery()) out.push({ kind: 'art', name: a.name, body: packDrawing(a.art) })
  for (const p of readPresets()) out.push({ kind: 'look', name: p.name, body: p.s })
  return out
}

const slot = (kind: string, name: string) => `${kind}:${name.trim().toLowerCase()}`

/**
 * Put a server row into the local store it belongs to.
 *
 * ⚠️ Through the same savers the rooms use, which re-validate. A row off the network is exactly
 * as trustworthy as a file off a disk: readSong and readDrawing are the security boundary and
 * this does not go around them.
 */
function adoptLocally(r: Row): boolean {
  if (r.kind === 'art') {
    const d = readDrawing(r.body)
    return d ? !!saveArt(d) : false
  }
  if (r.kind === 'look') {
    if (!r.body || typeof r.body !== 'object') return false
    savePreset(r.name, r.body as Record<string, unknown>)
    return true
  }
  const s = readSong(r.body)
  return s ? !!saveToLibrary(r.kind, s) : false
}

async function put(r: Row) {
  const { error } = await getSupabaseClient().rpc('library_put', {
    p_kind: r.kind,
    p_name: r.name,
    p_body: r.body,
  })
  /* ⚠️ A refusal is not a crash. The server caps size and count, and the honest outcome of
     hitting one is that this item stays local — which is exactly where it was a moment ago. */
  return !error
}

export type SyncResult = { pulled: number; pushed: number; failed: number }

/**
 * Bring the two level, once.
 *
 * ⚠️ PULL BEFORE PUSH, so a fresh browser fills up before it offers anything — otherwise the
 * first sign-in on a new machine pushes an empty library's worth of nothing and then pulls, which
 * is the same result by a longer road but looks alarming in the logs.
 */
export async function syncLibrary(): Promise<SyncResult | null> {
  const { data, error } = await getSupabaseClient().rpc('library_list')
  if (error) return null

  const remote: Row[] = (Array.isArray(data) ? data : [])
    .map((v) => v as { kind?: unknown; name?: unknown; body?: unknown })
    .filter((v): v is Row => isKind(v.kind) && typeof v.name === 'string' && !!v.body)

  const out: SyncResult = { pulled: 0, pushed: 0, failed: 0 }

  const here = new Set(localRows().map((r) => slot(r.kind, r.name)))
  for (const r of remote) {
    if (here.has(slot(r.kind, r.name))) continue
    if (adoptLocally(r)) out.pulled++
    else out.failed++
  }

  const there = new Set(remote.map((r) => slot(r.kind, r.name)))
  for (const r of localRows()) {
    if (there.has(slot(r.kind, r.name))) continue
    if (await put(r)) out.pushed++
    else out.failed++
  }
  return out
}

/**
 * Keep it level from here on.
 *
 * ⚠️ WATCHES THE STORES RATHER THAN WRAPPING THE SAVERS. saveToLibrary and saveArt are pure
 * storage and it matters that they stay that way — a network call inside them would make keeping
 * a take something that can fail, and "Keep" is a button that must not be able to. Subscribing
 * means a save is still a save, and the copy follows a moment later.
 *
 * ⚠️ A DELETE TRAVELS, because while this is running the difference between "gone from here" and
 * "never here" is known: it was in the previous snapshot. That is the same fact sync cannot
 * establish on a cold start, which is why sync never deletes and this does.
 */
export function watchLibrary(): () => void {
  let last = new Map(localRows().map((r) => [slot(r.kind, r.name), r]))
  let busy = false

  const settle = () => {
    if (busy) return
    busy = true
    void (async () => {
      try {
        const now = new Map(localRows().map((r) => [slot(r.kind, r.name), r]))
        for (const [k, r] of now) {
          const was = last.get(k)
          if (!was || JSON.stringify(was.body) !== JSON.stringify(r.body)) await put(r)
        }
        for (const [k, r] of last) {
          if (now.has(k)) continue
          await getSupabaseClient().rpc('library_drop', { p_kind: r.kind, p_name: r.name })
        }
        last = now
      } finally {
        busy = false
      }
    })()
  }

  const offs = [subscribeLibrary(settle), subscribeGallery(settle), subscribePresets(settle)]
  return () => offs.forEach((off) => off())
}
