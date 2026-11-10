import type { VoiceFx } from './takeFx'
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

/**
 * The longest single recording that may be opened from a file.
 *
 * ⚠️ A MEMORY LIMIT WEARING A CLOCK, and the byte cap above cannot do its job. TAKE_CAP bounds
 * what is STORED; this bounds what has to be DECODED to draw and play it, and the ratio
 * between the two is the bitrate, which is not in the file size. Sixteen megabytes of 128kbps
 * mp3 is about seventeen minutes, and seventeen minutes of stereo Float32 at 48kHz is roughly
 * 390MB of AudioBuffer — enough to take a phone tab down while the file itself sat well inside
 * every limit on this page.
 *
 * Ten minutes is about 115MB decoded in stereo, which a phone survives, and it is far longer
 * than anything this room is for: a take is a voice or a room, not an album.
 */
export const TAKE_MAX_SECONDS = 10 * 60

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
  /**
   * ⚠️ WHAT THE FIRST VERSION OF THE EDITOR STORED, and it is read but never written now. A
   * take trimmed before the edit log existed must not lose its edit, so `readLog` in
   * takeEdit.ts understands this shape and turns it into a one-step history. Left here rather
   * than migrated in place: a rewrite of every row is a write pass over somebody's recordings
   * to save reading one extra field.
   */
  trim?: { from: number; to: number }
  /**
   * Every edit this take has been through, and where in that line we are standing.
   *
   * ⚠️ NUMBERS BESIDE THE AUDIO, NEVER A REWRITTEN BLOB. The recording that came off the
   * microphone is the only copy there will ever be, and `putTake` above already refuses at the
   * cap rather than evicting because "that silently deletes something somebody sang, which is
   * the one thing a recorder must never do". An edit that re-encodes the blob is that same
   * deletion wearing a different hat — so an edit is a view, undo is standing somewhere else
   * in the list, and the bytes are untouchable.
   *
   * ⚠️ PERSISTED, WHICH IS WHY takeEdit BOUNDS IT. The history lives in the row, inside a store
   * with a hard cap on it, so an unbounded one would eventually squeeze out a recording. See
   * HISTORY_MAX.
   *
   * ⚠️ AND IT IS NOT VALIDATED BY `sane` BELOW, deliberately. A log that came back malformed is
   * a reason to ignore the log, never a reason to drop the take — `readLog` takes anything and
   * answers with the whole recording, so every reader is already safe and the row survives.
   */
  log?: { steps: { keep: { from: number; to: number }[] }[]; at: number }
  /**
   * How this recording sounds — Tone, Even, Double, Echo, Echo gap, Space — kept with the
   * recording rather than with its place in the loop.
   *
   * ⚠️ IT USED TO LIVE ONLY ON THE PLACEMENT, which meant two losses nobody chose: a take could
   * not be given a sound until it was in the loop, and taking it out of the loop threw the
   * sound away, so putting it back started flat. Here, it outlives both.
   *
   * ⚠️ NOT VALIDATED BY `sane`, for the reason the log is not: an unreadable sound is a reason
   * to play it plain, never a reason to drop the take. Every reader goes through `readVoiceFx`.
   */
  voice?: Partial<VoiceFx>
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

/**
 * Is this recording in the store — yes, no, or the store could not say.
 *
 * ⚠️ THREE ANSWERS, BECAUSE getTake HAS TWO AND ONE OF THEM MEANS TWO THINGS. `null` from
 * getTake is "there is no such row" and also "the store would not open" — private mode, blocked
 * by settings, a transaction that failed. Something deciding whether a recording is GONE must
 * not read the second as the first: that turns a browser that is having a bad moment into a
 * loop that forgets where somebody's voice went. `count` answers a number when it can look and
 * `run` answers null when it cannot, so the two finally come apart.
 */
export async function hasTake(id: string): Promise<boolean | null> {
  const n = await run<number>('readonly', (s) => s.count(id))
  return n === null ? null : n > 0
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

/**
 * Record where this take's editing has got to.
 *
 * ⚠️ READ-MODIFY-WRITE OF THE WHOLE ROW, because IndexedDB has no partial update — and the row
 * it writes back is the one it just read, blob included. That is the shape CLAUDE.md warns
 * about under "a save that writes every column is a delete for the ones the caller forgot", so
 * it is spelt out: nothing here constructs a row, it spreads the stored one and changes one
 * field. A take that has grown a field this function has never heard of keeps it.
 *
 * ⚠️ AND IT WRITES A PLAIN COPY. IndexedDB structured-clones what it is given, and a log held
 * in React state is shared with the component that is still drawing from it — storing the
 * live object means a later `logUndo` mutating a step would reach into the database. Nothing
 * in takeEdit mutates today; this costs nothing and removes the question.
 */
export async function setTakeLog(id: string, log: TakeRow['log'] | null): Promise<boolean> {
  const had = await getTake(id)
  if (!had) return false
  const row: TakeRow = { ...had }
  if (log)
    row.log = {
      at: log.at,
      steps: log.steps.map((s) => ({ keep: s.keep.map((k) => ({ from: k.from, to: k.to })) })),
    }
  else delete row.log
  const done = await run('readwrite', (s) => s.put(row) as IDBRequest<IDBValidKey>)
  return done !== null
}

/**
 * Keep how this recording sounds, beside it — null to forget it.
 *
 * ⚠️ THE SAME READ-MODIFY-WRITE AS `setTakeLog` AND FOR THE SAME REASON: the stored row is spread
 * and one field changed, so a field this function has never heard of survives it. The caller
 * coalesces — this rewrites the whole row, blob included, and a slider dragged across its range
 * is dozens of changes.
 */
export async function setTakeVoice(id: string, voice: VoiceFx | null): Promise<boolean> {
  const had = await getTake(id)
  if (!had) return false
  const row: TakeRow = { ...had }
  if (voice)
    row.voice = {
      tone: voice.tone,
      squeeze: voice.squeeze,
      double: voice.double,
      echo: voice.echo,
      echoTime: voice.echoTime,
      space: voice.space,
    }
  else delete row.voice
  const done = await run('readwrite', (s) => s.put(row) as IDBRequest<IDBValidKey>)
  return done !== null
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
