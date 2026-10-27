import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'
import { pvDescribe, pvDrop, pvKeep, pvPictures, pvUsed } from '../dev/picturePreview'
import {
  FULL_BYTES,
  FULL_EDGE,
  THUMB_BYTES,
  THUMB_EDGE,
  clampQuality,
  fitWithin,
  nextQuality,
} from './shrink'

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
 * ⚠️ THE SERVER'S OWN CEILINGS, NAMED HERE SO THE ROOM CAN SAY THEM. `picture_claim` is where
 * they are enforced and these are a copy — which is a thing to be uneasy about, so: they are
 * only ever used to DRAW a figure ("4.2 MB of 50 MB"), never to decide anything. A copy that
 * drifts makes a label wrong; it cannot make a refusal wrong, because the refusal is not here.
 */
export const PICTURES_EACH = 500
export const PICTURE_BYTES_ALL = 52_428_800

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

  /* ⚠️ CLAMPED HERE AND NOT ONLY IN THE ROOM. The cliff at WebP 1.0 is a property of the
     encoder, so every caller has to be held off it — and once pictures are something other
     surfaces reach for, "the room clamps it" stops being true. See MAX_QUALITY. */
  let q = clampQuality(startQuality)
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
  if (previewMember) return pvKeep(full, thumb, alt)
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

  /**
   * ⚠️ `fetch` REJECTS ON A CORS FAILURE — it does not hand back a response to look at. Without
   * this `catch` the rejection travelled out of `keepPicture`, past the `setBusy(false)` in the
   * room's own handler, and left Keep it disabled for ever: a greyed button, no message, and
   * nothing in the room admitting anything had happened. An await that throws skips every line
   * after it, and one of those lines is usually the one that clears the flag.
   *
   * ⚠️ AND THE TWO FAILURES ARE NAMED APART, because they have different fixes and only one of
   * them is anybody's fault. A rejection means the request never completed — nearly always the
   * bucket's CORS policy, since this is a cross-origin PUT. A status means R2 answered and said
   * no: 403 is the token lacking write on that bucket, or the bucket name not matching.
   */
  const put = async (url: string, body: Blob): Promise<string | null> => {
    try {
      const res = await fetch(url, { method: 'PUT', body, headers: { 'Content-Type': MIME } })
      return res.ok
        ? null
        : `the store refused it (${res.status}) — check the token and bucket name`
    } catch {
      return 'the store could not be reached — check the bucket CORS policy'
    }
  }
  const [a, b] = await Promise.all([put(mint.put, full.blob), put(mint.putThumb, thumb.blob)])
  const refused = a ?? b
  if (refused) {
    /**
     * ⚠️ IT ASKS THE SERVER WHETHER R2 IS REACHABLE, because from here the three candidates are
     * indistinguishable. A browser's cross-origin PUT that fails CORS rejects with no status in
     * it, which looks identical to a network drop and says nothing about the token or the bucket
     * name. The function is not subject to CORS, so one round trip turns a guess into an answer —
     * and it only happens on the failing path, so an upload that works pays nothing for it.
     */
    const seen = await askWhy()
    return { why: seen ? `${refused}. ${seen}` : refused }
  }

  const { error: badReady } = await supabase.rpc('picture_ready', { p_id: mint.id })
  if (badReady) return { why: badReady.message || 'that did not go up' }
  return { id: mint.id }
}

/**
 * What the server can see of R2, asked only when a browser upload has already failed.
 *
 * ⚠️ IT NEVER THROWS AND NEVER BLOCKS THE REAL MESSAGE. This runs inside a failure path; a
 * diagnosis that itself fails must leave the original sentence standing rather than replace it
 * with one about the diagnosis.
 */
async function askWhy(): Promise<string | null> {
  if (previewMember) return null
  try {
    const { data, error } = await getSupabaseClient().functions.invoke('pictures', {
      body: { op: 'check' },
    })
    if (error) return null
    const out = data as { meaning?: string; status?: number } | null
    return out?.meaning ? `R2 answered the server with ${out.status}: ${out.meaning}` : null
  } catch {
    return null
  }
}

/** what the ceiling has spoken for, which is not what the list adds up to — see the server */
export type Used = { count: number; ready: number; bytes: number }

export async function myPictures(): Promise<{ pictures: Kept[]; used: Used | null }> {
  if (previewMember) {
    const pictures = pvPictures()
    return { pictures, used: pvUsed() }
  }
  const { data, error } = await getSupabaseClient().functions.invoke('pictures', {
    body: { op: 'view' },
  })
  if (error) return { pictures: [], used: null }
  const out = data as { pictures?: Kept[]; used?: Used } | null
  return { pictures: out?.pictures ?? [], used: out?.used ?? null }
}

/**
 * The pictures behind these ids that you are allowed to see: yours, or one hanging on a rating
 * or a workout you may see.
 *
 * ⚠️ ASK FOR THE IDS YOU WANT, which is the whole reason this exists beside `myPictures`. The
 * chronicle dialog used to call myPictures() and pick one id out of the answer — and that signs
 * TWO urls for every picture on the account, so at the 500-picture ceiling it is a thousand
 * signatures to draw one photograph. It was invisible at four pictures and would not have stayed
 * invisible.
 *
 * ⚠️ IT RETURNS `failed` RATHER THAN AN EMPTY LIST, AND THE DIFFERENCE IS NOT COSMETIC. This used
 * to `return []` on error, which makes two completely different answers identical: "that picture
 * is not there, or is not yours to see" and "the request did not happen". The caller cannot tell
 * them apart, so it draws nothing either way — and worse, `seen.ts` CACHES absence on purpose, so
 * one dropped connection would have pinned a real photograph as missing for the next 45 minutes.
 * An empty list is an answer; a failure is the absence of one.
 *
 * ⚠️ AND IT STILL RETURNS FEWER THAN YOU ASK FOR WHEN IT SUCCEEDS. A picture that has gone, or
 * that you may not see, is simply absent from a `failed: false` result — so look one up by id
 * rather than by position.
 */
export type Seen = { pictures: Kept[]; failed: boolean }

export async function seenPictures(ids: string[]): Promise<Seen> {
  if (!ids.length) return { pictures: [], failed: false }
  if (previewMember)
    return { pictures: pvPictures().filter((p) => ids.includes(p.id)), failed: false }
  const { data, error } = await getSupabaseClient().functions.invoke('pictures', {
    body: { op: 'seen', ids },
  })
  if (error) return { pictures: [], failed: true }
  /* a 200 whose body is not the shape agreed is also not an answer */
  const rows = (data as { pictures?: Kept[] } | null)?.pictures
  if (!Array.isArray(rows)) return { pictures: [], failed: true }
  return { pictures: rows, failed: false }
}

export async function dropPicture(id: string): Promise<{ why: string } | null> {
  if (previewMember) return pvDrop(id)
  const { error } = await getSupabaseClient().functions.invoke('pictures', {
    body: { op: 'remove', id },
  })
  if (error) return { why: await sayFunctionError(error, 'that did not go') }
  return null
}

export async function describePicture(id: string, alt: string): Promise<{ why: string } | null> {
  if (previewMember) return pvDescribe(id, alt)
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
