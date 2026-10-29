/**
 * Presigned R2 URLs, minted only after Postgres has said yes.
 *
 * ⚠️ THE BYTES LIVE IN R2 AND THE DECISIONS LIVE IN SUPABASE, which is the whole shape of this.
 * R2 has no idea who a member is; Postgres does. So every operation here calls an RPC first —
 * `picture_claim`, `pictures_mine`, `picture_drop` — and only signs a URL if that RPC answered.
 * The signing is the only thing this adds.
 *
 * ⚠️ AND IT CALLS THEM AS THE CALLER, NOT AS THE SERVICE ROLE. The client is built with the
 * caller's own Authorization header, so `auth.uid()` inside those functions is the person at the
 * browser and every ceiling, ownership check and refusal they already carry applies unchanged.
 * A service-role client here would have made this file a second place where "what may be read"
 * is decided, which is exactly what CLAUDE.md §3's house pattern exists to prevent. refresh-prices
 * uses the service role because it answers to a cron and belongs to nobody; this answers to a
 * person.
 *
 * ⚠️ WHY ANY OF THIS RATHER THAN SUPABASE STORAGE: egress. The free plan meters bytes out at the
 * ORGANISATION level across database, Storage, Auth, Realtime and functions together, and going
 * over restricts the project rather than billing it — so a busy month of people looking at
 * pictures would take the chronicle, the chat and sign-in down with it. R2 charges nothing for
 * egress at any volume. The browser fetches images straight from R2 and never through Supabase,
 * so the only thing crossing that meter is the small JSON below.
 *
 * Secrets this needs (set with `supabase secrets set`, never in the bundle — §3):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'
/* the size check's decision, in its own file so vitest can ask it — see that file's header */
import { lengthFrom, verdictFor } from './verdict.ts'

/* ⚠️ NAMED ORIGINS RATHER THAN `*`. The JWT is what actually guards this — CORS does not protect
   a token the app sends deliberately — but an endpoint that mints upload URLs is not one to leave
   answering every origin that asks. localhost is here because the dev server is where it is
   driven; it reaches the same production database either way, which is a thing to remember. */
const ALLOWED = [
  'https://evancook.dev',
  'https://www.evancook.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

/**
 * ⚠️ THE ALLOWED HEADERS ARE ECHOED, NOT LISTED, AND A FIXED LIST IS WHY THIS DID NOT WORK.
 * This said `'authorization, content-type'` — which is what the browser's own `fetch` would ask
 * for, and not what `supabase.functions.invoke` asks for. supabase-js also sends `apikey` and
 * `x-client-info`, the browser requires EVERY requested header to appear in the allow list, and a
 * preflight that misses one fails the whole request before the POST is ever sent. The room's error
 * was "Failed to send a request to the Edge Function", which names no header and no origin.
 *
 * ⚠️ AND THE CHECK THAT MISSED IT LOOKED LIKE A PASS. A preflight sent with only
 * `Access-Control-Request-Method: POST` came back 204 with the right origin, and that was read as
 * "CORS works". It proved the ORIGIN was allowed and never asked about headers — the server
 * answers that part unconditionally, so the one question that mattered was never put to it. A
 * preflight test has to carry `Access-Control-Request-Headers`, with the headers the real client
 * sends, or it is testing half of CORS.
 *
 * Echoing is the robust form: it cannot drift when a client library adds a header, and it widens
 * nothing that matters — the ORIGIN list is the gate, and the JWT behind it is the lock. An allow
 * list of header NAMES was never a security boundary.
 */
const corsFor = (origin: string | null, asked?: string | null): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin && ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'Access-Control-Allow-Headers': asked || 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '3600',
  Vary: 'Origin, Access-Control-Request-Headers',
})

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsFor(origin) },
  })

/** how long a minted URL is good for, in seconds */
const PUT_FOR = 300 // five minutes: long enough for a slow upload, short enough to be uninteresting
/* ⚠️ an hour for reads, which is a deliberate middle. Shorter means a gallery left open stops
   drawing; longer means a URL someone copied out of devtools works for longer than it should. */
const GET_FOR = 3600

type Claim = { id: string; key: string; thumb_key: string }
type Pending = {
  key: string
  thumb_key: string
  bytes: number
  thumb_bytes: number
  ready: boolean
  /**
   * ⚠️ THE OWNER COMES BACK FROM POSTGRES, NEVER FROM THE REQUEST. `picture_pending` proved
   * `owner = auth.uid()` before answering, so this field is the database's word for who the
   * caller is — which is what lets the finishing call be made as `service_role` without this
   * file deciding anything about ownership. See the note on the `ready` op.
   */
  owner: string
}
type Mine = {
  id: string
  key: string
  thumb_key: string
  mime: string
  bytes: number
  thumb_bytes: number
  w: number
  h: number
  alt: string | null
  created_at: string
}

/**
 * ⚠️ EVERY SECRET IS TRIMMED, BECAUSE ONE OF THEM ARRIVED WITH A NEWLINE ON IT AND COST A DAY.
 * `R2_ACCESS_KEY_ID` was set with a trailing newline character — the sort of thing a copy-paste
 * adds and nothing anywhere displays. What it produced was not an error about a credential:
 *
 *   browser   the signature is built from the key, so the presigned URL carried
 *             `X-Amz-Credential=…ebd3%0A%2F20261023%2F…` and R2 answered **400**. An R2 error
 *             response carries no CORS headers, so the browser reported "No
 *             'Access-Control-Allow-Origin' header is present" — a CORS message for something
 *             that was never a CORS problem, which sent the diagnosis off for a day.
 *
 *   server    the reachability check threw rather than returning a status, so it reported 0,
 *             "could not reach R2 at all" — true, and about the wrong cause. The obvious
 *             explanation is that a newline is illegal in an HTTP header value and Deno refuses
 *             to build the request; that is NOT verified. Chrome was asked the same question
 *             directly and built such a header without complaint, so the two runtimes differ or
 *             the cause is something else. The browser half above IS verified — the credential
 *             was reproduced character for character from the `%0A` in the signed URL.
 *
 * No R2 credential has meaningful leading or trailing whitespace, so trimming cannot discard
 * anything real and removes the whole class. `whitespaceSeen` is what makes it SAY so, because a
 * value that silently starts working is one nobody learns from.
 */
const r2 = () => {
  const raw = {
    R2_ACCOUNT_ID: Deno.env.get('R2_ACCOUNT_ID'),
    R2_BUCKET: Deno.env.get('R2_BUCKET'),
    R2_ACCESS_KEY_ID: Deno.env.get('R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: Deno.env.get('R2_SECRET_ACCESS_KEY'),
  }
  const account = raw.R2_ACCOUNT_ID?.trim()
  const bucket = raw.R2_BUCKET?.trim()
  const accessKeyId = raw.R2_ACCESS_KEY_ID?.trim()
  const secretAccessKey = raw.R2_SECRET_ACCESS_KEY?.trim()
  if (!account || !bucket || !accessKeyId || !secretAccessKey) return null
  /* which secrets had whitespace, by NAME only — never a value, not even a trimmed one */
  const whitespaceSeen = Object.entries(raw)
    .filter(([, v]) => typeof v === 'string' && v !== v.trim())
    .map(([k]) => k)
  return {
    bucket,
    whitespaceSeen,
    base: `https://${account}.r2.cloudflarestorage.com/${bucket}`,
    /* region 'auto' is R2's own: it is one bucket in one place and SigV4 still wants the field */
    client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }),
  }
}

/**
 * A presigned URL for one object.
 *
 * ⚠️ `signQuery` PUTS THE SIGNATURE IN THE URL, which is what lets the browser `fetch` it with no
 * credentials of its own — the alternative is signing headers the browser would have to reproduce
 * exactly, and an <img src> cannot send headers at all.
 */
const signFor = async (
  kit: NonNullable<ReturnType<typeof r2>>,
  key: string,
  method: 'PUT' | 'GET' | 'DELETE',
  seconds: number,
): Promise<string> => {
  const url = `${kit.base}/${key}?X-Amz-Expires=${seconds}`
  const signed = await kit.client.sign(new Request(url, { method }), {
    aws: { signQuery: true },
  })
  return signed.url
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsFor(origin, req.headers.get('Access-Control-Request-Headers')),
    })
  }
  if (req.method !== 'POST') return json({ error: 'post something' }, 405, origin)

  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'not authenticated' }, 401, origin)

  const kit = r2()
  /* ⚠️ SAID PLAINLY RATHER THAN AS A 500. Until the four secrets are set this function cannot do
     anything, and "R2 is not configured" is a sentence somebody can act on where a stack trace in
     a log is not. */
  if (!kit) return json({ error: 'R2 is not configured on this project yet' }, 503, origin)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'that was not json' }, 400, origin)
  }

  /**
   * ── is R2 reachable from HERE ──────────────────────────────────────────────────────────────
   *
   * ⚠️ A SERVER-SIDE REQUEST IS NOT SUBJECT TO CORS, which is the whole reason this op exists.
   * When a browser's PUT fails there are three candidates — the bucket's CORS policy, the token's
   * permissions, and the bucket name — and from the browser they are indistinguishable, because a
   * CORS failure yields a rejected promise with no status in it. Asked from here, R2 answers
   * properly and the status separates all three:
   *
   *   200  the bucket is there and the token can read it → the browser's problem is CORS
   *   403  the token is wrong, or lacks Object Read & Write on this bucket
   *   404  the bucket name does not match R2_BUCKET
   *
   * ⚠️ IT REPORTS NO CREDENTIAL AND NO ACCOUNT ID. The bucket NAME is already something the
   * caller chose and told us; the status is a number. Nothing here widens what a signed-in member
   * can learn about the project beyond "storage is or is not configured correctly", which they
   * are about to learn anyway from whether their picture uploads.
   */
  if (body.op === 'check') {
    try {
      const res = await kit.client.fetch(kit.base, { method: 'HEAD' })
      return json(
        {
          reachable: res.ok,
          status: res.status,
          bucket: kit.bucket,
          whitespaceSeen: kit.whitespaceSeen,
          meaning:
            res.status === 200
              ? 'R2 answers this function, so an upload failing in the browser is the bucket CORS policy'
              : res.status === 403
                ? 'the token is wrong or lacks Object Read & Write on this bucket'
                : res.status === 404
                  ? 'no bucket of that name — R2_BUCKET does not match'
                  : 'R2 answered with something unexpected',
        },
        200,
        origin,
      )
    } catch (e) {
      return json(
        {
          reachable: false,
          status: 0,
          whitespaceSeen: kit.whitespaceSeen,
          meaning:
            kit.whitespaceSeen.length > 0
              ? `could not reach R2 — these secrets have stray whitespace: ${kit.whitespaceSeen.join(', ')}`
              : 'could not reach R2 at all from the function',
          detail: String(e),
        },
        200,
        origin,
      )
    }
  }

  /* ── a new picture: Postgres reserves the row and the keys, this signs the two uploads ── */
  if (body.op === 'upload') {
    const { data, error } = await supabase.rpc('picture_claim', {
      p_mime: body.mime,
      p_bytes: body.bytes,
      p_thumb_bytes: body.thumbBytes,
      p_w: body.w,
      p_h: body.h,
      p_alt: body.alt ?? null,
    })
    /* every refusal in picture_claim is already a sentence — the ceilings, the unknown mime —
       so it is passed through rather than replaced with one of this file's own */
    if (error) return json({ error: error.message }, 400, origin)
    const claim = data as Claim
    return json(
      {
        id: claim.id,
        put: await signFor(kit, claim.key, 'PUT', PUT_FOR),
        putThumb: await signFor(kit, claim.thumb_key, 'PUT', PUT_FOR),
      },
      200,
      origin,
    )
  }

  /* ── looking: the RPC decides WHICH pictures, this only signs the ones it named ── */
  if (body.op === 'view') {
    const { data, error } = await supabase.rpc('pictures_mine')
    if (error) return json({ error: error.message }, 400, origin)
    const rows = (data ?? []) as Mine[]
    const want = Array.isArray(body.ids) ? new Set(body.ids as string[]) : null
    const out = await Promise.all(
      rows
        .filter((p) => !want || want.has(p.id))
        .map(async (p) => ({
          id: p.id,
          w: p.w,
          h: p.h,
          alt: p.alt,
          bytes: p.bytes,
          created_at: p.created_at,
          url: await signFor(kit, p.key, 'GET', GET_FOR),
          thumbUrl: await signFor(kit, p.thumb_key, 'GET', GET_FOR),
        })),
    )
    /**
     * ⚠️ THE USAGE COMES FROM THE SERVER, not from adding up the list above. They are different
     * numbers and the room was showing the wrong one: the list holds only READY pictures and only
     * their full-size bytes, while the ceiling counts every row — unready claims included — and
     * their thumbnails too. Measured on the owner's account right after the first working upload,
     * the room said 942 KB where the ceiling had 5,724,752 spoken for. A figure shown against a
     * limit must be the figure the limit is applied to.
     *
     * It is one more RPC on the server's side of the wire and no extra round trip for the browser.
     */
    const { data: used } = await supabase.rpc('pictures_used')
    return json({ pictures: out, used }, 200, origin)
  }

  /**
   * ⚠️ A WIDER QUESTION THAN `view`, PUT TO A DIFFERENT RPC. `view` is backed by pictures_mine,
   * so it can only ever answer about your own gallery. A photograph hung on a rating or on a
   * day's workout has to be signable by whoever may see that rating or that workout, which is a
   * join rather than an owner check. pictures_i_can_see is where that lives, and it requires the
   * picture's owner to match the host row's owner — so an id written onto somebody else's row,
   * which circuit_ratings' direct UPDATE grant does permit, resolves to nothing.
   *
   * ⚠️ AND IT CARRIES NO `used`. That figure is the caller's own quota and says nothing about a
   * picture somebody else owns; returning it here would invite it onto a page about a friend.
   */
  if (body.op === 'seen') {
    /**
     * ⚠️ DEDUPED AND CAPPED HERE, not trusted from the caller. One page can ask for the same id
     * many times over — a week where the same photograph hangs on several days, a feed re-render
     * — and sending it twice costs a second signature for an identical answer. The cap is the
     * blunter half: this signs two URLs per row, each a real HMAC, so an unbounded array is an
     * invitation to make the function do arbitrary work for one request. 60 matches PER_CALL in
     * src/pictures/seen.ts, which splits a larger batch rather than truncating it, so a page
     * never reaches this limit and anything that does is not a page.
     *
     * `pictures_i_can_see` keeps its own looser bound of 200 as a backstop for any other caller.
     */
    const asked = Array.isArray(body.ids) ? (body.ids as unknown[]) : []
    const ids = [...new Set(asked.filter((x): x is string => typeof x === 'string' && !!x))]
    if (!ids.length) return json({ pictures: [] }, 200, origin)
    if (ids.length > 60)
      return json({ error: `too many pictures at once (${ids.length} of 60)` }, 400, origin)
    const { data, error } = await supabase.rpc('pictures_i_can_see', { p_ids: ids })
    if (error) return json({ error: error.message }, 400, origin)
    const out = await Promise.all(
      ((data ?? []) as Mine[]).map(async (p) => ({
        id: p.id,
        w: p.w,
        h: p.h,
        alt: p.alt,
        bytes: p.bytes,
        created_at: p.created_at,
        url: await signFor(kit, p.key, 'GET', GET_FOR),
        thumbUrl: await signFor(kit, p.thumb_key, 'GET', GET_FOR),
      })),
    )
    return json({ pictures: out }, 200, origin)
  }

  /**
   * ── finishing: the store is asked what it actually holds ──────────────────────────────────
   *
   * ⚠️ UNTIL THIS EXISTED, EVERY CEILING WAS APPLIED TO A NUMBER THE BROWSER CHOSE. `picture_claim`
   * bounds 2 MB a picture, 256 KB a thumbnail, 500 pictures and 50 MB an account against
   * `p_bytes` / `p_thumb_bytes` sent from the page, and `signFor` signs with `signQuery`, which
   * binds the method, the key and an expiry and NOT a content length — so R2 takes an object of
   * any size at that key. `picture_ready` then flipped the row ready without asking the store
   * anything.
   *
   * Measured on the live database, 28 Oct 2026, in a rolled-back transaction: a claim of
   * `bytes: 1, thumbBytes: 1` was accepted, the row read `bytes=1 thumb_bytes=1 ready=true`, and
   * the 50 MB ceiling counted **2 bytes** for it. Five hundred of those is an account at its row
   * limit holding whatever it liked, billed to Evan.
   *
   * ⚠️ THIS FUNCTION IS THE ONLY THING THAT CAN ASK, because it is the only thing holding R2
   * credentials. The decision it makes is in `verdict.ts` so that it can be tested without a
   * deployed runtime, a member's JWT and a bucket — see the note at the top of that file.
   *
   * ⚠️ AND THIS IS NOW THE ONLY WAY TO FINISH ONE, which is what makes the measurement a lock
   * rather than a courtesy. `picture_ready(uuid)` used to be granted to `authenticated`, so a
   * stale bundle — or anybody writing RPC calls by hand — could flip a row ready without being
   * measured. It is revoked (the `picture_ready_revoke` migration); what is left is the 2-arg
   * `picture_ready(uuid, uuid)`, granted to `service_role` and nothing else.
   *
   * ⚠️ SO THIS ONE CALL USES A SERVICE-ROLE CLIENT, AND ONLY THIS ONE. `picture_pending` and
   * `picture_drop` above stay on the caller's token, so ownership is still proved by Postgres and
   * not by the file holding the key — CLAUDE.md §3's house pattern is that "what may be written"
   * is one question answered in one place, and a service-role client used liberally makes this
   * file a second place. The owner it passes is the one `picture_pending` returned.
   */
  if (body.op === 'ready') {
    const { data, error } = await supabase.rpc('picture_pending', { p_id: body.id })
    if (error) return json({ error: error.message }, 400, origin)
    const claim = data as Pending
    /* already finished: a retry is not a mistake, and re-measuring would charge for the HEADs */
    if (claim.ready) return json({ ok: true }, 200, origin)

    /** `content-length` from the store, or null when it could not say — never a zero */
    const measure = async (key: string): Promise<number | null> => {
      try {
        const res = await kit.client.fetch(`${kit.base}/${key}`, { method: 'HEAD' })
        return res.ok ? lengthFrom(res.headers) : null
      } catch {
        return null
      }
    }
    const [seenBytes, seenThumb] = await Promise.all([measure(claim.key), measure(claim.thumb_key)])

    const verdict = verdictFor({
      claimedBytes: claim.bytes,
      claimedThumb: claim.thumb_bytes,
      seenBytes,
      seenThumb,
    })

    if (!verdict.ok) {
      /**
       * ⚠️ THE OBJECT GOES, NOT ONLY THE ROW. The row is what the ceiling counts and the object is
       * what Cloudflare bills, so dropping the row alone would leave the bytes in the bucket with
       * nothing in the database pointing at them — the quota would read as freed while the cost
       * stayed. `drop: false` is the upload that never arrived: there is nothing to delete, and
       * the hourly sweep in `picture_claim` takes the row.
       */
      if (verdict.drop) {
        const { data: keys } = await supabase.rpc('picture_drop', { p_id: body.id })
        const k = keys as { key: string; thumb_key: string } | null
        if (k) {
          await Promise.all(
            [k.key, k.thumb_key].map(async (one) => {
              try {
                await kit.client.fetch(`${kit.base}/${one}`, { method: 'DELETE' })
              } catch {
                /* an object nobody can reach any more; the row is already gone */
              }
            }),
          )
        }
      }
      return json({ error: verdict.why }, 400, origin)
    }

    /* ⚠️ SAID PLAINLY RATHER THAN AS A CRASH, for the same reason as "R2 is not configured"
       above: `createClient(url, undefined)` throws out of supabase-js with a message about a
       missing key, which reaches the page as a 500 and reads like the picture was too big. */
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serviceKey) {
      return json({ error: 'this project cannot finish pictures yet' }, 503, origin)
    }
    const asService = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
    const { error: badReady } = await asService.rpc('picture_ready', {
      p_id: body.id,
      p_owner: claim.owner,
    })
    if (badReady) return json({ error: badReady.message }, 400, origin)
    return json({ ok: true }, 200, origin)
  }

  /* ── removing: the row goes first, because its answer is what names the objects ── */
  if (body.op === 'remove') {
    const { data, error } = await supabase.rpc('picture_drop', { p_id: body.id })
    if (error) return json({ error: error.message }, 400, origin)
    const keys = data as { key: string; thumb_key: string }
    /**
     * ⚠️ A FAILED DELETE IN R2 IS NOT A FAILED DELETE. The row is already gone, so the picture is
     * gone from the person's point of view and saying otherwise would invite them to press it
     * again on a row that no longer exists. What is left is an object nobody can reach and nobody
     * is charged much for — reported, so a sweep can find it later, never raised.
     */
    const gone = await Promise.all(
      [keys.key, keys.thumb_key].map(async (k) => {
        try {
          const res = await kit.client.fetch(`${kit.base}/${k}`, { method: 'DELETE' })
          return res.ok || res.status === 404
        } catch {
          return false
        }
      }),
    )
    return json({ ok: true, orphaned: gone.some((g) => !g) }, 200, origin)
  }

  return json({ error: 'unknown op' }, 400, origin)
})
