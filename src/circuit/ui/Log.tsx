// Daily log — pick a person + date, enter per-exercise amounts, watch points/goal live, save.
// The exercise grid is a "sheet" of slots that are moveable (drag the ⠿ handle to reorder
// within or across columns) and editable in place (click a name to rename / tweak its
// multiplier, unit, and category). Writes through the shared store (localStorage now,
// Supabase realtime later) so every edit gets undo/redo + sync for free.
import { useEffect, useMemo, useState } from 'react'
import { circuitStore, useCircuit } from '../store'
import { isImportedTotal, logPoints } from '../scoring'
import { showToast } from '../toast'
import { CAT_COLORS, catColor } from '../catColors'
import { ScrubInput } from './ScrubInput'
import { ExerciseManager } from './ExerciseManager'
import { GoalBar } from './GoalBar'
import type { Exercise } from '../types'

const todayISO = () => new Date().toISOString().slice(0, 10)
const CATS = Object.keys(CAT_COLORS)
const UNITS = ['reps', 'min', 'sec', 'mi', 'km', 'hr', 'other']
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
  const [managing, setManaging] = useState(false)

  // slot interaction state
  const [editId, setEditId] = useState<string | null>(null) // open edit panel
  const [armedId, setArmedId] = useState<string | null>(null) // handle pressed → card draggable
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [colEdit, setColEdit] = useState<number | null>(null) // column header being renamed

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

  // load saved values when person/date (or underlying data) changes
  useEffect(() => {
    const next: Record<string, string> = {}
    if (existing && !isImportedTotal(existing)) {
      for (const e of existing.entries) if (e.val) next[e.eid] = String(e.val)
    }
    setVals(next)
  }, [existing])

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

  const setVal = (id: string, v: string) => setVals((prev) => ({ ...prev, [id]: v }))
  const shiftDay = (d: number) => {
    const dt = new Date(date + 'T00:00:00')
    dt.setDate(dt.getDate() + d)
    setDate(dt.toISOString().slice(0, 10))
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

  const save = () => {
    const entries = person.exercises
      .map((ex) => ({ eid: ex.id, val: parseFloat(vals[ex.id]) || 0 }))
      .filter((e) => e.val > 0)
    if (entries.length === 0) {
      if (existing) void circuitStore.deleteLog(existing.id)
      return
    }
    const id = existing?.id ?? crypto.randomUUID?.() ?? 'l' + Date.now()
    void circuitStore.saveLog({ id, personId: pid, date, entries })
    showToast('Saved!')
  }
  const clear = () => setVals({})
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
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          Drag ⠿ to move · click a name or column to rename
        </span>
        <span style={{ display: 'inline-flex', gap: '0.4rem' }}>
          <button
            className="btn btn-ghost"
            onClick={addCol}
            style={{ fontSize: '0.8rem' }}
            title="Add a new column to the sheet"
          >
            ＋ Column
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setManaging(true)}
            style={{ fontSize: '0.8rem' }}
            title="Reorder, move, or delete columns and do bulk edits"
          >
            ⚙️ Columns
          </button>
        </span>
      </div>

      {/* the sheet: columns side by side (spreadsheet style), slots stacked inside */}
      <div className="cz-ex-sheet">
        {cols.map((col) => (
          <div key={col.ci} className="cz-ex-col">
            {colEdit === col.ci ? (
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
                  marginBottom: '0.4rem',
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--b2, rgba(127,127,127,0.3))',
                  padding: '0 0 2px',
                  width: '11rem',
                }}
              />
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
                  open={editId === ex.id}
                  dragging={dragId === ex.id}
                  over={overId === ex.id}
                  armed={armedId === ex.id}
                  onVal={(v) => setVal(ex.id, v)}
                  onToggleEdit={() => setEditId((id) => (id === ex.id ? null : ex.id))}
                  onPatch={(p) => patchEx(ex.id, p)}
                  onDelete={() => delEx(ex.id)}
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

      {/* actions */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
        <button
          className="btn"
          onClick={copyLast}
          title="Fill from this person's most recent workout"
        >
          ⧉ Copy last
        </button>
        <button className="btn" onClick={clear}>
          Clear
        </button>
        {existing && (
          <button
            className="btn"
            onClick={() => {
              void circuitStore.deleteLog(existing.id)
              setVals({})
            }}
          >
            Delete
          </button>
        )}
        <button
          className="btn"
          onClick={save}
          style={{
            background: 'var(--accent, #7c6af7)',
            color: '#fff',
            borderColor: 'transparent',
          }}
        >
          Save
        </button>
      </div>

      {managing && <ExerciseManager person={person} onClose={() => setManaging(false)} />}
    </div>
  )
}

// ── one moveable + editable exercise slot ─────────────────────────────────────
function Slot({
  ex,
  val,
  best,
  open,
  dragging,
  over,
  armed,
  onVal,
  onToggleEdit,
  onPatch,
  onDelete,
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
  open: boolean
  dragging: boolean
  over: boolean
  armed: boolean
  onVal: (v: string) => void
  onToggleEdit: () => void
  onPatch: (p: Partial<Exercise>) => void
  onDelete: () => void
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
        {open ? (
          <input
            value={ex.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            onBlur={() => {
              if (!ex.name.trim()) onPatch({ name: 'Exercise' })
            }}
            placeholder="Exercise name"
            autoFocus
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            style={{ flex: 1, minWidth: 0, padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
          />
        ) : (
          <span className="cz-slot-name" onClick={onToggleEdit} title="Click to edit this exercise">
            {ex.name}
          </span>
        )}
        <button
          className="cz-slot-btn"
          onClick={onToggleEdit}
          title={open ? 'Close editor' : 'Edit exercise'}
        >
          {open ? '✓' : '✎'}
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
          title={isPR ? 'New personal best!' : undefined}
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
      {best ? (
        <div
          className="cz-num"
          style={{
            marginTop: 3,
            fontSize: '0.6rem',
            lineHeight: 1,
            color: isPR ? '#f5c060' : 'var(--muted)',
          }}
        >
          {isPR
            ? '🏆 new best!'
            : `best ${Math.round(best * 10) / 10}${ex.unit ? ' ' + ex.unit : ''}`}
        </div>
      ) : null}

      {open && (
        <div className="cz-edit-panel">
          <div className="cz-edit-row">
            <span className="muted" style={{ fontSize: '0.68rem', width: 28 }}>
              ×
            </span>
            <input
              type="number"
              value={ex.mult}
              onChange={(e) => onPatch({ mult: parseFloat(e.target.value) || 0 })}
              title="Points multiplier"
              style={{ width: 56, padding: '0.25rem 0.4rem', textAlign: 'right' }}
            />
            <select
              value={ex.unit}
              onChange={(e) => onPatch({ unit: e.target.value })}
              title="Unit"
              style={{ flex: 1, padding: '0.25rem 0.3rem' }}
            >
              {(UNITS.includes(ex.unit) ? UNITS : [ex.unit, ...UNITS]).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div className="cz-edit-row">
            <select
              value={ex.cat ?? 'other'}
              onChange={(e) => onPatch({ cat: e.target.value })}
              title="Category (color)"
              style={{ flex: 1, padding: '0.25rem 0.3rem' }}
            >
              {CATS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              className="cz-slot-btn cz-del"
              onClick={onDelete}
              title="Delete this exercise"
              style={{ fontSize: '0.85rem' }}
            >
              🗑
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
