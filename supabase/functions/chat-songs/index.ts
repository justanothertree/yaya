/**
 * Songs sent into a chat: the recording comes here, is checked here and is written to R2 from here;
 * Postgres decides who may send it and who may hear it.
 *
 * The contract is docs/2026-11-22-chat-songs.md; the SQL it calls is
 * docs/2026-11-22-chat-songs.DRAFT.sql until that is applied. This is modelled on `pictures`, and
 * every lesson written down there holds here — the ones that are load-bearing are repeated below
 * rather than referred to, because a deploy sends this file alone.
 *
 * ⚠️ THE BYTES LIVE IN R2 AND THE DECISIONS LIVE IN SUPABASE. R2 has no idea who a member is;
 * Postgres does. So every op calls an RPC first and only touches the bucket if that RPC answered —
 * and calls it AS THE CALLER, with their own Authorization header, so `auth.uid()` inside is the
 * person at the browser and every room check, cap and refusal applies unchanged. The service role
 * is used for exactly two calls, `chat_song_ready` and `chat_song_gone`, which no member may make.
 *
 * ⚠️ THE BROWSER NEVER WRITES TO R2. The first version signed a PUT for the browser and checked the
 * object afterwards. A signed PUT stays good until it expires, whatever that check said, so a
 * sender could put any file at the key after it had passed; and a PUT nobody finished left an
 * object that no row was ever completed for. Now the recording is the request body: at most 5 MB
 * of it is read, the bytes in hand are checked, and only then are they written, by this, with
 * credentials nobody else holds. Nothing outside this file can write a song's key.
 *
 * ⚠️ NOTHING HERE LEARNS OR RETURNS WHO SENT A SONG. The Lounge is pseudonymous, the key carries no
 * owner, and `play` signs whatever `chat_song_get` names without ever being told whose it is.
 *
 * Secrets this needs, the same four `pictures` reads (set with `supabase secrets set`, never in
 * the bundle — CLAUDE.md §3): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'
/* what an upload may be, in its own file so vitest can ask it — see that file's header */
import { MAX_BYTES, readAtMost, songId, uploadFrom, verdictFor } from './verdict.ts'

/* named origins rather than `*`: the JWT is the lock, but an endpoint that writes to the bucket
   is not one to leave answering every origin. localhost reaches the same production database. */
const ALLOWED = [
  'https://evancook.dev',
  'https://www.evancook.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

/**
 * ⚠️ THE ALLOWED HEADERS ARE ECHOED, NOT LISTED. `supabase.functions.invoke` sends `apikey` and
 * `x-client-info` as well as `authorization` and `content-type`, an upload adds its five
 * `x-song-*` headers, a preflight fails if ANY requested header is missing from the answer, and
 * the browser's error for it — "Failed to send a request to the Edge Function" — names no header.
 * That is how `pictures` was broken while a preflight test that carried no
 * `Access-Control-Request-Headers` said it worked. The origin list is the gate; a list of header
 * names never was.
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

/** how long a link to hear a song is good for: a thread left open still plays, a copied link does not live long */
const GET_FOR = 3600

/* the draft's functions return TABLE, so PostgREST answers each with an array */
type Claim = { id: string; key: string }
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
 * A link to hear one object. `signQuery` puts the signature in the URL, which is what lets an
 * <audio> play from it with no credentials of its own — and it is only ever a GET.
 */
const signGet = async (kit: Kit, key: string, seconds: number) => {
  const url = `${kit.base}/${key}?X-Amz-Expires=${seconds}`
  const signed = await kit.client.sign(new Request(url, { method: 'GET' }), {
    aws: { signQuery: true },
  })
  return signed.url
}

/**
 * Writes one recording, signed in the headers by this function's own credentials.
 *
 * ⚠️ THE `Content-Type` IS THE CLAIMED KIND, set here, because R2 stores it and serves the object
 * with it: what ▶ is handed is decided by this line and nothing the browser sent.
 */
const putObject = async (kit: Kit, key: string, bytes: Uint8Array<ArrayBuffer>, mime: string) => {
  try {
    const res = await kit.client.fetch(`${kit.base}/${key}`, {
      method: 'PUT',
      body: bytes,
      headers: { 'Content-Type': mime },
    })
    await res.body?.cancel()
    return res.ok
  } catch {
    return false
  }
}

/** DELETE one object; a 404 counts, because what was asked for — the object not being there — is true */
const deleteObject = async (kit: Kit, key: string): Promise<boolean> => {
  try {
    const res = await kit.client.fetch(`${kit.base}/${key}`, { method: 'DELETE' })
    await res.body?.cancel()
    return res.ok || res.status === 404
  } catch {
    return false
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

  /**
   * ⚠️ AN UPLOAD'S BODY IS THE RECORDING, so its op travels in a header and its body is not read
   * here — not as JSON, and not at all until the caller has been named below. Every other op is a
   * small JSON body.
   */
  const isUpload = req.headers.get('x-song-op') === 'upload'
  let body: Record<string, unknown> = {}
  if (!isUpload) {
    try {
      body = await req.json()
    } catch {
      return json({ error: 'that was not json' }, 400, origin)
    }
    /* `null` and `3` are JSON too, and `body.op` on either would throw past every answer below */
    if (!body || typeof body !== 'object') return json({ error: 'that was not json' }, 400, origin)
  }
  const op = isUpload ? 'upload' : body.op

  /**
   * ⚠️ AN `Authorization` HEADER IS NOT A PERSON. The publishable anon key is a valid value for it
   * and ships in the bundle, so the header existing proves nothing. `getUser()` asks Auth to
   * verify the token and name who it belongs to; nothing below runs without that answer, and no
   * byte of an upload is read before it.
   */
  const { data: whoData, error: whoErr } = await supabase.auth.getUser()
  const user = whoData?.user ?? null
  if (whoErr || !user) return json({ error: 'not authenticated' }, 401, origin)

  /**
   * ⚠️ A SUSPENDED MEMBER MAY ONLY `play` AND `remove`, the decision made for pictures: suspension
   * stops somebody putting things on other people's screens, and must not trap them with a song
   * they want taken down. And this cannot be left to the RPCs alone, because an upload finishes
   * through the SERVICE client, where `auth.uid()` is null and no function guard sees the member.
   */
  const { data: suspended } = await supabase.rpc('is_suspended', { p_user_id: user.id })
  if (suspended === true && op !== 'play' && op !== 'remove') {
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
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const service = serviceKey ? createClient(Deno.env.get('SUPABASE_URL')!, serviceKey) : null

  /**
   * Writes down that an object is gone, so it is never handed back to be deleted again.
   *
   * ⚠️ THE OWNER IS THE CALLER, AS AUTH NAMED THEM ABOVE, and that is the only owner this ever
   * needs: every row this reaches came from `chat_song_claim`, `chat_song_remove` or
   * `chat_song_abandoned`, which answer about `auth.uid()`'s own rows and nobody else's.
   * `chat_song_gone` checks it against the row, so a wrong one marks nothing.
   */
  const markGone = async (fileId: string) => {
    if (!service) {
      console.error('no service key, so a deleted song is not marked gone', fileId)
      return
    }
    try {
      const { error } = await service.rpc('chat_song_gone', { p_id: fileId, p_owner: user.id })
      if (error) console.error('could not mark a song gone', fileId, error.message)
    } catch (e) {
      console.error('could not mark a song gone', fileId, String(e))
    }
  }

  /**
   * ⚠️ WHAT THIS ACCOUNT LET GO IS DELETED FROM R2 FIRST, AT EVERY UPLOAD AND EVERY REMOVE.
   * `chat_song_claim` lets a song that was never sent go after an hour, `chat_song_remove` marks a
   * song removed, and a song whose message goes is marked by the table's trigger — but none of
   * them can reach the bucket; only this can. The rows stay until the object is confirmed gone, so
   * a delete that failed once is simply tried again next time, rather than leaving an object
   * nobody can name. Twenty at most, so a backlog never makes one request slow; it is best effort,
   * and nothing is refused because the tidying failed.
   *
   * ⚠️ AND ONLY THEN: nothing here runs on a timer, so an account that never uploads or removes
   * again keeps what it let go in the bucket. The doc's "Left" says what would close that.
   */
  const tidy = async () => {
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
  }

  /**
   * ── a new song: read it, claim it, check it, store it, finish it ────────────────────────────
   *
   * The claim comes first among the decisions because its refusals are the ones a member meets —
   * the room, the account's 25 MB, the name — and it takes the account's lock, so two uploads at
   * once cannot both fit under the cap. It is given the length of what actually arrived, never a
   * number the browser chose. Only then are the bytes in hand checked, and only bytes that pass
   * are written.
   */
  if (op === 'upload') {
    if (!service) return json({ error: 'this project cannot finish songs yet' }, 503, origin)
    await tidy()

    const said = uploadFrom(req.headers)
    let read: Awaited<ReturnType<typeof readAtMost>>
    try {
      read = await readAtMost(req.body, MAX_BYTES)
    } catch {
      return json({ error: 'that song never arrived — try it again' }, 400, origin)
    }
    if ('over' in read) return json({ error: 'that one is over 5 MB' }, 413, origin)
    const bytes = read.bytes

    const { data, error } = await supabase.rpc('chat_song_claim', {
      p_room: said.room,
      p_mime: said.mime,
      p_bytes: bytes.length,
      p_seconds: said.seconds,
      p_name: said.name,
    })
    if (error) return refused(error)
    const claim = (data as Claim[] | null)?.[0]
    if (!claim) return json({ error: 'that song could not be started' }, 500, origin)

    /**
     * ⚠️ FROM HERE A ROW EXISTS, AND EVERY WAY OUT BUT SUCCESS LETS IT GO: removed as the caller,
     * whatever may be at its key deleted, and marked gone once that is confirmed. Otherwise the
     * row would hold quota for an hour and the object would sit in the bucket billed.
     *
     * ⚠️ THE KEY IS THE CLAIM'S, NOT `chat_song_remove`'s ANSWER. The member may take the row down
     * from their list while this is running, and then the remove says "no such song" — while the
     * object written here is still there. And the DELETE is asked even when no PUT succeeded,
     * because a PUT that failed may still have landed (an answer lost after the store took it),
     * and a 404 counts as gone.
     */
    const fail = async (why: string, status: number) => {
      try {
        await supabase.rpc('chat_song_remove', { p_id: claim.id })
      } catch (e) {
        console.error('could not let a failed song go', claim.id, String(e))
      }
      if (await deleteObject(kit, claim.key)) await markGone(claim.id)
      return json({ error: why }, status, origin)
    }

    try {
      const verdict = verdictFor(said.mime, bytes)
      if (!verdict.ok) return await fail(verdict.why, 400)
      if (!(await putObject(kit, claim.key, bytes, verdict.mime))) {
        return await fail('the store would not take that song — try it again', 502)
      }
      /* the only way a song becomes ready: `chat_song_ready` is granted to service_role alone,
         and the owner is the caller as Auth named them, which the function checks against the row */
      const { error: badReady } = await service.rpc('chat_song_ready', {
        p_id: claim.id,
        p_owner: user.id,
      })
      if (badReady) return await fail(badReady.message, 400)
      return json({ id: claim.id }, 200, origin)
    } catch (e) {
      console.error('a song failed after its claim', claim.id, String(e))
      return await fail('that song didn’t go up — try it again', 500)
    }
  }

  const id = songId(body.id)

  /* ── listening: the RPC decides whether this person may hear it; this only signs ─────────── */
  if (op === 'play') {
    if (!id) return json({ error: 'which song?' }, 400, origin)
    const { data, error } = await supabase.rpc('chat_song_get', { p_id: id })
    if (error) return refused(error)
    const song = (data as Playable[] | null)?.[0]
    if (!song) return json({ error: 'no such song' }, 400, origin)
    return json({ url: await signGet(kit, song.key, GET_FOR) }, 200, origin)
  }

  /**
   * ── removing: the row is marked first, because its answer is what names the object ──────────
   *
   * ⚠️ A FAILED DELETE IN R2 IS NOT A FAILED REMOVE. The song is gone from the room the moment the
   * row is marked, so saying otherwise would invite a second press on a song that no longer
   * plays. And unlike `pictures`, where the row went first and the key with it, nothing is lost:
   * the row stays with `object_gone_at` empty, `chat_song_abandoned` hands it back, and the next
   * upload or remove deletes it. `orphaned` says the object is, for now, still there.
   */
  if (op === 'remove') {
    if (!id) return json({ error: 'which song?' }, 400, origin)
    await tidy()
    const { data, error } = await supabase.rpc('chat_song_remove', { p_id: id })
    if (error) return refused(error)
    const gone = typeof data === 'string' && (await deleteObject(kit, data))
    if (gone) await markGone(id)
    return json({ ok: true, orphaned: !gone }, 200, origin)
  }

  return json({ error: 'unknown op' }, 400, origin)
})
