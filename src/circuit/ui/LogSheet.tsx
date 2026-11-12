import { useEffect, useRef, useState } from 'react'
import { circuitStore } from '../store'
import { showToast } from '../toast'
import { CAT_COLORS, catColor } from '../catColors'
import { ScrubInput } from './ScrubInput'
import { sessionsIn } from '../sessions'
import { dayHref } from '../../chronicle/dayLink'
import { Modal } from './Modal'
import type { Exercise, Person } from '../types'
import type { LogState } from './useLog'

const CATS = Object.keys(CAT_COLORS)
// suggestions only — the unit field is free text, so you can type your own
const UNITS = ['reps', 'min', 'sec', 'mi', 'km', 'hr', 'cal', 'lbs', 'steps']
// A sensible starter grid for a brand-new person, so a friend who just joined a circuit can
// log right away instead of building columns and exercises from scratch. Multipliers match the
// crew's scoring (miles weighted heavily, plank by the minute); everything is editable after.
const STARTER_GRID: { label: string; exs: Omit<Exercise, 'id' | 'col' | 'row'>[] }[] = [
  {
    label: 'Body',
    exs: [
      { name: 'Pushups', unit: 'reps', mult: 1, cat: 'arms' },
      { name: 'Situps', unit: 'reps', mult: 1, cat: 'core' },
      { name: 'Squats', unit: 'reps', mult: 1, cat: 'legs' },
      { name: 'Plank', unit: 'min', mult: 10, cat: 'core' },
    ],
  },
  {
    label: 'Cardio',
    exs: [
      { name: 'Run', unit: 'mi', mult: 32, cat: 'run' },
      { name: 'Walk', unit: 'mi', mult: 16, cat: 'run' },
    ],
  },
]
const newId = () =>
  crypto.randomUUID?.() ?? 'e' + Date.now() + Math.random().toString(36).slice(2, 6)

/**
 * The exercise sheet under the day's total: columns side by side, a slot per exercise, the starter
 * set for somebody with none, and the editor a slot opens. Its state lives in useLog, which the log
 * owns; the grid edits are here because only the sheet makes them.
 */
export function LogSheet({ log, person }: { log: LogState; person: Person }) {
  const {
    date,
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
    canEdit,
    existing,
    cols,
    bestByEx,
    setVal,
  } = log
  // ── exercise-grid edits (persist through the store) ───────────────────────
  const saveExs = (next: Exercise[]) => {
    if (!canEdit) return
    void circuitStore.savePerson({ ...person, exercises: next })
  }
  const renameCol = (ci: number, label: string) => {
    if (!canEdit) return
    void circuitStore.savePerson({
      ...person,
      colLabels: person.colLabels.map((l, i) => (i === ci ? label : l)),
    })
  }
  const addCol = () => {
    if (!canEdit) return
    void circuitStore.savePerson({ ...person, colLabels: [...person.colLabels, 'New column'] })
    setColEdit(person.colLabels.length) // open the fresh header for naming
  }
  // one-tap onboarding for an empty person: drop in the common starter grid (editable after).
  const addStarterSet = () => {
    if (!canEdit) return
    const colLabels = STARTER_GRID.map((c) => c.label)
    const exercises: Exercise[] = []
    STARTER_GRID.forEach((c, ci) =>
      c.exs.forEach((e, row) => exercises.push({ ...e, id: newId(), col: ci, row })),
    )
    void circuitStore.savePerson({ ...person, colLabels, exercises })
  }
  // delete a column: its exercises merge into the neighbouring column (no data lost),
  // later columns shift down, and rows renumber per column. Keeps at least one column.
  const deleteCol = (ci: number) => {
    if (!canEdit) return
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
    /* ⚠️ SAID AFTERWARDS, because the only place it was said before was the button's title, and a
       tooltip does not exist on a phone: the column's exercises do not go, they join the next one */
    const into = person.colLabels[ci > 0 ? ci - 1 : 1] || 'Column'
    const had = person.exercises.some((e) => e.col === ci)
    showToast(had ? `Column removed — its exercises are in ${into} now` : 'Column removed')
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

  return (
    <>
      {/* brand-new person → a friendly starter CTA instead of a blank sheet */}
      {cols.length === 0 && (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: '1.6rem 1rem',
            display: 'grid',
            gap: '0.55rem',
            justifyItems: 'center',
          }}
        >
          <div style={{ fontSize: '1.7rem' }}>🏋️</div>
          <strong>Set up {person.name}&rsquo;s exercises</strong>
          <span className="muted" style={{ fontSize: '0.86rem', maxWidth: 320 }}>
            Start with a common set you can tweak anytime, or build your own grid.
          </span>
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              flexWrap: 'wrap',
              justifyContent: 'center',
              marginTop: '0.2rem',
            }}
          >
            <button
              className="btn"
              onClick={addStarterSet}
              style={{
                background: 'var(--accent,#7c6af7)',
                color: 'var(--btn-text)',
                borderColor: 'transparent',
              }}
            >
              ➕ Add a starter set
            </button>
            <button className="btn btn-ghost" onClick={addCol}>
              Build my own
            </button>
          </div>
        </div>
      )}

      {/* slot sheet header */}
      {cols.length > 0 && (
        <div
          className="cz-sheet-head"
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
      )}

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
                    aria-label="Delete this column"
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
                  sessions={sessionsIn(existing, ex.id)}
                  date={date}
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
    </>
  )
}

// ── one moveable exercise slot — a compact spreadsheet cell. Editing happens in a
//    modal (ExerciseEditModal), so the cell stays uniform and uncluttered. ───────────
function Slot({
  ex,
  val,
  sessions,
  date,
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
  /** how much of this cell Chronicle's sessions hold — see circuit/sessions.ts */
  sessions: number
  /** the day on screen, which the sessions link opens Chronicle on */
  date: string
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

  // Celebrate the moment a value beats this exercise's previous best (false→true edge). The
  // flash outlives the autosave that turns the new value into the record (isPR back to false).
  const prevPR = useRef(false)
  const [prFlash, setPrFlash] = useState(false)
  useEffect(() => {
    if (isPR && !prevPR.current) {
      setPrFlash(true)
      const t = setTimeout(() => setPrFlash(false), 1300)
      prevPR.current = true
      return () => clearTimeout(t)
    }
    prevPR.current = isPR
  }, [isPR])

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
          className={prFlash ? 'cz-goal-pop' : undefined}
          title={
            isPR ? 'New personal best!' : best ? `best ${Math.round(best * 10) / 10}` : undefined
          }
          style={{
            marginLeft: 'auto',
            fontVariantNumeric: 'tabular-nums',
            fontSize: '0.75rem',
            fontWeight: isPR || prFlash ? 800 : undefined,
            color: isPR || prFlash ? '#f5c060' : pts > 0 ? 'var(--accent, #7c6af7)' : 'inherit',
            opacity: pts > 0 ? 1 : 0.4,
          }}
        >
          {prFlash
            ? '🏆 PR!'
            : pts > 0
              ? `${isPR ? '🏆 ' : ''}${Math.round(pts * 10) / 10} pt`
              : `×${ex.mult}`}
        </span>
      </div>
      {/**
       * ⚠️ WHERE PART OF THIS NUMBER CAME FROM, AND WHERE TO CHANGE IT. The cell shows a total, and
       * sessions counted in Chronicle are part of it; the grid will not take the total below them
       * (OPEN-DECISIONS §19g), so the way to lower that part has to be on the cell, not in a toast
       * after the save has already been refused.
       */}
      {sessions > 0 ? (
        <a className="cz-slot-sessions" href={dayHref(date)}>
          {Math.round(sessions * 10) / 10} from Chronicle sessions · change them there
        </a>
      ) : null}
      {(best || tags.length > 0) && (
        <div
          className="cz-slot-meta"
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
              color: 'var(--btn-text)',
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
