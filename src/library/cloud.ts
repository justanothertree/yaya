import { getSupabaseClient } from '../finance/client'
import { library, saveToLibrary, subscribeLibrary } from '../audio/library'
import { packSong, readSong } from '../audio/songFile'
import { gallery, saveArt, subscribeGallery } from '../draw/gallery'
import { packDrawing, readDrawing } from '../draw/strokes'
import { readPresets, savePreset, subscribePresets } from '../audio/vizPresets'
import { packPet, pets, readPet, savePet, subscribePets } from '../pets/pets'
import { mergeWins, packWins, subscribeWins } from '../park/records'

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
 *
 * ⚠️ AND SOME KINDS MERGE, WHICH IS THE SECOND CONTRACT THIS FILE HOLDS. Add-only answers "who
 * wins?" with "whoever got here first", which is right for a song or a drawing — you either have
 * it or you do not, and two copies of the same name are the same thing. It is wrong for a park
 * record, where both copies are real and the one on the other machine might be the QUICKER one.
 * Skipping it would drop somebody's best time without a word, which is why records stayed out of
 * here when they were written. So a kind is now one of two things, and MERGED says which:
 *
 *   add-only  song, loop, art, look, pet   having it at all is the whole question
 *   merged    wins                          both copies are real; the answer is built from both
 *
 * A merged kind is never skipped on the way in, and is pushed back out whenever the merge left
 * this machine holding something the server does not have. The rule for who wins is not here —
 * it belongs to the thing being merged, and lives in park/records.ts beside the rule a restored
 * backup file already followed.
 */

type Kind = 'song' | 'loop' | 'art' | 'look' | 'pet' | 'wins'
type Row = { kind: Kind; name: string; body: unknown }

const KINDS: Kind[] = ['song', 'loop', 'art', 'look', 'pet', 'wins']
const isKind = (v: unknown): v is Kind => typeof v === 'string' && (KINDS as string[]).includes(v)

/** Kinds where two copies can both be real, so neither side may simply skip the other. */
const MERGED: Kind[] = ['wins']
const merges = (k: Kind) => MERGED.includes(k)

/**
 * ⚠️ ONE SLOT FOR ALL OF THEM. The park's records are one document, not one row each — 200
 * records at ~90 bytes would otherwise spend half of a person's 400-item library on 18KB. Named
 * for the arena so a second one later needs no change here or on the server.
 */
const WINS_SLOT = 'park'

/** Everything kept on this machine, in the shape the server stores. */
function localRows(): Row[] {
  const out: Row[] = []
  for (const i of library()) out.push({ kind: i.kind, name: i.name, body: packSong(i.song) })
  for (const a of gallery()) out.push({ kind: 'art', name: a.name, body: packDrawing(a.art) })
  for (const p of readPresets()) out.push({ kind: 'look', name: p.name, body: p.s })
  /* ⚠️ A pet is a drawing with a name, so it costs the library one more kind and no new
     anything — see pets.ts. The name is the slot, which is also why savePet refuses duplicates. */
  for (const p of pets()) out.push({ kind: 'pet', name: p.name, body: packPet(p) })
  /* ⚠️ Only when there are any. An empty list is not a document worth a row, and emitting one
     would have watchLibrary push an empty array over a server copy that had records in it. */
  const won = packWins()
  if (won.length) out.push({ kind: 'wins', name: WINS_SLOT, body: won })
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
  /* ⚠️ Merged rather than adopted: what is here already is half the answer, not a reason to
     stop. mergeWins reports whether this machine actually changed, so a sync that found the
     two already level counts nothing rather than claiming a pull. */
  if (r.kind === 'wins') return mergeWins(r.body) > 0
  if (r.kind === 'art') {
    const d = readDrawing(r.body)
    return d ? !!saveArt(d) : false
  }
  if (r.kind === 'pet') {
    const p = readPet(r.body)
    return p ? !!savePet(p.name, p.art) : false
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
    /* ⚠️ A merged kind is never skipped for being present. "I already have one" is the whole
       test for a song and is no answer at all for a record — theirs may be the quicker time. */
    if (!merges(r.kind) && here.has(slot(r.kind, r.name))) continue
    if (adoptLocally(r)) out.pulled++
    else if (!merges(r.kind)) out.failed++
    /* a merged kind that changed nothing is neither a pull nor a failure — it was already level */
  }

  /* ⚠️ READ AGAIN, AFTER THE MERGE. localRows() was snapshotted above to answer "what is here";
     the pull has since rewritten the merged kinds, and pushing the pre-merge copy would send
     back exactly the version we just improved on. */
  const theirs = new Map(remote.map((r) => [slot(r.kind, r.name), r]))
  for (const r of localRows()) {
    const had = theirs.get(slot(r.kind, r.name))
    if (had) {
      if (!merges(r.kind)) continue
      /* the merge has run, so ours is theirs-or-better; only send it if it is actually better */
      if (JSON.stringify(had.body) === JSON.stringify(r.body)) continue
    }
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

  /* ⚠️ The park too, or a record set in this session would sit here until the next sign-in.
     A win only ever improves the document, so the push half is all that ever fires for it —
     the drop half needs the slot to disappear, which takes deleting every record you have. */
  const offs = [
    subscribeLibrary(settle),
    subscribeGallery(settle),
    subscribePresets(settle),
    subscribePets(settle),
    subscribeWins(settle),
  ]
  return () => offs.forEach((off) => off())
}
