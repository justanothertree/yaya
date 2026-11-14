import { seatOf, waitingFor, type Rules } from './room'
import type { LabRoom } from './useLabRoom'

/** who is who in a call's room, as every toy and CallTable words it */
export function useCallWords<G, M>(lab: LabRoom<G, M>, rules: Rules<G, M>) {
  const room = lab.room
  const who = (id: string | null) =>
    id === null ? 'Empty seat' : room && id === room.me ? 'You' : (lab.names[id] ?? 'A friend')
  const mySeat = room ? seatOf(room) : null
  const waiting = room && lab.live ? waitingFor(room, rules) : null
  /**
   * ⚠️ ONLY A PLAYER LEFT ALONE IS OFFERED TO CARRY ON (Evan, 14 Nov): seated, the game still
   * going, and either the other player gone or the call's game stopped. A watcher has no game of
   * theirs to carry on.
   */
  const leftAlone =
    !!room &&
    mySeat !== null &&
    rules.turn(room.game) !== null &&
    (!lab.live || (waiting !== null && waiting !== room.me))
  return { room, who, mySeat, waiting, leftAlone }
}
