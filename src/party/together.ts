/**
 * One switch for "share whatever I am in".
 *
 * ⚠️ THE PROBLEM IS NOT THAT SHARING IS HARD, IT IS THAT THERE ARE THREE OF IT. Playing together,
 * drawing together and sharing a window are three separate mechanisms — jam.ts, draw.ts and
 * shared.ts — each with its own on-switch, and each switch lives INSIDE the room it belongs to.
 * So sharing three things means visiting three rooms and finding three different buttons, and
 * doing it again every time somebody joins. That is the whole of the complaint.
 *
 * ⚠️ A PREFERENCE, NOT A CONTROLLER. This file does not know what jam or draw or a shared window
 * are, and must not: it holds one boolean and tells anyone who asks. Each room subscribes and
 * turns ITSELF on, because each room is the only thing that knows what sharing means for it and
 * what has to be torn down afterwards. A module that reached into all three would have to be
 * edited every time a fourth thing became shareable — this way a new room joins in by adding one
 * subscription to its own file.
 *
 * ⚠️ IT ONLY SHARES; IT NEVER FOLLOWS. Offering a window costs the room nothing and can be
 * ignored, but adopting somebody else's settings changes what is on YOUR screen. shared.ts is
 * explicit that nobody is made to follow, and a switch that quietly started doing that would be
 * a different feature wearing this one's label. Joining stays a decision.
 */

/**
 * ⚠️ NOT REMEMBERED, AND OFF AGAIN WHEN A CALL ENDS (Evan, 13 Nov). It was kept in localStorage
 * under this key, so a switch turned on once came back on by itself in every later call, and
 * party.ts's own promise ("off by default, not persisted") had quietly stopped being true. Now it
 * starts off on every load and party.ts turns it off as a call ends. The old key is removed so a
 * stale '1' cannot sit in somebody's browser meaning nothing.
 */
const OLD_KEY = 'party_share_all_v1'
try {
  localStorage.removeItem(OLD_KEY)
} catch {
  /* private mode, or no storage at all: nothing was kept */
}

let on = false

const listeners = new Set<() => void>()
/* a stable snapshot, so useSyncExternalStore does not see a new object every render */
let snap = { on }

export const together = {
  getState: () => snap,
  subscribe(fn: () => void) {
    listeners.add(fn)
    /* ⚠️ returns void, not Set.delete's boolean — this is used directly as an effect cleanup */
    return () => {
      listeners.delete(fn)
    }
  },
  setOn(next: boolean) {
    if (next === on) return
    on = next
    snap = { on }
    for (const fn of listeners) fn()
  },
}
