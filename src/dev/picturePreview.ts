import type { Kept, Squeezed } from '../pictures/cloud'

/**
 * A stand-in for the picture store, so the room can be opened without R2.
 *
 * ⚠️ IT STANDS IN FOR THE STORAGE AND NOTHING ELSE. Squeezing is real here — `squeeze` in
 * pictures/cloud.ts is browser code that works perfectly well in the workbench, and the quality
 * dial is the thing most worth driving by hand. What cannot happen without a bucket is the PUT,
 * so that is the only part replaced: a blob becomes an object URL instead of an object key.
 *
 * ⚠️ THE CEILINGS ARE THE SERVER'S, IN THE SERVER'S OWN WORDS. CLAUDE.md records the opposite
 * twice — `pvStart` letting an archived activity start, `pvSaveActivity` letting a duplicate name
 * through — and the direction that hides a bug is a double more permissive than the thing it
 * doubles. If `picture_claim` would refuse it, this refuses it, with the same sentence.
 *
 * ⚠️ AND THE STORE IS BUILT BEHIND A FUNCTION. A statement-level `let s = seed()` is a side
 * effect rollup cannot prove pure, which is how 2.78 kB of invented fixture once shipped to real
 * users on a module whose header said it tree-shook out.
 */

const ACCOUNT_PICTURES = 500
const ACCOUNT_PICTURE_BYTES = 52_428_800

type PvPic = Kept & { _blob?: Blob; _thumbBlob?: Blob }

/**
 * ⚠️ SVG DATA URLS RATHER THAN DRAWN CANVASES, because a seed has to be synchronous and
 * `toBlob` is not. They are also honest about what they are: nobody will mistake these for
 * photographs, which is what a fixture should be.
 */
const drawn = (w: number, h: number, a: string, b: string, label: string): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <text x="50%" y="50%" fill="rgba(255,255,255,.85)" font-family="system-ui" font-size="${Math.round(Math.min(w, h) / 8)}"
      text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

const made = (
  id: string,
  w: number,
  h: number,
  a: string,
  b: string,
  label: string,
  alt: string | null,
  bytes: number,
  daysAgo: number,
): PvPic => ({
  id,
  w,
  h,
  alt,
  bytes,
  created_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  url: drawn(w, h, a, b, label),
  thumbUrl: drawn(
    Math.round((w / Math.max(w, h)) * 320),
    Math.round((h / Math.max(w, h)) * 320),
    a,
    b,
    label,
  ),
})

const seed = (): PvPic[] => [
  made(
    'pv-pic1',
    1600,
    1200,
    '#2f6fed',
    '#7b3fe4',
    'one',
    'the kitchen table, mid-afternoon',
    184_000,
    0,
  ),
  made('pv-pic2', 1200, 1600, '#1f9d55', '#0b7285', 'two', null, 221_000, 2),
  /**
   * ⚠️ A PANORAMA ON PURPOSE. A grid of near-squares tells you nothing about a grid; the shape
   * that breaks a layout is the one nothing in a tidy fixture has. `fitWithin` has its own test
   * for the arithmetic — this is for the eye.
   */
  made(
    'pv-pic3',
    1600,
    300,
    '#d9480f',
    '#f59f00',
    'three',
    'the whole street from the bridge',
    97_000,
    5,
  ),
  /* and one with a long description, because alt text is drawn and can overflow a tile */
  made(
    'pv-pic4',
    900,
    900,
    '#6741d9',
    '#c2255c',
    'four',
    'a very long description of a picture, written by somebody who wanted to be thorough about it',
    402_000,
    9,
  ),
]

let store: PvPic[] | null = null
const db = (): PvPic[] => (store ??= seed())

export const pvPictures = (): Kept[] => db().map((p) => ({ ...p }))

export const pvKeep = (
  full: Squeezed,
  thumb: Squeezed,
  alt: string,
): { id: string } | { why: string } => {
  const all = db()
  /* the server's two ceilings, counted the way picture_claim counts them — with the thumbnail,
     because a thumbnail is real storage */
  if (all.length >= ACCOUNT_PICTURES) return { why: 'that is 500 pictures — delete one first' }
  const used = all.reduce((n, p) => n + p.bytes, 0)
  if (used + full.blob.size + thumb.blob.size > ACCOUNT_PICTURE_BYTES) {
    return { why: 'your pictures come to 50 MB — delete one first' }
  }
  /* and the per-row ones, which on the live site are a CHECK with a sentence in front of it */
  if (full.blob.size > 2_097_152) {
    return { why: 'that one is over 2 MB even squeezed — try a lower quality' }
  }
  if (thumb.blob.size > 262_144) return { why: 'that one would not make a thumbnail' }

  const id = `pv-pic-new-${all.length + 1}`
  all.unshift({
    id,
    w: full.w,
    h: full.h,
    alt: alt.trim() || null,
    bytes: full.blob.size + thumb.blob.size,
    created_at: new Date().toISOString(),
    url: URL.createObjectURL(full.blob),
    thumbUrl: URL.createObjectURL(thumb.blob),
    _blob: full.blob,
    _thumbBlob: thumb.blob,
  })
  return { id }
}

export const pvDrop = (id: string): { why: string } | null => {
  const all = db()
  const at = all.findIndex((p) => p.id === id)
  if (at < 0) return { why: 'no such picture' }
  const [gone] = all.splice(at, 1)
  /* ⚠️ the object URLs are revoked, which the real path does not have to do — a blob held by a
     revoked URL is the one way this harness could leak memory across a long session */
  if (gone._blob) URL.revokeObjectURL(gone.url)
  if (gone._thumbBlob) URL.revokeObjectURL(gone.thumbUrl)
  return null
}

export const pvDescribe = (id: string, alt: string): { why: string } | null => {
  const p = db().find((x) => x.id === id)
  if (!p) return { why: 'no such picture' }
  p.alt = alt.trim() || null
  return null
}

/**
 * ⚠️ THE SAME ARITHMETIC THE SERVER DOES, which is deliberately not what the list adds up to:
 * every row rather than the ready ones, and thumbnails counted alongside the pictures. The
 * harness keeps no unready claims, so the two agree here — but the double has to do the same
 * SUM, or the room reads one number in the workbench and another on the live site.
 */
export const pvUsed = (): { count: number; ready: number; bytes: number } => {
  const all = db()
  return { count: all.length, ready: all.length, bytes: all.reduce((n, p) => n + p.bytes, 0) }
}
