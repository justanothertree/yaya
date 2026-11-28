/**
 * When this browser's look (theme, palette, flair, backdrop) should be sent to the profile, and
 * what to do when the send does not land.
 *
 * Two rules pull against each other, and App.tsx's note on the effect explains the first at
 * length: a page LOAD must never publish, because localStorage is per browser and a new phone's
 * defaults would overwrite the real look. Only a CHANGE publishes.
 *
 * ⚠️ AND A CHANGE HAS TO ARRIVE, WHICH IT DID NOT ALWAYS. The effect recorded the new look as
 * published BEFORE the write, and ignored the write's result. supabase-js does not throw — a
 * dropped connection or a 5xx resolves as `{ error }` — so a failed publish was lost without a
 * trace: this page thought the profile had it, and a reload could not finish it either, because
 * the first run of a page only records. The profile kept the old look until the next change.
 *
 * So the memo below holds what the profile is KNOWN to have: set when a write lands, made
 * unknown while one is out, and never set from an intention. And a change this browser chose is
 * written down (`LookIntent`, in localStorage) until it lands, so a reload can finish it without
 * breaking the first rule: it only sends a look THIS browser chose, and only if it still wears it.
 */

/** What this page knows of the look on one person's profile. `sent: null` means not known. */
export type LookMemo = { uid: string; sent: string | null }
/**
 * A look this browser chose for this person and has not yet seen land.
 *
 * `base` is the look the profile was KNOWN to hold when this one was chosen — the version it was
 * chosen over — or null when that was not known. A reload replays the intent only while the
 * profile still holds `base`; see replayVerdict.
 */
export type LookIntent = { uid: string; look: string; base: string | null }

export type LookPlan = {
  memo: LookMemo
  /** send this look */
  publish: boolean
  /**
   * a look owed from an earlier visit: read the profile and ask replayVerdict before sending —
   * never send it on the strength of this browser alone
   */
  verify: boolean
  /** a stored intent for this person is stale: drop it */
  forgetIntent: boolean
}

export function planLook(
  memo: LookMemo | null,
  intent: LookIntent | null,
  uid: string,
  sig: string,
): LookPlan {
  const mine = intent?.uid === uid
  if (memo?.uid !== uid) {
    /* the first run for this person carries no intention — unless this browser chose this very
       look earlier and never saw it land, in which case it is owed */
    if (mine && intent.look === sig)
      return { memo: { uid, sent: null }, publish: false, verify: true, forgetIntent: false }
    /* a different person is a first run of their own, or signing in as somebody else on a shared
       browser would publish the look the last one happened to be using */
    return { memo: { uid, sent: sig }, publish: false, verify: false, forgetIntent: mine }
  }
  if (memo.sent === sig) return { memo, publish: false, verify: false, forgetIntent: mine }
  return { memo, publish: true, verify: false, forgetIntent: false }
}

/**
 * A write is going out: until it answers, the profile may hold either look. Without this,
 * changing back to the old look while the new one was in flight would send nothing — and the
 * profile would end up wearing the one you left.
 */
export function lookSending(memo: LookMemo, uid: string): LookMemo {
  return memo.uid === uid ? { uid, sent: null } : memo
}

/** A write landed: the profile now has this look. */
export function lookLanded(memo: LookMemo, uid: string, sig: string): LookMemo {
  return memo.uid === uid ? { uid, sent: sig } : memo
}

const LOOK_RETRY_WAITS = [3_000, 10_000, 30_000, 90_000]

/**
 * How long to wait before sending a failed look again, or null to stop.
 *
 * Retried: nothing came back (status 0 — offline, a timeout, an abort), the server was briefly
 * unavailable (5xx, 408, 429), or the token expired mid-refresh (401, which supabase-js renews).
 * Not retried: a REFUSAL — set_my_profile_look raises for a paused account or a look it will not
 * store, and that answer would only come back again. Bounded either way: after the last wait the
 * look stays owed in localStorage, and the next change or the next load sends it.
 */
export function lookRetryIn(attempt: number, res: { status: number }): number | null {
  if (lookRefused(res)) return null
  return LOOK_RETRY_WAITS[attempt] ?? null
}

/** The server answered no. That is an answer, so the look is not owed any more. */
export function lookRefused(res: { status: number }): boolean {
  const s = res.status
  return !(s === 0 || s === 401 || s === 408 || s === 429 || s >= 500)
}

const LOOK_INTENT_KEY = 'profile_look_pending_v1'

export function readLookIntent(): LookIntent | null {
  try {
    const v = JSON.parse(localStorage.getItem(LOOK_INTENT_KEY) || 'null') as LookIntent | null
    if (!v || typeof v.uid !== 'string' || typeof v.look !== 'string') return null
    /* an intent written before `base` existed has none, so it can only land or be superseded */
    return { uid: v.uid, look: v.look, base: typeof v.base === 'string' ? v.base : null }
  } catch {
    return null
  }
}

export function keepLookIntent(intent: LookIntent): void {
  try {
    localStorage.setItem(LOOK_INTENT_KEY, JSON.stringify(intent))
  } catch {
    /* private mode: the retry within this page still runs */
  }
}

/** Drop the stored intent if it is this person's — and, given a look, only if it is that one. */
export function forgetLookIntent(uid: string, look?: string): void {
  const cur = readLookIntent()
  if (!cur || cur.uid !== uid || (look !== undefined && cur.look !== look)) return
  try {
    localStorage.removeItem(LOOK_INTENT_KEY)
  } catch {
    /* ignore */
  }
}

export type ReplayVerdict = 'send' | 'landed' | 'superseded' | 'wait'

/**
 * What to do with a look owed from an earlier visit, given what the profile holds NOW (its
 * signature, or undefined when it could not be read).
 *
 * ⚠️ THE NEWEST CHOICE WINS, AND A REPLAY IS NOT A CHOICE. A look that failed to land was kept
 * and sent again on a later load — with no way to know whether, in between, a newer look had been
 * chosen on another device. Replayed blind, the older one overwrote it (found in review, 28 Nov
 * 2026). So the intent remembers the version it was chosen over (`base`), and is sent only while
 * the profile still holds exactly that; anything else on the profile is newer and wins. A
 * compare-and-set on content, done from here because the server function has no version check.
 */
export function replayVerdict(intent: LookIntent, profileNow: string | undefined): ReplayVerdict {
  if (profileNow === undefined) return 'wait'
  if (profileNow === intent.look) return 'landed'
  if (intent.base !== null && profileNow === intent.base) return 'send'
  return 'superseded'
}

type LookArgs = { p_theme: unknown; p_palette: unknown; p_flair: unknown; p_backdrop: unknown }

/**
 * A look as one comparable string — the same for what this browser would send and for what the
 * profile row holds, so a replay can tell "unchanged" from "changed elsewhere".
 *
 * ⚠️ NORMALISED, because the two spell it differently: the server rebuilds the palette as its own
 * jsonb object, whose key order is jsonb's rather than ours, and stores hex as it was given.
 */
export function lookSig(l: LookArgs): string {
  const p = l.p_palette as { bg?: unknown; text?: unknown; accent?: unknown } | null
  const hex = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : null)
  return JSON.stringify([
    typeof l.p_theme === 'string' ? l.p_theme : null,
    p && typeof p === 'object' ? [hex(p.bg), hex(p.text), hex(p.accent)] : null,
    typeof l.p_flair === 'string' ? l.p_flair : null,
    typeof l.p_backdrop === 'string' ? l.p_backdrop : null,
  ])
}

/** The profile row's look, in lookSig's spelling. */
export function profileLookSig(row: {
  look_theme: unknown
  look_palette: unknown
  look_flair: unknown
  look_backdrop: unknown
}): string {
  return lookSig({
    p_theme: row.look_theme,
    p_palette: row.look_palette,
    p_flair: row.look_flair,
    p_backdrop: row.look_backdrop,
  })
}
