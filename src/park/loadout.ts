import { CAST, type CastKind } from './cast'

/**
 * The three big moves YOU take into the park, as opposed to the three a boss was drawn with.
 *
 * ⚠️ THE PLAYER AND THE BOSS SHARED ONE FUNCTION, AND IT ONLY SUITED ONE OF THEM. Both kits
 * came out of `temperOf`, which reads them off the drawing — and for a boss that is the whole
 * point, its own note says so: three casts every creature threw identically was "the one place
 * in this module where the drawing stopped deciding", and the order IS the character.
 *
 * For a player it is the opposite. `temperOf` forks the ranged slot on
 * `paceN >= 0.52 ? 'bolt' : 'mark'`, so a creature gets a bolt OR a mark and never both — which
 * means a slow creature has no way to throw a bolt at all, and its owner has no way to find out
 * that a bolt exists. Reported exactly that way: "I'm not sure how to cast the bolt."
 *
 * ⚠️ SO A BOSS IS STILL WHAT SOMEBODY DREW AND A PLAYER IS WHAT SOMEBODY CHOSE. Nothing about
 * temperOf changes; this sits in front of it for one creature only, the one you are steering.
 *
 * ⚠️ AND THE WIRE DOES NOT CARE. A cast travels as its KIND — castSlot maps bloom/mark/wave/bolt
 * to 7..10 — never as an index into anybody's three. So changing which kinds you hold needs no
 * protocol change and no relay deploy, and a peer running an older build reads your bolt as a
 * bolt because that is the only thing the number has ever meant.
 */

const KEY = 'park_loadout_v1'

/** How many you carry. Fewer than the kinds that exist, so choosing means giving something up. */
export const SLOTS = 3

export const ALL_CASTS: CastKind[] = ['bloom', 'mark', 'wave', 'bolt']

const isKind = (v: unknown): v is CastKind =>
  typeof v === 'string' && (ALL_CASTS as string[]).includes(v)

/**
 * A loadout off the disk, or null.
 *
 * ⚠️ DISTINCT, because two of the same is a slot spent on nothing — you would hold three
 * abilities and have two. It is also the one mistake a hand-edited localStorage can make that
 * looks like a working loadout.
 */
export function readLoadout(v: unknown): CastKind[] | null {
  if (!Array.isArray(v)) return null
  const out: CastKind[] = []
  for (const k of v) {
    if (!isKind(k) || out.includes(k)) continue
    out.push(k)
  }
  return out.length === SLOTS ? out : null
}

/**
 * What you have chosen, or null when you have not chosen.
 *
 * ⚠️ NULL IS NOT A DEFAULT, it is the absence of a choice — and the difference matters, because
 * the caller's fallback is the creature's own derived kit. Somebody who has never opened the
 * picker plays exactly the park they played yesterday.
 */
export function loadout(): CastKind[] | null {
  try {
    return readLoadout(JSON.parse(localStorage.getItem(KEY) || 'null'))
  } catch {
    return null
  }
}

export function setLoadout(kinds: CastKind[]): CastKind[] | null {
  const clean = readLoadout(kinds)
  try {
    if (clean) localStorage.setItem(KEY, JSON.stringify(clean))
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode or full: it holds for this visit, and a loadout is a preference rather than
       work somebody made — losing it costs three clicks, not a drawing */
  }
  return clean
}

/**
 * What to put in the belt: your choice if you made one, otherwise what the drawing rolled.
 *
 * ⚠️ PADDED FROM THE REST RATHER THAN REFUSED, so a creature whose derived kit is short still
 * fills its three. temperOf has always returned three, but this is the one place that would
 * silently show two if it ever did not.
 */
export function castsFor(derived: CastKind[] | undefined, mine: CastKind[] | null): CastKind[] {
  const start = mine ?? derived ?? []
  const out = start.filter((k, i) => isKind(k) && start.indexOf(k) === i).slice(0, SLOTS)
  for (const k of ALL_CASTS) {
    if (out.length >= SLOTS) break
    if (!out.includes(k)) out.push(k)
  }
  return out
}

/**
 * How long before that one comes back.
 *
 * ⚠️ ITS OWN WAIT, WHICH OVERTURNS A DECISION MADE ON PURPOSE. The note this replaces argued
 * for one wait shared by all three: "what keeps three casts from being three times the
 * casting... Three separate cooldowns would have been a different feature — chain all three,
 * then wait — and a much harder one to balance against a boss." It is now that different
 * feature, deliberately, because the three stopped being handed to you and became a kit you
 * choose — and one wait spent three ways is a resource you ration, where a chosen kit wants to
 * be a rotation.
 *
 * ⚠️ AND "CHAIN ALL THREE" WAS NEVER REACHABLE, which I only found by trying to prevent it. A
 * cast holds the caster for CAST[kind].time — 1.2s for a bolt, up to 1.9 for a fissure — and no
 * other can start while one is running. So the whole kit back to back already costs about four
 * and a half seconds of standing there casting, which is the window a boss acts in. The spacing
 * was always the cast's own length.
 *
 * ⚠️ SO THERE IS NO SECOND, INVISIBLE TIMER, and there was one here for about an hour. A 0.7s
 * lockout between casts looked like cheap insurance until a test pointed out it was LONGER than
 * the bolt's own 0.55s wait — so the bolt would have been governed by a rule nobody can see
 * rather than by the number that makes it the cheap fast one. A gate you cannot watch, sitting
 * on top of one you can, is a rule players learn as "sometimes it just does not fire".
 */
export const waitFor = (kind: CastKind): number => CAST[kind].wait
