// Edit a person's exercise grid: add/rename/reweight/recategorize/reorder exercises
// and rename or add columns. Saves through the store (undo/redo + realtime for free).
import { useState } from 'react'
import { circuitStore } from '../store'
import { showToast } from '../toast'
import { CAT_COLORS, catColor } from '../catColors'
import { Modal } from './Modal'
import type { Person } from '../types'

type EditEx = {
  id: string
  name: string
  unit: string
  mult: number
  cat: string
  col: number
  row: number
}

const CATS = Object.keys(CAT_COLORS) // arms, core, legs, bike, skate, run, walk, other
const UNITS = ['reps', 'min', 'sec', 'mi', 'km', 'hr', 'other']
const newId = () =>
  crypto.randomUUID?.() ?? 'e' + Date.now() + Math.random().toString(36).slice(2, 6)

export function ExerciseManager({ person, onClose }: { person: Person; onClose: () => void }) {
  // pad columns so every exercise's col index has a label
  const maxCol = person.exercises.reduce((m, e) => Math.max(m, e.col), 0)
  const initCols = person.colLabels.length ? [...person.colLabels] : ['Exercises']
  while (initCols.length <= maxCol) initCols.push('More')

  const [cols, setCols] = useState<string[]>(initCols)
  const [exs, setExs] = useState<EditEx[]>(() =>
    person.exercises.map((e) => ({
      id: e.id,
      name: e.name,
      unit: e.unit,
      mult: e.mult,
      cat: e.cat ?? 'other',
      col: e.col,
      row: e.row,
    })),
  )

  const patch = (id: string, p: Partial<EditEx>) =>
    setExs((prev) => prev.map((e) => (e.id === id ? { ...e, ...p } : e)))
  const removeEx = (id: string) => setExs((prev) => prev.filter((e) => e.id !== id))
  const addEx = (col: number) => {
    const row = Math.max(-1, ...exs.filter((e) => e.col === col).map((e) => e.row)) + 1
    setExs((prev) => [
      ...prev,
      { id: newId(), name: '', unit: 'reps', mult: 1, cat: 'other', col, row },
    ])
  }
  // swap an exercise with its neighbour above/below within the same column
  const move = (id: string, dir: -1 | 1) => {
    setExs((prev) => {
      const me = prev.find((e) => e.id === id)
      if (!me) return prev
      const colItems = prev.filter((e) => e.col === me.col).sort((a, b) => a.row - b.row)
      const idx = colItems.findIndex((e) => e.id === id)
      const swap = colItems[idx + dir]
      if (!swap) return prev
      return prev.map((e) =>
        e.id === me.id ? { ...e, row: swap.row } : e.id === swap.id ? { ...e, row: me.row } : e,
      )
    })
  }
  const moveToCol = (id: string, col: number) =>
    setExs((prev) => {
      const row = Math.max(-1, ...prev.filter((e) => e.col === col).map((e) => e.row)) + 1
      return prev.map((e) => (e.id === id ? { ...e, col, row } : e))
    })
  const addCol = () => setCols((prev) => [...prev, 'New'])

  const save = () => {
    const exercises = exs.map((e) => ({
      id: e.id,
      name: e.name.trim() || 'Exercise',
      unit: e.unit.trim(),
      mult: Number.isFinite(e.mult) ? e.mult : 1,
      cat: e.cat,
      col: e.col,
      row: e.row,
    }))
    void circuitStore.savePerson({ ...person, colLabels: cols, exercises })
    showToast('Exercises saved')
    onClose()
  }

  const cell: React.CSSProperties = { padding: '0.3rem 0.45rem' }

  return (
    <Modal
      title={
        <span>
          Edit exercises · <span style={{ color: person.color }}>{person.name}</span>
        </span>
      }
      onClose={onClose}
      width={760}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={save}
            style={{
              background: 'var(--accent,#7c6af7)',
              color: '#fff',
              borderColor: 'transparent',
            }}
          >
            Save
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
        Points = value × multiplier. Deleting an exercise also drops its past contribution to
        scores.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
        {cols.map((label, ci) => {
          const items = exs.filter((e) => e.col === ci).sort((a, b) => a.row - b.row)
          return (
            <div key={ci}>
              <input
                value={label}
                onChange={(e) =>
                  setCols((prev) => prev.map((c, i) => (i === ci ? e.target.value : c)))
                }
                placeholder="Column name"
                style={{
                  fontWeight: 700,
                  padding: '0.3rem 0.5rem',
                  marginBottom: '0.4rem',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border, rgba(127,127,127,0.25))',
                  width: '12rem',
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {items.length === 0 && (
                  <span className="muted" style={{ fontSize: '0.78rem', opacity: 0.6 }}>
                    No exercises in this column.
                  </span>
                )}
                {items.map((e, i) => (
                  <div
                    key={e.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      flexWrap: 'wrap',
                      background: 'var(--b1, rgba(127,127,127,0.06))',
                      borderRadius: 8,
                      borderLeft: `3px solid ${catColor(e.cat)}`,
                      ...cell,
                    }}
                  >
                    <input
                      value={e.name}
                      onChange={(ev) => patch(e.id, { name: ev.target.value })}
                      placeholder="Exercise name"
                      style={{ flex: 1, minWidth: 120, padding: '0.3rem 0.45rem' }}
                    />
                    <input
                      list="cz-units"
                      value={e.unit}
                      onChange={(ev) => patch(e.id, { unit: ev.target.value })}
                      placeholder="unit"
                      style={{ width: 64, padding: '0.3rem 0.4rem' }}
                    />
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      ×
                    </span>
                    <input
                      type="number"
                      value={e.mult}
                      onChange={(ev) => patch(e.id, { mult: parseFloat(ev.target.value) || 0 })}
                      title="Points multiplier"
                      style={{ width: 58, padding: '0.3rem 0.4rem', textAlign: 'right' }}
                    />
                    <select
                      value={e.cat}
                      onChange={(ev) => patch(e.id, { cat: ev.target.value })}
                      title="Category (color)"
                      style={{ padding: '0.3rem 0.3rem' }}
                    >
                      {CATS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    {cols.length > 1 && (
                      <select
                        value={e.col}
                        onChange={(ev) => moveToCol(e.id, Number(ev.target.value))}
                        title="Move to column"
                        style={{ padding: '0.3rem 0.3rem', maxWidth: 96 }}
                      >
                        {cols.map((c, idx) => (
                          <option key={idx} value={idx}>
                            {c || `Col ${idx + 1}`}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      className="btn btn-ghost"
                      onClick={() => move(e.id, -1)}
                      disabled={i === 0}
                      title="Move up"
                      style={{ padding: '0.2rem 0.45rem' }}
                    >
                      ↑
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => move(e.id, 1)}
                      disabled={i === items.length - 1}
                      title="Move down"
                      style={{ padding: '0.2rem 0.45rem' }}
                    >
                      ↓
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => removeEx(e.id)}
                      title="Delete exercise"
                      style={{ padding: '0.2rem 0.45rem', color: '#f46b6b' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => addEx(ci)}
                style={{ marginTop: '0.4rem', fontSize: '0.82rem' }}
              >
                ＋ Add exercise
              </button>
            </div>
          )
        })}
      </div>

      <button
        className="btn btn-ghost"
        onClick={addCol}
        style={{ marginTop: '1rem', fontSize: '0.82rem' }}
      >
        ＋ Add column
      </button>

      <datalist id="cz-units">
        {UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
    </Modal>
  )
}
