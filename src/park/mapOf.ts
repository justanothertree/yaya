import type { Drawing, Stroke } from '../draw/strokes'
import { boxOf } from '../pets/rig'
import { ASPECT, across, down, PARK_TALL } from './strike'
import { PARK, type Spot } from './walk'

/**
 * Reading a drawing as a map.
 *
 * ⚠️ THE SAME BARGAIN A CREATURE MAKES, AND THAT IS THE WHOLE IDEA. rigOf reads a drawing's
 * LAYER NAMES and hands back a skeleton: name a layer `wing` and the thing flaps. This reads a
 * drawing's layer names and hands back places: name a layer `rocks 0.5` and there is somewhere
 * to climb. Asked for as making the map maker out of the paint system — and the paint system
 * already has the two things a map needs, which are a place to draw and a name per layer.
 *
 * ⚠️ NOTHING NEW TO LEARN, WHICH IS THE POINT OF REUSING IT. Somebody who has made a minion
 * already knows that layers have names and that the name is what makes the drawing DO
 * something. A map is that again with a different vocabulary, rather than a second editor with
 * its own rules.
 *
 * ⚠️ THE DRAWING IS THE WHOLE PARK. A layer's ink is measured against the paper, and the paper
 * is the three-by-three world — so where you drew it is where it is, and how big you drew it is
 * how big it is. No placement step, no coordinates to type.
 *
 * ⚠️ PURE, and it does not touch the park. The park has a fixed MARKS table and will keep it
 * until something chooses a drawing instead; this is the reader, and it can be checked without
 * a browser.
 */

/** What a place IS, which decides how it is drawn — see the .park-mark styles. */
export type PlaceKind = 'pond' | 'grove' | 'ring' | 'rocks' | 'wall' | 'flat'

export type Place = {
  /** the layer name as it was typed, minus the height */
  name: string
  /** the middle of it, in world units across the whole park */
  at: Spot
  /** how wide, as a fraction of a screenful — the same unit Mark.size uses */
  size: number
  kind: PlaceKind
  /**
   * How high you stand on it, in pet-heights. 0 is the grass.
   *
   * ⚠️ FROM A NUMBER IN THE NAME, NOT FROM THE KIND, and the existing park is the argument:
   * `the little wood` and `the far trees` are both groves and one of them is 0.72 while the
   * other is flat. A kind cannot carry that, and a map maker wants a ledge at whatever height
   * the person wants it. So `rocks 0.5` means rocks half a creature high, and `rocks` on its
   * own means rocks you walk past.
   */
  top: number
  /**
   * The box its ink filled, in world units.
   *
   * ⚠️ BECAUSE A WALL IS NOT ROUND. Every other place is a blob and a centre plus a width
   * describes it well enough; a wall is long and thin and its height is the whole point of it.
   * Carrying the box costs four numbers and is the difference between a hedge that reaches
   * across a gap and a small circle you walk round the end of. See solid.ts.
   */
  box: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * Words that name a kind.
 *
 * ⚠️ SEVERAL WORDS EACH, the same way partOf works, because somebody writing `water` and
 * somebody writing `pond` mean the same thing and neither should have to guess which one the
 * program knows.
 */
const WORDS: Array<[PlaceKind, string[]]> = [
  ['pond', ['pond', 'water', 'lake', 'pool', 'river', 'puddle', 'stream']],
  ['grove', ['tree', 'wood', 'grove', 'forest', 'bush']],
  /* ⚠️ NO `yard` OR `court`. They were in here for one commit and `courtyard 0.3` — the
     example in the panel's own help text — came out as a gold ring, because it contains both.
     The kind decides how a place is DRAWN, so a word we are not sure about is better left
     neutral than guessed: a courtyard drawn as a clearing is the map telling somebody
     something about their own map that is not true. */
  ['ring', ['ring', 'circle', 'arena', 'clearing']],
  ['rocks', ['rock', 'stone', 'cliff', 'crag', 'boulder', 'ledge', 'hill', 'mound', 'step']],
  /* ⚠️ A HEDGE IS A WALL HERE, not a grove. You cannot walk through one, and in a game
     that is the only thing about a hedge that matters — see solid.ts. */
  ['wall', ['wall', 'fence', 'hedge', 'barrier', 'building', 'house']],
]

export function placeKind(name: string): PlaceKind {
  const n = name.toLowerCase()
  for (const [kind, words] of WORDS) if (words.some((w) => n.includes(w))) return kind
  return 'flat'
}

/** the tallest a drawn place may be, so a typo cannot put the grass above the sky */
export const TOP_MOST = 2

/**
 * Pull a height out of a layer name.
 *
 * ⚠️ THE LAST NUMBER, NOT THE FIRST, so `wood 2 0.4` is a second wood at 0.4 rather than a
 * wood at two creature-heights. People number things before they measure them.
 */
export function topOf(name: string): number {
  const found = name.match(/-?\d*\.?\d+/g)
  if (!found) return 0
  const n = Number(found[found.length - 1])
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(TOP_MOST, n)
}

/** the name without the height, for saying out loud */
export const placeName = (name: string): string =>
  name.replace(/\s*-?\d*\.?\d+\s*$/, '').trim() || name.trim()

/**
 * ⚠️ NOT A WHOLE Drawing, because it does not read one. Three fields is what a map is,
 * and asking for the rest would mean the paint room had to assemble a name, a version and a
 * background it is not using in order to ask a question about its layers.
 */
export type Mappable = Pick<Drawing, 'strokes' | 'ratio'> & { layers?: string[] }

/**
 * Every place a drawing describes, in the order its layers are stacked.
 *
 * ⚠️ AN UNNAMED LAYER IS SCENERY. It still got drawn and it still shows, it simply is not
 * somewhere — the same rule the rig follows for a layer nobody named, and for the same reason:
 * drawing is the part that should never be refused.
 */
/**
 * Is this layer name describing a place at all?
 *
 * ⚠️ A NAME ALONE IS NOT ENOUGH, and finding that out cost nothing because the picker
 * said so out loud: every creature in the gallery came up as a map. `Flappy — 4 places`,
 * because a layer called `leg` is a named layer and the first version asked for nothing more
 * than that. A drawing is a map when it says so — either with a word that names a KIND of
 * place, or with a height, which is a thing only terrain has.
 *
 * ⚠️ WHICH ALSO MEANS THE RULE IS TEACHABLE. "Call it pond, trees, rocks or a clearing,
 * or give it a height" is a sentence; "name the layer anything" was not a rule at all, it was
 * the absence of one.
 */
const isPlace = (raw: string): boolean => placeKind(raw) !== 'flat' || topOf(raw) > 0

export function mapOf(d: Mappable): Place[] {
  const byLayer = new Map<number, Stroke[]>()
  for (const s of d.strokes) {
    const l = s.l ?? 0
    const had = byLayer.get(l)
    if (had) had.push(s)
    else byLayer.set(l, [s])
  }

  const out: Place[] = []
  for (const [layer, strokes] of [...byLayer].sort((a, b) => a[0] - b[0])) {
    const raw = (d.layers?.[layer] ?? '').trim()
    if (!raw || raw === 'unnamed' || !isPlace(raw)) continue
    /* ⚠️ boxOf, not a second box measurer. It already knows that a fill is paint rather than
       shape — fill the page behind a map and every place would be the size of the park. */
    const box = boxOf(strokes, d.ratio)
    if (!box) continue
    const w = box.x1 - box.x0
    const h = box.y1 - box.y0
    if (!(w > 0) || !(h > 0)) continue
    out.push({
      name: placeName(raw),
      at: { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 },
      /* ⚠️ a fraction of a SCREENFUL, which is what Mark.size means — the drawing is the whole
         park, so a layer a ninth of the paper wide is a third of a screen wide */
      size: w * PARK.across,
      kind: placeKind(raw),
      top: topOf(raw),
      box: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
    })
  }
  return out
}

/** Which of them you can stand on, which is the only part the ground cares about. */
export const standable = (places: Place[]): Place[] => places.filter((p) => p.top > 0)

/**
 * The same conversion the other way round: something in the park, drawn on the paper.
 *
 * ⚠️ BECAUSE NOTHING ON THE PAGE SAYS HOW BIG ANYTHING IS, and that is not a small gap.
 * The paper is the whole park — three screens by three — so a shape drawn at a comfortable
 * size is enormous, and every test map built while writing mapOf came out bigger than any
 * landmark the real park has. I only found that out by printing the numbers, which is not a
 * thing anybody else is going to do. A guide is the difference between a rule you are told and
 * a rule you can see.
 *
 * ⚠️ AND THE STRETCH IS THE HALF NOBODY WOULD GUESS. World x is a fraction of the park's
 * WIDTH and world y of its HEIGHT, and the park is three 16:10 screens each way — so the world
 * is 1.6 times wider than it is tall, and a circle drawn on square paper arrives as an ellipse.
 * Asking for a square in the park therefore asks for two different numbers here, and a mark
 * drawn with both of them looks round exactly when the paper is the park's own shape.
 */
export const onPaper = (screenHeights: number) => ({
  w: across(screenHeights),
  h: down(screenHeights),
})

/**
 * How wide a typical landmark is, in screenfuls.
 *
 * ⚠️ THE MIDDLE OF THE FIVE THAT EXIST — 0.24, 0.26, 0.28, 0.30 and 0.34 — rather than a
 * round number. MapReading's SMALL and BIG were first guessed against the range the measurement
 * could take and called every real place in the game small; this is the same mistake's fix,
 * which is to band a measurement against what has actually been built.
 */
export const PLACE_MID = 0.28

/** Everything a guide drawn over the paper needs, all of it derived rather than typed. */
export const MAP_GUIDE = {
  /** how many screenfuls the paper is, across and down — the grid is the lines between them */
  cols: PARK.across,
  rows: PARK.down,
  /** a creature, standing */
  creature: onPaper(PARK_TALL),
  /** a landmark the size of the ones the park already has */
  place: onPaper(PLACE_MID * ASPECT),
}
