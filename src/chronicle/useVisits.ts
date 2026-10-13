import { useEffect, useRef } from 'react'
import { recordVisit } from './cloud'

/**
 * Time on the site, recorded without being asked for.
 *
 * Asked for as "the online/offline time of when i am logged in viewing the site and maybe even
 * over time what module i am in and at what times". The answer is that the two are one thing: the
 * time you were online IS the union of the time you were in rooms, so recording the rooms gives
 * both and nothing has to agree with anything.
 *
 * ⚠️ IT WRITES ORDINARY ACTIVITIES, so the rest of chronicle already works on it — the day's log
 * lists them, the category totals include them, and a goal can point at "my time in Paint" exactly
 * as it points at "Drawing". See chronicle_visit, which finds or makes one auto activity per room.
 *
 * ⚠️ AND IT NEVER OPENS AN ENTRY. The database allows exactly one entry with no end per person and
 * that one IS the hand-started timer; a visit that opened a row would fight it for the slot, so
 * starting a timer on Drawing would either fail or silently close the visit. A visit is a FINISHED
 * span that each heartbeat extends.
 */

/**
 * ⚠️ TWO MINUTES, INSIDE A THREE-MINUTE SLACK. The function extends the previous span when it
 * ended under three minutes ago, so a beat any slower than that would split one sitting into
 * separate rows. Two leaves a whole minute of margin for a slow network, and halves the traffic a
 * one-minute beat would make — this is a write a minute, forever, for every open tab.
 */
const BEAT_MS = 120_000

/**
 * ⚠️ HIDDEN IS NOT VIEWING, which is the word the ask used. A tab left open behind a window all
 * afternoon is not time spent on the site, and counting it would make the one number here a
 * measure of how often somebody forgets to close tabs. So the clock stops when the tab goes away
 * and what accrued is reported on the way out.
 */
const seeing = () => typeof document === 'undefined' || document.visibilityState === 'visible'

export function useVisits(room: string | null, authed: boolean) {
  /** when the current stretch in the current room began */
  const since = useRef(Date.now())
  /** the room that stretch belongs to, which is not always the room prop by the time we report */
  const was = useRef<string | null>(room)

  /**
   * ⚠️ A REF HOLDING THE REPORTER, so the effects below can be bound once and never torn down by
   * a changing callback. An effect whose dependency is rebuilt every render rebuilds whatever it
   * owns — and what this one owns is an interval and two window listeners.
   */
  /* the initial value is a no-op of the right shape; it is replaced on the first render below,
     before any effect can call it */
  const send = useRef<(room: string, secs: number) => Promise<void>>(() => Promise.resolve())
  send.current = async (name: string, secs: number) => {
    if (!authed || !name) return
    /* ⚠️ under the floor is not reported at all: tabbing through five rooms looking for one should
       write nothing. The server floors it at thirty seconds too, so this only saves a round trip. */
    if (secs < 30) return
    try {
      /* ⚠️ through cloud.ts rather than straight at Supabase, so the dev harness can answer it —
         this was the one chronicle call nobody could watch happening. See recordVisit. */
      await recordVisit(name, secs)
    } catch {
      /* ⚠️ a visit that does not land is not worth telling anybody about. This is bookkeeping
         nobody asked for in the moment, so a failed one must be quieter than a failed save. */
    }
  }

  /* moving room closes the book on the old one and opens it on the new */
  useEffect(() => {
    const left = was.current
    const secs = (Date.now() - since.current) / 1000
    if (left && left !== room) void send.current(left, secs)
    if (left !== room) {
      was.current = room
      since.current = Date.now()
    }
  }, [room])

  useEffect(() => {
    if (!authed) return
    /**
     * ⚠️ THE CLOCK STARTS WHEN YOU SIGN IN, NOT WHEN THE PAGE LOADED. `since` is set at mount, and
     * the page mounts for a signed-out visitor too — so somebody who read the site for twenty
     * minutes and then signed in had their first beat report twenty-two minutes, twenty of which
     * were nobody's record. The ask was "the time when I am LOGGED IN viewing the site", and this
     * is the line between the two.
     */
    since.current = Date.now()
    const beat = () => {
      if (!seeing() || !was.current) return
      const secs = (Date.now() - since.current) / 1000
      if (secs < 30) return
      void send.current(was.current, secs)
      /**
       * ⚠️ THE STRETCH RESTARTS AFTER EVERY BEAT, because the server EXTENDS the span it already
       * has rather than adding to it. Leaving `since` alone would make each beat claim the whole
       * sitting from the beginning, which the extend ignores — and the one time it does not, on
       * the first beat after the three-minute slack lapses, it would write a span reaching back
       * over a gap when nobody was there.
       */
      since.current = Date.now()
    }
    const t = window.setInterval(beat, BEAT_MS)

    /* going away reports what accrued; coming back starts a fresh stretch rather than counting
       the time the tab spent hidden */
    const flip = () => {
      if (seeing()) {
        since.current = Date.now()
        return
      }
      if (was.current) void send.current(was.current, (Date.now() - since.current) / 1000)
      since.current = Date.now()
    }
    /**
     * ⚠️ GOING AWAY REPORTS UNCONDITIONALLY, which `flip` cannot do because it has to decide.
     * pagehide was wired to flip, and flip's first question is "can I still be seen" — so on any
     * browser where the page is still VISIBLE when pagehide fires, the branch taken is the one
     * that resets the clock and reports nothing, and the tail of the visit is simply lost.
     *
     * Modern browsers do set visibility to hidden before pagehide, so in the common case flip
     * happened to do the right thing by having already reported on visibilitychange. Relying on
     * that ordering is relying on something this code cannot check, for the event that is the
     * commonest way a visit ends on a phone. Reporting twice is harmless — the server extends the
     * span it already has, and the second report is under the thirty-second floor anyway.
     */
    const away = () => {
      if (was.current) void send.current(was.current, (Date.now() - since.current) / 1000)
      since.current = Date.now()
    }
    document.addEventListener('visibilitychange', flip)
    /* ⚠️ pagehide rather than beforeunload: it fires on a phone putting the browser away, which
       beforeunload does not, and that is the commonest way a visit on a phone ends. */
    window.addEventListener('pagehide', away)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', flip)
      window.removeEventListener('pagehide', away)
    }
  }, [authed])
}
