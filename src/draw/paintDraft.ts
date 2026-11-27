import type { PaintSession } from './session'
import { MAX_LAYERS, readDrawing, type Drawing } from './strokes'

/**
 * Paint's unsaved work, as a draft on this device — what goes in, what comes back, and how the
 * room tells "unsaved" from "saved".
 *
 * ⚠️ IT GOES IN AS A DRAWING AND COMES BACK THROUGH readDrawing, so a draft is held to exactly the
 * bounds a gallery file is: known tools, hex colours, clamped numbers, capped counts. A draft that
 * passes is a picture the gallery could keep; one that fails is refused here rather than rendered.
 *
 * ⚠️ AND IT CARRIES WHAT A DRAWING DOES NOT: which layers are switched off, and whether the minion
 * guide was open. The second is the point of the whole feature — what was lost was a MINION, and
 * bringing back the picture without the guide would leave somebody holding a drawing and looking
 * for the button that turned it into a creature, which is how they lost it the first time.
 */
export type PaintDraft = {
  session: PaintSession
  /** the minion guide was open */
  minion: boolean
}

/** What is stored: a plain-form drawing, plus the two things a drawing does not hold. */
export function packPaintDraft(session: PaintSession, minion: boolean): unknown {
  const drawing: Drawing = {
    v: 1,
    name: session.name ?? '',
    ratio: session.ratio ?? 1.5,
    bg: session.bg,
    layers: session.layerNames.length ? session.layerNames : undefined,
    fps: session.fps,
    hits: session.hits,
    acts: session.acts,
    poses: session.poses,
    spells: session.spells,
    strokes: session.strokes,
  }
  return { drawing, hidden: session.hidden, ratio: session.ratio ?? null, minion }
}

/**
 * A stored draft back, validated, or null. Null too for a draft with nothing drawn in it: an
 * empty page is not work anybody could lose, and offering to restore one is noise.
 */
export function readPaintDraft(raw: unknown): PaintDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const d = readDrawing(o.drawing)
  if (!d || !d.strokes.length) return null
  const hidden = Array.isArray(o.hidden)
    ? [
        ...new Set(
          o.hidden.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < MAX_LAYERS),
        ),
      ]
    : []
  /* ⚠️ THE RATIO ONLY WHEN THE ROOM HAD ONE. readDrawing defaults a missing ratio to 1.5, and a
     page still on Free has none — restoring 1.5 onto it would pin a shape nobody chose. */
  const ratio = typeof o.ratio === 'number' && o.ratio > 0.05 && o.ratio < 20 ? d.ratio : undefined
  /* "Untitled" is readDrawing's word for no name; a draft with no name had none */
  const name =
    d.name === 'Untitled' && !(o.drawing as { name?: unknown })?.name ? undefined : d.name
  return {
    session: {
      strokes: d.strokes,
      bg: d.bg,
      hidden,
      layerNames: d.layers ?? [],
      ratio,
      name,
      fps: d.fps,
      hits: d.hits,
      acts: d.acts,
      poses: d.poses,
      spells: d.spells,
    },
    minion: o.minion === true,
  }
}

/**
 * The picture's content, as one comparable string: what "unsaved" is measured against.
 *
 * ⚠️ WHAT IS MADE, NOT HOW IT IS LOOKED AT. Hidden layers, the name and the paper's shape are
 * left out on purpose. Switching a layer off to see behind it is not an edit; the name is given
 * in the same breath as the save, so counting it would mark every fresh save as unsaved; and the
 * shape is pinned by the first stroke rather than chosen. A layer's NAME is in, because a name is
 * what makes a minion's wing flap.
 *
 * ⚠️ EMPTY MAPS AND MISSING ONES ARE THE SAME, and so are a default 8 fps and none, because the
 * room spells both ways depending on which door the picture came in by — and a picture opened
 * from the gallery must compare equal to itself or it reads as unsaved the moment it opens.
 */
export function contentSig(
  s: Pick<
    PaintSession,
    'strokes' | 'bg' | 'layerNames' | 'fps' | 'hits' | 'acts' | 'poses' | 'spells'
  >,
): string {
  const map = (m: Record<string, string> | undefined) =>
    m && Object.keys(m).length
      ? Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)))
      : null
  const names = [...s.layerNames]
  while (names.length && !names[names.length - 1]) names.pop()
  return JSON.stringify([
    /**
     * ⚠️ FIELD BY FIELD, IN A FIXED ORDER, and never the stroke object itself. JSON follows key
     * order, and readStroke builds its strokes in a different order from the room's own — so the
     * same picture serialised as an object read as two pictures, and a restored draft or an
     * opened file could never be "saved". Found by the round-trip test. The defaults are the
     * room's own readings: no symmetry and no echo are 0, no layer is layer 0, and no frame stays
     * distinct from frame 0 because it means EVERY frame. The id is left out: it names a stroke
     * for a call, it is not part of the picture.
     */
    s.strokes.map((k) => [
      k.t,
      k.c,
      k.a,
      k.w,
      k.k ?? 0,
      k.e ?? 0,
      k.l ?? 0,
      k.f ?? null,
      k.x ?? '',
      k.p,
    ]),
    s.bg ?? null,
    names,
    s.fps ?? 8,
    map(s.hits),
    map(s.acts),
    map(s.poses),
    map(s.spells),
  ])
}

/**
 * Whether a stored draft should be offered back, against the page as it stands.
 *
 * ⚠️ ONLY WHEN IT IS NOT ALREADY THERE. Walking to Games and back brings the picture back from
 * memory, and its draft is the same work — offering it would ask somebody whether they want what
 * they are looking at. Anything else is offered, and that includes a page that is NOT empty: a
 * minion opened from the Minions room to edit is a saved creature, and a draft sitting under it is
 * unsaved work that nothing else will ever bring back.
 */
export function offerFor(draft: PaintDraft | null, pageSig: string): boolean {
  return !!draft && contentSig(draft.session) !== pageSig
}

/** The empty page's signature — the baseline before anything is saved or opened. */
export const EMPTY_SIG = contentSig({ strokes: [], bg: null, layerNames: [] })
