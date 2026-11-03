/**
 * What R2 charges for, and what it charges for it.
 *
 * ⚠️ THIS IS A PRICE LIST AND IT HAD NOWHERE TO BE CHECKED. `r2OperationsAdaptiveGroups` hands
 * back a count per `actionType` and nothing else; the split into Class A ($4.50/M) and Class B
 * ($0.36/M) is ours to make, and the two differ by more than an order of magnitude. Done inline
 * in ws-server.js it would run inside a 2,700-line module that opens a WebSocket server and a
 * Supabase client at import, so nothing could ask it a question — the same reason `settings.mjs`
 * and `parseTrades.mjs` live here. A rule nobody can call is a rule nobody checks.
 *
 * ⚠️ AND AN UNKNOWN OPERATION IS PRICED AS A WRITE. R2 gains operations over time and these
 * three lists are a copy of somebody else's document, so the one thing this must not do is
 * quietly price a new write as free. Guessing high makes a figure cautious; guessing low makes it
 * reassuring and wrong, which for a panel whose only job is "am I about to be charged" is the
 * entire failure mode. The unknown names come back with the answer so they can be looked up
 * rather than discovered on a bill.
 *
 * The lists are Cloudflare's, read from developers.cloudflare.com/r2/pricing on 3 Nov 2026.
 * Prices the same day: storage $0.015/GB-month, Class A $4.50/million, Class B $0.36/million,
 * egress free; free each month 10 GB-month of standard storage, 1M Class A, 10M Class B.
 */

/** writes and lists */
export const R2_CLASS_A = new Set([
  'ListBuckets',
  'PutBucket',
  'ListObjects',
  'PutObject',
  'CopyObject',
  'CompleteMultipartUpload',
  'CreateMultipartUpload',
  'LifecycleStorageTierTransition',
  'ListMultipartUploads',
  'UploadPart',
  'UploadPartCopy',
  'ListParts',
  'PutBucketEncryption',
  'PutBucketCors',
  'PutBucketLifecycleConfiguration',
])

/** reads */
export const R2_CLASS_B = new Set([
  'HeadBucket',
  'HeadObject',
  'GetObject',
  'UsageSummary',
  'GetBucketEncryption',
  'GetBucketLocation',
  'GetBucketCors',
  'GetBucketLifecycleConfiguration',
])

/**
 * Free.
 *
 * ⚠️ LISTED RATHER THAN IMPLIED, because "not in A and not in B" is where an unknown write would
 * land and this site deletes a lot: every picture somebody takes down is a `DeleteObject` on the
 * full size and another on the thumbnail. Left to the fallback those would be priced as Class A,
 * and a member tidying up their pictures would look like a cost.
 */
export const R2_FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload'])

/**
 * Which class one operation name belongs to.
 *
 * @param {string} action the `actionType` dimension as R2 reports it
 * @returns {'A'|'B'|'free'} 'A' for anything unrecognised — see the header
 */
export function r2Class(action) {
  const name = typeof action === 'string' ? action : ''
  if (R2_FREE.has(name)) return 'free'
  if (R2_CLASS_B.has(name)) return 'B'
  return 'A'
}

/** Is this a name either list has heard of? Unknown names are reported, not hidden. */
export function r2Known(action) {
  const name = typeof action === 'string' ? action : ''
  return R2_CLASS_A.has(name) || R2_CLASS_B.has(name) || R2_FREE.has(name)
}

/**
 * Fold `r2OperationsAdaptiveGroups` into the three numbers a bill is made of.
 *
 * ⚠️ IT TAKES THE DATASET'S OWN SHAPE, `{ sum: { requests }, dimensions: { actionType } }`,
 * rather than a tidied-up pair — so the test exercises the thing the relay actually receives
 * and a change to the query shows up here rather than as a zero on a screen.
 *
 * ⚠️ AND `null` RATHER THAN 0 WHEN THERE IS NOTHING TO FOLD. A missing dataset and an idle month
 * are different answers, and this panel is the one place where reporting the second for the first
 * is the whole failure: a confident zero says "no need to look".
 *
 * @param {unknown} groups
 * @returns {{classA: number|null, classB: number|null, freeOps: number|null, unknown: string[]}}
 */
export function r2Operations(groups) {
  if (!Array.isArray(groups)) return { classA: null, classB: null, freeOps: null, unknown: [] }
  let classA = 0
  let classB = 0
  let freeOps = 0
  const unknown = new Set()
  for (const g of groups) {
    const n = Number(g?.sum?.requests ?? 0)
    /* a non-numeric or negative count is not a count; dropping it beats poisoning the total */
    const requests = Number.isFinite(n) && n > 0 ? n : 0
    const action = String(g?.dimensions?.actionType ?? '')
    if (action && !r2Known(action)) unknown.add(action)
    const cls = r2Class(action)
    if (cls === 'free') freeOps += requests
    else if (cls === 'B') classB += requests
    else classA += requests
  }
  return { classA, classB, freeOps, unknown: [...unknown] }
}

/**
 * Fold `r2StorageAdaptiveGroups` into bytes and an object count.
 *
 * ⚠️ MAX, NOT SUM, AND THE DIFFERENCE IS A FACTOR OF THIRTY. That dataset reports a LEVEL per
 * time bucket — how much was stored at that moment — so adding the window up multiplies one
 * bucket of objects by the number of days in it. A month of 7 MB would read as 210 MB and the
 * free tier would look nearly spent. The high-water mark is both the honest reading and the
 * cautious one.
 *
 * ⚠️ AND IT ADDS `metadataSize` TO `payloadSize`, because R2 bills their sum. A bucket of small
 * objects is mostly metadata, so leaving it out is how a figure quietly runs under.
 *
 * @param {unknown} groups
 * @returns {{bytes: number|null, objects: number|null}}
 */
export function r2Storage(groups) {
  if (!Array.isArray(groups)) return { bytes: null, objects: null }
  let bytes = null
  let objects = null
  for (const g of groups) {
    const payload = Number(g?.max?.payloadSize ?? NaN)
    const meta = Number(g?.max?.metadataSize ?? NaN)
    const count = Number(g?.max?.objectCount ?? NaN)
    if (Number.isFinite(payload)) {
      const total = payload + (Number.isFinite(meta) ? meta : 0)
      bytes = bytes === null ? total : Math.max(bytes, total)
    }
    if (Number.isFinite(count)) objects = objects === null ? count : Math.max(objects, count)
  }
  return { bytes, objects }
}
