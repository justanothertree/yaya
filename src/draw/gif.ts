/**
 * An animated GIF, written out by hand.
 *
 * ⚠️ NO LIBRARY, AND THE REASON IS THE REPOSITORY. This is a public portfolio project whose
 * dependencies are a supply chain somebody else controls, and a GIF encoder is a 1987 file format
 * with a 1984 compressor — about three hundred lines, fully specified, with nothing in it that
 * needs maintaining. The npm options all ship a web worker as a separate asset, which is a second
 * file to serve and a second thing to get wrong in a lazy chunk. Writing it here costs a day once
 * and nothing after that.
 *
 * ⚠️ FRAMES ARE CONSUMED ONE AT A TIME AND KEPT AS 15-BIT KEYS, not as pixels. A 480×320 frame is
 * 614KB of RGBA and there can be sixty of them; the same frames as one 16-bit key per pixel are
 * 307KB each, and a key is all the palette ever looks at anyway, so nothing is lost by converting
 * early. The caller can therefore reuse one canvas and one ImageData for the whole encode.
 *
 * ⚠️ EVERY FRAME AFTER THE FIRST IS ONLY THE RECTANGLE THAT CHANGED. GIF has carried a per-frame
 * offset and size since the beginning, and a drawing being drawn changes a few hundred pixels per
 * step out of a hundred and fifty thousand. Emitting full frames is correct and roughly fifteen
 * times the file for the same picture.
 */

/** RGB, quantised to five bits a channel — the key everything here is indexed by. */
const key = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
const KEYS = 1 << 15

/**
 * The colours actually used, reduced to at most 256 by median cut.
 *
 * ⚠️ A FIXED PALETTE IS NOT AN OPTION HERE, which is worth saying because it is the obvious
 * shortcut. A drawing is a handful of colours plus every anti-aliased blend between them and the
 * paper, and those blends lie along lines through the cube. A 6×6×6 web palette puts a visible
 * staircase on every edge; median cut spends its 256 entries where the pixels actually are, so a
 * picture with six colours in it comes out exact.
 */
function medianCut(counts: Uint32Array, sums: Float64Array, want: number): Uint8Array {
  const used: number[] = []
  for (let k = 0; k < KEYS; k++) if (counts[k]) used.push(k)
  /* ⚠️ No special case for a small drawing, because there does not need to be one: splitting
     stops when no box holds two colours, so a picture with forty colours in it produces forty
     boxes of one colour each and comes out exact. */
  const keys = Int32Array.from(used)

  type Box = { at: number; end: number; n: number }
  const boxes: Box[] = [{ at: 0, end: keys.length, n: keys.reduce((t, k) => t + counts[k], 0) }]

  const channel = (k: number, c: number) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31)

  while (boxes.length < want) {
    /* split whichever box holds the most pixels — the one whose error is costing the most */
    let pick = -1
    let best = 0
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].end - boxes[i].at < 2) continue
      if (boxes[i].n > best) {
        best = boxes[i].n
        pick = i
      }
    }
    if (pick < 0) break
    const box = boxes[pick]

    /* along its longest axis, because that is where the box is least like a single colour */
    let axis = 0
    let widest = -1
    for (let c = 0; c < 3; c++) {
      let lo = 32
      let hi = -1
      for (let i = box.at; i < box.end; i++) {
        const v = channel(keys[i], c)
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      if (hi - lo > widest) {
        widest = hi - lo
        axis = c
      }
    }
    if (widest <= 0) {
      box.n = 0 // nothing left to split here; stop considering it
      continue
    }

    const slice = Array.from(keys.subarray(box.at, box.end)).sort(
      (a, b) => channel(a, axis) - channel(b, axis),
    )
    keys.set(slice, box.at)

    /* cut at the pixel median rather than the middle of the list, so a box that is mostly one
       colour with a few outliers does not hand half its entries to the outliers */
    const half = box.n / 2
    let run = 0
    let cut = box.at
    for (let i = box.at; i < box.end - 1; i++) {
      run += counts[keys[i]]
      cut = i + 1
      if (run >= half) break
    }
    let left = 0
    for (let i = box.at; i < cut; i++) left += counts[keys[i]]
    boxes[pick] = { at: box.at, end: cut, n: left }
    boxes.push({ at: cut, end: box.end, n: box.n - left })
  }

  const palette = new Uint8Array(boxes.length * 3)
  boxes.forEach((box, i) => {
    let n = 0
    let r = 0
    let g = 0
    let b = 0
    for (let j = box.at; j < box.end; j++) {
      const k = keys[j]
      n += counts[k]
      r += sums[k * 3]
      g += sums[k * 3 + 1]
      b += sums[k * 3 + 2]
    }
    /* the average of the real pixels in the box, not the centre of the box — a box that is 99%
       one colour should come out as that colour */
    palette[i * 3] = n ? Math.round(r / n) : 0
    palette[i * 3 + 1] = n ? Math.round(g / n) : 0
    palette[i * 3 + 2] = n ? Math.round(b / n) : 0
  })
  return palette
}

/** LZW as GIF spells it: codes grow, the dictionary resets when it fills, bits pack low end first. */
function lzw(indices: Uint8Array, from: number, count: number, minCode: number): number[] {
  const clear = 1 << minCode
  const end = clear + 1

  const out: number[] = []
  let cur = 0
  let bits = 0
  let size = minCode + 1
  const put = (code: number) => {
    cur |= code << bits
    bits += size
    while (bits >= 8) {
      out.push(cur & 0xff)
      cur >>= 8
      bits -= 8
    }
  }

  const dict = new Map<number, number>()
  let next = end + 1
  put(clear)

  let run = indices[from]
  for (let i = 1; i < count; i++) {
    const k = indices[from + i]
    const probe = (run << 8) | k
    const found = dict.get(probe)
    if (found !== undefined) {
      run = found
      continue
    }
    put(run)
    /**
     * ⚠️ THE ENCODER WIDENS ONE STEP LATER THAN THE DECODER DOES, and the asymmetry is real
     * rather than a rounding choice. A decoder builds its dictionary one code BEHIND the encoder
     * — it cannot add an entry until it has seen the code that follows it — so at the moment the
     * encoder holds `next` entries the decoder holds `next - 1`. The decoder therefore widens on
     * `next === 1 << size` and the encoder on `next > 1 << size`, and both are reading the same
     * code at the same width.
     *
     * Getting this wrong by one is not a corrupt byte somewhere. Every code after the first
     * disagreement is read at the wrong width, so the file decodes to noise from that point on,
     * with nothing in it that looks broken — it cost the first attempt at this a decoder that
     * simply said "unexpected end of image".
     *
     * 4096 is the ceiling: the dictionary is full and the only way on is to clear it.
     */
    if (next < 4096) {
      dict.set(probe, next++)
      if (size < 12 && next > 1 << size) size++
    } else {
      put(clear)
      dict.clear()
      next = end + 1
      size = minCode + 1
    }
    run = k
  }
  put(run)
  put(end)
  if (bits > 0) out.push(cur & 0xff)
  return out
}

export class GifEncoder {
  private readonly counts = new Uint32Array(KEYS)
  private readonly sums = new Float64Array(KEYS * 3)
  private readonly frames: Uint16Array[] = []
  private readonly delays: number[] = []

  private readonly width: number
  private readonly height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  get count() {
    return this.frames.length
  }

  /**
   * Take one frame.
   *
   * @param rgba the frame's pixels; it is read, never kept
   * @param delay how long to hold it, in hundredths of a second
   *
   * ⚠️ ALPHA IS IGNORED, because the caller composites onto paper before it gets here. GIF's
   * transparency is one index meaning "leave whatever was underneath", which cannot express an
   * eraser stroke — and a picture being drawn is the one thing that erases. Painting the paper
   * colour makes rubbing out an ordinary change, which the changed-rectangle encoding then
   * handles for free.
   */
  add(rgba: Uint8ClampedArray, delay: number) {
    const n = this.width * this.height
    const keys = new Uint16Array(n)
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = rgba[p]
      const g = rgba[p + 1]
      const b = rgba[p + 2]
      const k = key(r, g, b)
      keys[i] = k
      this.counts[k]++
      this.sums[k * 3] += r
      this.sums[k * 3 + 1] += g
      this.sums[k * 3 + 2] += b
    }
    /* an identical frame is not a frame, it is the previous one held for longer — which is a
       two-byte change instead of another image block */
    const last = this.frames[this.frames.length - 1]
    if (last && same(last, keys)) {
      this.delays[this.delays.length - 1] += delay
      return
    }
    this.frames.push(keys)
    this.delays.push(delay)
  }

  /** @param loop 0 forever, or a number of times */
  finish(loop = 0): Uint8Array<ArrayBuffer> {
    if (!this.frames.length) return new Uint8Array(0)
    const { width: w, height: h } = this

    const palette = medianCut(this.counts, this.sums, 256)
    const colours = palette.length / 3
    /* the table is a power of two and at least four entries, which the header encodes as a size
       rather than a count */
    let bits = 1
    while (1 << bits < colours) bits++
    if (bits < 2) bits = 2
    const table = 1 << bits
    const minCode = bits

    /* nearest palette entry for a key, worked out once per key that actually turns up */
    const nearest = new Int16Array(KEYS).fill(-1)
    const index = (k: number): number => {
      const had = nearest[k]
      if (had >= 0) return had
      const r = ((k >> 10) << 3) | 4
      const g = (((k >> 5) & 31) << 3) | 4
      const b = ((k & 31) << 3) | 4
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < colours; i++) {
        const dr = r - palette[i * 3]
        const dg = g - palette[i * 3 + 1]
        const db = b - palette[i * 3 + 2]
        const d = dr * dr + dg * dg + db * db
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      nearest[k] = best
      return best
    }

    const out: number[] = []
    const byte = (v: number) => out.push(v & 0xff)
    const short = (v: number) => {
      out.push(v & 0xff, (v >> 8) & 0xff)
    }
    const ascii = (s: string) => {
      for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i))
    }

    ascii('GIF89a')
    short(w)
    short(h)
    byte(0x80 | 0x70 | ((bits - 1) & 7)) // global table, 8 bits of colour resolution, size
    byte(0)
    byte(0)
    for (let i = 0; i < table; i++) {
      byte(i < colours ? palette[i * 3] : 0)
      byte(i < colours ? palette[i * 3 + 1] : 0)
      byte(i < colours ? palette[i * 3 + 2] : 0)
    }

    /* the Netscape block, which is how a GIF says "again" — absent, every viewer plays once */
    ascii('\x21\xff\x0b')
    ascii('NETSCAPE2.0')
    byte(3)
    byte(1)
    short(loop)
    byte(0)

    const prev = new Uint8Array(w * h)
    const buf = new Uint8Array(w * h)

    for (let f = 0; f < this.frames.length; f++) {
      const keys = this.frames[f]
      /* the rectangle that differs from what is already on screen — the whole frame the first
         time, and usually a few hundred pixels after that */
      let x0 = 0
      let y0 = 0
      let x1 = w - 1
      let y1 = h - 1
      if (f > 0) {
        x0 = w
        y0 = h
        x1 = -1
        y1 = -1
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = y * w + x
            if (index(keys[i]) === prev[i]) continue
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
          }
        }
        /**
         * ⚠️ Identical after quantisation — two frames whose keys differed but whose palette
         * entries did not, which `add` could not have seen. It still has to occupy its own time,
         * so it is emitted as a one-pixel repaint of a pixel that already has that value. Adding
         * its delay to the previous frame instead would be silently ignored: that frame's header
         * is already in `out` and cannot be reached again.
         */
        if (x1 < x0) {
          x0 = 0
          y0 = 0
          x1 = 0
          y1 = 0
        }
      }
      const fw = x1 - x0 + 1
      const fh = y1 - y0 + 1

      let n = 0
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * w + x
          const v = index(keys[i])
          prev[i] = v
          buf[n++] = v
        }
      }

      ascii('\x21\xf9\x04')
      /* disposal 1 — leave the frame where it is. Every frame here paints real colours over the
         rectangle it claims, so there is nothing to undo between them. */
      byte(0x04)
      short(Math.max(2, Math.round(this.delays[f])))
      byte(0)
      byte(0)

      byte(0x2c)
      short(x0)
      short(y0)
      short(fw)
      short(fh)
      byte(0) // no local table, not interlaced

      byte(minCode)
      const bytes = lzw(buf, 0, n, minCode)
      for (let i = 0; i < bytes.length; i += 255) {
        const chunk = Math.min(255, bytes.length - i)
        byte(chunk)
        for (let j = 0; j < chunk; j++) byte(bytes[i + j])
      }
      byte(0)
    }

    byte(0x3b)
    return new Uint8Array(out)
  }
}

function same(a: Uint16Array, b: Uint16Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
