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
 * ⚠️ AND DETERMINISTIC FROM A SEED, WHICH IS THE WHOLE MULTIPLAYER ANSWER IN EMBRYO. cast.ts
 * opens by saying nothing new goes over the wire: a boss already sends where it is and how long
 * its cast has been out, so everyone derives the same patches from the same four numbers. Fifty
 * minions cannot each be a message. But a wave that SPAWNS from a seed everyone has, and steers
 * by player positions everyone already receives, is derived rather than sent — the same bargain,
 * one size up. What that still needs before it can be trusted is a correction channel, because
 * floating point drifts and derived motion cannot be allowed to drift forever; that is a separate
 * decision and this file does not pretend to have made it.
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
export function stepSwarm<T extends Mob>(
  mobs: T[],
  seek: { x: number; y: number },
  dt: number,
  tune: Flock = FLOCK,
): T[] {
  if (!(dt > 0)) return mobs
  const out: T[] = new Array(mobs.length)
  for (let i = 0; i < mobs.length; i++) {
    const m = mobs[i]
    const toX = seek.x - m.x
    const toY = seek.y - m.y
    const far = Math.hypot(toX, toY)
    const ux = far > 1e-6 ? toX / far : 0
    const uy = far > 1e-6 ? toY / far : 0
    /**
     * ⚠️ THE TARGET PUSHES BACK WHEN YOU ARE INSIDE IT, which is the whole of `reach` and took
     * two goes to get right. Merely stopping at reach is not enough: the ones at the front have
     * neighbours only BEHIND them, so separation drives them forward into the target and
     * something always ends up standing in the middle of you — measured at a seventh of the
     * distance they were supposed to keep. A pull that fades to nothing at `reach` and reverses
     * inside it makes the target a body like any of theirs, and the crowd arranges itself round
     * it without a special case anywhere.
     */
    const pull = Math.max(-1, Math.min(1, (far - tune.reach) / tune.reach))
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
