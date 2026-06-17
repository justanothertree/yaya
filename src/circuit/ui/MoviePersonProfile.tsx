// A movie-rater's profile: counts, average, generosity vs the room, score histogram,
// taste twin / most-at-odds, and their top-rated movies. (Ported from the standalone.)
import { useMemo } from 'react'
import { useCircuit } from '../store'
import { Modal } from './Modal'
import { MV_PIDS, scoreColor } from './movieMeta'

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        flex: '1 1 0',
        minWidth: 64,
        textAlign: 'center',
        background: 'var(--b1, rgba(127,127,127,0.07))',
        borderRadius: 8,
        padding: '0.5rem 0.4rem',
      }}
    >
      <div style={{ fontWeight: 800, fontSize: '1.05rem', color: color || 'inherit' }}>{value}</div>
      <div className="muted" style={{ fontSize: '0.66rem' }}>
        {label}
      </div>
    </div>
  )
}

export function MoviePersonProfile({
  personId,
  personName,
  color,
  onClose,
}: {
  personId: string
  personName: string
  color: string
  onClose: () => void
}) {
  const { movies, people } = useCircuit()
  const nameById = useMemo(
    () => Object.fromEntries(people.map((p) => [p.id, p.name])) as Record<string, string>,
    [people],
  )

  const stats = useMemo(() => {
    const rated = movies
      .map((m) => ({ title: m.title, score: m.ratings[personId]?.score }))
      .filter((r): r is { title: string; score: number } => r.score != null)
    const scores = rated.map((r) => r.score)
    const n = scores.length
    const avg = n ? mean(scores) : null
    const hi = n ? Math.max(...scores) : null
    const lo = n ? Math.min(...scores) : null

    // generosity: how much above/below the rest of the room on shared movies
    let gsum = 0,
      gc = 0
    movies.forEach((m) => {
      const mine = m.ratings[personId]?.score
      if (mine == null) return
      const others = MV_PIDS.filter((id) => id !== personId)
        .map((id) => m.ratings[id]?.score)
        .filter((s): s is number => s != null)
      if (!others.length) return
      gsum += mine - mean(others)
      gc++
    })
    const generosity = gc ? gsum / gc : null

    const buckets = [0, 0, 0, 0, 0, 0] // <60,60s,70s,80s,90s,100
    scores.forEach((v) => {
      buckets[v >= 100 ? 5 : v >= 90 ? 4 : v >= 80 ? 3 : v >= 70 ? 2 : v >= 60 ? 1 : 0]++
    })

    const matches = MV_PIDS.filter((id) => id !== personId)
      .map((id) => {
        let diff = 0,
          c = 0
        movies.forEach((m) => {
          const a = m.ratings[personId]?.score
          const b = m.ratings[id]?.score
          if (a != null && b != null) {
            diff += Math.abs(a - b)
            c++
          }
        })
        return { id, name: nameById[id] || id, avgDiff: c ? diff / c : Infinity, c }
      })
      .filter((x) => x.c >= 3)
      .sort((a, b) => a.avgDiff - b.avgDiff)

    const top = [...rated].sort((a, b) => b.score - a.score).slice(0, 8)
    return { n, avg, hi, lo, generosity, buckets, matches, top }
  }, [movies, personId, nameById])

  const { n, avg, hi, lo, generosity, buckets, matches, top } = stats
  const twin = matches[0]
  const opp = matches.length > 1 ? matches[matches.length - 1] : null
  const bmax = Math.max(1, ...buckets)
  const bLabels = ['<60', '60s', '70s', '80s', '90s', '100']
  const bColors = ['#f46b6b', '#fb923c', '#f5c060', '#7c6af7', '#5b9cf6', '#22cc78']

  return (
    <Modal title={<span style={{ color }}>{personName}</span>} onClose={onClose}>
      {n === 0 ? (
        <p className="muted">No movie ratings yet.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <Tile label="Rated" value={String(n)} color={color} />
            <Tile label="Avg" value={(avg ?? 0).toFixed(1)} color={color} />
            <Tile label="Highest" value={String(hi)} />
            <Tile label="Lowest" value={String(lo)} />
            {generosity != null && (
              <Tile
                label={generosity >= 0 ? 'vs room' : 'vs room'}
                value={`${generosity >= 0 ? '+' : ''}${generosity.toFixed(1)}`}
                color={generosity >= 0 ? '#22cc78' : '#f46b6b'}
              />
            )}
          </div>

          {/* histogram */}
          <div
            style={{ fontWeight: 700, opacity: 0.7, fontSize: '0.78rem', margin: '1rem 0 0.4rem' }}
          >
            Score spread
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 76 }}>
            {buckets.map((b, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>{b || ''}</div>
                <div
                  style={{
                    height: Math.round((b / bmax) * 46) + 2,
                    background: bColors[i],
                    borderRadius: '3px 3px 0 0',
                  }}
                />
                <div className="muted" style={{ fontSize: '0.62rem' }}>
                  {bLabels[i]}
                </div>
              </div>
            ))}
          </div>

          {/* taste match */}
          {twin && (
            <div
              style={{
                fontWeight: 700,
                opacity: 0.7,
                fontSize: '0.78rem',
                margin: '1rem 0 0.4rem',
              }}
            >
              Taste match
            </div>
          )}
          {twin && (
            <div className="muted" style={{ fontSize: '0.82rem' }}>
              🤝 Closest to <strong style={{ color: 'inherit' }}>{twin.name}</strong> (avg{' '}
              {twin.avgDiff.toFixed(1)} apart, {twin.c} shared)
            </div>
          )}
          {opp && (
            <div className="muted" style={{ fontSize: '0.82rem' }}>
              🌶️ Most at odds with <strong>{opp.name}</strong> (avg {opp.avgDiff.toFixed(1)} apart,{' '}
              {opp.c} shared)
            </div>
          )}

          {/* top movies */}
          <div
            style={{ fontWeight: 700, opacity: 0.7, fontSize: '0.78rem', margin: '1rem 0 0.4rem' }}
          >
            Top rated
          </div>
          <div>
            {top.map((t, k) => (
              <div
                key={k}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '2px 0' }}
              >
                <span
                  style={{
                    flex: 1,
                    fontSize: '0.82rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.title}
                </span>
                <span style={{ fontWeight: 700, color: scoreColor(t.score), fontSize: '0.82rem' }}>
                  {t.score}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
