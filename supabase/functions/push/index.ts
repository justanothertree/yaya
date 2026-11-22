/**
 * `push`: delivers what `push_outbox` holds to each member's phones, as Web Push.
 *
 * Step 2 of docs/2026-11-22-phone-alerts.md, on top of the SQL in
 * docs/2026-11-22-phone-alerts.DRAFT.sql. Deploy it as it is in git, this file and webpush.ts, and
 * then diff `get_edge_function` against both (CLAUDE.md §2).
 *
 *   POST { op: 'send' }   claim the rows that are due, seal each for each of its member's live
 *                         devices, POST them to the push services, and record what came back
 *
 * It answers `{ claimed, delivered, gone, failed }`, or `{ error }` with a status.
 *
 * ⚠️ IT NEEDS NO USER, AND THAT IS THE DESIGN RATHER THAN A GAP. `send` only delivers what the
 * database has already queued, once, to the members it was queued for: the SQL that saw the event
 * decided who is told and what they read, and nothing in the request can add a row, change one or
 * name a recipient. So the worst anybody holding the public anon key can do by calling it is
 * empty the queue a moment sooner. That is what lets the outbox trigger and the one-minute cron
 * call it with that key from pg_net, with no secret in the database.
 *
 * ⚠️ AND SO IT USES THE SERVICE ROLE FOR EVERYTHING, through four functions granted to nobody
 * else: `push_claim`, `push_done`, `push_device_ok`, `push_device_gone`. There is no caller whose
 * `auth.uid()` could stand in, and the subscription keys it needs are not something any member
 * may read. Every rule — who, when, how often, how many tries — lives in those functions.
 *
 * What is decided here is only the wire: the encryption and the VAPID token, which are in
 * webpush.ts so vitest can check them against RFC 8291's own worked example.
 *
 * Secrets (set with `supabase secrets set`, never in the bundle or the repository — §3):
 *   VAPID_PUBLIC_KEY   base64url, the 65-octet public point; the same string the client uses
 *   VAPID_PRIVATE_KEY  base64url, the 32-octet private scalar
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are the platform's own.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  encrypt,
  notePayload,
  outcomeOf,
  unb64u,
  vapidAuthorization,
  vapidKeysAgree,
} from './webpush.ts'

/* the same origins `pictures` allows, for the same reasons (see its notes). Nothing in a browser
   calls this today — pg_net sends no Origin — but an endpoint answers CORS one way across the
   project, so a page that ever does call it gets the house answer rather than a new one. */
const ALLOWED = [
  'https://evancook.dev',
  'https://www.evancook.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

/* ⚠️ ECHOED, NOT LISTED: supabase-js sends `apikey` and `x-client-info` as well, and a preflight
   missing any one of them fails before the POST is sent. `pictures` learned this the hard way. */
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

/**
 * Rows taken per call. ⚠️ BOUNDED BY THE LEASE IN `push_claim`: a claimed row is not offered
 * again for two minutes, so everything taken here must be sent well inside that, or an
 * overlapping call could take it a second time. Fifty rows, sent in parallel, each request cut off
 * at `PER_REQUEST_MS`, finish in seconds.
 */
const PER_CALL = 50
const PER_REQUEST_MS = 15_000

/**
 * Per kind: how long a push service may hold a message for a phone that is off (`TTL`, seconds),
 * and how hard to wake it (`Urgency`, RFC 8030 §5.3). ⚠️ A RING GETS A MINUTE: a call nobody can
 * answer by then is not a call any more, and a phone switched on an hour later should not ring.
 */
const DELIVERY: Record<string, { ttl: number; urgency: 'high' | 'normal' }> = {
  ring: { ttl: 60, urgency: 'high' },
  message: { ttl: 24 * 3600, urgency: 'high' },
  chronicle: { ttl: 3600, urgency: 'high' },
  test: { ttl: 600, urgency: 'high' },
  post: { ttl: 24 * 3600, urgency: 'normal' },
  challenge: { ttl: 24 * 3600, urgency: 'normal' },
}

type Device = { id: string; endpoint: string; p256dh: string; auth: string }
type Row = {
  id: number
  kind: string
  title: string
  body: string | null
  url: string | null
  tag: string | null
  attempts: number
  devices: Device[]
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

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'that was not json' }, 400, origin)
  }
  if (body?.op !== 'send') return json({ error: 'unknown op' }, 400, origin)

  /* ⚠️ BEFORE ANYTHING IS CLAIMED. A claim counts an attempt and starts a lease, so a function that
     claimed and then found it could not sign would spend every row's tries on a missing secret.
     Answered here, the rows stay exactly as they were until the secret exists. Trimmed for the
     reason `pictures` gives: a pasted secret once carried a newline nothing displayed. */
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')?.trim()
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')?.trim()
  if (!publicKey || !privateKey) {
    return json({ error: 'phone alerts are not configured' }, 503, origin)
  }
  if (!(await vapidKeysAgree(publicKey, privateKey))) {
    return json({ error: 'the two VAPID keys are not one pair' }, 503, origin)
  }
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) return json({ error: 'this project cannot send alerts yet' }, 503, origin)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
    auth: { persistSession: false },
  })

  const { data, error } = await db.rpc('push_claim', { p_limit: PER_CALL })
  if (error) return json({ error: error.message }, 500, origin)
  const rows = (data ?? []) as Row[]

  /* one token per push service per call: the audience is the service, not the phone (webpush.ts) */
  const tokens = new Map<string, Promise<string>>()
  const authFor = (endpoint: string) => {
    const aud = new URL(endpoint).origin
    if (!tokens.has(aud)) tokens.set(aud, vapidAuthorization({ endpoint, publicKey, privateKey }))
    return tokens.get(aud)!
  }

  const tally = { claimed: rows.length, delivered: 0, gone: 0, failed: 0 }

  /** one device: what its push service said, as the database needs to hear it */
  const deliver = async (d: Device, plaintext: Uint8Array, how: (typeof DELIVERY)[string]) => {
    const res = await fetch(d.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await authFor(d.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(how.ttl),
        Urgency: how.urgency,
      },
      body: await encrypt({ plaintext, uaPublic: unb64u(d.p256dh), authSecret: unb64u(d.auth) }),
      signal: AbortSignal.timeout(PER_REQUEST_MS),
      /* ⚠️ NOT FOLLOWED. `push_device_add` checked this address against the push services before
         storing it, and that check is the only thing standing between a member and "make the
         server POST somewhere". A redirect would send the request to an address nothing checked,
         so it is recorded as the failure it is. */
      redirect: 'manual',
    })
    const outcome = outcomeOf(res.status)
    if (outcome === 'delivered') {
      await res.body?.cancel()
      tally.delivered++
      await db.rpc('push_device_ok', { p_id: d.id })
      return null
    }
    /* marked gone rather than deleted, so nothing in this system deletes rows; and not an error for
       the row, because the member's other devices may well have had it (webpush.ts says why) */
    if (outcome === 'gone') {
      await res.body?.cancel()
      tally.gone++
      await db.rpc('push_device_gone', { p_id: d.id })
      return null
    }
    tally.failed++
    /* the service's own sentence, briefly: FCM says which of VAPID, size or rate it disliked. The
       host rather than the endpoint, because the endpoint is the one secret a device has. */
    const said = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120)
    return `${res.status} from ${new URL(d.endpoint).host}${said ? `: ${said}` : ''}`
  }

  await Promise.all(
    rows.map(async (row) => {
      let plaintext: Uint8Array
      try {
        plaintext = notePayload(row)
      } catch (e) {
        tally.failed++
        await db.rpc('push_done', { p_id: row.id, p_error: String(e).slice(0, 500) })
        return
      }
      const how = DELIVERY[row.kind] ?? { ttl: 3600, urgency: 'normal' }
      const errors = (
        await Promise.all(
          row.devices.map((d) =>
            deliver(d, plaintext, how).catch((e) => {
              tally.failed++
              return String(e).slice(0, 200)
            }),
          ),
        )
      ).filter((e): e is string => e !== null)
      /**
       * ⚠️ ONE FAILED DEVICE KEEPS THE ROW FOR ANOTHER TRY, EVEN IF ANOTHER DEVICE HAD IT. Marking
       * it sent would lose the alert for the phone that missed it; retrying sends it again to the
       * phone that did not. The second is harmless by construction: `sw.js` shows every alert
       * under its `tag`, and a notification replacing one with the same tag does not sound again.
       * A row with no live device at all is done — there is nobody left to tell.
       */
      await db.rpc('push_done', {
        p_id: row.id,
        p_error: errors.length ? errors.join('; ').slice(0, 500) : null,
      })
    }),
  )

  return json(tally, 200, origin)
})
