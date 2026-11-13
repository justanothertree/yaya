import { useEffect, useRef, useState } from 'react'
import {
  addNote,
  dropEntry,
  editEntry,
  editEntryDay,
  fixRunning,
  fixRunningDay,
  setsBetween,
  setAmount,
  setEntryPicture,
  setQuality,
} from './cloud'
import { seenPictures, type Kept } from '../pictures/cloud'
import { useBigPicture } from '../pictures/useBigPicture'
import { dayOfStart, type ChronSet } from './sets'
import {
  minsBetweenLocal,
  overlapMs,
  spanText,
  writeLocal,
  type Activity,
  type Entry,
} from './record'

/**
 * The sitting editor: which sitting it is showing, what its fields hold, the sets and photograph it
 * reads, and saving, deleting and writing a journal entry against it.
 *
 * ⚠️ A HOOK CALLED BY THE TIMER, NOT STATE INSIDE THE DIALOG, for the reason useActivityEditor is
 * one: Stop, a log row's ✎, the running display and the week grid all open this editor from
 * outside, and the state has to outlive the dialog closing and opening, exactly as when it lived
 * in Timer.tsx. The dialog draws it (SittingDialog.tsx).
 */
/** what a datetime-local input wants: local time, no zone, to the minute */
export const forInput = (iso: string): string => writeLocal(new Date(iso))

export function useSittingEditor({
  log,
  byId,
  bounds,
  busy,
  setBusy,
  moan,
  after,
  setSeeing,
}: {
  log: Entry[]
  byId: Map<string, Activity>
  bounds: { fromMs: number; toMs: number }
  busy: boolean
  setBusy: (busy: boolean) => void
  moan: (why: string) => void
  after: () => Promise<void>
  setSeeing: (day: string) => void
}) {
  /**
   * The sitting that has just ended, if its dialog is still open.
   *
   * ⚠️ IT IS A SEPARATE PIECE OF STATE FROM `fixEnt` THOUGH BOTH OPEN THE SAME EDITOR. Stopping
   * something and going back to fix it are different moments — one is offered, the other is
   * asked for — and a single flag would make "cancel" on a finish mean the same thing as
   * abandoning an edit, which it does not: there is nothing to abandon, the sitting is already
   * recorded.
   */
  const [justDid, setJustDid] = useState<string | null>(null)
  /** the amount being typed against a span, keyed by entry id */
  const [entAmount, setEntAmount] = useState('')
  /** how the span being edited went, '' for unrated — see Entry.quality */
  const [entMood, setEntMood] = useState('')
  const [fixEnt, setFixEnt] = useState<string | null>(null)
  const [entAct, setEntAct] = useState('')
  const [entNote, setEntNote] = useState('')
  /**
   * What the session really held, to the second.
   *
   * ⚠️ A `datetime-local` INPUT IS MINUTE-RESOLUTION AND THE RECORD IS NOT. `forInput` drops the
   * seconds to fill the box, so opening the editor on a 33-second sitting showed 3:43 PM in both
   * ends and `0m` between them — while the row above it read `33s`. Pressing Save would then
   * write both ends at :00 and destroy the 33 seconds, and every longer session loses up to 59
   * of them the same way, quietly, on an edit that changed nothing else.
   *
   * ⚠️ SO AN UNTOUCHED END SENDS WHAT IT ALWAYS HELD. The input is compared against what it was
   * seeded with; equal means nobody typed in it, and the original ISO goes back unchanged. Only
   * an end somebody actually moved is re-read from the box, where minute resolution is what they
   * chose and the truncation is theirs.
   */
  const entWas = useRef<{ from: string; to: string | null } | null>(null)
  /**
   * The sets counted during the sitting being edited — see sets.ts.
   *
   * ⚠️ READ SO THE EDITOR CAN SAY WHAT A MOVE DOES NOT DO, and so a start moved across midnight
   * takes them with it. Empty for every sitting until the sets draft is applied, and then for
   * every sitting nobody counted sets in — and an editor with no sets is exactly the editor there
   * has always been.
   */
  const [entSets, setEntSets] = useState<ChronSet[]>([])
  const [entFrom, setEntFrom] = useState('')
  const [entTo, setEntTo] = useState('')

  const fixStart = fixEnt ? (log.find((e) => e.id === fixEnt)?.start ?? null) : null
  useEffect(() => {
    if (!fixEnt || !fixStart) {
      setEntSets([])
      return
    }
    let dead = false
    /* the sets of a sitting are on the local day it starts — see dayOfStart */
    const day = dayOfStart(fixStart)
    const next = new Date(fixStart)
    next.setDate(next.getDate() + 1)
    void (async () => {
      const got = await setsBetween(day, dayOfStart(next.toISOString()))
      if (!dead) setEntSets(got.filter((x) => x.entry === fixEnt))
    })()
    return () => {
      dead = true
    }
  }, [fixEnt, fixStart])

  /**
   * ⚠️ THE DIALOG HAS TWO DOORS AND ONLY ONE OF THEM FILLED IT IN. ✎ seeds the fields in its own
   * click handler; a Stop opens the same dialog with nothing behind it, so it showed `—` for
   * both ends and "0m" in its own title. Seeding on the id covers both doors and cannot drift
   * from either.
   *
   * ⚠️ AND THE BOX STARTS EMPTY WHATEVER THE SITTING HOLDS, because it adds a NEW journal entry
   * rather than editing the last one — the existing ones are each editable in place above it.
   */
  useEffect(() => {
    const id = fixEnt ?? justDid
    if (!id) return
    const e = log.find((x) => x.id === id)
    if (!e) return
    seedSitting(e)
    setEntNote('')
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [fixEnt, justDid])

  /**
   * The photograph on the sitting the dialog is showing, with a link that works now.
   *
   * ⚠️ FETCHED, NOT STORED. The row keeps an id; R2 is private and every link to it is signed
   * for a short while, so a URL kept anywhere is a link that stops working with nothing to say
   * it has. This asks for one when the dialog opens and forgets it when it closes.
   */
  const [shot, setShot] = useState<Kept | null>(null)
  const bigPicture = useBigPicture()
  useEffect(() => {
    const id = fixEnt ?? justDid
    const want = id ? (log.find((x) => x.id === id)?.picture ?? null) : null
    if (!want) return setShot(null)
    let dead = false
    void (async () => {
      const got = await seenPictures([want])
      /* ⚠️ on `failed` the id is left ALONE rather than resolved to null: the row's 📷 badge
         comes from `e.picture` and is still right, and a dropped request is not evidence that
         the photograph has gone. Leaving `shot` as it was shows nothing new instead of
         asserting absence. */
      if (!dead && !got.failed) setShot(got.pictures.find((p) => p.id === want) ?? null)
    })()
    return () => {
      dead = true
    }
  }, [fixEnt, justDid, log])

  const hangPicture = async (entry: string, picture: string | null) => {
    if (busy) return
    setBusy(true)
    const bad = await setEntryPicture(entry, picture)
    setBusy(false)
    if (bad) return moan(bad.why)
    await after()
  }

  /**
   * ⚠️ IT CLEARS THE BOX BEFORE THE RELOAD, not after. `after()` refetches the day and the new
   * entry arrives in the list; leaving the text in the box as well would show it twice for as
   * long as the fetch took, which reads as having added it twice.
   */
  const addJournal = async (entry: string) => {
    const body = entNote.trim()
    if (!body || busy) return
    setBusy(true)
    const bad = await addNote(entry, body)
    setBusy(false)
    if (bad) return moan(bad.why)
    setEntNote('')
    await after()
  }

  /**
   * ⚠️ LOCAL TIME IN, ISO OUT. A `datetime-local` input gives "2026-10-12T21:30" with no zone,
   * which `new Date()` reads as LOCAL — correct here, and the one case where parsing a date string
   * is right rather than the UTC trap, because the string genuinely has no zone in it.
   */
  const saveEnt = async (metric?: string | null) => {
    if (!fixEnt || !entFrom || busy) return
    /**
     * ⚠️ THE ONE STILL GOING TAKES A DIFFERENT CALL, because it has no end to send and nothing
     * should give it one — that is what Stop is for. Everything else on the row is set after a
     * session finishes, so the running editor offers exactly the two things you notice while you
     * are working: what it is, and when it began. See chronicle_running_fix.
     */
    const running = log.find((e) => e.id === fixEnt)?.end == null
    if (running) {
      setBusy(true)
      const w = entWas.current
      const kept = w != null && forInput(w.from) === entFrom
      const from = kept ? w!.from : new Date(entFrom).toISOString()
      /* ⚠️ A SITTING WITH SETS MOVES THEM WITH ITS START, in the same call — §15c */
      const no = entSets.length
        ? await fixRunningDay(from, entAct || null, dayOfStart(from))
        : await fixRunning(from, entAct || null)
      setBusy(false)
      if (no) return moan(no.why)
      setFixEnt(null)
      await after()
      return
    }
    if (!entTo) return
    /**
     * ⚠️ REFUSED HERE, NOT ONLY GREYED. The Save button is disabled while the span is backwards,
     * which is the part a person sees — but a disabled button is a hint rather than a rule, and
     * this is the only place that knows the rule. `chronicle_entry_edit` would take the row and
     * the day would then hold a session that ends before it starts: `overlapMs` clamps it to
     * zero, so it would sit in the log reading "0m" and contribute nothing to any total, which
     * is a corrupt row that looks like an empty one.
     */
    const mins = minsBetweenLocal(entFrom, entTo)
    if (mins !== null && mins < 0) return moan('that ends before it starts')
    /* see `entWas`: an end nobody moved keeps its seconds */
    const was = entWas.current
    const sameFrom = was != null && forInput(was.from) === entFrom
    const sameTo = was?.to != null && forInput(was.to) === entTo
    setBusy(true)
    const fromISO = sameFrom ? was!.from : new Date(entFrom).toISOString()
    const toISO = sameTo ? was!.to! : new Date(entTo).toISOString()
    /**
     * ⚠️ A SITTING WITH SETS GOES THROUGH THE DAY EDITOR, which edits the span and moves the sets to
     * the local day it now starts on IN ONE CALL (§15c) — two calls would leave a moment, or a
     * failure, in which the Circuit grid and the sitting disagree about which day the reps were.
     * The note is not sent at all on that path, and the server leaves it alone.
     */
    const bad = entSets.length
      ? await editEntryDay(fixEnt, fromISO, toISO, entAct || null, dayOfStart(fromISO))
      : await editEntry(
          fixEnt,
          fromISO,
          toISO,
          /* ⚠️ THE NOTE IT ALREADY HAS, not null. This argument was hard-coded null, and the server
         read null as "clear it" — so opening a session's editor and pressing Save, changing
         nothing, destroyed whatever you had written about it. The server now reads null as "leave
         it alone" so no caller can lose one by forgetting; this sends the box, so you can change
         one or empty it on purpose. */
          /**
           * ⚠️ NULL, WHICH THE SERVER READS AS "LEAVE IT ALONE". `entNote` is the add-a-journal-entry
           * box now, not this session's note — sending it here would copy whatever is half-typed in
           * that box into the legacy `note` column on every Save. The journal is the one home for
           * what you write about a sitting; the column is frozen where it stood.
           */
          null,
          /* ⚠️ which activity it WAS, because pressing Start on the wrong one is the likeliest
         mistake this room allows and the only remedy used to be deleting the session and typing
         it in again — losing the amount, the rating and the day it was recorded. */
          entAct || null,
        )
    /**
     * ⚠️ THE AMOUNT IS A SECOND CALL, and only when the activity has something to count. It is a
     * separate function on the server for a reason the migration records — three signatures would
     * have had to change otherwise — so the UI pays one extra round trip on an edit rather than
     * the whole write path paying for a field most sessions do not have.
     */
    /**
     * ⚠️ THE SECOND AND THIRD CALLS CAN FAIL ON THEIR OWN, and this editor is the one place where
     * that is not self-evident. `setAmount` and `setQuality` answer true or false, and both
     * answers were dropped — so a span that saved while its amount did not closed the editor,
     * which is a success signal, and the row came back carrying the old number. Everywhere else
     * in this room a failed write leaves the thing visibly unchanged and says nothing, which at
     * least does not claim to have worked.
     *
     * It is still a generic sentence, because a boolean carries no reason. Saying WHICH part did
     * not take is the useful half: the span is saved either way, so nobody needs to type the
     * timestamps again.
     */
    let partly: string | null = null
    if (!bad) {
      const had = log.find((e) => e.id === fixEnt)?.amount ?? null
      if (metric) {
        const n = Number(entAmount)
        const ok = await setAmount(
          fixEnt,
          entAmount.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n,
        )
        if (!ok) partly = 'Saved — but the amount did not change.'
      } else if (had != null) {
        /**
         * ⚠️ AND A SESSION MOVED ONTO SOMETHING THAT COUNTS NOTHING LOSES ITS NUMBER, rather
         * than keeping one nothing can show. The box is gone by then, so skipping the write left
         * the old amount in the row — invisible, and waiting: moving the session back onto an
         * activity with a metric brought "60 reps" out again. Hidden state that reappears is
         * worse than a cleared field, because nobody chose it and nobody can see it to undo it.
         *
         * ⚠️ ONLY WHEN THERE IS ONE TO CLEAR, so the ordinary edit of an activity that counts
         * nothing still costs two round trips rather than three — the economy the note above is
         * about.
         */
        if (!(await setAmount(fixEnt, null))) partly = 'Saved — but the amount did not change.'
      }
    }
    /* ⚠️ a third call on an edit, for the same reason the amount is a second one — see setQuality.
       Only when it CHANGED, so the common case of nudging a timestamp stays two round trips. */
    if (!bad) {
      const was = log.find((e) => e.id === fixEnt)?.quality ?? null
      const now = entMood === '' ? null : Number(entMood)
      if (was !== now && !(await setQuality(fixEnt, now))) {
        partly = 'Saved — but the rating did not change.'
      }
    }
    setBusy(false)
    if (bad) return moan(bad.why)
    setFixEnt(null)
    await after()
    /* after the reload, so the row beside the message already shows what did save */
    if (partly) moan(partly)
  }

  /**
   * Fill the sitting editor's fields from a session.
   *
   * ⚠️ ONE COPY FOR ALL THREE DOORS. The seeding effect above, the row's ✎ and `openSitting` each
   * had these six lines, which is how one of them came to fill in less than the others before.
   * The two clicks still seed at once rather than leaving it to the effect, so the dialog never
   * draws a frame of the previous session's fields.
   */
  const seedSitting = (e: Entry) => {
    entWas.current = { from: e.start, to: e.end }
    setEntAct(e.activity)
    setEntFrom(forInput(e.start))
    setEntTo(e.end ? forInput(e.end) : '')
    setEntAmount(e.amount == null ? '' : String(e.amount))
    setEntMood(e.quality == null ? '' : String(e.quality))
  }

  /**
   * Open a sitting's editor on the day it happened — from the week grid, or from the journal.
   *
   * ⚠️ ONE FUNCTION FOR BOTH, lifted out of the week grid's handler rather than written again.
   * The editor's fields are seeded from the sitting here, and a second copy of these six lines
   * is where one of them would quietly stop seeding a field the other does — the amount, say,
   * which the week grid's version already had to remember.
   */

  const openSitting = (day: string, e: Entry) => {
    setSeeing(day)
    setFixEnt(e.id)
    seedSitting(e)
  }

  /**
   * ⚠️ IT ASKS ABOUT THE WHOLE SESSION, BECAUSE THAT IS WHAT IT DELETES. The day list shows a
   * straddling session's OVERLAP with the day you are looking at, so this read "Delete the 30m of
   * Writing?" for a session that was 1h 30m and then removed all of it, including the hour sitting
   * on yesterday's screen. A confirmation that understates what it does is worse than none: it is
   * the one moment somebody is deciding, and it was answering a different question.
   */
  const forget = async (e: Entry) => {
    const name = byId.get(e.activity)?.name ?? 'that'
    const here = overlapMs(e, bounds.fromMs, bounds.toMs, Date.now())
    /* an unbounded window, so the whole span comes back — and a running one still measures to
       the clock, and a backwards or unreadable one still comes back as zero, for free */
    const all = overlapMs(e, -Infinity, Infinity, Date.now())
    /* ⚠️ a minute of slack rather than `!==`: a session can poke a few seconds past midnight and
       "1h 30m of which 1h 30m is on this day" is a sentence about nothing */
    const spans = all - here > 60_000
    if (
      !window.confirm(
        spans
          ? `Delete the whole ${spanText(all)} of ${name}? It runs past this day — only ${spanText(here)} of it is here.`
          : `Delete the ${spanText(here)} of ${name}?`,
      )
    )
      return
    setBusy(true)
    await dropEntry(e.id)
    setBusy(false)
    await after()
  }

  return {
    justDid,
    setJustDid,
    fixEnt,
    setFixEnt,
    entAct,
    setEntAct,
    entFrom,
    setEntFrom,
    entTo,
    setEntTo,
    entAmount,
    setEntAmount,
    entMood,
    setEntMood,
    entNote,
    setEntNote,
    entWas,
    entSets,
    setEntSets,
    shot,
    bigPicture,
    hangPicture,
    addJournal,
    saveEnt,
    seedSitting,
    openSitting,
    forget,
  }
}

export type SittingEditor = ReturnType<typeof useSittingEditor>
