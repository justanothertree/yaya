/**
 * What an upload to `chat-songs` is allowed to be: how much of it is read, what its headers say,
 * and whether the bytes in hand are a recording this keeps.
 *
 * ⚠️ IN ITS OWN FILE SO IT CAN BE ASKED A QUESTION, as pictures/verdict.ts is: an edge function
 * needs a deployed runtime, a member's JWT and R2 credentials before any of it runs, so a rule
 * written inline there is a rule nobody checks. `verdict.test.ts` asks this one. Deno deploys this
 * file as it is, so it imports nothing from `src/`.
 *
 * ⚠️ THE CHECK IS MADE ON BYTES THE FUNCTION IS HOLDING, BEFORE ANYTHING IS STORED. The first
 * version signed a PUT for the browser and measured the object afterwards. A signed PUT stays good
 * until it expires, whatever the measurement said, so a sender could put any file at the key once
 * it had passed — and a PUT nobody finished left an object no row was ever completed for. Now the
 * recording comes to the function, and the function writes it to R2 only if this says yes:
 *
 *   - the size: something, and no more than 5 MB;
 *   - the kind: exactly one of the three bare types, because it becomes the stored `content-type`
 *     R2 serves to whoever presses ▶ — a "song" stored as text/html would be handed over as a
 *     page, from a URL this project signed;
 *   - the first bytes, because a picture can be re-encoded by the browser before it goes up and a
 *     recording cannot. Without them the bucket would host any file somebody labelled "audio".
 */

/** the most a recording sent into a chat may be: 5 MB, as `chat_song_claim` and the table hold */
export const MAX_BYTES = 5_242_880

/** the kinds `chat_song_claim` keeps, and the table's CHECK, word for word */
export const KINDS = ['audio/mp4', 'audio/webm', 'audio/ogg'] as const
export type Kind = (typeof KINDS)[number]

export type Verdict = { ok: true; mime: Kind } | { ok: false; why: string }

const startsWith = (b: Uint8Array, at: number, sig: number[]) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x)

/**
 * Whether `head` begins the way a recording of `mime` begins: an MP4 has `ftyp` four bytes in
 * (the first four are the box's length), WebM opens with the EBML magic number, and an Ogg
 * stream with `OggS`. Anything else is not a kind this keeps.
 */
export function looksLike(mime: string, head: Uint8Array): boolean {
  if (mime === 'audio/mp4') return startsWith(head, 4, [0x66, 0x74, 0x79, 0x70])
  if (mime === 'audio/webm') return startsWith(head, 0, [0x1a, 0x45, 0xdf, 0xa3])
  if (mime === 'audio/ogg') return startsWith(head, 0, [0x4f, 0x67, 0x67, 0x53])
  return false
}

const isKind = (mime: string | null): mime is Kind =>
  mime !== null && (KINDS as readonly string[]).includes(mime)

/**
 * Whether `bytes`, sent as `mime`, may be stored.
 *
 * ⚠️ THE KIND MUST ALREADY BE BARE, AND IS NEVER BARED HERE. It is the claim's `mime` and the
 * object's `content-type` both, so `audio/webm;codecs=opus` or `Audio/WebM` would either be stored
 * as something the row does not say or be quietly rewritten into something the sender did not
 * send. The claim refuses those same strings in the same words.
 *
 * The size and kind refusals are `chat_song_claim`'s own sentences, so the two checks say one
 * thing however a request reaches them; the size names no figure beyond the ceiling everybody is
 * told about.
 */
export function verdictFor(mime: string | null, bytes: Uint8Array): Verdict {
  if (bytes.length === 0) return { ok: false, why: 'that recording came to nothing' }
  if (bytes.length > MAX_BYTES) return { ok: false, why: 'that one is over 5 MB' }
  if (!isKind(mime)) return { ok: false, why: 'that is not a kind of recording this keeps' }
  if (!looksLike(mime, bytes)) return { ok: false, why: 'that is not a recording' }
  return { ok: true, mime }
}

/**
 * A request body, read to at most `max` bytes: the bytes, or `over` as soon as more than that has
 * arrived.
 *
 * ⚠️ READ AS A STREAM AND STOPPED, NEVER `arrayBuffer()`. That would hold whatever was sent before
 * any size could be asked, so the 5 MB ceiling would be checked on a body already sitting in the
 * function's memory at whatever size somebody chose. Here the reading stops at the chunk that
 * passes `max`, the rest is cancelled unread, and that chunk is dropped rather than kept — so no
 * more than `max` bytes are ever held. A `Content-Length` is not consulted: it is the sender's
 * word, and a chunked body has none.
 */
export async function readAtMost(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer> } | { over: true }> {
  if (!body) return { bytes: new Uint8Array(0) }
  const reader = body.getReader()
  const parts: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value || value.length === 0) continue
    n += value.length
    if (n > max) {
      await reader.cancel().catch(() => {})
      return { over: true }
    }
    parts.push(value)
  }
  const bytes = new Uint8Array(n)
  let at = 0
  for (const p of parts) {
    bytes.set(p, at)
    at += p.length
  }
  return { bytes }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** what an upload says about itself; each part null when it is missing or cannot be read */
export type Upload = {
  room: string | null
  mime: string | null
  seconds: number | null
  name: string | null
}

/**
 * An upload's `x-song-*` headers, read. The body is the recording itself, so everything else about
 * it travels in headers.
 *
 * ⚠️ NOTHING IS REFUSED HERE. A part that cannot be read becomes null, and `chat_song_claim` then
 * refuses it in the words it uses for everybody — "not in this room", "has no length", "needs a
 * name" — rather than this file inventing a second set. What this does decide is that a malformed
 * part never reaches PostgREST as itself: a room that is not a uuid would come back as Postgres'
 * own "invalid input syntax for type uuid", which is no sentence for a person.
 *
 * ⚠️ THE LENGTH IS PLAIN DIGITS OR NOTHING, the lesson `lengthFrom` in pictures/verdict.ts was
 * written for: `Number('')` is 0, `Number('1e3')` is 1000 and `Number('12.5')` is a fraction the
 * contract does not send. The name is percent-encoded, because a header cannot carry most of what
 * a song can be called; one that does not decode is no name.
 */
export function uploadFrom(headers: { get(name: string): string | null }): Upload {
  const room = headers.get('x-song-room') ?? ''
  const mime = headers.get('x-song-mime') ?? ''
  const secs = headers.get('x-song-seconds') ?? ''
  let name: string | null
  try {
    name = decodeURIComponent(headers.get('x-song-name') ?? '')
  } catch {
    name = null
  }
  const n = /^\d+$/.test(secs) ? Number(secs) : NaN
  return {
    room: UUID.test(room) ? room : null,
    mime: mime === '' ? null : mime,
    seconds: Number.isFinite(n) ? n : null,
    name,
  }
}

/** an id the database could have made, or null: an op's `id` is checked before Postgres sees it */
export const songId = (x: unknown): string | null =>
  typeof x === 'string' && UUID.test(x) ? x : null
