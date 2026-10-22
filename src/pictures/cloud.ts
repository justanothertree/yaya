import { getSupabaseClient } from '../finance/client'
import { FULL_BYTES, FULL_EDGE, THUMB_BYTES, THUMB_EDGE, fitWithin, nextQuality } from './shrink'

/**
 * Keeping a picture: squeeze it here, ask Postgres, put the bytes in R2.
 *
 * ⚠️ THREE HOPS, AND THE MIDDLE ONE IS THE ONLY ONE THAT DECIDES ANYTHING. The `pictures` edge
 * function calls `picture_claim` as the signed-in person, so every ceiling and refusal lives in
 * Postgres where the rest of this project's rules live; it then hands back two presigned URLs and
 * the browser PUTs straight to R2. Nothing but small JSON crosses Supabase, which is the point —
 * its egress meter is shared with the database, realtime and sign-in, and going over restricts
 * the whole project rather than billing it.
 *
 * ⚠️ AND `ready` IS A SEPARATE CALL ON PURPOSE. A row exists from the moment a key is reserved, so
 * a PUT that never lands leaves a claim rather than a picture — `picture_claim` sweeps its own
 * stale ones after an hour. Marking ready only after both bytes are up is what keeps a gallery
 * from drawing a hole.
 */

export type Kept = {
  id: string
  w: number
  h: number
  alt: string | null
  bytes: number
  created_at: string
  url: string
  thumbUrl: string
}

/** what a squeeze came to, for the dial to show */
export type Squeezed = { blob: Blob; w: number; h: number; quality: number }

const MIME = 'image/webp'

/**
 * Draw a picture at a size and encode it, walking the quality down until it fits.
 *
 * ⚠️ IT RETURNS THE BLOB EVEN WHEN IT DID NOT FIT, because the caller is better placed to say so:
 * "that one will not go below 2 MB" is a sentence about a picture, and this function only knows
 * about bytes. `nextQuality` stopping does not mean success — see `keepPicture`, which checks.
 *
 * ⚠️ `createImageBitmap` RATHER THAN AN `Image`, because it decodes off the main thread and does
 * not need the picture attached to the document to have a size. On a 12-megapixel photo that is
 * the difference between a visible freeze and none.
 */
export async function squeeze(
  file: Blob,
  edge: number,
  budget: number,
  startQuality: number,
): Promise<Squeezed | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  const size = fitWithin(bitmap.width, bitmap.height, edge)
  if (!(size.w > 0 && size.h > 0)) {
    bitmap.close()
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = size.w
  canvas.height = size.h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return null
  }
  ctx.drawImage(bitmap, 0, 0, size.w, size.h)
  bitmap.close()

  let q = startQuality
  for (;;) {
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, MIME, q))
    if (!blob) return null
    const next = nextQuality(blob.size, budget, q)
    if (next === null) return { blob, w: size.w, h: size.h, quality: q }
    q = next
  }
}

/** Both sizes of one picture, which is what an upload actually is. */
export async function prepare(
  file: Blob,
  quality: number,
): Promise<{ full: Squeezed; thumb: Squeezed } | { why: string }> {
  const full = await squeeze(file, FULL_EDGE, FULL_BYTES, quality)
  if (!full) return { why: 'that file did not look like a picture' }
  if (full.blob.size > FULL_BYTES) {
    return { why: 'that one will not squeeze under 2 MB — try a lower quality' }
  }
  /* ⚠️ THE THUMBNAIL IS MADE FROM THE ORIGINAL, not from the squeezed copy. Encoding an encode
     stacks WebP's artefacts on top of themselves, and a 320px thumbnail is where that shows
     first — it is the picture most people see most often. */
  const thumb = await squeeze(file, THUMB_EDGE, THUMB_BYTES, 0.75)
  if (!thumb) return { why: 'that file did not look like a picture' }
  if (thumb.blob.size > THUMB_BYTES) return { why: 'that one will not make a thumbnail' }
  return { full, thumb }
}

type Minted = { id: string; put: string; putThumb: string }

/**
 * The whole flow, for a picture already squeezed.
 *
 * ⚠️ A FAILED PUT LEAVES NO ROW WORTH HAVING, so it is not marked ready and the sweep in
 * `picture_claim` takes it an hour later. Reporting the failure is what matters; tidying is
 * already somebody's job.
 */
export async function keepPicture(
  full: Squeezed,
  thumb: Squeezed,
  alt: string,
): Promise<{ id: string } | { why: string }> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.functions.invoke('pictures', {
    body: {
      op: 'upload',
      mime: MIME,
      bytes: full.blob.size,
      thumbBytes: thumb.blob.size,
      w: full.w,
      h: full.h,
      alt: alt.trim() || null,
    },
  })
  if (error) return { why: await sayFunctionError(error, 'that did not go up') }
  const mint = data as Minted
  if (!mint?.id) return { why: 'that did not go up' }

  const put = async (url: string, body: Blob) => {
    const res = await fetch(url, { method: 'PUT', body, headers: { 'Content-Type': MIME } })
    return res.ok
  }
  const [a, b] = await Promise.all([put(mint.put, full.blob), put(mint.putThumb, thumb.blob)])
  if (!a || !b) return { why: 'the picture did not reach the store — try again' }

  const { error: badReady } = await supabase.rpc('picture_ready', { p_id: mint.id })
  if (badReady) return { why: badReady.message || 'that did not go up' }
  return { id: mint.id }
}

export async function myPictures(): Promise<Kept[]> {
  const { data, error } = await getSupabaseClient().functions.invoke('pictures', {
    body: { op: 'view' },
  })
  if (error) return []
  return ((data as { pictures?: Kept[] })?.pictures ?? []) as Kept[]
}

export async function dropPicture(id: string): Promise<{ why: string } | null> {
  const { error } = await getSupabaseClient().functions.invoke('pictures', {
    body: { op: 'remove', id },
  })
  if (error) return { why: await sayFunctionError(error, 'that did not go') }
  return null
}

export async function describePicture(id: string, alt: string): Promise<{ why: string } | null> {
  const { error } = await getSupabaseClient().rpc('picture_alt', { p_id: id, p_alt: alt })
  return error ? { why: error.message || 'that did not save' } : null
}

/**
 * ⚠️ A FUNCTION'S REFUSAL IS IN ITS BODY, NOT IN `error.message`. supabase-js reports a non-2xx
 * from `functions.invoke` as "Edge Function returned a non-2xx status code" and puts the response
 * on the error — so every ceiling `picture_claim` raises would arrive as that one useless
 * sentence unless the body is read. The ceilings are written to be read by a person; this is what
 * lets them be.
 */
async function sayFunctionError(error: unknown, fallback: string): Promise<string> {
  const res = (error as { context?: Response })?.context
  if (res && typeof res.json === 'function') {
    try {
      const body = await res.json()
      if (body?.error) return String(body.error)
    } catch {
      /* not json, or already read — fall through to the plain message */
    }
  }
  const msg = (error as { message?: string })?.message
  return msg && !/non-2xx/i.test(msg) ? msg : fallback
}
