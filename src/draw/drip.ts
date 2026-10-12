/**
 * Wet ink, which runs.
 *
 * The first of the "physics / effect brushes" asked for on 13 Sept 2026 — and the shape of it is
 * decided by two things that were already here.
 *
 * ⚠️ FIRST: `ember` ALREADY DID THIS AND SAYS HOW. Its note in strokes.ts is the doctrine —
 * "SIMULATED, BUT NOT LIVE". Every spark's whole flight is integrated at DRAW time out of its own
 * seed, so the result is a pure function of the points already in the stroke, which is what lets
 * it save as ~80 bytes, replay identically on a peer's screen, and come back the same after undo.
 * A brush holding live particle state would break all three at once: nothing to write to a file,
 * nothing to send, and no way to redraw it. This follows that exactly.
 *
 * ⚠️ SECOND: `ember` AND `vine` WERE RETIRED THE SAME DAY THE PHYSICS BRUSHES WERE ASKED FOR.
 * Both still render wherever one was drawn — a packed stroke stores its tool as an index, so
 * nothing can ever be deleted — but they came out of the picker, and the ask arrived in the same
 * batch of notes. Read together that says the bar is not "a brush that throws decoration off the
 * line". Sparks and sprouting leaves are an effect you use once and then never reach for again.
 * A brush worth keeping behaves like a MATERIAL: it does what the stuff would do, so you reach
 * for it because you want wet, or heavy, or slack — not because you want sparks.
 *
 * So: ink that is too wet to stay where you put it. Runs hang off the line and fall, longer where
 * you lingered, each one tapering to a bead. Useful for the things this site is actually for —
 * slime, lava, honey, blood, a melting creature, a shoreline — rather than for one novelty.
 */

/**
 * The cheap hash every generative brush here is seeded from.
 *
 * ⚠️ IT CAN NEVER CHANGE. Pictures do not store their drips; they store points, and the drips are
 * recomputed from them every time anybody opens the drawing. Changing a constant in here would
 * silently re-run every drip in every saved picture — the same class of break as reordering TOOLS,
 * and with no error to explain it. It is the same formula `noise` uses in strokes.ts, written
 * again rather than exported, because what matters is that this one is frozen.
 */
const noise = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * One run of ink.
 *
 * ⚠️ UNITS, SAID ONCE: `x` and `y` are the drawing's own 0..1 space, like every `Stroke.p`, and
 * `fall` and `thick` are in SHORT SIDES, like `Stroke.w`. The renderer multiplies by the same
 * `short` it already uses for the brush radius. A length in pixels in here would be a length that
 * means something different in a 192px bake than on a 1024px canvas, which is how a drawing comes
 * to look different depending on where it is being shown.
 */
export type Drop = {
  x: number
  y: number
  /** how far it has run, downward */
  fall: number
  /** how wide the run is where it leaves the line */
  thick: number
}

/**
 * The most a run may be, as a multiple of the brush's own width.
 *
 * ⚠️ IN BRUSH WIDTHS RATHER THAN IN SHORT SIDES, so a thin pen weeps and a fat loaded brush
 * pours — and so the bound is a sentence about the brush rather than a number about the canvas.
 * The test asserts this multiple, so a run can never quietly become a curtain.
 */
export const RUN_MOST = 6

/**
 * How wet it is: the share of points along the line that let go of a run.
 *
 * ⚠️ PER POINT, WHICH IS WHY IT READS AS SPEED. A hand moving slowly leaves points close
 * together, so a slow passage has more of them and sheds more ink; a fast flick leaves few and
 * stays nearly dry. Nothing records how fast you drew — but the spacing of what you drew already
 * says it, so the brush answers the gesture without a single extra byte being stored.
 */
const WET = 0.12

/**
 * Where the ink runs, given the line it was laid along.
 *
 * ⚠️ SEEDED FROM THE POSITION, NEVER FROM THE INDEX, and this is the one decision in the file
 * that is not cosmetic. A drawing on its way to the account is squeezed to fit a byte ceiling by
 * `simplifyDrawing`, which THINS the points of every freehand stroke — and this brush is freehand.
 * Seeded from `i`, every surviving point would be handed a different seed the moment a drawing was
 * saved, so every drip would move: the picture somebody kept would not be the picture they drew.
 * Seeded from where the point is, thinning can only ever REMOVE drips, because the points that
 * remain are unmoved and keep the drips they had. Fewer runs is a picture that got a little drier;
 * different runs is a picture that got replaced. That is the same reason `stampFrame` in mapDoc.ts
 * hashes a stamp's position rather than its order.
 */
export function dripsFrom(p: number[], w: number): Drop[] {
  const out: Drop[] = []
  if (!(w > 0)) return out
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i]
    const y = p[i + 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    /* the same mixing constants stampFrame uses, for the same reason: two coordinates into one
       seed, with no axis dominating at the scales a drawing actually uses */
    const seed = x * 127.1 + y * 311.7
    if (noise(seed) > WET) continue
    /**
     * ⚠️ A RUN IS NEVER ZERO AND NEVER THE WHOLE BOUND. The floor is there because a drip of no
     * length is a smudge nobody can read as a drip, and the ceiling is RUN_MOST exactly — so the
     * bound in the comment above is the bound in the code, rather than a number that drifted
     * away from the sentence beside it.
     */
    const run = (0.25 + noise(seed + 1.7) * 0.75) * RUN_MOST * w
    out.push({
      x,
      y,
      fall: run,
      /* thinner than the line it came off — surface tension pulls a run narrow, and a run as wide
         as the stroke reads as a second stroke rather than as ink escaping the first */
      thick: w * (0.3 + noise(seed + 2.3) * 0.35),
    })
  }
  return out
}
