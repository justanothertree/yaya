// Movies stats — group facts, per-rater average bars, and taste twins / foes.
import { useMemo } from 'react'
import { useCircuit } from '../store'
import { moviesInGroup } from '../groupFilter'
import { MV_PIDS, scoreColor } from './movieMeta'
import type { Person } from '../types'

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

function Fact({
  label,
  title,
  value,
  color,
}: {
  label: string
  title: string
  value?: string
  color?: string
}) {
  return (
    <div
      style={{
        background: 'var(--b1, rgba(127,127,127,0.07))',
        borderRadius: 10,
        padding: '0.6rem 0.75rem',
      }}
    >
      <div
        className="muted"
        style={{
          fontSize: '0.64rem',
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{ fontWeight: 800, fontSize: '0.95rem', color: color || 'inherit', marginTop: 2 }}
      >
        {title}
      </div>
      {value && (
        <div className="muted" style={{ fontSize: '0.76rem' }}>
          {value}
        </div>
      )}
    </div>
  )
}

export function MovieStats({ viewGroup = '' }: { viewGroup?: string } = {}) {
  const { movies: allMovies, people } = useCircuit()
  const movies = useMemo(() => moviesInGroup(allMovies, viewGroup), [allMovies, viewGroup])
  const byId = useMemo(
    () => Object.fromEntries(people.map((p) => [p.id, p])) as Record<string, Person>,
    [people],
  )
  const raters = MV_PIDS.map((id) => byId[id]).filter(Boolean)

  const stats = useMemo(() => {
    // per-movie aggregate
    const movieAgg = movies
      .map((m) => {
        const scores = MV_PIDS.map((id) => m.ratings[id]?.score).filter(
          (s): s is number => s != null,
        )
        return {
          title: m.title,
          avg: scores.length ? mean(scores) : null,
          n: scores.length,
          spread: scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0,
        }
      })
      .filter((x) => x.avg != null)

    const rated3 = movieAgg.filter((x) => x.n >= 3)
    const favorite = [...rated3].sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))[0]
    const divisive = [...rated3].sort((a, b) => b.spread - a.spread)[0]
    const consensus = [...rated3].sort((a, b) => a.spread - b.spread)[0]

    // per-rater
    const raterAgg = raters.map((p) => {
      const scores = movies.map((m) => m.ratings[p.id]?.score).filter((s): s is number => s != null)
      let gsum = 0,
        gc = 0
      movies.forEach((m) => {
        const mine = m.ratings[p.id]?.score
        if (mine == null) return
        const others = MV_PIDS.filter((id) => id !== p.id)
          .map((id) => m.ratings[id]?.score)
          .filter((s): s is number => s != null)
        if (!others.length) return
        gsum += mine - mean(others)
        gc++
      })
      return {
        p,
        n: scores.length,
        avg: scores.length ? mean(scores) : 0,
        generosity: gc ? gsum / gc : 0,
      }
    })

    const mostGenerous = [...raterAgg].sort((a, b) => b.generosity - a.generosity)[0]
    const harshest = [...raterAgg].sort((a, b) => a.generosity - b.generosity)[0]
    const prolific = [...raterAgg].sort((a, b) => b.n - a.n)[0]

    // pairwise agreement
    const pairs: { a: Person; b: Person; avgDiff: number; shared: number }[] = []
    for (let i = 0; i < raters.length; i++) {
      for (let j = i + 1; j < raters.length; j++) {
        const A = raters[i],
          B = raters[j]
        let diff = 0,
          c = 0
        movies.forEach((m) => {
          const sa = m.ratings[A.id]?.score
          const sb = m.ratings[B.id]?.score
          if (sa != null && sb != null) {
            diff += Math.abs(sa - sb)
            c++
          }
        })
        if (c >= 3) pairs.push({ a: A, b: B, avgDiff: diff / c, shared: c })
      }
    }
    const twins = [...pairs].sort((a, b) => a.avgDiff - b.avgDiff)[0]
    const foes = [...pairs].sort((a, b) => b.avgDiff - a.avgDiff)[0]

    const maxAvg = Math.max(1, ...raterAgg.map((r) => r.avg))
    return {
      favorite,
      divisive,
      consensus,
      raterAgg,
      mostGenerous,
      harshest,
      prolific,
      twins,
      foes,
      maxAvg,
    }
  }, [movies, raters])

  if (!movies.length) return <p className="muted">No movies rated yet.</p>

  return (
    <div>
      {/* fact cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))',
          gap: '0.6rem',
          marginBottom: '1.4rem',
        }}
      >
        {stats.favorite && (
          <Fact
            label="Group favorite"
            title={stats.favorite.title}
            value={`${stats.favorite.avg!.toFixed(1)} avg`}
            color={scoreColor(stats.favorite.avg)}
          />
        )}
        {stats.divisive && (
          <Fact
            label="Most divisive"
            title={stats.divisive.title}
            value={`${Math.round(stats.divisive.spread)} pt spread`}
            color="#f46b6b"
          />
        )}
        {stats.consensus && (
          <Fact
            label="Strongest consensus"
            title={stats.consensus.title}
            value={`${Math.round(stats.consensus.spread)} pt spread`}
            color="#22cc78"
          />
        )}
        {stats.mostGenerous && (
          <Fact
            label="Most generous"
            title={stats.mostGenerous.p.name}
            value={`+${stats.mostGenerous.generosity.toFixed(1)} vs room`}
            color={stats.mostGenerous.p.color}
          />
        )}
        {stats.harshest && (
          <Fact
            label="Harshest critic"
            title={stats.harshest.p.name}
            value={`${stats.harshest.generosity.toFixed(1)} vs room`}
            color={stats.harshest.p.color}
          />
        )}
        {stats.prolific && (
          <Fact
            label="Most prolific"
            title={stats.prolific.p.name}
            value={`${stats.prolific.n} rated`}
            color={stats.prolific.p.color}
          />
        )}
        {stats.twins && (
          <Fact
            label="Taste twins"
            title={`${stats.twins.a.name} + ${stats.twins.b.name}`}
            value={`${stats.twins.avgDiff.toFixed(1)} apart · ${stats.twins.shared} shared`}
            color="#22cc78"
          />
        )}
        {stats.foes && (
          <Fact
            label="Taste foes"
            title={`${stats.foes.a.name} vs ${stats.foes.b.name}`}
            value={`${stats.foes.avgDiff.toFixed(1)} apart · ${stats.foes.shared} shared`}
            color="#f46b6b"
          />
        )}
      </div>

      {/* per-rater average bars */}
      <div style={{ fontWeight: 700, opacity: 0.75, marginBottom: '0.5rem' }}>Average score</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {[...stats.raterAgg]
          .sort((a, b) => b.avg - a.avg)
          .map((r) => (
            <div key={r.p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span
                style={{ width: '4rem', fontWeight: 700, color: r.p.color, fontSize: '0.84rem' }}
              >
                {r.p.name}
              </span>
              <span
                style={{
                  flex: 1,
                  height: 14,
                  background: 'var(--b1, rgba(127,127,127,0.15))',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${(r.avg / stats.maxAvg) * 100}%`,
                    background: r.p.color,
                    borderRadius: 6,
                  }}
                />
              </span>
              <span
                style={{ width: '4.5rem', textAlign: 'right', fontSize: '0.8rem', fontWeight: 700 }}
              >
                {r.avg.toFixed(1)}
                <span className="muted" style={{ fontWeight: 400 }}>
                  {' '}
                  · {r.n}
                </span>
              </span>
            </div>
          ))}
      </div>
    </div>
  )
}
