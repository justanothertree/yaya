// Movies leaderboard — per-person scores + group average + RT%, sortable.
// (Detail modal / reviews / stats / watchlist from the standalone come later.)
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import type { Movie, Person } from '../types'

const MV_PIDS = ['1', '2', '3', '5', '6'] // standalone movie raters: Josh, Evan, Cam, Mills, Tin
type SortKey = 'avg' | 'alpha' | 'rt' | 'date'

function avgOf(m: Movie): number | null {
  const xs = Object.values(m.ratings)
    .map((r) => r.score)
    .filter((s): s is number => s != null)
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}
function scoreColor(v: number | null): string {
  if (v == null) return 'var(--b1, rgba(127,127,127,0.2))'
  return `hsl(${Math.round(v * 1.2)} 60% 42%)` // 0=red → 100=green
}

export function Movies() {
  const state = useCircuit()

  const raters = useMemo<Person[]>(() => {
    const present = new Set<string>()
    state.movies.forEach((m) => Object.keys(m.ratings).forEach((id) => present.add(id)))
    const ids = MV_PIDS.filter((id) => present.has(id))
    return (ids.length ? ids : MV_PIDS)
      .map((id) => state.people.find((p) => p.id === id))
      .filter((p): p is Person => !!p)
  }, [state.movies, state.people])

  const [sort, setSort] = useState<SortKey>('avg')
  const [dir, setDir] = useState(-1)
  const setSortKey = (k: SortKey) => {
    if (sort === k) setDir((d) => -d)
    else {
      setSort(k)
      setDir(k === 'alpha' ? 1 : -1)
    }
  }

  const rows = useMemo(() => {
    const list = state.movies.map((m) => ({ m, avg: avgOf(m) }))
    const cmp: Record<SortKey, (a: (typeof list)[0], b: (typeof list)[0]) => number> = {
      avg: (a, b) => ((a.avg ?? -1) - (b.avg ?? -1)) * dir,
      alpha: (a, b) => a.m.title.localeCompare(b.m.title) * dir,
      rt: (a, b) => ((parseInt(a.m.rt || '') || 0) - (parseInt(b.m.rt || '') || 0)) * dir,
      date: (a, b) => (a.m.date || '').localeCompare(b.m.date || '') * dir,
    }
    return [...list].sort(cmp[sort])
  }, [state.movies, sort, dir])

  const arrow = (k: SortKey) => (sort === k ? (dir > 0 ? ' ↑' : ' ↓') : '')
  const chip = (v: number | null) => (
    <span
      style={{
        display: 'inline-block',
        minWidth: 30,
        padding: '2px 6px',
        borderRadius: 6,
        textAlign: 'center',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 700,
        fontSize: '0.82rem',
        color: v == null ? 'var(--muted, #888)' : '#fff',
        background: scoreColor(v),
      }}
    >
      {v == null ? '–' : Math.round(v)}
    </span>
  )

  if (state.movies.length === 0) return <p className="muted">No movies yet.</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Movies</h3>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {state.movies.length} rated
        </span>
        <span
          style={{ display: 'inline-flex', gap: '0.35rem', marginLeft: 'auto', flexWrap: 'wrap' }}
        >
          {(
            [
              ['avg', 'Avg'],
              ['alpha', 'A–Z'],
              ['rt', 'RT%'],
              ['date', 'Date'],
            ] as [SortKey, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              className="btn"
              onClick={() => setSortKey(k)}
              aria-pressed={sort === k}
              style={
                sort === k
                  ? {
                      background: 'var(--accent, #7c6af7)',
                      color: '#fff',
                      borderColor: 'transparent',
                    }
                  : undefined
              }
            >
              {label}
              {arrow(k)}
            </button>
          ))}
        </span>
      </div>

      <div style={{ overflow: 'auto', maxHeight: '70vh', marginTop: '0.9rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '6px 8px', opacity: 0.6, width: 28 }}>#</th>
              <th style={{ padding: '6px 8px' }}>Movie</th>
              {raters.map((p) => (
                <th key={p.id} style={{ padding: '6px 8px', textAlign: 'center', color: p.color }}>
                  {p.name}
                </th>
              ))}
              <th style={{ padding: '6px 8px', textAlign: 'center' }}>Avg</th>
              <th style={{ padding: '6px 8px', textAlign: 'center', color: '#fa4242' }}>RT%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, avg }, i) => (
              <tr key={m.id} style={{ borderTop: '1px solid var(--b1, rgba(127,127,127,0.15))' }}>
                <td
                  style={{ padding: '6px 8px', opacity: 0.5, fontVariantNumeric: 'tabular-nums' }}
                >
                  {i + 1}
                </td>
                <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                  {m.title}
                  {m.date && (
                    <span className="muted" style={{ marginLeft: 6, fontSize: '0.72rem' }}>
                      {m.date.slice(0, 7)}
                    </span>
                  )}
                </td>
                {raters.map((p) => (
                  <td key={p.id} style={{ padding: '6px 8px', textAlign: 'center' }}>
                    {chip(m.ratings[p.id]?.score ?? null)}
                  </td>
                ))}
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  {chip(avg == null ? null : Math.round(avg * 10) / 10)}
                </td>
                <td
                  style={{
                    padding: '6px 8px',
                    textAlign: 'center',
                    color: '#fa4242',
                    fontWeight: 700,
                  }}
                >
                  {m.rt || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
