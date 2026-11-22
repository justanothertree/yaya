/**
 * Whether what landed in R2 is the recording that was claimed: the right size, stored as the
 * right kind, and a recording.
 *
 * ⚠️ IN ITS OWN FILE SO IT CAN BE ASKED A QUESTION, as pictures/verdict.ts is: an edge function
 * needs a deployed runtime, a member's JWT and R2 credentials before any of it runs, so a rule
 * written inline there is a rule nobody checks. `verdict.test.ts` asks this one. Deno deploys this
 * file as it is, so it imports nothing from `src/`.
 *
 * ⚠️ THE SIGNED PUT BINDS NEITHER LENGTH NOR TYPE (pictures/verdict.ts has the measurement), so R2
 * accepts any object at the key, labelled however the uploader liked. Three things are checked:
 *
 *   - the size, exactly, as pictures are: a tolerance is a size somebody can hide inside;
 *   - the stored `content-type`, because R2 serves the object with it — a "song" stored as
 *     text/html would be handed to whoever presses ▶ as a page, from a URL signed by this project;
 *   - the first bytes, because a picture can be re-encoded by the browser before it goes up and a
 *     recording cannot. Without them the bucket would host any file somebody labelled "audio".
 */

/** the most a recording sent into a chat may be: 5 MB, as `chat_song_claim` and the table hold */
export const MAX_BYTES = 5_242_880

export type Seen = {
  /** what `chat_song_claim` recorded */
  claimedBytes: number
  mime: string
  /** `content-length` from a HEAD, or null when the object is not there */
  seenBytes: number | null
  /** `content-type` from the same HEAD, as R2 reports it */
  seenType: string | null
  /** the object's first bytes, from a ranged GET, or null when they could not be read */
  head: Uint8Array | null
}

export type Verdict = { ok: true } | { ok: false; why: string; drop: boolean }

/**
 * A content type without its parameters, in lower case: `Audio/WebM; codecs=opus` is
 * `audio/webm`. Null for nothing at all, so a missing header never reads as a kind.
 */
export function bareMime(type: string | null): string | null {
  const bare = (type ?? '').split(';')[0].trim().toLowerCase()
  return bare === '' ? null : bare
}

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

export function verdictFor(s: Seen): Verdict {
  if (s.seenBytes === null) {
    /* ⚠️ NOT DROPPED. A missing object is the ordinary shape of an upload that failed partway,
       and the claim lets the row go after an hour; deleting here would turn a flaky connection
       into lost work on the retry. */
    return { ok: false, why: 'that song never finished going up — try it again', drop: false }
  }
  if (s.seenBytes > MAX_BYTES) {
    return { ok: false, why: 'what arrived is over the 5 MB a song may be', drop: true }
  }
  /* ⚠️ THE SENTENCE NAMES NO FIGURES. Somebody doing this on purpose needs no hint how close they
     got, and somebody who hit it by accident cannot act on the numbers either. */
  if (s.seenBytes !== s.claimedBytes || bareMime(s.seenType) !== s.mime) {
    return { ok: false, why: 'that is not the recording this account was told about', drop: true }
  }
  if (s.head === null) {
    /* not dropped either: the object is there and the right size, and only the read failed */
    return { ok: false, why: 'that song could not be checked — try it again', drop: false }
  }
  if (!looksLike(s.mime, s.head)) {
    return { ok: false, why: 'that is not a recording', drop: true }
  }
  return { ok: true }
}

/**
 * `content-length` as a number of bytes, or null when the store did not say one.
 *
 * ⚠️ A MISSING OR EMPTY HEADER IS NOT A ZERO. `Number(null)` and `Number('')` are both 0, which
 * would read as an empty object that exists — a mismatch, and so a delete of an upload that had
 * merely not arrived. Only plain digits count: `1e3` and `12.5` are not lengths.
 */
export function lengthFrom(headers: { get(name: string): string | null }): number | null {
  const raw = headers.get('content-length')?.trim() ?? ''
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}
