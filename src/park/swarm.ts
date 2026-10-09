/**
 * A crowd of small things that want to reach you.
 *
 * ⚠️ PURE, AND IN ONE UNIT IT NEVER NAMES. Everything in here — positions, speeds, how far apart
 * two of them stay — is in the SAME unit, and which unit that is belongs to the caller. The park
 * would hand it pet-heights; a preview hands it pixels. This file has a long history of the
 * opposite: `across` takes screen-heights while nearly everything is written in pet-heights, and
 * leaving the conversion out cost a dodge that crossed the field and two boss attacks that could
 * never land. A module with no second unit in it has nowhere to put that mistake.
 *
 * ⚠️ AND DETERMINISTIC FROM A SEED, WHICH IS A REPRODUCIBLE SPAWN AND NOT THE MULTIPLAYER
 * ANSWER. This said it was "the whole multiplayer answer in embryo" — a wave derived on every
 * machine from one seed, needing only "a correction channel" — and that was wrong, because it
 * had counted one of the three things that differ between two machines. Frame cadence drifts,
 * yes. But stepSwarm is asked to seek the CALLER'S OWN creature, so two people would not watch
 * one crowd diverge slowly, they would watch two different crowds from the first frame; and
 * health hangs off each mob, stamped by whichever client swung. A channel correcting all three
 * would have to carry positions and health, which is an echo — and the park already has one of
 * those, for the boss. "Fifty minions cannot each be a message" is true and answers a question
 * nobody asked: forty of them are ONE message, measured at 139 characters for a wave of ten.
 * See docs/2026-10-09-shared-waves-design.md. The seed stays because a reproducible ring is
 * worth having, and that is all it is.
 */

export type Mob = {
  x: number
  y: number
  vx: number
  vy: number
}

/**
 * How a crowd behaves. All distances in the caller's unit, all times in seconds.
 */
export type Flock = {
  /** how fast one of them travels at full tilt */
  speed: number
  /** how quickly it reaches that speed */
  grip: number
  /** how close two of them get before they start pushing apart */
  apart: number
  /** how hard that push is, against the pull of the thing they want */
  shove: number
  /**
   * How close one of them tries to get before it stops closing.
   *
   * ⚠️ WITHOUT THIS THEY CONVERGE ON A POINT, AND A POINT IS NOT WHAT THEY ARE CHASING. Seeking
   * the target's exact centre means fifty things all want to occupy one coordinate, so separation
   * spends its whole budget fighting the pull and they end up in a knot — measured at a fifth of
   * the distance they are meant to keep. A player has a body: the thing to want is to be NEXT to
   * them, and then the crowd arranges itself around that ring on its own.
   */
  reach: number
}

export const FLOCK: Flock = { speed: 1.6, grip: 7, apart: 0.55, shove: 1.3, reach: 0.9 }

/** Somewhere a crowd wants to be next to. The caller's unit, like everything else here. */
export type Want = { x: number; y: number }

/**
 * The most a wave is ever allowed to be.
 *
 * ⚠️ THERE WAS NO CAP, AND THAT IS A FRAME CLIFF RATHER THAN A BALANCE CHOICE. The curve below
 * ran forever: wave 49 is three hundred of them, and the note on stepSwarm says of its own
 * O(n²) loop that it "stops being fine somewhere around three hundred". Nobody has cleared
 * twenty-five waves in a sitting, which is the only reason it has never been met.
 *
 * ⚠️ AND THE NUMBER IS MEASURED RATHER THAN FELT. Timed on V8, warmed, 300 frames per size:
 * 150 mobs cost 0.61ms a frame (3.7% of a 60fps frame), 300 cost 2.49ms (15%), 400 cost 4.38ms
 * (26%). Those are for THINKING ONLY — drawing is culled by onCamera but not free, the player's
 * own physics and casts share the frame, and a phone is several times slower than the machine
 * that produced them. 154 keeps the crowd's share small enough that a slower device has room,
 * and it is wave 25 exactly.
 *
 * ⚠️ IT MAKES WAVE 25 AND EVERY WAVE AFTER IT THE SAME SIZE, which is a real consequence and
 * not a hidden one. If a run should keep getting harder past there, the difficulty has to come
 * from somewhere other than the count — tougher minions, or more than one kind — and that is a
 * design decision this constant deliberately does not make.
 */
export const WAVE_MOST = 154

/**
 * How many come in wave n, counting from one.
 *
 * ⚠️ ONE HOME, BECAUSE THE SECOND CALLER ARRIVED THE MOMENT A CLEARED WAVE SAID WHAT WAS NEXT.
 * The spawn had `10 + waveNo * 6` inline and the message needed the same rule one wave along —
 * two copies of an escalation curve, which is a thing that drifts and then lies on screen about
 * what you are walking into.
 *
 * ⚠️ AND IT LIVES HERE NOW RATHER THAN IN THE COMPONENT, so the cap can be asked a question. A
 * ceiling nothing can call is a ceiling nothing can check.
 */
export const waveSize = (no: number): number => Math.min(WAVE_MOST, 10 + (no - 1) * 6)

/**
 * A seeded number, so every machine makes the same wave.
 *
 * ⚠️ NOT Math.random(), AND THAT IS THE POINT RATHER THAN A PREFERENCE. A wave that is random on
 * each client is a different fight on each screen, and the fix for that is either sending fifty
 * positions or sending one seed. mulberry32 because it is eight lines, has no state outside the
 * number handed in, and gives the same sequence everywhere — including, importantly, the same
 * sequence on a machine that joined late and is catching up.
 */
export const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A wave, arriving in a ring around a point.
 *
 * ⚠️ A RING RATHER THAN A SCATTER, because a swarm has to come FROM somewhere. Scattered across
 * the field they are already on top of you and there is nothing to read; arriving from the edge
 * is what makes a direction to run the interesting decision. The radius is the caller's — in the
 * park it would be a little beyond what the camera shows, so they walk in rather than appear.
 */
export function ringOf(
  n: number,
  seed: number,
  at: { x: number; y: number },
  radius: number,
): Mob[] {
  const rng = seeded(seed)
  const out: Mob[] = []
  for (let i = 0; i < n; i++) {
    /* ⚠️ spread evenly and then jittered, not placed at random: n random angles leave gaps and
       clumps, and a gap in a ring is a safe side that nobody chose to leave open */
    const a = ((i + rng() * 0.8) / n) * Math.PI * 2
    const r = radius * (0.85 + rng() * 0.3)
    out.push({ x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r, vx: 0, vy: 0 })
  }
  return out
}

/**
 * One step of the whole crowd.
 *
 * ⚠️ SEEK PLUS SEPARATION, AND SEPARATION IS WHY IT READS AS A CROWD. Without it every one of
 * them takes the same straight line and fifty creatures become one creature drawn fifty times,
 * stacked in a column. With it they spread around what they are chasing and arrive as a tide,
 * which is the thing being built.
 *
 * ⚠️ IT IS O(n²) AND THAT IS FINE AT THE SIZE THIS IS FOR. Fifty is 2,450 pair checks a frame,
 * which is nothing beside the 42ms that ten unbaked creatures cost to draw. It stops being fine
 * somewhere around three hundred, and the answer then is a grid rather than a cleverer loop —
 * worth knowing now, not worth building now.
 */
/**
 * ⚠️ GENERIC, SO A CALLER CAN HANG ITS OWN THINGS OFF A MOB. A crowd you can fight needs health
 * on each of them, and the alternative — a parallel array kept in step by hand — is one filter
 * away from a minion with somebody else's hit points. The step owns position and velocity and
 * carries the rest through untouched.
 */
/**
 * ⚠️ ONE TARGET OR EVERYBODY, AND EACH MOB PICKS THE NEAREST. A crowd in a room with four people
 * in it has to chase somebody, and "whoever called the wave" is the wrong answer — it would make
 * a wave a fight the host has while everyone else watches it happen to them.
 *
 * ⚠️ PER MOB, NOT PER CROWD. One target chosen for the whole crowd means forty creatures change
 * their minds at once when somebody crosses the midpoint — a tide that flinches. Choosing per mob
 * is what splits a crowd around two players standing apart, which is the thing co-op is for.
 *
 * ⚠️ AND NOBODY TO CHASE IS A REAL STATE, not an error. An empty list leaves the pull at zero and
 * separation still running, so a crowd whose last player walked out spreads and settles instead of
 * freezing or flying at a coordinate nothing is standing on.
 */
function nearestTo<T extends Mob>(m: T, many: readonly Want[]): Want | null {
  let best: Want | null = null
  let bestD = Infinity
  for (const w of many) {
    /* squared, because the comparison does not need the root and the root does not change it */
    const d = (w.x - m.x) * (w.x - m.x) + (w.y - m.y) * (w.y - m.y)
    if (d < bestD) {
      bestD = d
      best = w
    }
  }
  return best
}

export function stepSwarm<T extends Mob>(
  mobs: T[],
  seek: Want | readonly Want[],
  dt: number,
  tune: Flock = FLOCK,
): T[] {
  if (!(dt > 0)) return mobs
  const many = Array.isArray(seek) ? (seek as readonly Want[]) : null
  const one = many ? null : (seek as Want)
  const out: T[] = new Array(mobs.length)
  for (let i = 0; i < mobs.length; i++) {
    const m = mobs[i]
    /* ⚠️ the single-target path is the SAME ARITHMETIC IN THE SAME ORDER as before this grew a
       second shape, which is what lets a test assert that one target and a list of one are the
       same crowd down to the last bit — see swarm.test.ts */
    const want = one ?? nearestTo(m, many as readonly Want[])
    const toX = want ? want.x - m.x : 0
    const toY = want ? want.y - m.y : 0
    const far = Math.hypot(toX, toY)
    const ux = want && far > 1e-6 ? toX / far : 0
    const uy = want && far > 1e-6 ? toY / far : 0
    /**
     * ⚠️ THE TARGET PUSHES BACK WHEN YOU ARE INSIDE IT, which is the whole of `reach` and took
     * two goes to get right. Merely stopping at reach is not enough: the ones at the front have
     * neighbours only BEHIND them, so separation drives them forward into the target and
     * something always ends up standing in the middle of you — measured at a seventh of the
     * distance they were supposed to keep. A pull that fades to nothing at `reach` and reverses
     * inside it makes the target a body like any of theirs, and the crowd arranges itself round
     * it without a special case anywhere.
     */
    const pull = want ? Math.max(-1, Math.min(1, (far - tune.reach) / tune.reach)) : 0
    let ax = ux * pull
    let ay = uy * pull
    for (let j = 0; j < mobs.length; j++) {
      if (j === i) continue
      const o = mobs[j]
      const dx = m.x - o.x
      const dy = m.y - o.y
      const d = Math.hypot(dx, dy)
      if (d >= tune.apart) continue
      /* ⚠️ two in the same place have no direction to part along, so they are nudged by their
         index rather than by zero — otherwise a stack stays a stack forever */
      const nx = d > 1e-6 ? dx / d : Math.cos(i * 2.399)
      const ny = d > 1e-6 ? dy / d : Math.sin(i * 2.399)
      const push = (tune.apart - d) / tune.apart
      ax += nx * push * tune.shove
      ay += ny * push * tune.shove
    }
    /**
     * ⚠️ CAPPED, NOT NORMALISED, and that is a different animal. Normalising means every mob
     * travels at full speed for ever — a settled one with almost no force on it jitters at a
     * sprint, and a crowd that has arrived never stops vibrating. Capping lets a small force mean
     * a small movement, which is what makes them settle.
     */
    const len = Math.hypot(ax, ay)
    const fit = len > 1 ? 1 / len : 1
    const k = Math.min(1, tune.grip * dt)
    const vx = m.vx + (ax * fit * tune.speed - m.vx) * k
    const vy = m.vy + (ay * fit * tune.speed - m.vy) * k
    out[i] = { ...m, x: m.x + vx * dt, y: m.y + vy * dt, vx, vy }
  }
  return out
}

/** Which of them are close enough to the camera to be worth drawing. */
/**
 * ⚠️ DRAWING IS CULLED AND THINKING IS NOT, which is the right way round and worth saying out
 * loud because the opposite is the tempting one. A minion that stops steering while off screen
 * arrives in a clump the moment it comes back on, having spent the whole time not walking — and
 * the thing chasing you from off screen is most of what makes a swarm feel like one. Thinking
 * fifty is free; drawing them is what the spike measured.
 */
export const onCamera = (
  m: Mob,
  at: { x: number; y: number },
  halfW: number,
  halfH: number,
): boolean => Math.abs(m.x - at.x) <= halfW && Math.abs(m.y - at.y) <= halfH
