import { createECDH } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  HEADER_BYTES,
  MAX_PLAINTEXT,
  RECORD_SIZE,
  VAPID_SUBJECT,
  b64u,
  deriveKeys,
  encrypt,
  notePayload,
  outcomeOf,
  privateKey,
  unb64u,
  vapidAuthorization,
  vapidKeysAgree,
} from './webpush'

/**
 * ⚠️ THE EXPECTATIONS ARE THE RFC'S, NOT THIS FILE'S. Every string below is copied from RFC 8291
 * (Appendix A, and the body printed in §5), fetched from rfc-editor.org on 22 Nov 2026, so a
 * mistake in webpush.ts cannot be agreed with here by a second copy of the same sum. The one
 * thing the RFC does not print is how to decrypt; `open` below does it from the browser's side
 * with Web Crypto's own HKDF, which shares no arithmetic with the module's HMAC-based one.
 */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  ecdhSecret: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  prkKey: 'Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k',
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  prk: '09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

const te = new TextEncoder()
const td = new TextDecoder()
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const

/** the RFC's sender key, as the module is handed one */
const rfcSender = async () => ({
  privateKey: await privateKey('ECDH', RFC.asPrivate, unb64u(RFC.asPublic)),
  publicRaw: unb64u(RFC.asPublic),
})

/** a browser's private key, imported here without the module's help */
const browserKey = (d: string, pub: Uint8Array<ArrayBuffer>) =>
  crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d,
      x: b64u(pub.slice(1, 33)),
      y: b64u(pub.slice(33, 65)),
    },
    P256,
    false,
    ['deriveBits'],
  )

/**
 * Decrypt a push body the way a browser does (RFC 8291 §3, RFC 8188 §2), with Web Crypto's HKDF.
 * It reads the header from the body rather than being told it, so a wrong record size or key id
 * in the module is a wrong header here.
 */
const open = async (
  body: Uint8Array<ArrayBuffer>,
  ua: CryptoKey,
  uaPublic: Uint8Array<ArrayBuffer>,
  auth: Uint8Array<ArrayBuffer>,
) => {
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0)
  const idlen = body[20]
  const keyid = body.slice(21, 21 + idlen)
  const sealed = body.slice(21 + idlen)
  const as = await crypto.subtle.importKey('raw', keyid, P256, false, [])
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: as }, ua, 256)
  const hkdf = (ikm: ArrayBuffer) =>
    crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const info = (...parts: ArrayLike<number>[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
  const ikm = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: auth,
      info: info(te.encode('WebPush: info\0'), uaPublic, keyid),
    },
    await hkdf(secret),
    256,
  )
  const prk = await hkdf(ikm)
  const cek = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('Content-Encoding: aes128gcm\0') },
    prk,
    128,
  )
  const nonce = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('Content-Encoding: nonce\0') },
    prk,
    96,
  )
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const padded = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, sealed),
  )
  return {
    rs,
    idlen,
    keyid,
    salt,
    delimiter: padded[padded.length - 1],
    plaintext: padded.slice(0, -1),
  }
}

/** a browser's subscription, freshly made, the way `pushManager.subscribe` would hold one */
const aBrowser = async () => {
  const pair = await crypto.subtle.generateKey(P256, true, ['deriveBits'])
  return {
    key: pair.privateKey,
    p256dh: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    auth: crypto.getRandomValues(new Uint8Array(16)),
  }
}

describe("RFC 8291's worked example, step by step", () => {
  it('copies the keys correctly: each public key in the RFC is its private key times G', () => {
    /* the transcription check: node:crypto's own EC arithmetic, nothing from the module */
    for (const [d, pub] of [
      [RFC.asPrivate, RFC.asPublic],
      [RFC.uaPrivate, RFC.uaPublic],
    ]) {
      const ec = createECDH('prime256v1')
      ec.setPrivateKey(Buffer.from(unb64u(d)))
      expect(b64u(new Uint8Array(ec.getPublicKey()))).toBe(pub)
    }
  })

  it('derives every intermediate value Appendix A prints', async () => {
    const k = await deriveKeys({
      asPrivate: (await rfcSender()).privateKey,
      asPublic: unb64u(RFC.asPublic),
      uaPublic: unb64u(RFC.uaPublic),
      authSecret: unb64u(RFC.authSecret),
      salt: unb64u(RFC.salt),
    })
    expect(b64u(k.ecdhSecret)).toBe(RFC.ecdhSecret)
    expect(b64u(k.prkKey)).toBe(RFC.prkKey)
    expect(b64u(k.ikm)).toBe(RFC.ikm)
    expect(b64u(k.prk)).toBe(RFC.prk)
    expect(b64u(k.cek)).toBe(RFC.cek)
    expect(b64u(k.nonce)).toBe(RFC.nonce)
  })

  it('produces the exact body RFC 8291 §5 prints', async () => {
    const body = await encrypt({
      plaintext: te.encode(RFC.plaintext),
      uaPublic: unb64u(RFC.uaPublic),
      authSecret: unb64u(RFC.authSecret),
      sender: await rfcSender(),
      salt: unb64u(RFC.salt),
    })
    expect(b64u(body)).toBe(RFC.body)
  })

  it('is a body the RFC’s browser can open, with a 4096 record size and the last-record delimiter', async () => {
    const opened = await open(
      unb64u(RFC.body),
      await browserKey(RFC.uaPrivate, unb64u(RFC.uaPublic)),
      unb64u(RFC.uaPublic),
      unb64u(RFC.authSecret),
    )
    expect(td.decode(opened.plaintext)).toBe(RFC.plaintext)
    expect(opened.rs).toBe(4096)
    expect(opened.delimiter).toBe(0x02)
    expect(b64u(opened.keyid)).toBe(RFC.asPublic)
  })
})

describe('a message as index.ts sends one', () => {
  it('opens for the browser it was sealed for, and only that one', async () => {
    const phone = await aBrowser()
    const words = 'Dad: are you coming for dinner? 🍝'
    const body = await encrypt({
      plaintext: te.encode(words),
      uaPublic: phone.p256dh,
      authSecret: phone.auth,
    })
    const opened = await open(body, phone.key, phone.p256dh, phone.auth)
    expect(td.decode(opened.plaintext)).toBe(words)
    expect(opened.rs).toBe(RECORD_SIZE)
    expect(opened.idlen).toBe(65)
    expect(opened.keyid[0]).toBe(0x04)
    expect(opened.delimiter).toBe(0x02)

    const someoneElse = await aBrowser()
    await expect(
      open(body, someoneElse.key, someoneElse.p256dh, someoneElse.auth),
    ).rejects.toThrow()
  })

  it('never reuses a sender key or a salt, so the same words seal differently every time', async () => {
    const phone = await aBrowser()
    const plaintext = te.encode('the same words')
    const a = await encrypt({ plaintext, uaPublic: phone.p256dh, authSecret: phone.auth })
    const b = await encrypt({ plaintext, uaPublic: phone.p256dh, authSecret: phone.auth })
    expect(b64u(a.slice(0, 16))).not.toBe(b64u(b.slice(0, 16))) // salt
    expect(b64u(a.slice(21, 86))).not.toBe(b64u(b.slice(21, 86))) // sender key
    for (const body of [a, b]) {
      expect(td.decode((await open(body, phone.key, phone.p256dh, phone.auth)).plaintext)).toBe(
        'the same words',
      )
    }
  })

  it('fills a push service’s 4096 octets exactly at the largest payload, and refuses one more', async () => {
    /* 4096 is RFC 8030's floor for what a push service must take; 3993 is RFC 8291 §4's own sum */
    expect(MAX_PLAINTEXT).toBe(3993)
    expect(HEADER_BYTES).toBe(86)
    const phone = await aBrowser()
    const most = await encrypt({
      plaintext: new Uint8Array(3993).fill(0x61),
      uaPublic: phone.p256dh,
      authSecret: phone.auth,
    })
    expect(most.length).toBe(4096)
    await expect(
      encrypt({ plaintext: new Uint8Array(3994), uaPublic: phone.p256dh, authSecret: phone.auth }),
    ).rejects.toThrow(/3993/)
  })

  it('refuses a subscription key that is not a P-256 point, or an auth secret that is not 16 octets', async () => {
    const phone = await aBrowser()
    const plaintext = te.encode('x')
    await expect(
      encrypt({ plaintext, uaPublic: phone.p256dh.slice(1), authSecret: phone.auth }),
    ).rejects.toThrow()
    await expect(
      encrypt({ plaintext, uaPublic: phone.p256dh, authSecret: phone.auth.slice(1) }),
    ).rejects.toThrow()
  })
})

describe('what the phone is told', () => {
  const row = {
    kind: 'message',
    title: 'Mum',
    body: 'Home by six',
    url: '#chat?room=dm:1',
    tag: 'chat:dm:1',
  }

  it('is the row as JSON when it fits, every field carried', () => {
    expect(JSON.parse(td.decode(notePayload(row)))).toEqual(row)
  })

  it('gives way in the body first, keeps the title, and still fits one message', () => {
    const long = { ...row, body: 'word '.repeat(2000) }
    const bytes = notePayload(long)
    expect(bytes.length).toBeLessThanOrEqual(3993)
    const out = JSON.parse(td.decode(bytes))
    expect(out.title).toBe('Mum')
    expect(out.url).toBe(row.url)
    expect(out.body.endsWith('…')).toBe(true)
    expect(out.body.length).toBeGreaterThan(3000) // cut to fit, not cut to nothing
  })

  it('fits a body JSON inflates sixfold, and one of characters outside the BMP', () => {
    /* a control character is one octet of text and six of JSON (\u0001); 🍝 is two UTF-16 units */
    for (const body of ['\u0001'.repeat(2000), '🍝'.repeat(2000)]) {
      const bytes = notePayload({ ...row, body })
      expect(bytes.length).toBeLessThanOrEqual(3993)
      const out = JSON.parse(td.decode(bytes)) // still valid JSON: no half of a surrogate pair
      expect(out.title).toBe('Mum')
    }
  })

  it('shortens the title only once the body is gone', () => {
    const out = JSON.parse(
      td.decode(notePayload({ ...row, title: 'T'.repeat(5000), body: 'b'.repeat(100) })),
    )
    expect(out.body).toBeNull()
    expect(out.title.endsWith('…')).toBe(true)
  })

  it('says so rather than sending something a push service will refuse', () => {
    expect(() => notePayload({ ...row, url: '#' + 'u'.repeat(4000) })).toThrow(/small enough/)
  })
})

describe('VAPID (RFC 8292)', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bExample'

  /** a fresh pair in the two forms the secrets will hold: the raw point and the raw scalar */
  const aPair = async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
    return {
      publicKey: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
      privateKey: jwk.d as string,
    }
  }

  const parse = (header: string) => {
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
    if (!m) throw new Error(`not a vapid header: ${header}`)
    const [, h, c, s, k] = m
    return {
      head: JSON.parse(td.decode(unb64u(h))),
      claims: JSON.parse(td.decode(unb64u(c))),
      signed: te.encode(`${h}.${c}`),
      sig: unb64u(s),
      k,
    }
  }

  it('is an ES256 JWT for the push service’s origin, under a day, from the site', async () => {
    const keys = await aPair()
    const now = 1_795_000_000
    const t = parse(await vapidAuthorization({ endpoint, ...keys, now }))
    expect(t.head).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(t.claims.aud).toBe('https://fcm.googleapis.com')
    expect(t.claims.exp).toBeGreaterThan(now)
    expect(t.claims.exp - now).toBeLessThanOrEqual(24 * 60 * 60)
    expect(t.claims.sub).toBe('https://evancook.dev')
    expect(VAPID_SUBJECT).toBe('https://evancook.dev')
    expect(t.k).toBe(keys.publicKey)
  })

  it('verifies with the public key it names, as a 64-octet r‖s, and not once tampered with', async () => {
    const keys = await aPair()
    const t = parse(await vapidAuthorization({ endpoint, ...keys }))
    /* JWS ES256 is r‖s, 64 octets (RFC 7518 §3.4); a DER signature would be 70-72 */
    expect(t.sig.length).toBe(64)
    const verifier = await crypto.subtle.importKey(
      'raw',
      unb64u(t.k),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const alg = { name: 'ECDSA', hash: 'SHA-256' }
    expect(await crypto.subtle.verify(alg, verifier, t.sig, t.signed)).toBe(true)
    const forged = te.encode(
      td.decode(t.signed).replace(/\.[\w-]+$/, `.${b64u(te.encode('{"aud":"x"}'))}`),
    )
    expect(await crypto.subtle.verify(alg, verifier, t.sig, forged)).toBe(false)
  })

  it('names the service, not the device: two phones on one service share an audience', async () => {
    const keys = await aPair()
    const other = 'https://fcm.googleapis.com/fcm/send/another-phone'
    const a = parse(await vapidAuthorization({ endpoint, ...keys })).claims.aud
    const b = parse(await vapidAuthorization({ endpoint: other, ...keys })).claims.aud
    expect(a).toBe(b)
    const moz = parse(
      await vapidAuthorization({
        endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAA',
        ...keys,
      }),
    ).claims.aud
    expect(moz).toBe('https://updates.push.services.mozilla.com')
  })

  /* ⚠️ UNDER NODE THE IMPORT IS WHAT SAYS NO, NOT THE SIGNATURE: Node 22 refuses a JWK whose d
     and x,y disagree, so `vapidKeysAgree`'s sign-and-verify half never decides anything here.
     Measured 22 Nov 2026 by making that half return true: this test stayed green. The half is
     kept for Deno, whose import was not measured, and is unexercised by this file. */
  it('knows when the two secrets are not one pair', async () => {
    const a = await aPair()
    const b = await aPair()
    expect(await vapidKeysAgree(a.publicKey, a.privateKey)).toBe(true)
    expect(await vapidKeysAgree(a.publicKey, b.privateKey)).toBe(false)
    expect(await vapidKeysAgree(a.publicKey, 'not a key')).toBe(false)
    expect(await vapidKeysAgree('', a.privateKey)).toBe(false)
  })
})

describe('what a push service’s answer means', () => {
  it('201 and 202 are delivered, 404 and 410 are gone, and everything else is tried again', () => {
    /* RFC 8030 §5 and §7.3; the rest are the answers a refused token, a rate limit, an oversized
       body, an outage and a redirect come back as — each one a retry, never a lost device */
    expect([201, 202].map(outcomeOf)).toEqual(['delivered', 'delivered'])
    expect([404, 410].map(outcomeOf)).toEqual(['gone', 'gone'])
    for (const status of [0, 200, 301, 400, 401, 403, 413, 429, 500, 502, 503]) {
      expect(outcomeOf(status)).toBe('failed')
    }
  })
})

describe('base64url', () => {
  it('reads what browsers and copy-pastes hand over: url-safe or plain, padded or not', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x10])
    expect(b64u(bytes)).toBe('-_-_ABA')
    for (const text of ['-_-_ABA', '+/+/ABA=', ' -_-_ABA \n']) {
      expect([...unb64u(text)]).toEqual([...bytes])
    }
  })
})
