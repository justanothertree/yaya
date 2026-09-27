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

/**
 * The most one item may be before the ACCOUNT refuses it, in bytes.
 *
 * ⚠️ THE SERVER'S NUMBER, NOT A LOCAL PREFERENCE. member_library carries
 * `check (octet_length(body::text) <= 131072)` as a table constraint, and library_put checks it
 * too so the caller is told which limit it hit. A local store that allows more than this is a
 * store that says "Kept" for something the account will never take — and `put` in cloud.ts
 * discards the error on purpose, because a refusal there is not a crash. So the only place that
 * can prevent the lie is the local ceiling, and it has to be this number.
 *
 * ⚠️ THREE OF THE FOUR SYNCED KINDS DID NOT HAVE ONE. The gallery's was 200KB — mine, copied
 * from the maps store's reasoning without checking what the account takes, which opened a
 * window between 128KB and 200KB where a keep reported success and never reached the server.
 * Minions and songs had no per-item ceiling at all. Looks had 60,000, safely under.
 *
 * ⚠️ AND MAPS ARE DELIBERATELY NOT HELD TO IT. They are not a kind in library/cloud.ts, so
 * there is no account copy to be refused by — their 200KB answers a different question, which
 * their own comment explains.
 */
export const ACCOUNT_ITEM_BYTES = 131072

/**
 * How big a body is in the unit the server counts.
 *
 * ⚠️ BYTES, NOT CHARACTERS, and the difference is not academic here. `octet_length` counts
 * UTF-8 bytes while `JSON.stringify(x).length` counts UTF-16 code units — so a drawing whose
 * name carries an emoji, or a layer named in a language that is not Latin-1, measures smaller
 * locally than it does on the server. Measuring in the wrong unit is how a ceiling set to
 * exactly the server's number still lets something through.
 */
export const bodyBytes = (body: unknown): number =>
  new TextEncoder().encode(JSON.stringify(body)).length

/** Will the account take this? Ask before keeping, so a room can say which wall it hit. */
export const fitsAccount = (body: unknown): boolean => bodyBytes(body) <= ACCOUNT_ITEM_BYTES
