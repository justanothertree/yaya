/**
 * A store's one spot on this browser's disk, and whether the last write reached it.
 *
 * ⚠️ BECAUSE FIVE STORES HAD THE SAME try/catch AND ONLY ONE OF THEM TOLD ANYBODY. Every
 * store that holds something a person MADE — pictures, songs, minions, maps, saved looks —
 * ends its write by swallowing the quota error, and that is right: a keep that throws is a
 * button people cannot trust, and the thing is still there for the visit.
 * What was wrong is that the bargain was never offered. Somebody told "Kept" and then losing it
 * on reload has been misled by the message rather than by the storage.
 *
 * The gallery grew a `landed` flag for exactly this and the other four did not, which left one
 * store honest and four quiet about the same failure — the half-closed path this repository has
 * just written a rule about. One object, five users, and the next store cannot be written
 * without it.
 *
 * ⚠️ IT DOES NOT READ. Each store parses and re-validates its own shape on the way out, which
 * is the security boundary and belongs with the thing that knows the shape. This owns the one
 * question they all share and none of the ones they do not.
 */

export type Kept = {
  /** Write it down. Never throws. */
  put: (body: string) => void
  /** Did the last put reach the disk, or is it only in memory for this visit? */
  landed: () => boolean
}

/**
 * ⚠️ IT STARTS true, AND THAT IS THE HONEST DEFAULT. A store that has never been written to
 * has not failed to write, and reporting "not saved" before anybody saved anything would put a
 * warning under every empty room on the site.
 */
export function keptAt(key: string): Kept {
  let landed = true
  return {
    put(body) {
      try {
        localStorage.setItem(key, body)
        landed = true
      } catch {
        /* full, blocked, or private mode — it stays for this visit, and landed() says so */
        landed = false
      }
    },
    landed: () => landed,
  }
}
