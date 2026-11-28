import { getSupabaseClient } from '../finance/client'
import { bodiesWanted, slotKey } from './kept'
import { library, saveToLibrary, subscribeLibrary } from '../audio/library'
import { packSong, readSong } from '../audio/songFile'
import { gallery, saveArt, subscribeGallery } from '../draw/gallery'
import { packDrawing, readDrawing } from '../draw/strokes'
import { readPresets, savePreset, subscribePresets } from '../audio/vizPresets'
import { packPet, pets, readPet, savePet, subscribePets } from '../pets/pets'
import { mergeFought, mergeWins, packFought, packWins, subscribeWins } from '../park/records'
import {
  due,
  noteChanges,
  outboxKey,
  outcomeOf,
  packOutbox,
  readOutbox,
  retryDelay,
  shouldPush,
  type Outbox,
  type Outcome,
} from './outbox'

/**
 * The library, on your account instead of in one browser.
 *
 * ⚠️ THIS IS THE FIX THE BACKUP BUTTON WAS A STOPGAP FOR. Songs, drawings and saved looks were
 * localStorage and only localStorage, which is documented in each of those files as a deliberate
 * first step — and it was, until the bill came due twice in a week: songs made weeks earlier gone
 * with no browser change and nothing cleared, because browsers evict site data from sites you have
 * not visited lately; and a song made in Firefox impossible to edit from Chrome, because the
 * library is not there.
 *
 * ⚠️ LOCAL STAYS THE SOURCE THE APP READS. Every room still reads localStorage synchronously and
 * knows nothing about this file — which is what keeps the instrument and paint rooms working
 * offline, working while signed out, and working exactly as fast as they did. The server is a
 * copy that is kept level, not a thing the UI waits for.
 *
 * ⚠️ SYNC NEVER DELETES. Merging is add-only in both directions, keyed by name. "Missing on this
 * machine" is ambiguous — it means both "I deleted it" and "I have never seen it" — and without
 * tombstones to tell those apart, a tidy-looking two-way delete would quietly eat work the first
 * time somebody signed in on a fresh browser. Deletions travel only as they happen, while the app
 * is open and watching.
 *
 * ⚠️ AND A DELETION THAT HAPPENED BUT DID NOT LAND IS WRITTEN DOWN — library/outbox.ts. That is
 * the one tombstone this file keeps: made at the moment the deletion was seen, per account, and
 * gone once the account confirms it. Sync sends it and will not pull that row back meanwhile.
 * Nothing else about "missing here" changed, so sync still never deletes on its own say.
 *
 * ⚠️ AND SOME KINDS MERGE, WHICH IS THE SECOND CONTRACT THIS FILE HOLDS. Add-only answers "who
 * wins?" with "whoever got here first", which is right for a song or a drawing — you either have
 * it or you do not, and two copies of the same name are the same thing. It is wrong for a park
 * record, where both copies are real and the one on the other machine might be the QUICKER one.
 * Skipping it would drop somebody's best time without a word, which is why records stayed out of
 * here when they were written. So a kind is now one of two things, and MERGED says which:
 *
 *   add-only  song, loop, art, look, pet   having it at all is the whole question
 *   merged    wins                          both copies are real; the answer is built from both
 *
 * A merged kind is never skipped on the way in, and is pushed back out whenever the merge left
 * this machine holding something the server does not have. The rule for who wins is not here —
 * it belongs to the thing being merged, and lives in park/records.ts beside the rule a restored
 * backup file already followed.
 */

type Kind = 'song' | 'loop' | 'art' | 'look' | 'pet' | 'wins'
type Row = { kind: Kind; name: string; body: unknown }

const KINDS: Kind[] = ['song', 'loop', 'art', 'look', 'pet', 'wins']
const isKind = (v: unknown): v is Kind => typeof v === 'string' && (KINDS as string[]).includes(v)

/** Kinds where two copies can both be real, so neither side may simply skip the other. */
const MERGED: Kind[] = ['wins']
const merges = (k: Kind) => MERGED.includes(k)

/**
 * ⚠️ ONE SLOT FOR ALL OF THEM. The park's records are one document, not one row each — 200
 * records at ~90 bytes would otherwise spend half of a person's 400-item library on 18KB. Named
 * for the arena so a second one later needs no change here or on the server.
 */
const WINS_SLOT = 'park'

/** Everything kept on this machine, in the shape the server stores. */
function localRows(): Row[] {
  const out: Row[] = []
  for (const i of library()) out.push({ kind: i.kind, name: i.name, body: packSong(i.song) })
  for (const a of gallery()) out.push({ kind: 'art', name: a.name, body: packDrawing(a.art) })
  for (const p of readPresets()) out.push({ kind: 'look', name: p.name, body: p.s })
  /* ⚠️ A pet is a drawing with a name, so it costs the library one more kind and no new
     anything — see pets.ts. The name is the slot, which is also why savePet refuses duplicates. */
  for (const p of pets()) out.push({ kind: 'pet', name: p.name, body: packPet(p) })
  /* ⚠️ Only when there are any. An empty list is not a document worth a row, and emitting one
     would have watchLibrary push an empty array over a server copy that had records in it. */
  /**
   * ⚠️ BOTH HALVES OF A FIGHT IN ONE ROW, because they are one thing: what you beat and what
   * you beat it with. Two rows would be two things that can arrive out of step, and a
   * creature whose slots and whose record disagreed would be a creature that gained a part on
   * one machine and lost it on another.
   *
   * ⚠️ AND THE OLD SHAPE IS STILL READ. The body used to be a bare array of wins; mergeWins
   * takes either, so an account written before today restores exactly as it did.
   */
  const won = packWins()
  const used = packFought()
  if (won.length || used.length)
    out.push({ kind: 'wins', name: WINS_SLOT, body: { v: 2, beat: won, fought: used } })
  return out
}

/* ⚠️ the shared one — the server matches with `lower(btrim(name))` and a test asserts the pair
   agree about what one thing is called. See library/kept.ts. */
const slot = slotKey

/**
 * Put a server row into the local store it belongs to.
 *
 * ⚠️ Through the same savers the rooms use, which re-validate. A row off the network is exactly
 * as trustworthy as a file off a disk: readSong and readDrawing are the security boundary and
 * this does not go around them.
 */
function adoptLocally(r: Row): boolean {
  /* ⚠️ Merged rather than adopted: what is here already is half the answer, not a reason to
     stop. mergeWins reports whether this machine actually changed, so a sync that found the
     two already level counts nothing rather than claiming a pull. */
  if (r.kind === 'wins') {
    /* ⚠️ either shape: a bare array is the pre-v2 body, an object carries both halves */
    const body = r.body as { beat?: unknown; fought?: unknown } | unknown[]
    const beat = Array.isArray(body) ? body : body?.beat
    const used = Array.isArray(body) ? [] : body?.fought
    return mergeWins(beat) + mergeFought(used) > 0
  }
  if (r.kind === 'art') {
    const d = readDrawing(r.body)
    return d ? !!saveArt(d) : false
  }
  if (r.kind === 'pet') {
    const p = readPet(r.body)
    return p ? !!savePet(p.name, p.art) : false
  }
  if (r.kind === 'look') {
    if (!r.body || typeof r.body !== 'object') return false
    savePreset(r.name, r.body as Record<string, unknown>)
    return true
  }
  const s = readSong(r.body)
  return s ? !!saveToLibrary(r.kind, s) : false
}

/**
 * ⚠️ A REFUSAL IS NOT A CRASH, BUT IT IS NOT NOTHING EITHER. The server caps size and count, and
 * the honest outcome of hitting one is that this item stays local — which is exactly where it was
 * a moment ago, so nothing is lost and nothing should be thrown.
 *
 * ⚠️ WHAT WAS WRONG WAS RETURNING A BOOLEAN. `library_put` raises sentences — "that one is too
 * big to keep", "your library is full — delete something first" — and `!error` threw every one of
 * them away. A `400` in the console with no item named and no reason given is all anybody got,
 * and the item in question never syncs again on any machine, for ever, in silence. The caller
 * cannot say which picture is not on your account if this does not tell it.
 *
 * ⚠️ AND WHICH KIND OF NO IT WAS, because the two want opposite things. A refusal with a reason
 * gets the same sentence if asked again with the same body; a request that never got an answer
 * is worth asking again soon. outbox.ts decides which is which — see `outcomeOf`.
 */
type Answer = { outcome: Outcome; why: string }

async function ask(fn: string, args: Record<string, unknown>, fallback: string): Promise<Answer> {
  try {
    const { error } = await getSupabaseClient().rpc(fn, args)
    return { outcome: outcomeOf(error), why: error?.message || fallback }
  } catch (e) {
    /* supabase-js resolves its failures, so this is the one that got past it — still not sent */
    return { outcome: 'failed', why: e instanceof Error ? e.message : fallback }
  }
}

const put = (r: Row) =>
  ask(
    'library_put',
    { p_kind: r.kind, p_name: r.name, p_body: r.body },
    'the account would not take it',
  )

const drop = (kind: string, name: string) =>
  ask('library_drop', { p_kind: kind, p_name: name }, 'the account did not answer')

/**
 * One account's outbox, as this browser last wrote it down.
 *
 * ⚠️ READ AND WRITTEN EVERY TIME RATHER THAN ONCE, because a page load is when it is needed most:
 * the tab that owed something is the tab that closed. A disk that will not take it is not a crash
 * — the watcher keeps its own copy for the visit — it just means the next load cannot help.
 */
function owedTo(uid: string): Outbox {
  try {
    return readOutbox(localStorage.getItem(outboxKey(uid)))
  } catch {
    return new Map()
  }
}

function keepOwed(uid: string, box: Outbox) {
  try {
    if (box.size) localStorage.setItem(outboxKey(uid), packOutbox(box))
    else localStorage.removeItem(outboxKey(uid))
  } catch {
    /* full or blocked: what is owed is still in memory for this visit */
  }
}

const snapshot = () => new Map(localRows().map((r) => [slot(r.kind, r.name), r]))

/**
 * ⚠️ `refused` NAMES THE ITEMS, which is the half this used to drop. A count of failures tells
 * you something is wrong and not which thing, and the things that fail here fail PERMANENTLY —
 * an item over the ceiling is refused on this sync and on every sync after it.
 */
export type SyncResult = {
  pulled: number
  pushed: number
  failed: number
  refused: Array<{ kind: Kind; name: string; why: string }>
  /** set when the LIST failed, in which case nothing below it ran */
  why?: string
}

/**
 * Bring the two level, once.
 *
 * ⚠️ PULL BEFORE PUSH, so a fresh browser fills up before it offers anything — otherwise the
 * first sign-in on a new machine pushes an empty library's worth of nothing and then pulls, which
 * is the same result by a longer road but looks alarming in the logs.
 */
/**
 * ⚠️ AN INDEX FIRST, AND THEN ONLY THE BODIES THIS BROWSER IS MISSING. This used to call
 * `library_list`, which returns every row's whole body, on every page load — **2,187,984 bytes**
 * on the largest account — and then threw nearly all of it away. For five of the six kinds the
 * test is "do I already have a thing by this name", and the NAME answers that; the bodies were
 * being shipped to settle a question they are not needed for.
 *
 * Measured against the same account: the index is **6,285 bytes** and the one merged body is
 * **569**, so a returning browser moves about **6.8 kB instead of 2.19 MB**. Supabase meters
 * egress across the whole organisation and restricts the project rather than billing it when the
 * allowance goes, so this was the largest line on that meter by a wide margin.
 *
 * ⚠️ WHICH BODIES IS `bodiesWanted`, and it lives in kept.ts where a test can ask it. It has
 * the one exception in it that makes the rest safe: a merged kind is always fetched, because for
 * a park record both copies are real and "I have one of those" settles nothing.
 *
 * ⚠️ `uid` IS WHOSE OUTBOX TO SEND. What this browser still owes the account — a delete or an
 * edit that never landed — is sent here, so closing the tab does not lose it. It is owed to the
 * account that made it and is never sent for anybody else who signs in on this machine.
 */
export async function syncLibrary(uid: string): Promise<SyncResult> {
  const supabase = getSupabaseClient()
  const { data: index, error } = await supabase.rpc('library_index')
  /* ⚠️ THE REASON TRAVELS. This returned `null`, and App.tsx did not look at the result at all,
     so a failing list was invisible from the room and from the console alike — the only trace was
     a bare 500 in the network tab with nothing saying what had not happened because of it. */
  if (error)
    return {
      pulled: 0,
      pushed: 0,
      failed: 0,
      refused: [],
      why: error.message || 'could not read the account library',
    }

  const owed = owedTo(uid)
  const hereRows = snapshot()
  const { send: owedNow, stale } = due(owed, hereRows)
  for (const k of stale) owed.delete(k)
  /* ⚠️ DELETED HERE AND NOT YET GONE THERE. The account still lists these, and pulling them back
     is the exact bug the outbox is for — whether or not the drop below lands this time. */
  const deleted = new Set(owedNow.filter((s) => s.op === 'drop').map((s) => s.key))

  const named = (Array.isArray(index) ? index : [])
    .map((v) => v as { kind?: unknown; name?: unknown })
    .filter((v): v is { kind: Kind; name: string } => isKind(v.kind) && typeof v.name === 'string')
    .filter((v) => !deleted.has(slot(v.kind, v.name)))

  /* what is here already decides what is worth asking for */
  const hereKeys = new Set(hereRows.keys())
  const want = bodiesWanted(named, hereKeys, (k) => merges(k as Kind))

  let bodies: unknown = []
  if (want.length) {
    const got = await supabase.rpc('library_bodies', { p_slots: want })
    if (got.error)
      return {
        pulled: 0,
        pushed: 0,
        failed: 0,
        refused: [],
        why: got.error.message || 'could not read the account library',
      }
    bodies = got.data
  }

  const remote: Row[] = (Array.isArray(bodies) ? bodies : [])
    .map((v) => v as { kind?: unknown; name?: unknown; body?: unknown })
    .filter((v): v is Row => isKind(v.kind) && typeof v.name === 'string' && !!v.body)

  /**
   * ⚠️ THE PUSH HALF NEEDS THE NAMES, NOT THE BODIES, and that is why this is two sets. It
   * asks "does the account already have a thing in this slot" to decide whether to send ours —
   * which the index answers for everything, including rows whose bodies were never fetched. Using
   * `remote` for that would have pushed a copy of every item this browser already had, over the
   * top of the identical one already there: the exact opposite of the saving.
   */
  const theirKeys = new Set(named.map((r) => slot(r.kind, r.name)))

  const out: SyncResult = { pulled: 0, pushed: 0, failed: 0, refused: [] }

  /* the owed deletes first: a delete makes room, and the account refuses an add when it is full */
  for (const s of owedNow) {
    if (s.op !== 'drop') continue
    const r = await drop(s.kind, s.name)
    if (r.outcome === 'sent') owed.delete(s.key)
    else out.failed++
  }

  const here = hereKeys
  for (const r of remote) {
    /* ⚠️ A merged kind is never skipped for being present. "I already have one" is the whole
       test for a song and is no answer at all for a record — theirs may be the quicker time. */
    if (!merges(r.kind) && here.has(slot(r.kind, r.name))) continue
    if (adoptLocally(r)) out.pulled++
    else if (!merges(r.kind)) out.failed++
    /* a merged kind that changed nothing is neither a pull nor a failure — it was already level */
  }

  /* ⚠️ READ AGAIN, AFTER THE MERGE. localRows() was snapshotted above to answer "what is here";
     the pull has since rewritten the merged kinds, and pushing the pre-merge copy would send
     back exactly the version we just improved on. */
  const theirs = new Map(remote.map((r) => [slot(r.kind, r.name), r]))
  for (const r of localRows()) {
    const k = slot(r.kind, r.name)
    const had = theirs.get(k)
    const owedEdit = owed.get(k)?.op === 'put'
    const push = shouldPush({
      /* ⚠️ asked of the INDEX, so a body we never fetched still counts as present — see above */
      theyHaveIt: theirKeys.has(k),
      /* ⚠️ an edit that never landed: the account has this NAME, and an older body under it */
      owed: owedEdit,
      merged: merges(r.kind),
      /* the merge has run, so ours is theirs-or-better; only send it if it is actually better */
      same: !!had && JSON.stringify(had.body) === JSON.stringify(r.body),
    })
    if (!push) {
      /* already level, so nothing is owed for it any more */
      if (owedEdit) owed.delete(k)
      continue
    }
    const res = await put(r)
    if (res.outcome === 'sent') {
      out.pushed++
      owed.delete(k)
    } else {
      out.failed++
      out.refused.push({ kind: r.kind, name: r.name, why: res.why })
    }
  }
  keepOwed(uid, owed)
  return out
}

/**
 * Keep it level from here on.
 *
 * ⚠️ WATCHES THE STORES RATHER THAN WRAPPING THE SAVERS. saveToLibrary and saveArt are pure
 * storage and it matters that they stay that way — a network call inside them would make keeping
 * a take something that can fail, and "Keep" is a button that must not be able to. Subscribing
 * means a save is still a save, and the copy follows a moment later.
 *
 * ⚠️ A DELETE TRAVELS, because while this is running the difference between "gone from here" and
 * "never here" is known: it was in the previous snapshot. That is the same fact sync cannot
 * establish on a cold start, which is why sync never deletes and this does.
 *
 * ⚠️ AND IT IS NOT SENT UNTIL THE ACCOUNT SAYS SO. This moved its snapshot on whether or not a
 * put or a drop had landed, so a failed delete was never sent again — and the next load pulled
 * the item back — and a failed edit was never sent again either. A change is now written into
 * the outbox (outbox.ts) the moment it is seen and leaves only when the account confirms it; until
 * then it is sent again after a bounded backoff, on the next change, when the network comes back,
 * and by the next load's sync.
 *
 * ⚠️ `signedInAs` IS ASKED ON EVERY PASS, because sign-out does not stop this. What is owed is
 * owed to the account that was signed in when the change happened, and while nobody is signed
 * in a change is nobody's to send — which is what happened before, minus the refused requests.
 */
export function watchLibrary(signedInAs: () => string | null): () => void {
  let last = snapshot()
  let busy = false
  /* a change that arrived while a pass was out — it used to be dropped until the next one */
  let again = false
  let stopped = false
  let tries = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  /* this visit's copy of each account's outbox, so a disk that will not take it loses nothing
     the tab can still send */
  const boxes = new Map<string, Outbox>()
  /* what each account refused this visit; asked again when it changes or room is made */
  const held = new Map<string, Set<string>>()

  /** This account's outbox for the visit: ONE live map, so every pass and record share it. */
  const boxOf = (who: string): Outbox => {
    let box = boxes.get(who)
    if (!box) {
      box = owedTo(who)
      boxes.set(who, box)
    }
    return box
  }

  /**
   * Note what changed since the last look, into the outbox ON DISK, now. Returns who it is owed to.
   *
   * ⚠️ ON EVERY CALL, BUSY OR NOT. This used to happen only at the start of a pass, and a change
   * made while a pass was out waited for that pass's sends to finish — so a tab closed in between
   * lost it, and the next load pulled the deleted item back (found in review, 28 Nov 2026). Now
   * settle() records first and only then decides whether a pass can start.
   *
   * ⚠️ AND INTO THE LIVE MAP, IN PLACE. noteChanges answers with a new map; swapping it in while a
   * pass is out would leave that pass deleting from, and writing out, a stale copy.
   */
  const record = (): string | null => {
    const now = snapshot()
    const who = signedInAs()
    if (!who) {
      last = now
      return null
    }
    const box = boxOf(who)
    const noted = noteChanges(box, last, now)
    last = now
    for (const k of noted.touched) box.set(k, noted.box.get(k)!)
    const refused = held.get(who) ?? new Set<string>()
    held.set(who, refused)
    for (const k of noted.touched) refused.delete(k)
    /* ⚠️ written down BEFORE anything is sent, so a tab closed mid-send still owes it */
    keepOwed(who, box)
    return who
  }

  /** One look. True when something did not get an answer and is worth asking again soon. */
  const pass = async (): Promise<boolean> => {
    const who = record()
    if (!who) return false
    const box = boxOf(who)
    const refused = held.get(who)!

    const { send, stale } = due(box, last, refused)
    for (const k of stale) box.delete(k)
    let failed = false
    let roomMade = false
    for (const s of send) {
      /* ⚠️ owed to THIS account: if somebody else signed in mid-pass, the rest waits for it */
      if (signedInAs() !== who) break
      const owed = box.get(s.key)
      const r = s.op === 'drop' ? await drop(s.kind, s.name) : await put(s.item)
      const what = s.op === 'drop' ? `${s.kind} "${s.name}"` : `${s.item.kind} "${s.item.name}"`
      if (r.outcome === 'sent') {
        /* ⚠️ only the entry that was sent: one recorded while it was out is newer, and still owed */
        if (box.get(s.key) === owed) box.delete(s.key)
        if (s.op === 'drop') roomMade = true
      } else if (r.outcome === 'refused') {
        /* ⚠️ the watcher cannot show anything — it fires long after any button was pressed —
           but it can say so where the refusal is at least findable */
        refused.add(s.key)
        console.warn(`[library] ${what} was not kept: ${r.why}`)
      } else {
        failed = true
        if (tries === 0)
          console.warn(`[library] ${what} has not reached your account yet: ${r.why}`)
      }
    }
    keepOwed(who, box)
    /* a delete that landed may be the room a refused add was waiting for */
    if (roomMade && refused.size) {
      refused.clear()
      again = true
    }
    return failed
  }

  const settle = () => {
    if (stopped) return
    /* written down first, whatever happens next — see record() */
    record()
    if (busy) {
      again = true
      return
    }
    busy = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    void (async () => {
      let failed = false
      try {
        do {
          again = false
          failed = await pass()
        } while (again && !stopped)
      } catch {
        failed = true
      } finally {
        busy = false
      }
      if (stopped) return
      if (!failed) {
        tries = 0
        return
      }
      /* ⚠️ BOUNDED: when the schedule runs out, what is owed stays written down for the next
         change, the network coming back, or the next load — never dropped */
      const wait = retryDelay(tries)
      if (wait == null) return
      tries++
      timer = setTimeout(() => {
        timer = null
        settle()
      }, wait)
    })()
  }

  /* a person doing something, or the network coming back, starts the schedule again */
  const fresh = () => {
    tries = 0
    settle()
  }
  const online = typeof window !== 'undefined' && typeof window.addEventListener === 'function'
  if (online) window.addEventListener('online', fresh)

  /* ⚠️ The park too, or a record set in this session would sit here until the next sign-in.
     A win only ever improves the document, so the push half is all that ever fires for it —
     the drop half needs the slot to disappear, which takes deleting every record you have. */
  const offs = [
    subscribeLibrary(fresh),
    subscribeGallery(fresh),
    subscribePresets(fresh),
    subscribePets(fresh),
    subscribeWins(fresh),
  ]
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    if (online) window.removeEventListener('online', fresh)
    offs.forEach((off) => off())
  }
}
