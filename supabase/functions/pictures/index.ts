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

const corsFor = (origin: string | null): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin && ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
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

const r2 = () => {
  const account = Deno.env.get('R2_ACCOUNT_ID')
  const bucket = Deno.env.get('R2_BUCKET')
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')
  if (!account || !bucket || !accessKeyId || !secretAccessKey) return null
  return {
    bucket,
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
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsFor(origin) })
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
    return json({ pictures: out }, 200, origin)
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
