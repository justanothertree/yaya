// Movies leaderboard — per-person scores + group average + RT%, sortable.
// (Detail modal / reviews / stats / watchlist from the standalone come later.)
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import type { Movie, Person } from '../types'
import { MovieRate } from './MovieRate'
import { AddMovie } from './AddMovie'
import { MoviePersonProfile } from './MoviePersonProfile'
import { MovieDetail } from './MovieDetail'
import { MV_ICONS, MV_PIDS, scoreColor } from './movieMeta'

type SortKey = 'avg' | 'alpha' | 'rt' | 'date'

function avgOf(m: Movie): number | null {
  const xs = Object.values(m.ratings)
    .map((r) => r.score)
    .filter((s): s is number => s != null)
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

const stickyTh: React.CSSProperties = {
  padding: '6px 8px',
  position: 'sticky',
  top: 0,
  background: 'var(--panel, #141a2a)',
  zIndex: 1,
}

export function Movies() {
  const state = useCircuit()
  const [rate, setRate] = useState<{ movie: Movie; person: Person } | null>(null)
  const [adding, setAdding] = useState(false)
  const [profile, setProfile] = useState<Person | null>(null)
  const [detail, setDetail] = useState<Movie | null>(null)

  const raters = useMemo<Person[]>(() => {
    const present = new Set<string>()
    state.movies.forEach((m) => Object.keys(m.ratings).forEach((id) => present.add(id)))
    const ids = MV_PIDS.filter((id) => present.has(id))
    return (ids.length ? ids : MV_PIDS)
      .map((id) => state.people.find((p) => p.id === id))
      .filter((p): p is Person => !!p)
  }, [state.movies, state.people])

  const [sort, setSort] = useState<string>('avg') // 'avg'|'alpha'|'rt'|'date'|'p:<personId>'
  const [dir, setDir] = useState(-1)
  const setSortKey = (k: string) => {
    if (sort === k) setDir((d) => -d)
    else {
      setSort(k)
      setDir(k === 'alpha' ? 1 : -1)
    }
  }

  const rows = useMemo(() => {
    const list = state.movies.map((m) => ({ m, avg: avgOf(m) }))
    type Row = (typeof list)[0]
    // sort by a per-row number; unrated always sinks to the bottom regardless of direction
    const byScore =
      (get: (m: Movie) => number | null) =>
      (a: Row, b: Row): number => {
        const av = get(a.m),
          bv = get(b.m)
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        return (av - bv) * dir
      }
    let cmp: (a: Row, b: Row) => number
    if (sort.startsWith('p:')) {
      const pid = sort.slice(2)
      cmp = byScore((m) => m.ratings[pid]?.score ?? null)
    } else if (sort === 'alpha') cmp = (a, b) => a.m.title.localeCompare(b.m.title) * dir
    else if (sort === 'rt')
      cmp = (a, b) => ((parseInt(a.m.rt || '') || 0) - (parseInt(b.m.rt || '') || 0)) * dir
    else if (sort === 'date') cmp = (a, b) => (a.m.date || '').localeCompare(b.m.date || '') * dir
    else cmp = (a, b) => ((a.avg ?? -1) - (b.avg ?? -1)) * dir
    return [...list].sort(cmp)
  }, [state.movies, sort, dir])

  const arrow = (k: string) => (sort === k ? (dir > 0 ? ' ↑' : ' ↓') : '')
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

  if (state.movies.length === 0)
    return (
      <div>
        <button className="btn" onClick={() => setAdding(true)}>
          ＋ Add movie
        </button>
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          No movies yet.
        </p>
        {adding && <AddMovie onClose={() => setAdding(false)} />}
      </div>
    )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Movies</h3>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {state.movies.length} rated
        </span>
        <button className="btn" onClick={() => setAdding(true)}>
          ＋ Add
        </button>
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
              <th style={{ ...stickyTh, opacity: 0.6, width: 28 }}>#</th>
              <th style={stickyTh}>Movie</th>
              {raters.map((p) => (
                <th key={p.id} style={{ ...stickyTh, textAlign: 'center', color: p.color }}>
                  <span
                    onClick={() => setSortKey('p:' + p.id)}
                    style={{ cursor: 'pointer' }}
                    title={`Sort by ${p.name}'s ratings`}
                  >
                    {p.name}
                    {arrow('p:' + p.id)}
                  </span>
                  <button
                    onClick={() => setProfile(p)}
                    title={`${p.name}'s movie stats`}
                    style={{
                      display: 'block',
                      margin: '1px auto 0',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.7rem',
                      opacity: 0.75,
                    }}
                  >
                    📊
                  </button>
                </th>
              ))}
              <th style={{ ...stickyTh, textAlign: 'center' }}>Avg</th>
              <th style={{ ...stickyTh, textAlign: 'center', color: '#fa4242' }}>RT%</th>
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
                  <span
                    onClick={() => setDetail(m)}
                    style={{ cursor: 'pointer' }}
                    title="See all ratings"
                  >
                    {m.title}
                  </span>
                  {m.date && (
                    <span className="muted" style={{ marginLeft: 6, fontSize: '0.72rem' }}>
                      {m.date.slice(0, 7)}
                    </span>
                  )}
                </td>
                {raters.map((p) => {
                  const r = m.ratings[p.id]
                  const vibes = (r?.icons ?? [])
                    .slice(0, 2)
                    .map((id) => MV_ICONS.find((x) => x.id === id)?.emoji)
                    .filter(Boolean)
                  return (
                    <td
                      key={p.id}
                      onClick={() => setRate({ movie: m, person: p })}
                      title={`Rate as ${p.name}`}
                      style={{ padding: '4px 8px', textAlign: 'center', cursor: 'pointer' }}
                    >
                      {chip(r?.score ?? null)}
                      {vibes.length > 0 && (
                        <div style={{ fontSize: '0.7rem', lineHeight: 1, marginTop: 2 }}>
                          {vibes.join('')}
                        </div>
                      )}
                    </td>
                  )
                })}
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

      {rate && (
        <MovieRate
          movie={rate.movie}
          personId={rate.person.id}
          personName={rate.person.name}
          color={rate.person.color}
          onClose={() => setRate(null)}
        />
      )}
      {adding && <AddMovie onClose={() => setAdding(false)} />}
      {profile && (
        <MoviePersonProfile
          personId={profile.id}
          personName={profile.name}
          color={profile.color}
          onClose={() => setProfile(null)}
        />
      )}
      {detail && <MovieDetail movie={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
