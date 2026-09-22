/**
 * Where a recorded take's audio actually lives.
 *
 * ⚠️ THE LOOPER STORES NOTES AND THAT DECISION STANDS. Its header says why, and all four
 * reasons are still true: a note layer is a few hundred bytes, plays on any instrument, survives
 * a tempo change without pitch-shifting, and is cheap enough to send to a friend. Nothing here
 * changes that, and a note layer remains what you get unless you deliberately record a sound.
 *
 * ⚠️ A VOICE HAS NO NOTES, which is the one case that argument cannot cover. You cannot store
 * singing as "midi 60 down at 1.42s" — there is no midi 60, there are words. So a take pays all
 * four of those costs on purpose, and only where there is no alternative: it is big, it is tied
 * to the sound it was recorded with, it does not follow a tempo change, and it cannot ride in a
 * song's JSON. Everything that CAN be notes still is.
 *
 * ⚠️ WHICH IS WHY THE AUDIO IS NOT IN THE SONG. A song is JSON in localStorage, validated
 * through readSong on the way in and on the way out, and localStorage is a handful of megabytes
 * of string. One minute of compressed audio is about 350KB and a minute of raw is thirty times
 * that — so the song keeps a name and an id, and the bytes live here, in IndexedDB, keyed by
 * that id. The consequence is real and worth saying out loud: a song exported without its takes
 * is a song whose takes are silent.
 *
 * ⚠️ COMPRESSED, NOT RAW. MediaRecorder hands back webm/opus at about 48kbps, which is roughly
 * 350KB a minute; the same minute as Float32 PCM is 11MB. Storing what the recorder already
 * produced costs nothing and is thirty times smaller, and the decode back to an AudioBuffer is
 * one call the browser was going to make anyway.
 */

const DB = 'yaya_takes'
const STORE = 'takes'
const VERSION = 1

/**
 * How much recorded audio one browser may hold.
 *
 * ⚠️ A CEILING RATHER THAN A QUOTA, and it is deliberately well under what the browser would
 * allow. IndexedDB will happily take hundreds of megabytes and then evict the lot under storage
 * pressure with no warning — so the useful limit is the one where a person still knows what they
 * have. At roughly 350KB a minute this is about three quarters of an hour of singing.
 */
export const TAKE_CAP = 16 * 1024 * 1024

/** What is kept beside the bytes, so the store can be listed without decoding anything. */
export type TakeRow = {
  id: string
  /** ms since epoch */
  at: number
  /** seconds of audio */
  len: number
  bytes: number
  type: string
  blob: Blob
}

let open: Promise<IDBDatabase | null> | null = null

/**
 * ⚠️ NEVER THROWS, AND THAT IS NOT LAZINESS. IndexedDB is unavailable in a private window in
 * some browsers, can be blocked by the person's settings, and fails outright when the origin's
 * storage is full. Every one of those is a normal state for a toy on a phone, and the right
 * behaviour in all of them is that the instrument still works and the takes are simply not
 * there — the same bargain every localStorage read in this project already makes.
 */
function db(): Promise<IDBDatabase | null> {
  if (open) return open
  open = new Promise((done) => {
    try {
      if (typeof indexedDB === 'undefined') return done(null)
      const req = indexedDB.open(DB, VERSION)
      req.onupgradeneeded = () => {
        const d = req.result
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => done(req.result)
      req.onerror = () => done(null)
      req.onblocked = () => done(null)
    } catch {
      done(null)
    }
  })
  return open
}

function run<T>(
  mode: IDBTransactionMode,
  go: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return db().then(
    (d) =>
      new Promise<T | null>((done) => {
        if (!d) return done(null)
        try {
          const tx = d.transaction(STORE, mode)
          const req = go(tx.objectStore(STORE))
          req.onsuccess = () => done(req.result)
          req.onerror = () => done(null)
          tx.onabort = () => done(null)
          tx.onerror = () => done(null)
        } catch {
          done(null)
        }
      }),
  )
}

/** Everything held, newest first. The blobs come with it; they are references, not copies. */
export async function allTakes(): Promise<TakeRow[]> {
  const rows = await run<TakeRow[]>('readonly', (s) => s.getAll() as IDBRequest<TakeRow[]>)
  if (!rows) return []
  return rows.filter(sane).sort((a, b) => b.at - a.at)
}

/**
 * ⚠️ VALIDATED ON THE WAY OUT, exactly as a song is. IndexedDB is writable by anything on this
 * origin, so what a trusted path wrote is not necessarily what comes back — see the same note
 * on the library. A row that does not look like a take is skipped rather than repaired.
 */
const sane = (r: unknown): r is TakeRow => {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.at === 'number' &&
    typeof o.len === 'number' &&
    o.len >= 0 &&
    typeof o.bytes === 'number' &&
    o.blob instanceof Blob
  )
}

export async function getTake(id: string): Promise<TakeRow | null> {
  const row = await run<TakeRow>('readonly', (s) => s.get(id) as IDBRequest<TakeRow>)
  return row && sane(row) ? row : null
}

/** How many bytes of audio are held in total. */
export async function takenBytes(): Promise<number> {
  return (await allTakes()).reduce((n, r) => n + r.bytes, 0)
}

export type PutResult = { ok: true; row: TakeRow } | { ok: false; why: 'full' | 'blocked' }

/**
 * Keep a recording.
 *
 * ⚠️ IT REFUSES RATHER THAN EVICTS. The obvious thing when the cap is reached is to drop the
 * oldest take and carry on — and that silently deletes something somebody sang, which is the
 * one thing a recorder must never do. Refusing is rude and recoverable; evicting is polite and
 * not.
 */
export async function putTake(id: string, blob: Blob, len: number): Promise<PutResult> {
  const held = await takenBytes()
  const had = await getTake(id)
  /* replacing a take only costs the difference, so re-recording at the cap still works */
  if (held - (had?.bytes ?? 0) + blob.size > TAKE_CAP) return { ok: false, why: 'full' }
  const row: TakeRow = {
    id,
    at: Date.now(),
    len,
    bytes: blob.size,
    type: blob.type || 'audio/webm',
    blob,
  }
  const done = await run('readwrite', (s) => s.put(row) as IDBRequest<IDBValidKey>)
  return done === null ? { ok: false, why: 'blocked' } : { ok: true, row }
}

export async function dropTake(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>)
}

/**
 * Throw away audio no song refers to any more.
 *
 * ⚠️ BECAUSE DELETING A SONG CANNOT REACH IN HERE. The song is JSON in localStorage and the
 * audio is in a different store under a different lifetime — so removing a song leaves its
 * takes behind, and after a few months of making things the cap is full of recordings belonging
 * to nothing. Sweeping is how the two stay honest, and it runs from the library rather than
 * from here because the library is the only thing that knows what is still referred to.
 *
 * ⚠️ IT TAKES THE IDS THAT ARE STILL WANTED, not the ones to delete. Asking for the survivors
 * means a caller that forgets a song deletes nothing; asking for the condemned means a caller
 * that forgets a song deletes somebody's singing. Only one of those is safe to get wrong.
 */
export async function sweepTakes(keep: Iterable<string>): Promise<number> {
  const wanted = new Set(keep)
  const rows = await allTakes()
  let gone = 0
  for (const r of rows) {
    if (wanted.has(r.id)) continue
    await dropTake(r.id)
    gone++
  }
  return gone
}
