// Movies leaderboard — per-person scores + group average + RT%, sortable.
// (Detail modal / reviews / stats / watchlist from the standalone come later.)
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import { moviesInGroup } from '../groupFilter'
import type { Movie, Person } from '../types'
import { MovieRate } from './MovieRate'
import { AddMovie } from './AddMovie'
import { MoviePersonProfile } from './MoviePersonProfile'
import { MovieDetail } from './MovieDetail'
import { MovieStats } from './MovieStats'
import { MV_PIDS, scoreColor } from './movieMeta'
import { REVIEW_KINDS, kindEmoji } from '../reviewKinds'

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

export function Movies({ viewGroup = '' }: { viewGroup?: string } = {}) {
  const state = useCircuit()
  const [rate, setRate] = useState<{ movie: Movie; person: Person } | null>(null)
  const [adding, setAdding] = useState(false)
  const [profile, setProfile] = useState<Person | null>(null)
  const [detail, setDetail] = useState<Movie | null>(null)
  const [view, setView] = useState<'board' | 'stats'>('board')

  // scope to the viewed circuit (shared filter) — '' shows everything you can see
  const inGroup = useMemo(() => moviesInGroup(state.movies, viewGroup), [state.movies, viewGroup])
  // which review kinds are present here, and the active category filter ('' = all)
  const kindCounts = useMemo(() => {
    const m = new Map<string, number>()
    inGroup.forEach((r) => {
      const k = r.kind ?? 'movie'
      m.set(k, (m.get(k) ?? 0) + 1)
    })
    return m
  }, [inGroup])
  const multiKind = kindCounts.size > 1
  const [kindFilter, setKindFilter] = useState('')
  const movies = useMemo(
    () => (kindFilter ? inGroup.filter((r) => (r.kind ?? 'movie') === kindFilter) : inGroup),
    [inGroup, kindFilter],
  )

  // Raters = people you can actually see who have rated something — not a hardcoded crew
  // list, so a member viewing another circuit doesn't get nameless ghost columns.
  const allRaters = useMemo<Person[]>(() => {
    const present = new Set<string>()
    movies.forEach((m) =>
      Object.entries(m.ratings).forEach(([id, r]) => {
        if (r?.score != null) present.add(id)
      }),
    )
    const order = (id: string) => {
      const i = MV_PIDS.indexOf(id)
      return i === -1 ? MV_PIDS.length : i
    }
    return state.people.filter((p) => present.has(p.id)).sort((a, b) => order(a.id) - order(b.id))
  }, [movies, state.people])

  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem('circuit_movies_hidecols') || '[]'))
    } catch {
      return new Set<string>()
    }
  })
  const [showCols, setShowCols] = useState(false)
  const toggleCol = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem('circuit_movies_hidecols', JSON.stringify([...next]))
      } catch {
        /* ignore */
      }
      return next
    })
  const raters = allRaters.filter((p) => !hidden.has(p.id))

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
    const list = movies.map((m) => ({ m, avg: avgOf(m) }))
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
  }, [movies, sort, dir])

  const arrow = (k: string) => (sort === k ? (dir > 0 ? ' ↑' : ' ↓') : '')
  const chip = (v: number | null) => (
    <span
      className="cz-num"
      style={{
        display: 'inline-block',
        minWidth: 30,
        padding: '2px 6px',
        borderRadius: 6,
        textAlign: 'center',
        fontWeight: 700,
        fontSize: '0.82rem',
        color: v == null ? 'var(--muted, #888)' : '#fff',
        background: scoreColor(v),
      }}
    >
      {v == null ? '–' : Math.round(v)}
    </span>
  )

  if (movies.length === 0)
    return (
      <div>
        <button className="btn" onClick={() => setAdding(true)}>
          ＋ Add a review
        </button>
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          {viewGroup ? 'Nothing rated in this circuit yet.' : 'Nothing rated yet.'} Rate a movie, a
          meal, a beer — anything you want to compare.
        </p>
        {adding && <AddMovie onClose={() => setAdding(false)} />}
      </div>
    )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Reviews</h3>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {movies.length} rated
        </span>
        <button className="btn" onClick={() => setAdding(true)}>
          ＋ Add
        </button>
        <span style={{ display: 'inline-flex', gap: '0.35rem', marginLeft: 'auto' }}>
          {(
            [
              ['board', '📋 Board'],
              ['stats', '📊 Stats'],
            ] as ['board' | 'stats', string][]
          ).map(([k, label]) => (
            <button
              key={k}
              className="btn"
              onClick={() => setView(k)}
              aria-pressed={view === k}
              style={
                view === k
                  ? {
                      background: 'var(--accent, #7c6af7)',
                      color: '#fff',
                      borderColor: 'transparent',
                    }
                  : undefined
              }
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      {/* category filter — only appears once the board holds more than movies */}
      {multiKind && (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
          <button
            className={'cz-chip' + (kindFilter === '' ? ' cz-on' : '')}
            style={
              kindFilter === ''
                ? { background: 'var(--accent, #7c6af7)', color: '#fff' }
                : undefined
            }
            onClick={() => setKindFilter('')}
          >
            All {inGroup.length}
          </button>
          {REVIEW_KINDS.filter((rk) => kindCounts.has(rk.id)).map((rk) => (
            <button
              key={rk.id}
              className={'cz-chip' + (kindFilter === rk.id ? ' cz-on' : '')}
              style={
                kindFilter === rk.id
                  ? { background: 'var(--accent, #7c6af7)', color: '#fff' }
                  : undefined
              }
              onClick={() => setKindFilter(rk.id)}
            >
              {rk.emoji} {rk.plural} {kindCounts.get(rk.id)}
            </button>
          ))}
        </div>
      )}

      {view === 'board' && (
        <div style={{ marginTop: '0.6rem' }}>
          <button
            className="btn btn-ghost"
            onClick={() => setShowCols((v) => !v)}
            style={{ fontSize: '0.82rem' }}
            aria-expanded={showCols}
          >
            👁 Columns
            {hidden.size ? ` (${allRaters.length - hidden.size}/${allRaters.length})` : ''}
          </button>
          {showCols && (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {allRaters.map((p) => {
                const on = !hidden.has(p.id)
                return (
                  <button
                    key={p.id}
                    className="btn"
                    onClick={() => toggleCol(p.id)}
                    title={on ? `Hide ${p.name}` : `Show ${p.name}`}
                    style={{
                      borderColor: p.color,
                      color: on ? '#fff' : p.color,
                      background: on ? p.color : 'transparent',
                      fontWeight: 700,
                      opacity: on ? 1 : 0.55,
                      fontSize: '0.8rem',
                    }}
                  >
                    {on ? '✓ ' : ''}
                    {p.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {view === 'stats' && (
        <div style={{ marginTop: '0.9rem' }}>
          <MovieStats viewGroup={viewGroup} />
        </div>
      )}

      {view === 'board' && (
        <span
          style={{
            display: 'flex',
            gap: '0.35rem',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            marginTop: '0.7rem',
          }}
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
      )}

      {view === 'board' && (
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
                      {multiKind && (
                        <span aria-hidden style={{ marginRight: 5 }}>
                          {kindEmoji(m.kind)}
                        </span>
                      )}
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
                    // Vibes/reactions live in the detail modal (click the title), so the list
                    // stays a tight grid of score chips — no per-row emoji band bloating height.
                    return (
                      <td
                        key={p.id}
                        onClick={() => setRate({ movie: m, person: p })}
                        title={`Rate as ${p.name}`}
                        style={{ padding: '4px 8px', textAlign: 'center', cursor: 'pointer' }}
                      >
                        {chip(r?.score ?? null)}
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
      )}

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
