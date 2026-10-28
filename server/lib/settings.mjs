/**
 * What a multiplayer room's settings are allowed to be.
 *
 * ⚠️ THIS IS A SECURITY BOUNDARY AND IT HAD NEVER BEEN TESTED. `sanitizeSettings` is the only
 * thing standing between a client-supplied object and the state every other player in the room
 * is handed back — it ran on the relay, inside a 2,700-line module that starts a WebSocket
 * server and a Supabase client at import time, so nothing could ask it a question without
 * opening a socket. It lives here for the same reason `parseTrades` does: a rule nobody can
 * call is a rule nobody can check.
 *
 * ⚠️ IT IS AN ALLOWLIST, AND THAT IS THE PART THAT BITES. Anything not named below is DROPPED —
 * so a setting the client knows about and this file does not is not half-broken, it silently
 * reverts. Hunger was missing once: toggling it on flickered and the seconds options never
 * appeared, because the client set it, sent it, and the relay echoed the room's settings back
 * without it, undoing the click. Add a key here at the same time as the client control.
 */

/**
 * What a room starts from before the host changes anything.
 *
 * ⚠️ MIRRORS `DEFAULT_SETTINGS` in `src/game/manager.tsx` — change both together. That is a list
 * maintained by hand to stay true, which §11 says is the one thing that does not belong
 * anywhere; it cannot be imported from here (the client's is not exported, and that module pulls
 * in React, the renderer and the net client at load), so `settings.test.mjs` reads the client's
 * source and compares the field that has actually moved before.
 */
export const DEFAULT_SETTINGS = {
  grid: 30,
  apples: 4,
  passThroughEdges: true,
  canvasSize: 'medium',
}

export function sanitizeSettings(input, prev) {
  const next = { ...(prev || DEFAULT_SETTINGS) }
  if (!input || typeof input !== 'object') return next
  const s = input
  // No upper bound on apples, by request. Spawning loops against free cells and is guarded, so a
  // silly number fills the board instead of hanging; the floor of 1 is what actually matters.
  if (typeof s.apples === 'number' && s.apples >= 1) next.apples = Math.floor(s.apples)
  if (typeof s.passThroughEdges === 'boolean') next.passThroughEdges = s.passThroughEdges
  if (typeof s.grid === 'number' && s.grid >= 10 && s.grid <= 60) next.grid = s.grid
  if (typeof s.canvasSize === 'string' && ['small', 'medium', 'large'].includes(s.canvasSize)) {
    next.canvasSize = s.canvasSize
  }
  if (typeof s.race === 'boolean') next.race = s.race
  if (typeof s.tron === 'boolean') next.tron = s.tron
  if (typeof s.tronRivals === 'boolean') next.tronRivals = s.tronRivals
  if (typeof s.solidBodies === 'boolean') next.solidBodies = s.solidBodies
  if (typeof s.ghosts === 'boolean') next.ghosts = s.ghosts
  if (typeof s.hunger === 'boolean') next.hunger = s.hunger
  if (typeof s.hungerSeconds === 'number' && s.hungerSeconds >= 2 && s.hungerSeconds <= 120) {
    next.hungerSeconds = Math.floor(s.hungerSeconds)
  }
  if (typeof s.raceTarget === 'number' && s.raceTarget >= 5 && s.raceTarget <= 500) {
    next.raceTarget = Math.floor(s.raceTarget)
  }
  if (typeof s.speedMs === 'number' && s.speedMs >= 40 && s.speedMs <= 400) {
    next.speedMs = Math.floor(s.speedMs)
  }
  return next
}

/** Which board a room's settings describe — the mode a finished round is recorded under. */
export function boardModeFor(settings) {
  const s = settings || {}
  if (s.tron) return 'tron'
  if (s.race) return 'race'
  return 'survival'
}
