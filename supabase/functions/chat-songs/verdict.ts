/**
 * Whether what landed in R2 is the recording that was claimed: the right size, and a recording.
 *
 * ⚠️ IN ITS OWN FILE SO IT CAN BE ASKED A QUESTION, as pictures/verdict.ts is: an edge function
 * needs a deployed runtime, a member's JWT and R2 credentials before any of it runs, so a rule
 * written inline there is a rule nobody checks. `verdict.test.ts` asks this one.
 *
 * ⚠️ THE SIGNED PUT BINDS NEITHER LENGTH NOR TYPE (see pictures/verdict.ts for the measurement),
 * so R2 accepts any object at the key. The size is checked exactly, as pictures are, and a picture
 * can at least be re-encoded by the browser before it goes up while a recording cannot, so the
 * FIRST BYTES are checked as well: without that the bucket would host any file somebody labelled
 * "audio" and sent into a chat.
 */

/** the most a recording sent into a chat may be: 5 MB, as `chat_song_claim` and the table hold */
export const MAX_BYTES = 5_242_880

export type Seen = {
  /** what `chat_song_claim` recorded */
  claimedBytes: number
  mime: string
  /** `content-length` from a HEAD, or null when the object is not there */
  seenBytes: number | null
  /** the object's first bytes, from a ranged GET, or null when they could not be read */
  head: Uint8Array | null
}

export type Verdict = { ok: true } | { ok: false; why: string; drop: boolean }

const startsWith = (b: Uint8Array, at: number, sig: number[]) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x)

/**
 * Whether `head` begins the way a recording of `mime` begins: an MP4 has `ftyp` four bytes in,
 * WebM (Matroska) opens with the EBML magic number, and an Ogg stream with `OggS`.
 */
export function looksLike(mime: string, head: Uint8Array): boolean {
  if (mime === 'audio/mp4') return startsWith(head, 4, [0x66, 0x74, 0x79, 0x70])
  if (mime === 'audio/webm') return startsWith(head, 0, [0x1a, 0x45, 0xdf, 0xa3])
  if (mime === 'audio/ogg') return startsWith(head, 0, [0x4f, 0x67, 0x67, 0x53])
  return false
}

export function verdictFor(s: Seen): Verdict {
  if (s.seenBytes === null) {
    /* not dropped: an upload that failed partway is retried, and dropping it would lose that */
    return { ok: false, why: 'that song never finished going up — try it again', drop: false }
  }
  if (s.seenBytes > MAX_BYTES) {
    return { ok: false, why: 'what arrived is over the 5 MB a song may be', drop: true }
  }
  if (s.seenBytes !== s.claimedBytes) {
    /* no figures: somebody doing this on purpose needs no hint, and nobody else can act on one */
    return { ok: false, why: 'that is not the recording this account was told about', drop: true }
  }
  if (!s.head || !looksLike(s.mime, s.head)) {
    return { ok: false, why: 'that is not a recording', drop: true }
  }
  return { ok: true }
}

/** a `content-length` header as a number of bytes, or null when it is missing or not a count */
export function lengthFrom(header: string | null): number | null {
  if (header === null || header.trim() === '' || !/^\d+$/.test(header.trim())) return null
  return Number(header.trim())
}
