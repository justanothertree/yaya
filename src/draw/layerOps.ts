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
  | { k: 'hide'; i: number; on: boolean }

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
  return null
}
