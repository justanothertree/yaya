/**
 * The arithmetic of the Lab's time mirror: the ring of past frames, the delay map that says which
 * moment each part of the picture shows, the brushes that paint it, and the scene that stands in
 * when there is no camera.
 *
 * ⚠️ THE PAST IS A RING OF TEXTURE LAYERS. Every frame the newest picture is written over the
 * oldest layer of a texture array, and `head` says which layer is newest — nothing is ever moved.
 * A pixel with delay d (0..1) shows the frame d·(FRAMES − 1) ago, blending the two frames either
 * side of that, so a smooth delay map gives a smooth smear of time rather than steps.
 */

/** Hand-packed to match `struct Mirror` — mirror.test.ts lays the struct out from the shader. */
export const MIRROR = {
  size: 0,
  head: 8,
  frames: 12,
  dabs: 16,
  tint: 20,
  bytes: 24,
} as const

/** how many past frames are kept: at 30 a second, about two seconds of the past */
export const FRAMES = 64
/**
 * The picture's size in the history, shaped like the canvas so nothing is stretched: about 49,000
 * texels whatever the shape — small enough that 64 of them are cheap, sharp enough to see a face.
 */
export function historyFor(aspect: number): [number, number] {
  const a = Math.min(4, Math.max(0.25, aspect))
  const w = Math.round(Math.sqrt(49152 * a))
  return [w, Math.round(49152 / w)]
}
export const MAX_DABS = 16

/**
 * Which two layers a pixel with delay `d` blends, and how much of the second: the frame d·(n − 1)
 * ago, between whole frames. Mirrored in mirror.wgsl.
 */
export function layersFor(head: number, d: number, n = FRAMES): [number, number, number] {
  const back = Math.min(Math.max(d, 0), 1) * (n - 1)
  const whole = Math.floor(back)
  const a = (((head - whole) % n) + n) % n
  const b = (((a - 1) % n) + n) % n
  return [a, b, back - whole]
}

/** delay maps to start from: how far back each part of the picture looks, 0..1, w×h */
export const MAPS = {
  falling: 'Falling',
  ripple: 'Ripple',
  split: 'Split',
  now: 'Now',
} as const
export type MapId = keyof typeof MAPS
export const MAP_IDS = Object.keys(MAPS) as MapId[]

export function delayMap(id: MapId, w: number, h: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w
      const v = (y + 0.5) / h
      let d = 0
      // the top is now, and the past pours down the picture: the classic slit-scan
      if (id === 'falling') d = v
      // rings of time spreading from the middle
      else if (id === 'ripple') d = Math.min(1, Math.hypot(u - 0.5, (v - 0.5) * (h / w)) * 2.2)
      // left now, right two seconds ago, with a soft seam
      else if (id === 'split') d = 1 / (1 + Math.exp(-(u - 0.5) * 30))
      out[y * w + x] = d
    }
  return out
}

export type Brush = 'slow' | 'now'
/** a dab of the time brush: where, how wide (texels), and what it does — `slow` drags towards the past, `now` back to the present */
export type Dab = { x: number; y: number; r: number; brush: Brush }

export function packDabs(dabs: readonly Dab[]): Float32Array<ArrayBuffer> {
  const f = new Float32Array(MAX_DABS * 4)
  dabs
    .slice(0, MAX_DABS)
    .forEach((d, i) => f.set([d.x, d.y, d.r, d.brush === 'slow' ? 1 : 0], i * 4))
  return f
}

/** how far one frame of a held brush moves the delay, at its centre */
export const BRUSH_RATE = 0.06

/**
 * One frame of brushing, on the CPU as the shader does it: within a dab's reach, the delay eases
 * towards 1 (slow) or 0 (now) by up to BRUSH_RATE, softest at the dab's edge.
 */
export function brush(map: Float32Array, w: number, h: number, dabs: readonly Dab[]) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let d = map[y * w + x]
      for (const b of dabs) {
        const r = Math.hypot(x + 0.5 - b.x, y + 0.5 - b.y)
        if (r >= b.r) continue
        const k = BRUSH_RATE * (1 - r / b.r)
        d = Math.fround(d + ((b.brush === 'slow' ? 1 : 0) - d) * k)
      }
      map[y * w + x] = d
    }
}

/**
 * The stand-in for a camera: a scene drawn into a 2D context — circles drifting round, a clock hand
 * sweeping — so time has something to show. Frame `n` also writes n into the top-left texel's red
 * and green (n & 255, n >> 8), which is how the probe reads back which frame a pixel came from.
 */
export function drawStandIn(g: CanvasRenderingContext2D, w: number, h: number, n: number) {
  const t = n / 30
  g.fillStyle = '#10131c'
  g.fillRect(0, 0, w, h)
  for (let k = 0; k < 5; k++) {
    const a = t * (0.6 + k * 0.17) + k * 1.3
    g.fillStyle = `hsl(${(k * 72 + t * 40) % 360} 80% 60%)`
    g.beginPath()
    g.arc(
      w / 2 + Math.cos(a) * w * 0.3,
      h / 2 + Math.sin(a * 1.3) * h * 0.3,
      Math.min(w, h) * (0.06 + k * 0.015),
      0,
      Math.PI * 2,
    )
    g.fill()
  }
  g.strokeStyle = '#ffffff'
  g.lineWidth = Math.max(2, w / 80)
  g.beginPath()
  g.moveTo(w / 2, h / 2)
  g.lineTo(w / 2 + Math.cos(t * 2) * h * 0.45, h / 2 + Math.sin(t * 2) * h * 0.45)
  g.stroke()
  g.fillStyle = `rgb(${n & 255},${(n >> 8) & 255},0)`
  g.fillRect(0, 0, 1, 1)
}

export type MirrorFrame = { w: number; h: number; head: number; dabs: number; tint: boolean }

export function packMirror(p: MirrorFrame, into = new ArrayBuffer(MIRROR.bytes)) {
  const u = new Uint32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[MIRROR.head / 4] = p.head
  u[MIRROR.frames / 4] = FRAMES
  u[MIRROR.dabs / 4] = p.dabs
  u[MIRROR.tint / 4] = p.tint ? 1 : 0
  return into
}
