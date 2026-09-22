import type { Ground } from './ground'
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
 * to be. A drawn map is not on the wire, so two people with different maps would be standing
 * on rocks the other cannot see — which is why the only thing that sets one is the dev
 * workbench. That is enforcement by construction rather than by a rule somebody has to
 * remember: there is no control anywhere else.
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
let shownMarks: Mark[] = MARKS
let shownPlanes: Ground[] = BUILT_IN

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
/** true while the park is something somebody drew */
export const worldIsDrawn = (): boolean => drawn !== null

/**
 * Walk a drawing instead of the built-in park, or pass null to go back.
 *
 * ⚠️ A DRAWN PLACE WITH NO HEIGHT IS STILL A LANDMARK. It goes in the marks — so it is on the
 * little map, it has a name you can say, and "you are at the pond" works — and it simply does
 * not go in the planes. That is the same split the built-in park makes, where two of its five
 * places are scenery.
 */
export function setWorld(places: Place[] | null) {
  drawn = places && places.length ? places : null
  if (!drawn) {
    shownMarks = MARKS
    shownPlanes = BUILT_IN
  } else {
    shownMarks = drawn.map((p) => ({ at: p.at, size: p.size, kind: p.kind, name: p.name }))
    shownPlanes = drawn
      .filter((p) => p.top > 0)
      .map((p) => ({ at: p.at, size: p.size, top: p.top, name: p.name, kind: p.kind }))
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
