import { slotKey } from './kept'

/**
 * What this browser has asked the account to do and not yet heard back about.
 *
 * ⚠️ BECAUSE A SEND THAT FAILED WAS COUNTED AS SENT. supabase-js does not throw when a request
 * fails — a dropped connection resolves `{ data: null, error }` — and watchLibrary moved its
 * snapshot on whether or not the account had answered. So a delete that failed was never sent
 * again, and the next load's sync found the row still on the account and pulled it back as if
 * it had never been deleted. An edit that failed was never sent again either, and sync skips any
 * name the account already holds, so the account kept the old version for good.
 *
 * ⚠️ SO AN OP LEAVES HERE ONLY WHEN THE ACCOUNT SAYS IT LANDED. Until then it waits: sent again
 * after a bounded backoff, on the next change, and on the next load's sync — which is why it is
 * written down rather than held in memory, since closing the tab is the commonest way a retry
 * never happens.
 *
 * ⚠️ AND IT IS A TOMBSTONE, WHICH IS WHAT SYNC NEVER HAD. Sync never deletes because "missing
 * here" means both "I deleted it" and "I have never seen it" (cloud.ts). A drop written here is
 * the first of those, recorded at the moment it was known — so sync can send it, and must not
 * pull that row back while it is owed. It is kept per account, because a delete is owed to the
 * account that made it and to nobody who signs in after them.
 *
 * Nothing here talks to the network or to storage, so a test can ask it anything.
 */

export type Op = 'put' | 'drop'
export type Owed = { op: Op; kind: string; name: string }
/** keyed by slotKey, so one thing has one entry however its name is cased */
export type Outbox = Map<string, Owed>
/** what the watcher compares: one thing on this machine */
export type Item = { kind: string; name: string; body: unknown }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Write down what changed here since the last look. The latest intent for a slot wins: a thing
 * deleted and made again is owed as a put, and a thing edited and then deleted as a drop.
 *
 * `touched` names every slot that changed, so a refusal held back for the old body can be asked
 * about again now that there is a new one.
 */
export function noteChanges(
  box: ReadonlyMap<string, Owed>,
  before: ReadonlyMap<string, Item>,
  now: ReadonlyMap<string, Item>,
): { box: Outbox; touched: string[] } {
  const out: Outbox = new Map(box)
  const touched: string[] = []
  for (const [k, r] of now) {
    const was = before.get(k)
    if (was && same(was.body, r.body)) continue
    out.set(k, { op: 'put', kind: r.kind, name: r.name })
    touched.push(k)
  }
  for (const [k, r] of before) {
    if (now.has(k)) continue
    out.set(k, { op: 'drop', kind: r.kind, name: r.name })
    touched.push(k)
  }
  return { box: out, touched }
}

export type Send<T extends Item = Item> =
  | { key: string; op: 'drop'; kind: string; name: string }
  | { key: string; op: 'put'; item: T }

/**
 * What to send now, and which entries no longer mean anything.
 *
 * ⚠️ A DROP FOR SOMETHING THIS MACHINE STILL HOLDS IS NEVER SENT. It is stale — the thing came
 * back by some other road — and deleting from the account what this browser has would be the
 * eviction-is-a-delete bug from the other side (CLAUDE.md §8). It is let go, and the copy here is
 * what the account is brought level with.
 *
 * ⚠️ A PUT FOR SOMETHING NO LONGER HERE IS LET GO TOO. If it had been deleted while this was
 * watching it would be a drop already; gone without that means it went while nobody was
 * watching, and deletions do not travel that way.
 *
 * Drops go first, because a delete makes room and the account refuses an add when it is full.
 * `held` is what the account refused this visit; it waits for its next change or the next load.
 */
export function due<T extends Item>(
  box: ReadonlyMap<string, Owed>,
  now: ReadonlyMap<string, T>,
  held: ReadonlySet<string> = new Set(),
): { send: Send<T>[]; stale: string[] } {
  const drops: Send<T>[] = []
  const puts: Send<T>[] = []
  const stale: string[] = []
  for (const [k, o] of box) {
    const here = now.get(k)
    if (o.op === 'drop' ? !!here : !here) {
      stale.push(k)
      continue
    }
    if (held.has(k)) continue
    if (o.op === 'drop') drops.push({ key: k, op: 'drop', kind: o.kind, name: o.name })
    else if (here) puts.push({ key: k, op: 'put', item: here })
  }
  return { send: [...drops, ...puts], stale }
}

/**
 * How a send went.
 *
 *   sent     the account answered with no error
 *   refused  the account answered with a reason about the THING — too big, library full,
 *            suspended. Asking again with the same body gets the same sentence, so it waits for
 *            the body to change, for room to be made, or for the next load.
 *   failed   anything else: no answer, a 5xx, a token mid-refresh. Worth asking again soon.
 *
 * ⚠️ 'not authenticated' IS A FAILURE, NOT A REFUSAL, though it is raised the same way. The
 * watcher only sends while somebody is signed in, so hearing it means a token in the middle of a
 * refresh — which the next try gets past.
 */
export type Outcome = 'sent' | 'refused' | 'failed'

export function outcomeOf(error: unknown): Outcome {
  if (!error) return 'sent'
  const e = error as { code?: unknown; message?: unknown }
  /* P0001 is plpgsql's `raise exception`: library_put says no in a sentence */
  if (e.code === 'P0001' && e.message !== 'not authenticated') return 'refused'
  return 'failed'
}

/**
 * How long to wait before sending again after the `tries`th pass in a row that failed, or null
 * to stop asking on a timer. Doubling from five seconds, never more than five minutes apart, and
 * done after eight — about a quarter of an hour. What is still owed then stays written down for
 * the next change, the network coming back, or the next load.
 */
const FIRST_RETRY_MS = 5_000
const LONGEST_RETRY_MS = 5 * 60_000
export const RETRIES = 8

export function retryDelay(tries: number): number | null {
  if (!Number.isInteger(tries) || tries < 0 || tries >= RETRIES) return null
  return Math.min(FIRST_RETRY_MS * 2 ** tries, LONGEST_RETRY_MS)
}

/**
 * Whether sync should push this machine's copy of a thing.
 *
 * ⚠️ `owed` IS THE HALF THAT WAS MISSING. Sync skips any add-only name the account already holds,
 * because having it is the whole question for a song or a drawing — but an EDIT that never landed
 * is the account holding an older one, and only the outbox knows. `same` is only known for a
 * merged kind, whose body sync fetches; for the rest it is false, and an owed edit is sent.
 */
export function shouldPush(p: {
  theyHaveIt: boolean
  owed: boolean
  merged: boolean
  same: boolean
}): boolean {
  if (!p.theyHaveIt) return true
  if (p.owed || p.merged) return !p.same
  return false
}

/** Where one account's outbox is written down on this machine. */
export const outboxKey = (uid: string) => `library.outbox.v1:${uid}`

/**
 * Read a written-down outbox.
 *
 * ⚠️ RE-VALIDATED, because localStorage is editable by anything on this origin. Every entry is
 * re-keyed from its own kind and name rather than trusting the key it was stored under, and
 * anything that is not an op on a named thing is left out.
 */
export function readOutbox(raw: string | null): Outbox {
  const out: Outbox = new Map()
  let v: unknown
  try {
    v = JSON.parse(raw || '[]')
  } catch {
    return out
  }
  if (!Array.isArray(v)) return out
  for (const e of v) {
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    if (o.op !== 'put' && o.op !== 'drop') continue
    if (typeof o.kind !== 'string' || !o.kind) continue
    if (typeof o.name !== 'string' || !o.name.trim()) continue
    out.set(slotKey(o.kind, o.name), { op: o.op, kind: o.kind, name: o.name })
  }
  return out
}

export const packOutbox = (box: ReadonlyMap<string, Owed>): string =>
  JSON.stringify([...box.values()].map((o) => ({ op: o.op, kind: o.kind, name: o.name })))
