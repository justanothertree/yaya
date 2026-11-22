/**
 * Web Push by hand: RFC 8291 message encryption and RFC 8292 VAPID, on WebCrypto and nothing else.
 *
 * ⚠️ PURE, AND THAT IS WHY IT IS ITS OWN FILE. `index.ts` needs a deployed runtime, the service
 * key and a real push service before a line of it runs, and a deploy sends the whole file as one
 * argument with no diff to look at (CLAUDE.md §2). Everything here can be asked a question from
 * vitest instead: Node 22's `globalThis.crypto.subtle` is the same Web Crypto API Deno has, so the
 * code that runs in the function is the code the test runs. It imports nothing, from `src/` or
 * anywhere else, so it deploys as it is.
 *
 * ⚠️ NO web-push LIBRARY, ON PURPOSE. The npm one is built on Node's `crypto` module and its
 * `https` agent; under Deno that is a compatibility layer between this file and the one thing it
 * must get exactly right. The whole job is ECDH, two HKDFs, one AES-GCM and one ECDSA signature,
 * and RFC 8291 prints every intermediate value of a worked example, so it can be checked step by
 * step (webpush.test.ts does) rather than trusted.
 */

const te = new TextEncoder()

/** the record size every message here declares: RFC 8291 §4 has application servers use 4096 */
export const RECORD_SIZE = 4096
/** salt (16) + rs (4) + idlen (1) + keyid, the sender's public point (65) */
export const HEADER_BYTES = 86
/**
 * ⚠️ THE LARGEST PAYLOAD A PUSH SERVICE MUST TAKE, AND THE RFC'S OWN NUMBER. A push service need
 * not accept a body over 4096 octets; less the header, the one-octet 0x02 delimiter and the
 * 16-octet GCM tag, that leaves 3993 octets of plaintext (RFC 8291 §4). Bigger is not an error a
 * push service owes anybody a sentence about, so it is refused here, before anything is sent.
 */
export const MAX_PLAINTEXT = RECORD_SIZE - HEADER_BYTES - 1 - 16

/** who a push service is told to complain to: the site, not an inbox (docs/2026-11-22-phone-alerts.md) */
export const VAPID_SUBJECT = 'https://evancook.dev'
/** seconds a VAPID token is good for. RFC 8292 §2 allows at most 24 hours; half that leaves a
    push service's clock a long way to be wrong in before a token reads as expired */
export const VAPID_LIFETIME = 12 * 60 * 60

// ── bytes ──────────────────────────────────────────────────────────────────────────────────

/** base64url with no padding, which is what both RFCs and `PushSubscription.toJSON()` use */
export const b64u = (bytes: Uint8Array): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** reads base64url or plain base64, padded or not: browsers and copy-pastes hand over both */
export const unb64u = (text: string): Uint8Array<ArrayBuffer> => {
  const std = text.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const concat = (...parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const copy = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => concat(bytes)

// ── HKDF, written as RFC 8291 writes it ───────────────────────────────────────────────────

/**
 * ⚠️ HMAC RATHER THAN WebCrypto's HKDF, SO EVERY STEP CAN BE ASKED. `deriveBits({ name: 'HKDF' })`
 * goes from input keying material to output in one call, and RFC 8291's example prints the
 * pseudorandom key in between (`PRK_key`, `PRK`). Written as extract and expand, each of those is
 * a value the test compares — and the test's own decryption uses WebCrypto's HKDF, so the two
 * paths share no arithmetic. Every output here is at most 32 octets, so expand is one HMAC block.
 */
const hmac = async (key: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> => {
  const k = await crypto.subtle.importKey(
    'raw',
    copy(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, copy(data)))
}

export const hkdfExtract = (salt: Uint8Array, ikm: Uint8Array) => hmac(salt, ikm)

export const hkdfExpand = async (prk: Uint8Array, info: Uint8Array, length: number) => {
  if (length > 32) throw new Error('one HMAC-SHA-256 block holds 32 octets')
  return (await hmac(prk, concat(info, [0x01]))).slice(0, length)
}

// ── keys ──────────────────────────────────────────────────────────────────────────────────

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const

/** an uncompressed P-256 point: 0x04, then x and y, 32 octets each */
const isPoint = (raw: Uint8Array) => raw.length === 65 && raw[0] === 0x04

/**
 * A private key as Web Crypto will take it. ⚠️ A JWK NEEDS THE PUBLIC POINT AS WELL AS THE
 * SCALAR, and Web Crypto will not import a bare P-256 scalar any other way — so every private
 * key here travels with its public half, which is how a VAPID pair is stored anyway.
 */
export const privateKey = (
  algorithm: 'ECDH' | 'ECDSA',
  d: string,
  publicRaw: Uint8Array,
): Promise<CryptoKey> => {
  if (!isPoint(publicRaw)) throw new Error('a P-256 public key is 65 octets starting 0x04')
  if (unb64u(d).length !== 32) throw new Error('a P-256 private key is 32 octets')
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: b64u(unb64u(d)),
      x: b64u(publicRaw.slice(1, 33)),
      y: b64u(publicRaw.slice(33, 65)),
      ext: false,
    },
    { name: algorithm, namedCurve: 'P-256' },
    false,
    algorithm === 'ECDH' ? ['deriveBits'] : ['sign'],
  )
}

// ── RFC 8291: the message ─────────────────────────────────────────────────────────────────

/** every value RFC 8291's Appendix A prints, so each can be compared on its own */
export type Derived = {
  ecdhSecret: Uint8Array
  prkKey: Uint8Array
  keyInfo: Uint8Array
  ikm: Uint8Array
  prk: Uint8Array
  cek: Uint8Array
  nonce: Uint8Array
}

export const deriveKeys = async (k: {
  /** the sender's (application server's) private half, for this one message */
  asPrivate: CryptoKey
  asPublic: Uint8Array
  /** the subscription's `p256dh` */
  uaPublic: Uint8Array
  /** the subscription's `auth` */
  authSecret: Uint8Array
  salt: Uint8Array
}): Promise<Derived> => {
  const ua = await crypto.subtle.importKey('raw', copy(k.uaPublic), P256, false, [])
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: ua }, k.asPrivate, 256),
  )
  // RFC 8291 §3.3-3.4: the auth secret and both public keys go into the input keying material
  const prkKey = await hkdfExtract(k.authSecret, ecdhSecret)
  const keyInfo = concat(te.encode('WebPush: info'), [0x00], k.uaPublic, k.asPublic)
  const ikm = await hkdfExpand(prkKey, keyInfo, 32)
  // RFC 8188 §2.2-2.3: the content-encryption key and nonce, salted per message
  const prk = await hkdfExtract(k.salt, ikm)
  const cek = await hkdfExpand(prk, concat(te.encode('Content-Encoding: aes128gcm'), [0x00]), 16)
  const nonce = await hkdfExpand(prk, concat(te.encode('Content-Encoding: nonce'), [0x00]), 12)
  return { ecdhSecret, prkKey, keyInfo, ikm, prk, cek, nonce }
}

/**
 * One push message body, `Content-Encoding: aes128gcm`, for one browser's subscription.
 *
 * `sender` and `salt` exist so RFC 8291's example can be reproduced exactly. Left out, as they
 * always are in `index.ts`, each message gets a fresh key pair and a fresh random salt — RFC 8291
 * §4 forbids reusing either, because the same key and nonce twice under AES-GCM gives the
 * plaintexts away.
 */
export const encrypt = async (m: {
  plaintext: Uint8Array
  uaPublic: Uint8Array
  authSecret: Uint8Array
  sender?: { privateKey: CryptoKey; publicRaw: Uint8Array }
  salt?: Uint8Array
}): Promise<Uint8Array<ArrayBuffer>> => {
  if (m.plaintext.length > MAX_PLAINTEXT) {
    throw new Error(`a push message holds at most ${MAX_PLAINTEXT} octets (${m.plaintext.length})`)
  }
  if (!isPoint(m.uaPublic)) throw new Error('the subscription key is not a P-256 point')
  if (m.authSecret.length !== 16) throw new Error('the subscription auth secret is not 16 octets')

  let sender = m.sender
  if (!sender) {
    const pair = await crypto.subtle.generateKey(P256, true, ['deriveBits'])
    sender = {
      privateKey: pair.privateKey,
      publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    }
  }
  const salt = m.salt ?? crypto.getRandomValues(new Uint8Array(16))
  if (salt.length !== 16) throw new Error('the salt is 16 octets')

  const { cek, nonce } = await deriveKeys({
    asPrivate: sender.privateKey,
    asPublic: sender.publicRaw,
    uaPublic: m.uaPublic,
    authSecret: m.authSecret,
    salt,
  })
  const key = await crypto.subtle.importKey('raw', copy(cek), 'AES-GCM', false, ['encrypt'])
  /* ⚠️ ONE RECORD, AND 0x02 MARKS IT THE LAST (RFC 8188 §2): a push message is a single record,
     and a 0x01 delimiter would tell the browser more records follow, which it then rejects */
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: copy(nonce), tagLength: 128 },
    key,
    concat(m.plaintext, [0x02]),
  )
  const rs = [
    (RECORD_SIZE >>> 24) & 0xff,
    (RECORD_SIZE >>> 16) & 0xff,
    (RECORD_SIZE >>> 8) & 0xff,
    RECORD_SIZE & 0xff,
  ]
  return concat(salt, rs, [sender.publicRaw.length], sender.publicRaw, new Uint8Array(sealed))
}

// ── what the phone is told ────────────────────────────────────────────────────────────────

/** one outbox row, as `public/sw.js` reads it */
export type Note = {
  kind: string
  title: string
  body?: string | null
  url?: string | null
  tag?: string | null
}

/** shorter by at least `over` octets: every character removed is at least one and the … is three */
const shorten = (text: string, over: number): string => {
  const chars = Array.from(text)
  const keep = chars.length - over - 3
  return keep > 0 ? chars.slice(0, keep).join('') + '…' : '…'
}

/**
 * The plaintext for one alert, cut down until it fits one push message.
 *
 * ⚠️ THE BODY GIVES WAY FIRST AND THE TITLE ONLY AFTER IT IS GONE. The outbox's own limits keep a
 * row well under 3993 octets of plain text, but JSON escapes a control character as six octets,
 * so the worst row the table accepts is not the worst payload — and a message that does not fit
 * is one the phone never sees, which is worse than a sentence that ends in "…".
 */
export const notePayload = (note: Note): Uint8Array<ArrayBuffer> => {
  let title = note.title
  let body = note.body ?? null
  for (;;) {
    const bytes = te.encode(
      JSON.stringify({
        kind: note.kind,
        title,
        body,
        url: note.url ?? null,
        tag: note.tag ?? null,
      }),
    )
    const over = bytes.length - MAX_PLAINTEXT
    if (over <= 0) return copy(bytes)
    if (body && body.length > 1) body = shorten(body, over)
    else if (body) body = null
    else if (title.length > 1) title = shorten(title, over)
    else throw new Error('this alert cannot be made small enough to send')
  }
}

// ── what a push service's answer means ────────────────────────────────────────────────────

/**
 * One device's answer, as the database needs to hear it. Here rather than in `index.ts` so the
 * rule can be asked without a push service (CLAUDE.md §2: move the decision out).
 *
 *   delivered  201 or 202: the service took it (RFC 8030 §5) → `push_device_ok`
 *   gone       404 or 410: the subscription is over for good (RFC 8030 §7.3) → `push_device_gone`
 *   failed     anything else, a refused token, a rate limit or an outage → kept for another try
 *
 * ⚠️ GONE IS NOT A FAILURE OF THE ALERT. The phone unsubscribed or its app data was cleared, so
 * there is nothing to retry; retrying would spend the row's tries on a device that cannot answer.
 */
export type Outcome = 'delivered' | 'gone' | 'failed'
export const outcomeOf = (status: number): Outcome =>
  status === 201 || status === 202
    ? 'delivered'
    : status === 404 || status === 410
      ? 'gone'
      : 'failed'

// ── RFC 8292: VAPID ───────────────────────────────────────────────────────────────────────

/**
 * ⚠️ THE AUDIENCE IS THE PUSH SERVICE'S ORIGIN, NOT THE DEVICE'S URL (RFC 8292 §2). The endpoint
 * is per browser; the token is per service, so one token serves every Pixel FCM knows about and a
 * token naming the full endpoint is refused.
 */
export const audienceOf = (endpoint: string): string => new URL(endpoint).origin

const jsonPart = (value: unknown) => b64u(te.encode(JSON.stringify(value)))

/**
 * The `Authorization` header for one push service: `vapid t=<ES256 JWT>, k=<public key>`.
 *
 * Web Crypto's ECDSA signature is already the 64-octet r‖s that JWS ES256 wants (RFC 7518 §3.4),
 * so there is no DER to unpick. `now` is seconds, and exists for the test.
 */
export const vapidAuthorization = async (v: {
  endpoint: string
  publicKey: string
  privateKey: string
  now?: number
}): Promise<string> => {
  const publicRaw = unb64u(v.publicKey)
  const signer = await privateKey('ECDSA', v.privateKey, publicRaw)
  const now = Math.floor(v.now ?? Date.now() / 1000)
  const unsigned = `${jsonPart({ typ: 'JWT', alg: 'ES256' })}.${jsonPart({
    aud: audienceOf(v.endpoint),
    exp: now + VAPID_LIFETIME,
    sub: VAPID_SUBJECT,
  })}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signer,
    te.encode(unsigned),
  )
  return `vapid t=${unsigned}.${b64u(new Uint8Array(sig))}, k=${b64u(publicRaw)}`
}

/**
 * Whether the two VAPID secrets are halves of ONE key pair.
 *
 * ⚠️ A MISMATCHED PAIR FAILS AT THE PUSH SERVICE, ONE MESSAGE AT A TIME, FOR EVER. Every service
 * answers 403 to a token its `k=` cannot verify, and `index.ts` would record that as a retryable
 * error on every row until each ran out of attempts. Asked once up front, a pasted-wrong secret is
 * one sentence instead of a stuck queue.
 *
 * ⚠️ BOTH WAYS, IMPORT AND SIGNATURE, because where the mismatch shows depends on the runtime.
 * Node 22 refuses the JWK at import ("Invalid keyData", measured 22 Nov 2026); Deno's import was
 * not measured, so a sign-and-verify round trip is asked as well rather than trusting either.
 */
export const vapidKeysAgree = async (
  publicKey: string,
  privateKeyText: string,
): Promise<boolean> => {
  try {
    const publicRaw = unb64u(publicKey)
    const signer = await privateKey('ECDSA', privateKeyText, publicRaw)
    const verifier = await crypto.subtle.importKey(
      'raw',
      publicRaw,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const probe = te.encode('do these belong together')
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, probe)
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, sig, probe)
  } catch {
    return false
  }
}
