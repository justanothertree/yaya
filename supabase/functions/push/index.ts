/**
 * `push`: delivers what `push_outbox` holds to each member's phones, as Web Push.
 *
 * Step 2 of docs/2026-11-22-phone-alerts.md, on top of the SQL in
 * docs/2026-11-22-phone-alerts.DRAFT.sql. Deploy it as it is in git, this file and webpush.ts, and
 * then diff `get_edge_function` against both (CLAUDE.md §2).
 *
 *   POST { op: 'send' }   claim the rows that are due, seal each for each of its member's devices
 *                         still waiting for it, POST them to the push services, and record what
 *                         came back, device by device
 *
 * It answers `{ ok: true }`, or `{ error: 'not sent' }` with a status. Nothing more, on purpose:
 * see the next note.
 *
 * ⚠️ IT NEEDS NO USER, AND THAT IS THE DESIGN RATHER THAN A GAP. `send` only delivers what the
 * database has already queued, once, to the members it was queued for: the SQL that saw the event
 * decided who is told and what they read, and nothing in the request can add a row, change one or
 * name a recipient. So the worst anybody holding the public anon key can do by calling it is
 * empty the queue a moment sooner. That is what lets the outbox trigger and the one-minute cron
 * call it with that key from pg_net, with no secret in the database.
 *
 * ⚠️ AND SO IT TELLS ITS CALLER NOTHING. The caller is anybody with the anon key, which is in every
 * page of the site. The first version answered with its tally — how many alerts were claimed,
 * delivered, refused — and with the database's own error message, which together say how busy the
 * queue is and how the function is failing to anyone who asks. pg_net reads none of it. Every
 * figure and every reason goes to the function's log instead (`console`), which only the
 * project's owner can read — and even there without an endpoint or a key.
 *
 * ⚠️ AND IT USES THE SERVICE ROLE FOR EVERYTHING, through five functions granted to nobody else:
 * `push_claim`, `push_delivery`, `push_device_gone`, `push_done` and `push_expire`. There is no
 * caller whose `auth.uid()` could stand in, and the subscription keys it needs are not something
 * any member may read. Every rule — who, when, how often, how many tries, when a row is finished —
 * lives in those functions.
 *
 * What is decided here is only the wire: the encryption, the VAPID token, the TTL and what each
 * answer means, which are in webpush.ts so vitest can check them without a push service.
 *
 * Secrets (set with `supabase secrets set`, never in the bundle or the repository — §3):
 *   VAPID_PUBLIC_KEY   base64url, the 65-octet public point; the same string the client uses
 *   VAPID_PRIVATE_KEY  base64url, the 32-octet private scalar
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are the platform's own.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  deliveryFor,
  encrypt,
  failureNote,
  notePayload,
  outcomeOf,
  serviceSaid,
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
 * The one failure a caller hears about, whatever it was. The reason is logged beside it, so the
 * secret step can still tell "not configured" from "the keys are not a pair" — by reading the
 * log, not the response. It is still a sentence only this function says, which is what tells it
 * apart from the gateway's own 401 (CLAUDE.md §2).
 */
const notSent = (why: string, origin: string | null) => {
  console.error(`push: not sent: ${why}`)
  return json({ error: 'not sent' }, 503, origin)
}

/**
 * Rows taken per call. ⚠️ BOUNDED BY THE LEASE IN `push_claim`: a claimed row is not offered
 * again for two minutes, so everything taken here must be sent well inside that, or an
 * overlapping call could take it a second time. Fifty rows, sent in parallel, each request cut off
 * at `PER_REQUEST_MS`, finish in seconds.
 */
const PER_CALL = 50
const PER_REQUEST_MS = 15_000

type Device = { id: string; endpoint: string; p256dh: string; auth: string }
type Row = {
  id: number
  kind: string
  title: string
  body: string | null
  url: string | null
  tag: string | null
  attempts: number
  /** seconds since the row became due, on the database's clock */
  age: number
  /** the member's live devices that have neither taken this row nor refused it for good */
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
  if (!publicKey || !privateKey) return notSent('phone alerts are not configured', origin)
  if (!(await vapidKeysAgree(publicKey, privateKey))) {
    return notSent('the two VAPID keys are not one pair', origin)
  }
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) return notSent('no service role key', origin)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
    auth: { persistSession: false },
  })

  /** a service door, whose refusal is logged rather than lost — there is nobody else to tell */
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await db.rpc(fn, args)
    if (error) console.error(`push: ${fn} failed: ${error.message}`)
  }

  const { data, error } = await db.rpc('push_claim', { p_limit: PER_CALL })
  if (error) return notSent(`push_claim: ${error.message}`, origin)
  const rows = (data ?? []) as Row[]

  /* one token per push service per call: the audience is the service, not the phone (webpush.ts) */
  const tokens = new Map<string, Promise<string>>()
  const authFor = (endpoint: string) => {
    const aud = new URL(endpoint).origin
    if (!tokens.has(aud)) tokens.set(aud, vapidAuthorization({ endpoint, publicKey, privateKey }))
    return tokens.get(aud)!
  }

  const tally = { claimed: rows.length, delivered: 0, gone: 0, refused: 0, retry: 0, expired: 0 }

  /**
   * One device, and what its push service said, recorded for THAT DEVICE as soon as it is known.
   * Returns the note to keep in the row's `last_error`, or null when there is nothing to say.
   *
   * ⚠️ RECORDED HERE, NOT AFTER THE LAST DEVICE ANSWERS. A device that took the alert is never
   * offered that row again (`push_claim` leaves it out), and that only holds if the record exists
   * before anything else can go wrong — a function cut off between a 201 and the end of the row
   * would otherwise send the same alert to the same phone on the retry.
   */
  const deliver = async (
    row: Row,
    d: Device,
    plaintext: Uint8Array,
    how: ReturnType<typeof deliveryFor>,
  ): Promise<string | null> => {
    let sealed: Uint8Array<ArrayBuffer>
    try {
      sealed = await encrypt({ plaintext, uaPublic: unb64u(d.p256dh), authSecret: unb64u(d.auth) })
    } catch (e) {
      /* keys the table's shape check let through but that are not a point on the curve: the same
         keys will fail the same way next time, so this device is done with this row */
      const note = failureNote(d.endpoint, e)
      tally.refused++
      console.warn(`push: row ${row.id}, device ${d.id}: could not seal (${note})`)
      await call('push_delivery', { p_outbox: row.id, p_device: d.id, p_error: note })
      return note
    }
    let res: Response
    try {
      res = await fetch(d.endpoint, {
        method: 'POST',
        headers: {
          Authorization: await authFor(d.endpoint),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(how.ttl),
          Urgency: how.urgency,
        },
        body: sealed,
        signal: AbortSignal.timeout(PER_REQUEST_MS),
        /* ⚠️ NOT FOLLOWED. `push_device_add` checked this address against the push services before
           storing it, and that check is the only thing standing between a member and "make the
           server POST somewhere". A redirect would send the request to an address nothing checked,
           so it is recorded as the failure it is. */
        redirect: 'manual',
      })
    } catch (e) {
      /* a timeout or a dropped connection: worth another try, for this device only */
      const note = failureNote(d.endpoint, e)
      tally.retry++
      console.warn(`push: row ${row.id}, device ${d.id}: ${note}`)
      return note
    }
    const outcome = outcomeOf(res.status)
    if (outcome === 'delivered') {
      await res.body?.cancel()
      tally.delivered++
      await call('push_delivery', { p_outbox: row.id, p_device: d.id })
      return null
    }
    /* marked gone rather than deleted, so nothing in this system deletes rows; and not an error for
       the row, because a device that is gone is no longer one of the member's devices at all */
    if (outcome === 'gone') {
      await res.body?.cancel()
      tally.gone++
      await call('push_device_gone', { p_id: d.id })
      return null
    }
    const note = failureNote(d.endpoint, res.status)
    const said = serviceSaid(await res.text().catch(() => ''), d.endpoint)
    console.warn(`push: row ${row.id}, device ${d.id}: ${note}${said ? `: ${said}` : ''}`)
    if (outcome === 'final') {
      tally.refused++
      await call('push_delivery', { p_outbox: row.id, p_device: d.id, p_error: note })
    } else {
      tally.retry++
    }
    return note
  }

  await Promise.all(
    rows.map(async (row) => {
      /* nobody left waiting — every device took it, refused it, or went — so the row is finished,
         and push_done says so from what the database holds rather than from anything said here */
      if (row.devices.length === 0) {
        await call('push_done', { p_id: row.id, p_error: null })
        return
      }
      const how = deliveryFor(row.kind, row.age)
      if (how.ttl <= 0) {
        tally.expired++
        await call('push_expire', { p_id: row.id })
        return
      }
      let plaintext: Uint8Array
      try {
        plaintext = notePayload(row)
      } catch (e) {
        /* the outbox's own limits make this unreachable, so it is left to fail loudly: kept for
           another try, and after five `push_stuck` counts it. The note is webpush.ts's own
           sentence, never anything from a device. */
        tally.refused++
        await call('push_done', {
          p_id: row.id,
          p_error: (e instanceof Error ? e.message : 'the alert would not fit').slice(0, 500),
        })
        return
      }
      const notes = (
        await Promise.all(row.devices.map((d) => deliver(row, d, plaintext, how)))
      ).filter((e): e is string => e !== null)
      /**
       * ⚠️ push_done DECIDES WHETHER THE ROW IS FINISHED, FROM THE DEVICES, NOT FROM THESE NOTES.
       * A row is sent once every live device of its member has taken it or refused it for good;
       * a device that met a 429 or a 5xx is still waiting, and is the only one the retry goes to.
       * The notes are only what `last_error` says about this try.
       */
      await call('push_done', {
        p_id: row.id,
        p_error: notes.length ? notes.join('; ').slice(0, 500) : null,
      })
    }),
  )

  console.log(`push: ${JSON.stringify(tally)}`)
  return json({ ok: true }, 200, origin)
})
