import type { Stroke } from './strokes'

/**
 * Changing the stack of layers — as one definition, so it happens the same way for everybody.
 *
 * ⚠️ A LAYER IS A NUMBER ON A STROKE, not a container (see Stroke.l). Which means reordering and
 * deleting are not tidy container moves: they REWRITE `l` on strokes that already exist, and
 * deleting throws strokes away. Drawing together, that is the difference between the two
 * divergences this module exists to prevent and the one it cannot:
 *
 *   - a stroke that does not arrive is one stroke missing, and it is obvious;
 *   - a reorder that does not arrive silently repaints the whole picture in a different order on
 *     one screen and not the other, and neither person can see that it happened.
 *
 * Strokes already travel and already carry their layer, so drawing on layer 2 has always landed
 * on layer 2. The STRUCTURE never travelled at all.
 *
 * ⚠️ ONE PURE FUNCTION, CALLED BY BOTH SIDES. The local press and the message off the wire run
 * this same transform over their own state. Two implementations of "move a layer down" is two
 * chances to disagree about what happens to the hidden flags, and the whole point is that
 * everybody ends up with the same picture — so there is only one, and the way to be sure the
 * receiver does what the sender did is that it is literally the same code.
 *
 * ⚠️ WHAT DOES NOT TRAVEL: which layer you are drawing on. That is where your hand is, not what
 * the picture is, and moving somebody else's brush to another layer mid-stroke is not sharing.
 * It only follows a move or a delete, where the layer it pointed at went somewhere or stopped
 * existing — see `layer` below.
 *
 * ⚠️ AND THE LIMIT, said plainly: these are applied in the order they arrive. Two people doing
 * layer surgery in the same second can still end up different, because "delete layer 1" and
 * "move layer 2 up" do not commute and nothing here resolves that. Strokes never conflict, which
 * is why they need no such machinery; this is the one part of the room that does, and the honest
 * answer for a handful of friends drawing together is that deliberate, rare, one-at-a-time
 * operations do not race. A real fix is a version vector, which is a different project.
 */
export type LayerOp =
  | { k: 'add' }
  /** swap with the neighbour at `to` — an index rather than a direction, so it cannot mean
      something different on a screen whose list is drawn the other way up */
  | { k: 'move'; i: number; to: number }
  | { k: 'remove'; i: number }
  /**
   * Give a layer a name.
   *
   * ⚠️ THE NAMES WERE READ, SAVED AND SHOWN, AND COULD NEVER BE SET. Drawing.layers has
   * carried them since the frame editor arrived, nameOf() falls back to "Layer 3" when one is
   * missing, and the only thing that ever called setLayerNames was a picture arriving from a peer
   * — whose names had nowhere to come from either. So every layer on the site was unnamed, and
   * the Pets room, which reads those names as a creature's skeleton, could only ever find a body.
   *
   * ⚠️ AN OP RATHER THAN LOCAL STATE, like every other thing you can do to a layer here. A
   * rename that did not travel would mean the same layer was called different things on two
   * screens in the same shared picture — and it is the names that decide how a pet moves, so the
   * two would disagree about the creature, not just about a label.
   */
  | { k: 'name'; i: number; name: string }
  | { k: 'hide'; i: number; on: boolean }
  /**
   * Put every stroke on this layer onto one frame, or onto all of them.
   *
   * ⚠️ IT IS AN OP, not a flag, and that is what makes "this layer never changes" cost
   * nothing to store, nothing to save and nothing to sync on its own. A stroke with no frame
   * already shows on every one — it is how anything drawn before you pressed Frames becomes the
   * background — so holding a layer still is an edit to strokes that already travel, and reading
   * it back is a question the strokes answer (see layerHolds).
   *
   * ⚠️ THE FRAME TRAVELS WITH IT. `null` means every frame; a number means that one. Letting
   * each end use its OWN current frame would put the same layer on frame 2 here and frame 5
   * there, from one press.
   */
  | { k: 'hold'; i: number; f: number | null }
  /**
   * Restyle strokes that are already drawn — the colour, opacity and width controls acting on a
   * selection instead of on the next stroke.
   *
   * ⚠️ BY ID, not by index, and that is the only way it can travel. An index means a position
   * in MY array, which is not anybody else's; a stroke's id is the name the room already uses to
   * take one back (see drawParty.undo). A stroke with no id — one loaded from a gallery file
   * rather than drawn or received — is restyled locally and cannot be named to anyone, which is
   * the same limit undo has always had.
   *
   * ⚠️ EVERY FIELD OPTIONAL, because these are three separate controls. Sending the whole
   * style on each would mean moving the opacity slider also re-applied whatever colour happened to
   * be loaded, which is not what anybody pressed.
   */
  | { k: 'style'; ids: string[]; c?: string; a?: number; w?: number }
  /**
   * Move, scale and rotate strokes that are already drawn — as one affine matrix.
   *
   * ⚠️ A MATRIX RATHER THAN THE RESULTING POINTS, which is the difference between six numbers
   * and every coordinate of everything you selected. A stroke can carry two thousand points; a
   * handful of them dragged across the page would be a message of tens of kilobytes for a gesture
   * anybody can repeat by accident.
   *
   * ⚠️ AND ONE OPERATION COVERS ALL THREE, so there is no "scale op" that has to agree with a
   * "rotate op" about what happens when you do both. [a, b, c, d, e, f] is the same layout canvas
   * and SVG use: x' = a·x + c·y + e, y' = b·x + d·y + f.
   */
  | { k: 'xform'; ids: string[]; m: [number, number, number, number, number, number] }

export type Stack = {
  strokes: Stroke[]
  names: string[]
  /** the layers that are not being drawn */
  hidden: number[]
  /** which layer this person is drawing on */
  layer: number
}

/** `s.l ?? 0` everywhere: absent means the bottom layer, and every stroke from before layers
    existed has no `l` at all. Comparing `s.l` directly leaves all of them behind on layer 0. */
const at = (s: Stroke) => s.l ?? 0

/**
 * Apply one change to the stack. Pure: it reads `stack` and returns a new one.
 *
 * `layers` is the current count, which is derived from the strokes AND the names (see
 * layerCount) rather than stored — so it is passed in rather than recomputed here.
 */
export function applyLayerOp(stack: Stack, op: LayerOp, layers: number): Stack {
  const { strokes, names, hidden, layer } = stack
  /** names is a sparse parallel array; anything past its end is an unnamed layer */
  const padded = () => {
    const n = [...names]
    while (n.length < layers) n.push('')
    return n
  }

  if (op.k === 'add') {
    if (layers >= 12) return stack
    const n = padded()
    n.push('')
    // ⚠️ `layer` deliberately untouched. The person who pressed + moves to the new layer; a peer
    // watching it appear does not get their brush taken off what they were drawing on.
    return { strokes, names: n, hidden, layer }
  }

  if (op.k === 'name') {
    if (op.i >= layers) return stack
    const n = padded()
    n[op.i] = op.name
    return { strokes, names: n, hidden, layer }
  }

  if (op.k === 'hide') {
    const on = hidden.includes(op.i)
    if (on === op.on) return stack
    return {
      strokes,
      names,
      hidden: op.on ? [...hidden, op.i] : hidden.filter((x) => x !== op.i),
      layer,
    }
  }

  if (op.k === 'hold') {
    const f = op.f === null ? undefined : op.f
    return {
      strokes: strokes.map((s) => (at(s) === op.i ? { ...s, f } : s)),
      names,
      hidden,
      layer,
    }
  }

  if (op.k === 'style') {
    const want = new Set(op.ids)
    return {
      strokes: strokes.map((st) =>
        st.id && want.has(st.id)
          ? {
              ...st,
              ...(op.c !== undefined ? { c: op.c } : {}),
              ...(op.a !== undefined ? { a: op.a } : {}),
              ...(op.w !== undefined ? { w: op.w } : {}),
            }
          : st,
      ),
      names,
      hidden,
      layer,
    }
  }

  if (op.k === 'xform') {
    const want = new Set(op.ids)
    const [a, b, c, d, e, f] = op.m
    return {
      strokes: strokes.map((st) => {
        if (!st.id || !want.has(st.id)) return st
        const p = st.p.slice()
        for (let i = 0; i + 1 < p.length; i += 2) {
          const x = p[i]
          const y = p[i + 1]
          /* ⚠️ clamped to the same range readStroke allows, because a transform is the one edit
             that can push a point arbitrarily far and these become canvas coordinates */
          p[i] = Math.max(-0.5, Math.min(1.5, a * x + c * y + e))
          p[i + 1] = Math.max(-0.5, Math.min(1.5, b * x + d * y + f))
        }
        return { ...st, p }
      }),
      names,
      hidden,
      layer,
    }
  }

  if (op.k === 'move') {
    const { i, to } = op
    if (i === to || i < 0 || to < 0 || i >= layers || to >= layers) return stack
    const n = padded()
    const keep = n[i]
    n[i] = n[to]
    n[to] = keep
    return {
      strokes: strokes.map((s) => {
        const l = at(s)
        if (l === i) return { ...s, l: to }
        if (l === to) return { ...s, l: i }
        return s
      }),
      names: n,
      hidden: hidden.map((x) => (x === i ? to : x === to ? i : x)),
      // it follows, or your brush ends up on whatever swapped into the row you were on
      layer: layer === i ? to : layer === to ? i : layer,
    }
  }

  // remove
  const { i } = op
  if (layers <= 1 || i < 0 || i >= layers) return stack
  return {
    // ⚠️ everything above shifts DOWN a number, or the strokes on those layers would point at a
    // layer that is no longer there and would all collapse onto the bottom one
    strokes: strokes
      .filter((s) => at(s) !== i)
      .map((s) => (at(s) > i ? { ...s, l: at(s) - 1 } : s)),
    names: names.filter((_, k) => k !== i),
    hidden: hidden.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)),
    layer: Math.min(layer > i ? layer - 1 : layer, layers - 2),
  }
}

/**
 * An operation off the wire, or null.
 *
 * ⚠️ Indices are CLAMPED BY THE CALLER's own layer count, not trusted from the message, because
 * `applyLayerOp` is the thing that rejects an out-of-range index and it is given the receiver's
 * `layers`. What this does is make sure the shape is an operation at all: nothing here reaches a
 * canvas, but it does reach everybody's strokes, and a `remove` with a junk index would be a
 * picture quietly losing a layer.
 */
export function readLayerOp(raw: unknown): LayerOp | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const whole = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 12 ? v : null
  if (o.k === 'add') return { k: 'add' }
  if (o.k === 'hide') {
    const i = whole(o.i)
    return i === null || typeof o.on !== 'boolean' ? null : { k: 'hide', i, on: o.on }
  }
  if (o.k === 'move') {
    const i = whole(o.i)
    const to = whole(o.to)
    return i === null || to === null ? null : { k: 'move', i, to }
  }
  if (o.k === 'remove') {
    const i = whole(o.i)
    return i === null ? null : { k: 'remove', i }
  }
  if (o.k === 'name') {
    const i = whole(o.i)
    if (i === null || typeof o.name !== 'string') return null
    /* the same 24 characters readDrawing allows, so a name that travels is a name that saves */
    return { k: 'name', i, name: o.name.slice(0, 24) }
  }
  if (o.k === 'style') {
    if (!Array.isArray(o.ids)) return null
    /* ⚠️ The same caps the stroke reader uses, because this ends up in a canvas call and in a
       picture somebody may save: a known colour word or a six-digit hex, and numbers clamped to
       the ranges readStroke itself clamps them to. */
    const ids = o.ids
      .slice(0, 4000)
      .filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 60)
    if (!ids.length) return null
    const op: LayerOp = { k: 'style', ids }
    if (
      typeof o.c === 'string' &&
      (o.c === 'none' || o.c === 'rainbow' || /^#[0-9a-f]{6}$/i.test(o.c))
    )
      op.c = o.c
    if (typeof o.a === 'number' && Number.isFinite(o.a)) op.a = Math.max(0.02, Math.min(1, o.a))
    if (typeof o.w === 'number' && Number.isFinite(o.w))
      op.w = Math.max(0.0015, Math.min(0.25, o.w))
    return op.c === undefined && op.a === undefined && op.w === undefined ? null : op
  }
  if (o.k === 'xform') {
    if (!Array.isArray(o.ids) || !Array.isArray(o.m) || o.m.length !== 6) return null
    const ids = o.ids
      .slice(0, 4000)
      .filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 60)
    if (!ids.length) return null
    /* ⚠️ Every term finite and bounded. An unbounded scale is not a drawing edit, it is a way
       to turn every point into the same coordinate; the clamp in the transform above stops the
       damage either way, but a matrix that cannot be sane is better refused than applied. */
    const m = o.m.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN))
    if (m.some((v) => Number.isNaN(v) || Math.abs(v) > 1000)) return null
    return { k: 'xform', ids, m: m as [number, number, number, number, number, number] }
  }
  if (o.k === 'hold') {
    const i = whole(o.i)
    if (i === null) return null
    if (o.f === null) return { k: 'hold', i, f: null }
    /* ⚠️ REJECTED, NOT DEFAULTED. Bounded by MAX_FRAMES because the number becomes a frame
       index and the editor sizes its frame list from the largest one it can see — but a junk
       value must not fall back to `null`, because null is a real instruction here ("every
       frame"), and quietly promoting a malformed message into a layer-wide edit is worse than
       dropping it. */
    if (typeof o.f !== 'number' || !Number.isInteger(o.f) || o.f < 0 || o.f >= 60) return null
    return { k: 'hold', i, f: o.f }
  }
  return null
}
