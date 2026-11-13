import { useEffect, useMemo, useRef, useState } from 'react'
import { circuitStore, useCircuit } from '../store'
import { peopleInGroup } from '../groupFilter'
import { isImportedTotal } from '../scoring'
import { daySave } from '../daySave'
import { todayISO, localISO } from '../dates'
import { getSupabaseClient } from '../../finance/client'

/**
 * Everything the Circuit's log holds: whose day it is and which day, the numbers being typed,
 * who may change them, the autosave, the live total and its celebration, and the sheet's
 * drag-and-edit state.
 *
 * ⚠️ A HOOK CALLED BY THE LOG, the shape useActivityEditor set: the log draws the day (Log.tsx)
 * and the sheet draws the exercises (LogSheet.tsx), and both read the same state, which lives here
 * exactly as it did inside Log.
 */
export function useLog({
  defaultPersonId,
  defaultDate,
  viewGroup,
}: {
  defaultPersonId?: string
  defaultDate?: string
  viewGroup: string
}) {
  const state = useCircuit()
  // the person picker scopes to the viewed circuit (shared filter)
  const people = useMemo(() => peopleInGroup(state.people, viewGroup), [state.people, viewGroup])
  const [selPid, setSelPid] = useState(defaultPersonId ?? '')
  const [date, setDate] = useState(defaultDate ?? todayISO())
  const [vals, setVals] = useState<Record<string, string>>({})

  // slot interaction state
  const [editId, setEditId] = useState<string | null>(null) // exercise open in the edit modal
  const [armedId, setArmedId] = useState<string | null>(null) // handle pressed → card draggable
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [colEdit, setColEdit] = useState<number | null>(null) // column header being renamed
  const dirty = useRef(false) // true once the user edits values — gates autosave vs load
  const [savedPulse, setSavedPulse] = useState(0) // bumps to flash the "saved" indicator
  const [celebrate, setCelebrate] = useState(false) // brief flourish when you cross the goal
  const prevHit = useRef(false) // tracks goal-hit so the celebration fires only on the cross
  const [uid, setUid] = useState<string | null | undefined>(undefined) // undefined=loading, null=out
  const [isAdmin, setIsAdmin] = useState(false)
  // true once BOTH uid and admin status have resolved — until then we don't render the
  // Read-only badge, so a signed-in admin doesn't flash "read-only" on a default person
  // during the beat between the session resolving and is_admin() returning.
  const [authReady, setAuthReady] = useState(false)

  const pid = selPid || people[0]?.id || ''
  const person = state.people.find((p) => p.id === pid)
  // Can the signed-in user edit this person? Signed out = local demo sandbox (always editable);
  // signed in = only your OWN Circuit, or admin. Mirrors the server RLS and surfaces it so edits
  // to someone else's board aren't silently dropped.
  const canEdit = uid == null || isAdmin || person?.ownerUserId === uid
  const existing = useMemo(
    () => state.logs.find((l) => l.personId === pid && l.date === date),
    [state.logs, pid, date],
  )
  const imported = isImportedTotal(existing)

  // Drag bookkeeping cleanup. A stuck "armed" handle (mouse released without a drag) would
  // leave the card draggable and fight the scrub input. And when a slot moves to a new row on
  // drop, its own dragend can get lost — leaving it stuck at the dragging opacity (grayed out).
  // Clear all drag state on any global mouseup / dragend so nothing lingers.
  useEffect(() => {
    const clearArmed = () => setArmedId(null)
    const clearDrag = () => {
      setArmedId(null)
      setDragId(null)
      setOverId(null)
    }
    window.addEventListener('mouseup', clearArmed)
    window.addEventListener('dragend', clearDrag)
    return () => {
      window.removeEventListener('mouseup', clearArmed)
      window.removeEventListener('dragend', clearDrag)
    }
  }, [])

  // Resolve who's signed in — both for edit permissions and to default to their OWN Circuit
  // (the person they own) unless we arrived targeting someone specific. Signed out there's no
  // owner, so it falls through to the first person (the demo "Example" persona).
  useEffect(() => {
    let cancelled = false
    const sb = getSupabaseClient()
    // local session first (instant, no network) so the owner default lands fast
    void sb.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      const u = data.session?.user?.id ?? null
      setUid(u)
      if (!u) {
        setAuthReady(true)
        return
      }
      if (!defaultPersonId && !selPid) {
        const mine = state.people.find((p) => p.ownerUserId === u)
        if (mine) setSelPid(mine.id)
      }
      const { data: adm } = await sb.rpc('is_admin')
      if (cancelled) return
      setIsAdmin(adm === true)
      setAuthReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [defaultPersonId, selPid, state.people])

  // load saved values when person/date (or underlying data) changes; this is not a user
  // edit, so clear the dirty flag so it doesn't trigger an autosave.
  useEffect(() => {
    const next: Record<string, string> = {}
    if (existing && !isImportedTotal(existing)) {
      for (const e of existing.entries) if (e.val) next[e.eid] = String(e.val)
    }
    setVals(next)
    dirty.current = false
  }, [existing])

  // Autosave: after the user edits values, persist (debounced) — no Save button.
  // The dirty flag keeps load/realtime updates from re-triggering a write loop.
  useEffect(() => {
    if (!dirty.current || !person || !canEdit) return
    const t = setTimeout(() => {
      const entries = person.exercises
        .map((ex) => ({ eid: ex.id, val: parseFloat(vals[ex.id]) || 0 }))
        .filter((e) => e.val > 0)
      /**
       * ⚠️ A PHOTOGRAPH KEEPS THE DAY ALIVE. Clearing the numbers deletes the log, and the
       * picture lives ON that row — so zeroing a day you had put a photo on would have taken the
       * photo with it, silently, from an autosave nobody pressed. The same shape as the rating
       * editor's empty test. The picture itself stays in the gallery either way; what would have
       * gone is the fact that it belonged to this day.
       */
      if (entries.length === 0 && !existing?.picture) {
        if (existing) void circuitStore.deleteLog(existing.id)
      } else {
        /* ⚠️ the day as the board has it, numbers replaced — see daySave for what was being lost */
        void circuitStore.saveLog(daySave(existing, pid, date, entries))
      }
      dirty.current = false
      setSavedPulse((n) => n + 1)
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vals, pid, date])

  const cols = useMemo(() => {
    if (!person) return []
    return person.colLabels.map((label, ci) => ({
      label,
      ci,
      exs: person.exercises.filter((e) => e.col === ci).sort((a, b) => a.row - b.row),
    }))
  }, [person])

  // personal best (max raw value) per exercise, for PR hints/highlights on the slots
  const bestByEx = useMemo(() => {
    const best: Record<string, number> = {}
    if (!person) return best
    for (const l of state.logs) {
      if (l.personId !== person.id) continue
      for (const e of l.entries) {
        if (e.eid === '__total__' || !(e.val > 0)) continue
        if (!best[e.eid] || e.val > best[e.eid]) best[e.eid] = e.val
      }
    }
    return best
  }, [state.logs, person])

  // Live total + goal, computed before the early return so the celebrate effect (a hook) can
  // watch the goal-hit state.
  const goal = person?.goal ?? 100
  const total = person
    ? person.exercises.reduce((s, ex) => s + (parseFloat(vals[ex.id]) || 0) * ex.mult, 0)
    : 0
  const hit = total >= goal

  // Fire a brief celebration the moment you cross the goal while logging — only on the
  // false→true edge, and only on a real edit (not when loading an already-hit day).
  useEffect(() => {
    if (hit && !prevHit.current && dirty.current) {
      setCelebrate(true)
      const t = setTimeout(() => setCelebrate(false), 1500)
      prevHit.current = true
      return () => clearTimeout(t)
    }
    prevHit.current = hit
  }, [hit])

  const setVal = (id: string, v: string) => {
    if (!canEdit) return
    dirty.current = true
    setVals((prev) => ({ ...prev, [id]: v }))
  }
  const shiftDay = (d: number) => {
    const dt = new Date(date + 'T00:00:00')
    dt.setDate(dt.getDate() + d)
    setDate(localISO(dt))
  }

  const clear = () => {
    if (!canEdit) return
    dirty.current = true
    setVals({})
  }
  const copyLast = () => {
    if (!canEdit) return
    const prior = state.logs
      .filter(
        (l) =>
          l.personId === pid &&
          l.date < date &&
          (l.entries || []).some((e) => e.eid !== '__total__' && e.val > 0),
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    if (!prior) return
    const next: Record<string, string> = {}
    prior.entries.forEach((e) => {
      if (e.eid !== '__total__' && e.val > 0) next[e.eid] = String(e.val)
    })
    dirty.current = true
    setVals(next)
  }

  return {
    people,
    setSelPid,
    date,
    setDate,
    vals,
    setVals,
    editId,
    setEditId,
    armedId,
    setArmedId,
    dragId,
    setDragId,
    overId,
    setOverId,
    colEdit,
    setColEdit,
    savedPulse,
    celebrate,
    uid,
    authReady,
    pid,
    person,
    canEdit,
    existing,
    imported,
    cols,
    bestByEx,
    goal,
    total,
    hit,
    setVal,
    shiftDay,
    clear,
    copyLast,
  }
}

export type LogState = ReturnType<typeof useLog>
