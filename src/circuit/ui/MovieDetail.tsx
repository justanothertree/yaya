// Group detail modal — all ratings for one movie, aggregated gut reactions + tag cloud.
import { useMemo, useState } from 'react'
import { useCircuit } from '../store'
import { Modal } from './Modal'
import { MV_ICONS, MV_PIDS, REC, REWATCH, SENTIMENT, TIPS, scoreColor } from './movieMeta'
import { MovieRate } from './MovieRate'
import { MoviePersonProfile } from './MoviePersonProfile'
import type { Movie, Person } from '../types'

export function MovieDetail({ movie, onClose }: { movie: Movie; onClose: () => void }) {
  const { people } = useCircuit()
  const [editing, setEditing] = useState<Person | null>(null)
  const [personProfile, setPersonProfile] = useState<Person | null>(null)

  const byId = useMemo(
    () => Object.fromEntries(people.map((p) => [p.id, p])) as Record<string, Person>,
    [people],
  )
  const raters = MV_PIDS.map((id) => byId[id]).filter(Boolean)

  const scores = raters.map((p) => movie.ratings[p.id]?.score).filter((s): s is number => s != null)
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null

  // Sentiment distribution across all raters
  const sentDist = [0, 0, 0, 0, 0]
  raters.forEach((p) => {
    const s = movie.ratings[p.id]?.review?.sentiment
    if (s != null && s >= 0 && s < 5) sentDist[s]++
  })

  // Tips aggregated
  const tipsCounts: Record<string, number> = {}
  raters.forEach((p) => {
    ;(movie.ratings[p.id]?.review?.tips ?? []).forEach(
      (t) => (tipsCounts[t] = (tipsCounts[t] || 0) + 1),
    )
  })
  const tipsList = Object.entries(tipsCounts).sort((a, b) => b[1] - a[1])

  // Tags aggregated
  const tagCounts: Record<string, number> = {}
  raters.forEach((p) => {
    ;(movie.ratings[p.id]?.review?.tags ?? []).forEach(
      (t) => (tagCounts[t] = (tagCounts[t] || 0) + 1),
    )
  })
  const tagList = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])

  const headerLabel = (
    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>{movie.title}</span>
      {avg != null && (
        <span
          style={{
            background: scoreColor(avg),
            color: '#fff',
            borderRadius: 6,
            padding: '1px 9px',
            fontSize: '0.88rem',
            fontWeight: 700,
          }}
        >
          {avg.toFixed(1)}
        </span>
      )}
    </span>
  )

  return (
    <>
      <Modal title={headerLabel} onClose={onClose}>
        {/* Meta row */}
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
            marginBottom: '0.85rem',
            flexWrap: 'wrap',
          }}
        >
          {movie.date && (
            <span className="muted" style={{ fontSize: '0.78rem' }}>
              Watched {movie.date.slice(0, 7)}
            </span>
          )}
          {movie.rt && (
            <span style={{ color: '#fa4242', fontWeight: 700, fontSize: '0.82rem' }}>
              🍅 {movie.rt}
            </span>
          )}
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            {scores.length} of {raters.length} rated
          </span>
        </div>

        {/* Gut reactions */}
        {sentDist.some((c) => c > 0) && (
          <>
            <div
              className="muted"
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                marginBottom: '0.3rem',
              }}
            >
              GUT REACTIONS
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.85rem' }}>
              {SENTIMENT.map(
                (s, i) =>
                  sentDist[i] > 0 && (
                    <span key={i} title={s.l} style={{ fontSize: '1.1rem' }}>
                      {s.e}
                      {sentDist[i] > 1 && (
                        <sup style={{ fontSize: '0.65rem', fontWeight: 700 }}>{sentDist[i]}</sup>
                      )}
                    </span>
                  ),
              )}
            </div>
          </>
        )}

        {/* Tips of the cap */}
        {tipsList.length > 0 && (
          <>
            <div
              className="muted"
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                marginBottom: '0.3rem',
              }}
            >
              TIPS OF THE CAP
            </div>
            <div
              style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}
            >
              {tipsList.map(([tip, count]) => {
                const t = TIPS.find((x) => x.id === tip)
                return t ? (
                  <span
                    key={tip}
                    style={{
                      fontSize: '0.8rem',
                      background: 'var(--b1,rgba(127,127,127,0.1))',
                      borderRadius: 12,
                      padding: '2px 9px',
                    }}
                  >
                    {t.e} {t.l}
                    {count > 1 && <span style={{ opacity: 0.6 }}> ×{count}</span>}
                  </span>
                ) : null
              })}
            </div>
          </>
        )}

        {/* Tags */}
        {tagList.length > 0 && (
          <>
            <div
              className="muted"
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                marginBottom: '0.3rem',
              }}
            >
              TAGS
            </div>
            <div
              style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}
            >
              {tagList.map(([tag, count]) => (
                <span
                  key={tag}
                  style={{
                    fontSize: '0.76rem',
                    background: 'var(--b1,rgba(127,127,127,0.1))',
                    borderRadius: 12,
                    padding: '2px 8px',
                  }}
                >
                  #{tag}
                  {count > 1 && <span style={{ opacity: 0.6 }}> ×{count}</span>}
                </span>
              ))}
            </div>
          </>
        )}

        {/* Per-rater cards */}
        <div
          className="muted"
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            marginBottom: '0.5rem',
          }}
        >
          RATINGS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {raters.map((p) => {
            const r = movie.ratings[p.id]
            const rv = r?.review
            const sentItem = rv?.sentiment != null ? SENTIMENT[rv.sentiment] : null
            const rewItem = rv?.rewatch != null ? REWATCH.find((x) => x.v === rv.rewatch) : null
            const recItem = rv?.rec ? REC.find((x) => x.v === rv.rec) : null
            const vibes = (r?.icons ?? [])
              .map((id) => MV_ICONS.find((x) => x.id === id)?.emoji)
              .filter(Boolean)

            return (
              <div
                key={p.id}
                style={{
                  background: 'var(--b1,rgba(127,127,127,0.07))',
                  borderRadius: 10,
                  padding: '0.55rem 0.7rem',
                  borderLeft: `3px solid ${p.color}`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    onClick={() => setPersonProfile(p)}
                    style={{
                      fontWeight: 700,
                      color: p.color,
                      cursor: 'pointer',
                      fontSize: '0.88rem',
                    }}
                    title={`${p.name}'s movie stats`}
                  >
                    {p.name}
                  </span>
                  {r?.score != null && (
                    <span
                      style={{
                        background: scoreColor(r.score),
                        color: '#fff',
                        borderRadius: 6,
                        padding: '1px 8px',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                      }}
                    >
                      {r.score}
                    </span>
                  )}
                  {sentItem && (
                    <span title={sentItem.l} style={{ fontSize: '1rem' }}>
                      {sentItem.e}
                    </span>
                  )}
                  {vibes.length > 0 && (
                    <span style={{ fontSize: '0.9rem', letterSpacing: '0.04em' }}>
                      {vibes.join(' ')}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                    {recItem && (
                      <span title={recItem.l} style={{ fontSize: '0.9rem' }}>
                        {recItem.e}
                      </span>
                    )}
                    {rewItem && (
                      <span title={rewItem.l} style={{ fontSize: '0.9rem' }}>
                        {rewItem.e}
                      </span>
                    )}
                    <button
                      className="btn"
                      style={{ fontSize: '0.7rem', padding: '1px 7px', marginLeft: '0.25rem' }}
                      onClick={() => setEditing(p)}
                    >
                      {r?.score != null ? 'Edit' : 'Rate'}
                    </button>
                  </span>
                </div>
                {(rv?.tips ?? []).length > 0 && (
                  <div
                    style={{
                      fontSize: '0.76rem',
                      display: 'flex',
                      gap: '0.4rem',
                      flexWrap: 'wrap',
                      marginTop: '0.3rem',
                    }}
                  >
                    {rv!.tips!.map((tip) => {
                      const t = TIPS.find((x) => x.id === tip)
                      return t ? (
                        <span key={tip} className="muted">
                          {t.e} {t.l}
                        </span>
                      ) : null
                    })}
                  </div>
                )}
                {(rv?.tags ?? []).length > 0 && (
                  <div className="muted" style={{ fontSize: '0.74rem', marginTop: '0.25rem' }}>
                    {rv!.tags!.map((t) => `#${t}`).join(' ')}
                  </div>
                )}
                {rv?.note && (
                  <p
                    className="muted"
                    style={{ fontSize: '0.8rem', fontStyle: 'italic', margin: '0.3rem 0 0' }}
                  >
                    "{rv.note}"
                  </p>
                )}
                {!r && (
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    Not rated yet
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </Modal>

      {editing && (
        <MovieRate
          movie={movie}
          personId={editing.id}
          personName={editing.name}
          color={editing.color}
          onClose={() => setEditing(null)}
        />
      )}
      {personProfile && (
        <MoviePersonProfile
          personId={personProfile.id}
          personName={personProfile.name}
          color={personProfile.color}
          onClose={() => setPersonProfile(null)}
        />
      )}
    </>
  )
}
