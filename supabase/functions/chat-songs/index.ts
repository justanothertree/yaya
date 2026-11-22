/**
 * Songs sent into a chat: presigned R2 URLs, minted only after Postgres has said yes.
 *
 * The contract is docs/2026-11-22-chat-songs.md; the SQL it calls is
 * docs/2026-11-22-chat-songs.DRAFT.sql until that is applied. This is modelled on `pictures`, and
 * every lesson written down there holds here — the ones that are load-bearing are repeated below
 * rather than referred to, because a deploy sends this file alone.
 *
 * ⚠️ THE BYTES LIVE IN R2 AND THE DECISIONS LIVE IN SUPABASE. R2 has no idea who a member is;
 * Postgres does. So every op calls an RPC first and only signs a URL if that RPC answered — and
 * calls it AS THE CALLER, with their own Authorization header, so `auth.uid()` inside is the person
 * at the browser and every room check, cap and refusal applies unchanged. The service role is used
 * for exactly two calls, `chat_song_ready` and `chat_song_gone`, which no member may make.
 *
 * ⚠️ NOTHING HERE LEARNS OR RETURNS WHO SENT A SONG. The Lounge is pseudonymous, the key carries no
 * owner, and `play` signs whatever `chat_song_get` names without ever being told whose it is.
 *
 * Secrets this needs, the same four `pictures` reads (set with `supabase secrets set`, never in
 * the bundle — CLAUDE.md §3): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'
/* the upload check's decision, in its own file so vitest can ask it — see that file's header */
import { lengthFrom, verdictFor } from './verdict.ts'

/* named origins rather than `*`: the JWT is the lock, but an endpoint that mints upload URLs is
   not one to leave answering every origin. localhost reaches the same production database. */
const ALLOWED = [
  'https://evancook.dev',
  'https://www.evancook.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

/**
 * ⚠️ THE ALLOWED HEADERS ARE ECHOED, NOT LISTED. `supabase.functions.invoke` sends `apikey` and
 * `x-client-info` as well as `authorization` and `content-type`, a preflight fails if ANY requested
 * header is missing from the answer, and the browser's error for it — "Failed to send a request to
 * the Edge Function" — names no header. That is how `pictures` was broken while a preflight test
 * that carried no `Access-Control-Request-Headers` said it worked. The origin list is the gate; a
 * list of header names never was.
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
const PUT_FOR = 300 // five minutes: long enough for a slow upload of 5 MB, short enough to be uninteresting
const GET_FOR = 3600 // an hour: a thread left open still plays, a copied link does not live long
/** how much of a recording is read to tell what it is: every signature `looksLike` knows fits */
const HEAD_BYTES = 64

/* the draft's functions return TABLE, so PostgREST answers each with an array */
type Claim = { id: string; key: string }
type Pending = { key: string; mime: string; bytes: number; ready: boolean; owner: string }
type Playable = { key: string; mime: string }
type Abandoned = { id: string; key: string }

/**
 * ⚠️ EVERY SECRET IS TRIMMED, because one of `pictures`' arrived with a trailing newline from a
 * copy-paste and cost a day: the signature was built from `…%0A`, R2 answered 400, an R2 error
 * carries no CORS headers, and the browser reported a CORS failure for something that was never
 * CORS. No R2 credential has meaningful surrounding whitespace, so trimming discards nothing real.
 * Which ones had it is logged by NAME, never by value, because a value that silently starts
 * working is one nobody learns from.
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
  const whitespaceSeen = Object.entries(raw)
    .filter(([, v]) => typeof v === 'string' && v !== v.trim())
    .map(([k]) => k)
  if (whitespaceSeen.length)
    console.warn('R2 secrets with stray whitespace:', whitespaceSeen.join(', '))
  return {
    base: `https://${account}.r2.cloudflarestorage.com/${bucket}`,
    /* region 'auto' is R2's own: it is one bucket in one place and SigV4 still wants the field */
    client: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }),
  }
}
type Kit = NonNullable<ReturnType<typeof r2>>

/**
 * A presigned URL for one object. `signQuery` puts the signature in the URL, so the browser can
 * PUT to it and an <audio> can play from it with no credentials of their own.
 */
const signFor = async (kit: Kit, key: string, method: 'PUT' | 'GET', seconds: number) => {
  const url = `${kit.base}/${key}?X-Amz-Expires=${seconds}`
  const signed = await kit.client.sign(new Request(url, { method }), { aws: { signQuery: true } })
  return signed.url
}

/** DELETE one object; a 404 counts, because what was asked for — the object not being there — is true */
const deleteObject = async (kit: Kit, key: string): Promise<boolean> => {
  try {
    const res = await kit.client.fetch(`${kit.base}/${key}`, { method: 'DELETE' })
    return res.ok || res.status === 404
  } catch {
    return false
  }
}

/** the size and stored type from a HEAD; nulls when the store could not say, never a zero */
const measure = async (kit: Kit, key: string) => {
  try {
    const res = await kit.client.fetch(`${kit.base}/${key}`, { method: 'HEAD' })
    if (!res.ok) return { bytes: null, type: null }
    return { bytes: lengthFrom(res.headers), type: res.headers.get('content-type') }
  } catch {
    return { bytes: null, type: null }
  }
}

/**
 * The object's first bytes, from a ranged GET, or null when they could not be read.
 *
 * ⚠️ A 200 IS ACCEPTED AS WELL AS A 206, AND THEN THE READ STOPS ITSELF. A store that ignores the
 * Range header answers with the whole object, and reading that to the end would be 5 MB pulled
 * through the function to look at 64 bytes. So the body is read until there are enough and then
 * cancelled, whichever status came back.
 */
const readHead = async (kit: Kit, key: string): Promise<Uint8Array | null> => {
  try {
    const res = await kit.client.fetch(`${kit.base}/${key}`, {
      headers: { Range: `bytes=0-${HEAD_BYTES - 1}` },
    })
    if ((res.status !== 206 && res.status !== 200) || !res.body) {
      await res.body?.cancel()
      return null
    }
    const reader = res.body.getReader()
    const out = new Uint8Array(HEAD_BYTES)
    let n = 0
    while (n < HEAD_BYTES) {
      const { done, value } = await reader.read()
      if (done || !value) break
      const take = Math.min(value.length, HEAD_BYTES - n)
      out.set(value.subarray(0, take), n)
      n += take
    }
    await reader.cancel().catch(() => {})
    return out.slice(0, n)
  } catch {
    return null
  }
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
  /* said plainly rather than as a 500: until the four secrets are set this can do nothing */
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
  /* `null` and `3` are JSON too, and `body.op` on either would throw past every answer below */
  if (!body || typeof body !== 'object') return json({ error: 'that was not json' }, 400, origin)

  /**
   * ⚠️ AN `Authorization` HEADER IS NOT A PERSON. The publishable anon key is a valid value for it
   * and ships in the bundle, so the header existing proves nothing. `getUser()` asks Auth to
   * verify the token and name who it belongs to; nothing below runs without that answer.
   */
  const { data: whoData, error: whoErr } = await supabase.auth.getUser()
  const user = whoData?.user ?? null
  if (whoErr || !user) return json({ error: 'not authenticated' }, 401, origin)

  /**
   * ⚠️ A SUSPENDED MEMBER MAY ONLY `play` AND `remove`, the decision made for pictures: suspension
   * stops somebody putting things on other people's screens, and must not trap them with a song
   * they want taken down. And this cannot be left to the RPCs alone, because `ready` finishes
   * through the SERVICE client, where `auth.uid()` is null and no function guard sees the member.
   */
  const { data: suspended } = await supabase.rpc('is_suspended', { p_user_id: user.id })
  if (suspended === true && body.op !== 'play' && body.op !== 'remove') {
    return json({ error: 'your account is suspended' }, 403, origin)
  }

  /**
   * Every refusal in the SQL is already a sentence, so it is passed through rather than replaced.
   *
   * ⚠️ EXCEPT A FUNCTION THAT IS NOT THERE. PGRST202 is PostgREST saying the RPC does not exist —
   * this deployed before the migration was applied — and its own words ("Could not find the
   * function public.chat_song_claim(…) in the schema cache") mean nothing to a member. It is
   * answered as a 404, which is what the client already reads as "not switched on yet" when this
   * function itself is missing, so the two halves of an unfinished rollout say the same thing.
   */
  const refused = (error: { code?: string; message: string }) =>
    error.code === 'PGRST202'
      ? json({ error: "Songs in chat aren't switched on yet." }, 404, origin)
      : json({ error: error.message }, 400, origin)

  /**
   * The service client, for the two calls no member may make. ⚠️ Said plainly when its key is
   * missing: `createClient(url, undefined)` throws out of supabase-js, which would reach the page
   * as a 500 that reads like the song was at fault.
   */
  const asService = () => {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    return serviceKey ? createClient(Deno.env.get('SUPABASE_URL')!, serviceKey) : null
  }

  /**
   * Writes down that an object is gone, so it is never handed back to be deleted again.
   *
   * ⚠️ THE OWNER IS THE CALLER, AS AUTH NAMED THEM ABOVE, and that is the only owner this ever
   * needs: both paths here reach a row only through `chat_song_remove` or `chat_song_abandoned`,
   * which answer about `auth.uid()`'s own rows and nobody else's. `chat_song_gone` checks it
   * against the row, so a wrong one marks nothing.
   */
  const markGone = async (songId: string) => {
    const service = asService()
    if (!service) {
      console.error('no service key, so a deleted song is not marked gone', songId)
      return
    }
    try {
      const { error } = await service.rpc('chat_song_gone', { p_id: songId, p_owner: user.id })
      if (error) console.error('could not mark a song gone', songId, error.message)
    } catch (e) {
      console.error('could not mark a song gone', songId, String(e))
    }
  }

  const id = typeof body.id === 'string' ? body.id : null

  /**
   * ── a new song: Postgres reserves the row and the key, this signs the upload ──────────────────
   *
   * ⚠️ AND FIRST, WHAT THIS ACCOUNT LET GO IS DELETED FROM R2. `chat_song_claim` lets an upload
   * that was never sent go after an hour, and `chat_song_remove` marks a song removed, but neither
   * can reach the bucket — only this can. The rows stay until the object is confirmed gone, so a
   * delete that failed once is simply tried again next time, rather than leaving an object nobody
   * can name. Twenty at most, so a backlog never makes one upload slow; it is best effort, and an
   * upload is never refused because the tidying failed.
   */
  if (body.op === 'upload') {
    try {
      const { data: lost } = await supabase.rpc('chat_song_abandoned')
      await Promise.all(
        ((lost ?? []) as Abandoned[]).map(async (a) => {
          if (await deleteObject(kit, a.key)) await markGone(a.id)
        }),
      )
    } catch (e) {
      console.error('could not tidy abandoned songs', String(e))
    }

    const { data, error } = await supabase.rpc('chat_song_claim', {
      p_room: body.room,
      p_mime: body.mime,
      p_bytes: body.bytes,
      p_seconds: body.seconds,
      p_name: body.name,
    })
    if (error) return refused(error)
    const claim = (data as Claim[] | null)?.[0]
    if (!claim) return json({ error: 'that song could not be started' }, 500, origin)
    return json({ id: claim.id, put: await signFor(kit, claim.key, 'PUT', PUT_FOR) }, 200, origin)
  }

  /**
   * ── finishing: the store is asked what it actually holds ─────────────────────────────────────
   *
   * ⚠️ THE SIGNED PUT BINDS NEITHER LENGTH NOR TYPE, so until this runs every cap was applied to a
   * number the browser chose. The size and stored type come from a HEAD, the first bytes from a
   * ranged GET, and `verdict.ts` decides. This is the only thing that can ask, because it is the
   * only thing holding R2 credentials — and the only way a song becomes ready, because
   * `chat_song_ready` is granted to `service_role` and nothing else.
   *
   * ⚠️ SO THIS ONE CALL USES THE SERVICE CLIENT, with the owner `chat_song_pending` returned —
   * which it returns only for the caller's own row, so ownership is proved by Postgres and not
   * decided here.
   */
  if (body.op === 'ready') {
    if (!id) return json({ error: 'which song?' }, 400, origin)
    const { data, error } = await supabase.rpc('chat_song_pending', { p_id: id })
    if (error) return refused(error)
    const pending = (data as Pending[] | null)?.[0]
    if (!pending) return json({ error: 'no such song' }, 400, origin)
    /* already finished: a retry is not a mistake, and measuring again would charge for it */
    if (pending.ready) return json({ ok: true }, 200, origin)

    const [seen, head] = await Promise.all([measure(kit, pending.key), readHead(kit, pending.key)])
    const verdict = verdictFor({
      claimedBytes: pending.bytes,
      mime: pending.mime,
      seenBytes: seen.bytes,
      seenType: seen.type,
      head,
    })

    if (!verdict.ok) {
      /**
       * ⚠️ THE OBJECT GOES, NOT ONLY THE ROW: the row is what the cap counts and the object is what
       * Cloudflare bills. `drop: false` is an upload that never arrived or could not be read —
       * nothing to delete yet, and the claim lets the row go after an hour.
       */
      if (verdict.drop) {
        const { data: key } = await supabase.rpc('chat_song_remove', { p_id: id })
        if (typeof key === 'string' && (await deleteObject(kit, key))) await markGone(id)
      }
      return json({ error: verdict.why }, 400, origin)
    }

    const service = asService()
    if (!service) return json({ error: 'this project cannot finish songs yet' }, 503, origin)
    const { error: badReady } = await service.rpc('chat_song_ready', {
      p_id: id,
      p_owner: pending.owner,
    })
    if (badReady) return refused(badReady)
    return json({ ok: true }, 200, origin)
  }

  /* ── listening: the RPC decides whether this person may hear it; this only signs ─────────── */
  if (body.op === 'play') {
    if (!id) return json({ error: 'which song?' }, 400, origin)
    const { data, error } = await supabase.rpc('chat_song_get', { p_id: id })
    if (error) return refused(error)
    const song = (data as Playable[] | null)?.[0]
    if (!song) return json({ error: 'no such song' }, 400, origin)
    return json({ url: await signFor(kit, song.key, 'GET', GET_FOR) }, 200, origin)
  }

  /**
   * ── removing: the row is marked first, because its answer is what names the object ──────────
   *
   * ⚠️ A FAILED DELETE IN R2 IS NOT A FAILED REMOVE. The song is gone from the room the moment the
   * row is marked, so saying otherwise would invite a second press on a song that no longer
   * plays. And unlike `pictures`, where the row went first and the key with it, nothing is lost:
   * the row stays with `object_gone_at` empty, `chat_song_abandoned` hands it back, and the next
   * upload deletes it. `orphaned` says the object is, for now, still there.
   */
  if (body.op === 'remove') {
    if (!id) return json({ error: 'which song?' }, 400, origin)
    const { data, error } = await supabase.rpc('chat_song_remove', { p_id: id })
    if (error) return refused(error)
    const gone = typeof data === 'string' && (await deleteObject(kit, data))
    if (gone) await markGone(id)
    return json({ ok: true, orphaned: !gone }, 200, origin)
  }

  return json({ error: 'unknown op' }, 400, origin)
})
