import type { Ground } from './ground'
import { wallOf, type Wall } from './solid'
import type { Place } from './mapOf'
import { MARKS, VIEW, type Mark, type Spot } from './walk'

/**
 * Which park everybody is standing in.
 *
 * ⚠️ THE FIXED TABLE IS STILL THE PARK. walk.ts says why MARKS is a list in the code rather
 * than a seed: everybody has to be standing in the same place, and a generated layout would
 * need the seed on the wire and agreement about the generator. Nothing here changes that —
 * the built-in map is what you get, and it is what every shared room gets.
 *
 * ⚠️ WHAT THIS ADDS IS ONE SWAPPABLE SLOT, so a drawing CAN be the park somewhere it is safe
 * to be. A drawn map is not on the wire, so two people with different maps would be standing on
 * rocks the other cannot see.
 *
 * ⚠️ AND THE SAFETY MOVED, WHICH IS WHY THIS NOTE CHANGED. For three commits the guarantee
 * was "the only control is in the dev workbench", which is a guarantee that lasts exactly until
 * somebody adds a second control — and the map maker was useless to anybody else until somebody
 * did. It is a lock now instead: joinPark refuses the socket outright while worldIsDrawn(), so a
 * drawn park is a park with nobody else in it no matter who calls setWorld or why.
 *
 * ⚠️ AND THE QUERIES LIVE HERE RATHER THAN IN walk.ts, which is the whole reason this file
 * exists. `nearestMark` and `markAt` read the list of places; if they stayed beside the
 * built-in one they would answer about the built-in park while somebody walked around a
 * different one. Moving them is how the two cannot come apart.
 */

/**
 * How high each built-in landmark stands, in pet-heights.
 *
 * ⚠️ MOVED HERE FROM ground.ts, unchanged, because the heights and the places are one table
 * once a drawing can supply both — and ground.ts importing this while this imported ground.ts
 * would be a cycle. The reasoning behind the three numbers is still the one written there:
 * a jump peaks at HOP.up, which is 0.62, so the ring is a step, the rocks are a scramble, and
 * the far trees are the place you can only reach with wings.
 */
const TOPS: Record<string, number> = {
  'the ring': 0.22,
  'the rocks': 0.5,
  'the far trees': 0.72,
}

const BUILT_IN: Ground[] = MARKS.filter((m) => m.name in TOPS).map((m) => ({
  at: m.at,
  size: m.size,
  top: TOPS[m.name],
  name: m.name,
  kind: m.kind,
}))

let drawn: Place[] | null = null
/** whether ANY part of the world was supplied rather than built in — see setWorld */
let custom = false
let shownMarks: Mark[] = MARKS
let shownPlanes: Ground[] = BUILT_IN
let shownWalls: Wall[] = []

const listeners = new Set<() => void>()
let version = 0

export const subscribeWorld = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
/** for useSyncExternalStore — changes whenever the park does */
export const worldVersion = () => version

/** every landmark in the park you are actually in */
export const worldMarks = (): Mark[] => shownMarks
/** every one of them you can stand on top of */
export const worldPlanes = (): Ground[] => shownPlanes
/**
 * Every one you cannot walk through — see solid.ts.
 *
 * ⚠️ THE BUILT-IN PARK HAS NONE, and that is deliberate rather than an omission. Its five
 * landmarks have never stopped anybody and the note on MARKS says why: "they decide nothing",
 * because a landmark that changed the fight would be a fight you have to learn the map to win.
 * A drawn map is where somebody chooses otherwise, for their own map.
 */
export const worldWalls = (): Wall[] => shownWalls
/**
 * True while the park is something somebody drew.
 *
 * ⚠️ READ BY joinPark, AND THAT IS THE POINT OF IT. This is the one question that decides
 * whether the relay may be spoken to at all — see the note at the top.
 */
export const worldIsDrawn = (): boolean => custom

/**
 * Walk a drawing instead of the built-in park, or pass null to go back.
 *
 * ⚠️ A DRAWN PLACE WITH NO HEIGHT IS STILL A LANDMARK. It goes in the marks — so it is on the
 * little map, it has a name you can say, and "you are at the pond" works — and it simply does
 * not go in the planes. That is the same split the built-in park makes, where two of its five
 * places are scenery.
 */
/**
 * ⚠️ ONE ARGUMENT THAT IS EITHER A WORLD OR NULL, rather than a list that might be
 * empty. A map can be nothing but painted zones, or nothing but painted ground — both are
 * somebody's map and neither has a single PLACE in it. Asked "is this list empty", the room
 * answered "then you must be in the built-in park", and handed back the shared park's five
 * landmarks to stand among, with its own walls bolted on. Worse, worldIsDrawn is the lock that
 * makes joinPark refuse the socket, so that world would also have gone on the wire: a room
 * where everybody else can walk through what stops you.
 *
 * Whether a world is DRAWN and whether it happens to CONTAIN anything are two questions, and
 * only the caller knows the first one.
 */
export function setWorld(world: { places: Place[] | null; blocks?: Wall[] } | null) {
  const places = world?.places ?? null
  const blocks = world?.blocks ?? []
  drawn = places && places.length ? places : null
  custom = !!world
  if (!custom) {
    shownMarks = MARKS
    shownPlanes = BUILT_IN
    shownWalls = []
  } else if (!drawn) {
    /* a drawn world with no places: no landmarks at all, rather than somebody else's */
    shownMarks = []
    shownPlanes = []
    shownWalls = blocks
  } else {
    shownMarks = drawn.map((p) => ({
      at: p.at,
      size: p.size,
      kind: p.kind,
      name: p.name,
      /* the picture rides along, or the mark falls back to its kind's mound — see Mark.art */
      art: p.art,
    }))
    /* ⚠️ A WALL IS NOT SOMETHING YOU STAND ON, whatever height was typed after it. The
       two are different answers to different questions and a place that was both would have
       to decide what happens when you walk into it from above — see solid.ts. */
    shownPlanes = drawn
      .filter((p) => p.top > 0 && p.kind !== 'wall')
      .map((p) => ({ at: p.at, size: p.size, top: p.top, name: p.name, kind: p.kind }))
    shownWalls = drawn
      .filter((p) => p.kind === 'wall')
      /* ⚠️ a place carrying a PICTURE is solid to the edge of the box it was stamped in;
         one without is a park landmark and keeps the two-thirds — see wallOf */
      .map((p) => wallOf(p.box.x0, p.box.y0, p.box.x1, p.box.y1, p.name, p.art ? 1 : undefined))
      /* painted zones are walls like any other, and by the time they arrive here they are
         already boxes — see zoneWalls, which is what turns a grid into a few rectangles */
      .concat(blocks)
  }
  version++
  for (const fn of listeners) fn()
}

/**
 * The place nearest to somewhere, which is never null.
 *
 * ⚠️ markAt ASKS "AM I AT ONE", THIS ASKS "WHICH ONE IS THIS NEAR". Two different questions:
 * the first is for telling you where you are standing and has to be able to say "nowhere in
 * particular"; the second is for putting something somewhere nameable and must always answer.
 *
 * ⚠️ AND IT CAN BE ASKED OF AN EMPTY PARK NOW, which the built-in one never could. A drawing
 * with nothing named in it is a real thing somebody can be walking around, so "never null"
 * needs somewhere to fall back to rather than reading MARKS[0] off the end of an empty list.
 */
export const nearestMark = (at: Spot): Mark => {
  const all = shownMarks
  if (!all.length) return { at: { x: 0.5, y: 0.5 }, size: 0.3, kind: 'ring', name: 'the middle' }
  return all.reduce((best, m) => {
    const d = (o: Mark) =>
      Math.hypot((((at.x - o.at.x) / VIEW.w) * 16) / 10, (at.y - o.at.y) / VIEW.h)
    return d(m) < d(best) ? m : best
  }, all[0])
}

export const markAt = (me: Spot): Mark | null => {
  for (const m of shownMarks) {
    const dx = ((me.x - m.at.x) / VIEW.w) * (16 / 10)
    const dy = (me.y - m.at.y) / VIEW.h
    if (Math.hypot(dx, dy) <= m.size) return m
  }
  return null
}
