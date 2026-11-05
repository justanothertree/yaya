/**
 * The Lab's lava lamp: a handful of blobs, simulated here because there are only a handful —
 * the GPU's job is drawing them as one gooey surface, which is the expensive part (every pixel
 * asks every blob). Pure, so the thing a lava lamp is FOR can be tested: wax that heats at the
 * bottom, rises, cools at the top and sinks again.
 *
 * Space: x runs 0..1 across the lamp, y 0 (top) to 1 (bottom). A blob's radius is in units of
 * the lamp's HEIGHT, so it is round whatever the lamp's shape; `aspect` (width / height) turns it
 * into x units where that matters.
 */

export type Blob = { x: number; y: number; vx: number; vy: number; r: number; heat: number }

/** Hand-packed to match `struct Lava` in lava.wgsl — lava.test.ts lays it out from the shader. */
export const LAVA = { aspect: 0, count: 4, time: 8, scheme: 12, bytes: 16 } as const

export function packLava(
  p: { aspect: number; count: number; time: number; scheme: number },
  into = new ArrayBuffer(LAVA.bytes),
): ArrayBuffer {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  f[LAVA.aspect / 4] = p.aspect
  u[LAVA.count / 4] = p.count
  f[LAVA.time / 4] = p.time
  u[LAVA.scheme / 4] = p.scheme
  return into
}

/** as many blobs as the lamp will hold; the shader's loop and the storage buffer are this size */
export const MAX_BLOBS = 16

/** Blobs as the shader reads them: x, y, r, heat — four floats each. */
export function packBlobs(blobs: readonly Blob[], into = new Float32Array(MAX_BLOBS * 4)) {
  into.fill(0)
  blobs.slice(0, MAX_BLOBS).forEach((b, i) => into.set([b.x, b.y, b.r, b.heat], i * 4))
  return into
}

/** A tiny deterministic random, so a lamp — and a test — can be started the same way twice. */
export function seeded(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

/** A fresh lamp: wax mostly pooled at the bottom, cool, at rest. */
export function fill(count: number, rand = Math.random): Blob[] {
  return Array.from({ length: Math.min(count, MAX_BLOBS) }, () => ({
    x: 0.15 + rand() * 0.7,
    y: 0.55 + rand() * 0.4,
    vx: 0,
    vy: 0,
    r: 0.05 + rand() * 0.045,
    heat: rand() * 0.5,
  }))
}

/** what a lamp's bulb and its own walls do; `power` is the bulb, 0..2 */
export type LampOpts = { aspect: number; power: number; time: number }

/**
 * One step of the lamp, in place.
 *
 * The bulb heats wax in the bottom quarter; everything cools, faster towards the top. Warm wax is
 * lighter than the liquid round it and cool wax heavier — so heat becomes lift, which is the whole
 * lamp. Drag stops it running away, and a slow sideways drift keeps two blobs from rising in
 * lock-step forever.
 */
export function stepLamp(blobs: Blob[], dt: number, o: LampOpts) {
  if (dt <= 0) return
  blobs.forEach((b, i) => {
    const bottom = Math.max(0, (b.y - 0.75) / 0.25)
    b.heat += dt * o.power * bottom * 0.9
    // cooling is mostly a thing of the top: wax rising through the warm middle keeps its heat
    b.heat -= dt * b.heat * (0.05 + 0.6 * (1 - b.y) ** 2)
    b.heat = Math.min(1, Math.max(0, b.heat))
    // lift: warm wax rises (y falls), cool wax sinks
    b.vy -= (b.heat - 0.4) * 1.1 * dt
    b.vx += Math.sin(o.time * 0.37 + i * 2.1) * 0.012 * dt
    const drag = Math.exp(-dt * 1.1)
    b.vx *= drag
    b.vy *= drag
    b.x += b.vx * dt
    b.y += b.vy * dt
  })
  // wax keeps a little apart, so the lamp does not collapse into one lump
  for (let i = 0; i < blobs.length; i++)
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i]
      const b = blobs[j]
      const dx = (b.x - a.x) * o.aspect
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy) || 1e-6
      const want = (a.r + b.r) * 0.7
      if (d >= want) continue
      const push = ((want - d) / d) * 0.5 * Math.min(1, dt * 6)
      a.x -= (dx * push) / o.aspect
      a.y -= dy * push
      b.x += (dx * push) / o.aspect
      b.y += dy * push
    }
  // the glass
  for (const b of blobs) {
    const rx = b.r / o.aspect
    if (b.x < rx) [b.x, b.vx] = [rx, Math.abs(b.vx) * 0.4]
    if (b.x > 1 - rx) [b.x, b.vx] = [1 - rx, -Math.abs(b.vx) * 0.4]
    if (b.y < b.r) [b.y, b.vy] = [b.r, Math.abs(b.vy) * 0.3]
    if (b.y > 1 - b.r) [b.y, b.vy] = [1 - b.r, -Math.abs(b.vy) * 0.3]
  }
}

/** The blob a press at (x, y) means: the nearest, if it is within two of its own radii. */
export function blobAt(blobs: readonly Blob[], x: number, y: number, aspect: number) {
  let best = -1
  let bestD = Infinity
  blobs.forEach((b, i) => {
    const d = Math.hypot((b.x - x) * aspect, b.y - y) / b.r
    if (d < 2 && d < bestD) [best, bestD] = [i, d]
  })
  return best
}
