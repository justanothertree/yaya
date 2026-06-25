// Daily log — pick a person + date, enter per-exercise amounts, watch points/goal live.
// The exercise grid is a "sheet" of slots: moveable (drag the ⠿ handle to reorder within or
// across columns), and edited in a focused modal (name / multiplier / unit / category / tags).
// Entries autosave through the shared store (localStorage now, Supabase realtime later), so
// there's no Save button and every change gets undo/redo + sync for free.
import { useEffect, useMemo, useRef, useState } from 'react'
import { circuitStore, useCircuit } from '../store'
import { isImportedTotal, logPoints } from '../scoring'
import { CAT_COLORS, catColor } from '../catColors'
import { ScrubInput } from './ScrubInput'
import { Modal } from './Modal'
import { GoalBar } from './GoalBar'
import { todayISO, localISO } from '../dates'
import { getSupabaseClient } from '../../finance/client'
import type { Exercise } from '../types'

const CATS = Object.keys(CAT_COLORS)
// suggestions only — the unit field is free text, so you can type your own
const UNITS = ['reps', 'min', 'sec', 'mi', 'km', 'hr', 'cal', 'lbs', 'steps']
const newId = () =>
  crypto.randomUUID?.() ?? 'e' + Date.now() + Math.random().toString(36).slice(2, 6)

export function Log({
  defaultPersonId,
  defaultDate,
}: {
  defaultPersonId?: string
  defaultDate?: string
} = {}) {
  const state = useCircuit()
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

  const pid = selPid || state.people[0]?.id || ''
  const person = state.people.find((p) => p.id === pid)
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

  // Default to the signed-in user's OWN Circuit (the person they own), unless we arrived
  // here targeting someone specific (clicked from the feed/board). Signed out, there's no
  // owner, so it falls through to the first person (the demo "Example" persona).
  useEffect(() => {
    if (defaultPersonId || selPid) return
    let cancelled = false
    void getSupabaseClient()
      .auth.getUser()
      .then(({ data }) => {
        const uid = data.user?.id
        if (cancelled || !uid) return
        const mine = state.people.find((p) => p.ownerUserId === uid)
        if (mine) setSelPid(mine.id)
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
    if (!dirty.current || !person) return
    const t = setTimeout(() => {
      const entries = person.exercises
        .map((ex) => ({ eid: ex.id, val: parseFloat(vals[ex.id]) || 0 }))
        .filter((e) => e.val > 0)
      if (entries.length === 0) {
        if (existing) void circuitStore.deleteLog(existing.id)
      } else {
        void circuitStore.saveLog({
          id: existing?.id ?? `l-${pid}-${date}`,
          personId: pid,
          date,
          entries,
        })
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

  if (!person) return <p className="muted">No participants yet.</p>

  const total = person.exercises.reduce((s, ex) => s + (parseFloat(vals[ex.id]) || 0) * ex.mult, 0)
  const goal = person.goal ?? 100
  const hit = total >= goal
  const laps = Math.floor(total / goal)
  const extra = Math.round(total % goal)
  const goalNote = !hit
    ? `/ ${goal} pts`
    : laps > 1
      ? `/ ${goal} pts ✓ ×${laps} goal!`
      : extra > 0
        ? `/ ${goal} pts ✓ +${extra} bonus`
        : `/ ${goal} pts ✓ goal hit!`

  const setVal = (id: string, v: string) => {
    dirty.current = true
    setVals((prev) => ({ ...prev, [id]: v }))
  }
  const shiftDay = (d: number) => {
    const dt = new Date(date + 'T00:00:00')
    dt.setDate(dt.getDate() + d)
    setDate(localISO(dt))
  }

  // ── exercise-grid edits (persist through the store) ───────────────────────
  const saveExs = (next: Exercise[]) => void circuitStore.savePerson({ ...person, exercises: next })
  const renameCol = (ci: number, label: string) =>
    void circuitStore.savePerson({
      ...person,
      colLabels: person.colLabels.map((l, i) => (i === ci ? label : l)),
    })
  const addCol = () => {
    void circuitStore.savePerson({ ...person, colLabels: [...person.colLabels, 'New column'] })
    setColEdit(person.colLabels.length) // open the fresh header for naming
  }
  // delete a column: its exercises merge into the neighbouring column (no data lost),
  // later columns shift down, and rows renumber per column. Keeps at least one column.
  const deleteCol = (ci: number) => {
    if (person.colLabels.length <= 1) return
    const target = ci > 0 ? ci - 1 : 0
    const moved = person.exercises.map((e) =>
      e.col === ci ? { ...e, col: target } : e.col > ci ? { ...e, col: e.col - 1 } : e,
    )
    const byCol: Record<number, Exercise[]> = {}
    for (const e of moved) (byCol[e.col] ||= []).push(e)
    const exercises = Object.values(byCol).flatMap((arr) => arr.map((e, i) => ({ ...e, row: i })))
    const colLabels = person.colLabels.filter((_, i) => i !== ci)
    void circuitStore.savePerson({ ...person, exercises, colLabels })
    setColEdit(null)
  }
  const patchEx = (id: string, p: Partial<Exercise>) =>
    saveExs(person.exercises.map((e) => (e.id === id ? { ...e, ...p } : e)))
  const delEx = (id: string) => {
    saveExs(person.exercises.filter((e) => e.id !== id))
    setVals((prev) => {
      const n = { ...prev }
      delete n[id]
      return n
    })
    if (editId === id) setEditId(null)
  }
  const addEx = (col: number) => {
    const row = Math.max(-1, ...person.exercises.filter((e) => e.col === col).map((e) => e.row)) + 1
    const id = newId()
    saveExs([
      ...person.exercises,
      { id, name: 'New exercise', unit: 'reps', mult: 1, cat: 'other', col, row },
    ])
    setEditId(id) // open the editor on the fresh slot
  }
  // move the dragged slot into `targetCol`, dropped just before `beforeId` (or to the end)
  const reorder = (targetCol: number, beforeId: string | null) => {
    if (!dragId) return
    const moving = person.exercises.find((e) => e.id === dragId)
    if (!moving || (beforeId === dragId && moving.col === targetCol)) return
    const others = person.exercises.filter((e) => e.id !== dragId)
    const colItems = others.filter((e) => e.col === targetCol).sort((a, b) => a.row - b.row)
    let at = colItems.length
    if (beforeId) {
      const i = colItems.findIndex((e) => e.id === beforeId)
      if (i >= 0) at = i
    }
    const merged = [...colItems.slice(0, at), moving, ...colItems.slice(at)].map((e, i) => ({
      ...e,
      col: targetCol,
      row: i,
    }))
    saveExs([...others.filter((e) => e.col !== targetCol), ...merged])
  }

  const clear = () => {
    dirty.current = true
    setVals({})
  }
  const copyLast = () => {
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

  return (
    <div>
      {/* person chips */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
        {state.people.map((p) => {
          const on = p.id === pid
          return (
            <button
              key={p.id}
              className="btn"
              onClick={() => setSelPid(p.id)}
              style={{
                borderColor: p.color,
                color: on ? '#fff' : p.color,
                background: on ? p.color : 'transparent',
                fontWeight: 700,
              }}
            >
              {p.name}
            </button>
          )
        })}
      </div>

      {/* date row */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}
      >
        <button className="btn" aria-label="Previous day" onClick={() => shiftDay(-1)}>
          ‹
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ padding: '0.4rem 0.6rem' }}
        />
        <button className="btn" aria-label="Next day" onClick={() => shiftDay(1)}>
          ›
        </button>
        {date !== todayISO() && (
          <button
            className="btn btn-ghost"
            onClick={() => setDate(todayISO())}
            style={{ fontSize: '0.78rem' }}
            title="Jump to today"
          >
            ● Today
          </button>
        )}
        {existing && !imported && (
          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              color: '#22cc78',
              background: 'rgba(34,204,120,0.12)',
              border: '1px solid rgba(34,204,120,0.4)',
              borderRadius: 12,
              padding: '2px 9px',
            }}
            title="A workout is saved for this day"
          >
            Saved ✓
          </span>
        )}
        {imported && (
          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              color: '#f5c060',
              background: 'rgba(245,192,96,0.12)',
              border: '1px solid rgba(245,192,96,0.4)',
              borderRadius: 12,
              padding: '2px 9px',
            }}
            title="Imported historical total"
          >
            Imported
          </span>
        )}
      </div>

      {imported && (
        <p className="muted" style={{ marginTop: 0 }}>
          📊 Imported total: <strong>{Math.round(logPoints(person, existing!))} pts</strong> — no
          per-exercise breakdown. Entering values below will replace it.
        </p>
      )}

      {/* goal / live total */}
      <div style={{ margin: '0.5rem 0 1rem' }}>
        <GoalBar total={total} goal={goal} color="var(--accent, #7c6af7)" />
        <div className="muted" style={{ marginTop: 4 }}>
          <span
            className="cz-num"
            style={{
              fontSize: '1.4rem',
              fontWeight: 800,
              color: hit ? '#22cc78' : 'var(--accent, #7c6af7)',
            }}
          >
            {Math.round(total)}
          </span>{' '}
          <span style={{ fontSize: '0.82rem', color: hit ? '#22cc78' : undefined }}>
            {goalNote}
          </span>
        </div>
      </div>

      {/* slot sheet header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '0.25rem 0 0.6rem',
        }}
      >
        <span className="cz-sheet-hint muted" style={{ fontSize: '0.78rem' }}>
          Drag ⠿ to move · click a name to edit · click a column to rename
        </span>
        <button
          className="btn btn-ghost"
          onClick={addCol}
          style={{ fontSize: '0.8rem' }}
          title="Add a new column to the sheet"
        >
          ＋ Column
        </button>
      </div>

      {/* the sheet: columns side by side (spreadsheet style), slots stacked inside */}
      <div className="cz-ex-sheet">
        {cols.map((col) => (
          <div key={col.ci} className="cz-ex-col">
            {colEdit === col.ci ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  marginBottom: '0.4rem',
                }}
              >
                <input
                  className="cz-num"
                  value={col.label}
                  onChange={(e) => renameCol(col.ci, e.target.value)}
                  onBlur={() => {
                    setColEdit(null)
                    if (!col.label.trim()) renameCol(col.ci, 'Column')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--b2, rgba(127,127,127,0.3))',
                    padding: '0 0 2px',
                  }}
                />
                {cols.length > 1 && (
                  <button
                    className="cz-slot-btn cz-del"
                    onMouseDown={(e) => e.preventDefault()} // don't blur the input before the click
                    onClick={() => deleteCol(col.ci)}
                    title="Delete this column — its exercises merge into the neighbouring one"
                    style={{ fontSize: '0.78rem' }}
                  >
                    🗑
                  </button>
                )}
              </div>
            ) : (
              <div
                className="cz-sec"
                onClick={() => setColEdit(col.ci)}
                title="Click to rename this column"
                style={{ marginBottom: '0.4rem', cursor: 'text', display: 'inline-block' }}
              >
                {col.label || 'Column'}
              </div>
            )}
            <div className="cz-ex-grid">
              {col.exs.map((ex) => (
                <Slot
                  key={ex.id}
                  ex={ex}
                  val={vals[ex.id] ?? ''}
                  best={bestByEx[ex.id]}
                  dragging={dragId === ex.id}
                  over={overId === ex.id}
                  armed={armedId === ex.id}
                  onVal={(v) => setVal(ex.id, v)}
                  onEdit={() => setEditId(ex.id)}
                  onArm={() => setArmedId(ex.id)}
                  onDragStart={() => setDragId(ex.id)}
                  onDragEnd={() => {
                    setDragId(null)
                    setOverId(null)
                    setArmedId(null)
                  }}
                  onDragOver={() => dragId && dragId !== ex.id && setOverId(ex.id)}
                  onDragLeave={() => setOverId((o) => (o === ex.id ? null : o))}
                  onDrop={() => {
                    reorder(ex.col, ex.id)
                    setDragId(null)
                    setOverId(null)
                  }}
                />
              ))}
              <button
                className={`cz-add-slot${overId === `add-${col.ci}` ? ' cz-drag-over' : ''}`}
                onClick={() => addEx(col.ci)}
                onDragOver={(e) => {
                  if (dragId) {
                    e.preventDefault()
                    setOverId(`add-${col.ci}`)
                  }
                }}
                onDragLeave={() => setOverId((o) => (o === `add-${col.ci}` ? null : o))}
                onDrop={(e) => {
                  e.preventDefault()
                  reorder(col.ci, null)
                  setDragId(null)
                  setOverId(null)
                }}
                title="Add an exercise to this column"
              >
                ＋ add
              </button>
            </div>
          </div>
        ))}
      </div>
      <datalist id="cz-log-units">
        {UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      {/* actions — entries save automatically, so there's no Save button */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginTop: '1.25rem',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          className="btn"
          onClick={copyLast}
          title="Fill from this person's most recent workout"
        >
          ⧉ Copy last
        </button>
        <button className="btn" onClick={clear} title="Clear this day's entries (removes the log)">
          Clear
        </button>
        <span
          key={savedPulse}
          className="muted"
          style={{ fontSize: '0.78rem', marginLeft: 'auto', animation: 'czIn 0.2s ease' }}
        >
          {existing && !imported ? '✓ Saved automatically' : 'Saves automatically as you type'}
        </span>
      </div>

      {editId &&
        (() => {
          const ex = person.exercises.find((e) => e.id === editId)
          return ex ? (
            <ExerciseEditModal
              ex={ex}
              onPatch={(p) => patchEx(ex.id, p)}
              onDelete={() => delEx(ex.id)}
              onClose={() => setEditId(null)}
            />
          ) : null
        })()}
    </div>
  )
}

// ── one moveable exercise slot — a compact spreadsheet cell. Editing happens in a
//    modal (ExerciseEditModal), so the cell stays uniform and uncluttered. ───────────
function Slot({
  ex,
  val,
  best,
  dragging,
  over,
  armed,
  onVal,
  onEdit,
  onArm,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  ex: Exercise
  val: string
  best?: number
  dragging: boolean
  over: boolean
  armed: boolean
  onVal: (v: string) => void
  onEdit: () => void
  onArm: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: () => void
}) {
  const v = parseFloat(val) || 0
  const pts = v * ex.mult
  const isPR = v > 0 && !!best && v > best
  const tags = ex.tags ?? []
  return (
    <div
      className={`cz-slot${dragging ? ' cz-dragging' : ''}${over ? ' cz-drag-over' : ''}`}
      style={{ borderLeftColor: catColor(ex.cat) }}
      draggable={armed}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
    >
      <div className="cz-slot-head">
        <span className="cz-dot" style={{ background: catColor(ex.cat) }} />
        <span className="cz-slot-name" onClick={onEdit} title="Edit this exercise">
          {ex.name}
        </span>
        <button className="cz-slot-btn" onClick={onEdit} title="Edit exercise">
          ✎
        </button>
        <span className="cz-handle" title="Drag to move" onMouseDown={onArm} onTouchStart={onArm}>
          ⠿
        </span>
      </div>

      <div className="cz-slot-body">
        <ScrubInput
          value={val}
          onChange={onVal}
          style={{ width: 72, textAlign: 'right', padding: '0.35rem 0.5rem' }}
        />
        <span className="muted" style={{ fontSize: '0.75rem' }}>
          {ex.unit}
        </span>
        <span
          title={
            isPR ? 'New personal best!' : best ? `best ${Math.round(best * 10) / 10}` : undefined
          }
          style={{
            marginLeft: 'auto',
            fontVariantNumeric: 'tabular-nums',
            fontSize: '0.75rem',
            fontWeight: isPR ? 800 : undefined,
            color: isPR ? '#f5c060' : pts > 0 ? 'var(--accent, #7c6af7)' : 'inherit',
            opacity: pts > 0 ? 1 : 0.4,
          }}
        >
          {pts > 0 ? `${isPR ? '🏆 ' : ''}${Math.round(pts * 10) / 10} pt` : `×${ex.mult}`}
        </span>
      </div>
      {(best || tags.length > 0) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 4,
            marginTop: 4,
            minHeight: '0.7rem',
          }}
        >
          {best ? (
            <span
              className="cz-num"
              style={{ fontSize: '0.58rem', color: isPR ? '#f5c060' : 'var(--muted)' }}
            >
              {isPR ? '🏆 best!' : `best ${Math.round(best * 10) / 10}`}
            </span>
          ) : null}
          {tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: '0.56rem',
                padding: '1px 5px',
                borderRadius: 4,
                background: 'var(--b1, rgba(127,127,127,0.14))',
                color: 'var(--muted)',
                lineHeight: 1.5,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── focused editor for a single exercise (opened from a slot) ─────────────────
function ExerciseEditModal({
  ex,
  onPatch,
  onDelete,
  onClose,
}: {
  ex: Exercise
  onPatch: (p: Partial<Exercise>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [tagDraft, setTagDraft] = useState('')
  const tags = ex.tags ?? []
  const addTag = (t: string) => {
    const tv = t.trim().toLowerCase()
    if (tv && !tags.includes(tv)) onPatch({ tags: [...tags, tv] })
    setTagDraft('')
  }
  const removeTag = (t: string) => onPatch({ tags: tags.filter((x) => x !== t) })
  const label: React.CSSProperties = {
    display: 'block',
    fontSize: '0.72rem',
    fontWeight: 700,
    color: 'var(--muted)',
    marginBottom: 4,
  }
  const field: React.CSSProperties = { width: '100%', padding: '0.45rem 0.6rem' }
  return (
    <Modal
      title="Edit exercise"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button
            className="btn btn-ghost"
            onClick={onDelete}
            style={{ color: '#ff5566', marginRight: 'auto' }}
          >
            🗑 Delete
          </button>
          <button
            className="btn"
            onClick={onClose}
            style={{
              background: 'var(--accent, #7c6af7)',
              color: '#fff',
              borderColor: 'transparent',
            }}
          >
            Done
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <div>
          <span style={label}>Name</span>
          <input
            value={ex.name}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => onPatch({ name: e.target.value })}
            onBlur={() => {
              if (!ex.name.trim()) onPatch({ name: 'Exercise' })
            }}
            style={field}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.7rem' }}>
          <div style={{ flex: '0 0 6rem' }}>
            <span style={label}>Multiplier</span>
            <input
              type="number"
              value={ex.mult}
              onChange={(e) => onPatch({ mult: parseFloat(e.target.value) || 0 })}
              style={{ ...field, textAlign: 'right' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <span style={label}>Unit</span>
            <input
              list="cz-log-units"
              value={ex.unit}
              placeholder="reps, min, mi…"
              onChange={(e) => onPatch({ unit: e.target.value })}
              style={field}
            />
          </div>
        </div>
        <p className="muted" style={{ margin: '-0.5rem 0 0', fontSize: '0.74rem' }}>
          Points = the value you log × the multiplier.
        </p>
        <div>
          <span style={label}>Category (sets the dot color)</span>
          <select
            value={ex.cat ?? 'other'}
            onChange={(e) => onPatch({ cat: e.target.value })}
            style={field}
          >
            {CATS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span style={label}>Tags</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
            {tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: '0.74rem',
                  padding: '2px 5px 2px 9px',
                  borderRadius: 12,
                  background: 'var(--b1, rgba(127,127,127,0.15))',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {t}
                <span
                  onClick={() => removeTag(t)}
                  title="Remove tag"
                  style={{ cursor: 'pointer', opacity: 0.6, fontWeight: 700 }}
                >
                  ×
                </span>
              </span>
            ))}
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag(tagDraft)
                }
              }}
              onBlur={() => addTag(tagDraft)}
              placeholder="+ tag"
              style={{ flex: 1, minWidth: 70, padding: '0.35rem 0.5rem' }}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
