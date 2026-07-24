// Full-richness movie rating sheet: score + vibes + sentiment + rewatch + recommend
// + tip-of-the-cap + tags + hot-take, for one person on one movie. Writes via the store.
import { useMemo, useState } from 'react'
import { circuitStore, useCircuit } from '../store'
import type { Movie, MovieRating, MovieReview } from '../types'
import { Modal } from './Modal'
import { MV_ICONS, REC, REWATCH, SENTIMENT, TAG_PRESETS, TIPS, scoreColor } from './movieMeta'

const sectionLabel: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  opacity: 0.6,
  margin: '0.9rem 0 0.4rem',
}

function Chip({
  on,
  onClick,
  children,
  color,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  color?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${on ? color || 'var(--accent, #7c6af7)' : 'var(--b2, rgba(127,127,127,0.35))'}`,
        background: on ? color || 'var(--accent, #7c6af7)' : 'transparent',
        color: on ? '#fff' : 'inherit',
        borderRadius: 999,
        padding: '4px 10px',
        fontSize: '0.8rem',
        fontWeight: 600,
        cursor: 'pointer',
        lineHeight: 1.3,
      }}
    >
      {children}
    </button>
  )
}

export function MovieRate({
  movie,
  personId,
  personName,
  color,
  onClose,
}: {
  movie: Movie
  personId: string
  personName: string
  color: string
  onClose: () => void
}) {
  const existing = movie.ratings[personId]
  const isMovie = (movie.kind ?? 'movie') === 'movie'
  const rv = existing?.review ?? {}
  const [score, setScore] = useState<number | null>(existing?.score ?? null)
  const [icons, setIcons] = useState<string[]>(existing?.icons ?? [])
  const [sentiment, setSentiment] = useState<number | null>(rv.sentiment ?? null)
  const [rewatch, setRewatch] = useState<number | null>(rv.rewatch ?? null)
  const [rec, setRec] = useState<'y' | 'n' | 'm' | null>(rv.rec ?? null)
  const [tips, setTips] = useState<string[]>(rv.tips ?? [])
  const [tags, setTags] = useState<string[]>(rv.tags ?? [])
  const [note, setNote] = useState(rv.note ?? '')
  const [customTag, setCustomTag] = useState('')

  // this person's other rated movies, ranked — to show where the current score lands
  const allMovies = useCircuit().movies
  const ranked = useMemo(
    () =>
      allMovies
        .filter((x) => x.id !== movie.id)
        .map((x) => ({ title: x.title, score: x.ratings[personId]?.score }))
        .filter((r): r is { title: string; score: number } => r.score != null)
        .sort((a, b) => b.score - a.score),
    [allMovies, movie.id, personId],
  )

  const toggle = (arr: string[], set: (v: string[]) => void, v: string) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  // vibes stack: the same reaction can be added multiple times (🔥×3). icons is a flat
  // list with repeats; click adds one, right-click removes one.
  const iconCount = (id: string) => icons.filter((x) => x === id).length
  // functional updaters so rapid repeats accumulate (don't read a stale `icons`)
  const addIcon = (id: string) => setIcons((prev) => [...prev, id])
  const removeIcon = (id: string) =>
    setIcons((prev) => {
      const i = prev.indexOf(id)
      return i < 0 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)]
    })

  const save = () => {
    const review: MovieReview = { sentiment, rewatch, rec, tips, tags, note: note.trim() }
    const reviewEmpty =
      sentiment == null &&
      rewatch == null &&
      rec == null &&
      !tips.length &&
      !tags.length &&
      !review.note
    const allEmpty = score == null && !icons.length && reviewEmpty
    const ratings: Record<string, MovieRating> = { ...movie.ratings }
    if (allEmpty) delete ratings[personId]
    else
      ratings[personId] = {
        score,
        icons: icons.length ? icons : undefined,
        review: reviewEmpty ? undefined : review,
      }
    void circuitStore.saveMovie({ ...movie, ratings })
    onClose()
  }

  return (
    <Modal
      title={
        <span>
          <span style={{ color }}>{personName}</span>
          <span style={{ opacity: 0.6, fontWeight: 400 }}> · {movie.title}</span>
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
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
        </>
      }
    >
      {/* score */}
      <div style={sectionLabel}>Score</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <input
          type="range"
          min={0}
          max={100}
          value={score ?? 0}
          onChange={(e) => setScore(Number(e.target.value))}
          style={{ flex: 1, accentColor: scoreColor(score) }}
        />
        <input
          type="number"
          min={0}
          max={100}
          value={score ?? ''}
          placeholder="–"
          onChange={(e) => setScore(e.target.value === '' ? null : Number(e.target.value))}
          style={{
            width: 64,
            textAlign: 'center',
            fontWeight: 800,
            padding: '0.3rem',
            color: scoreColor(score),
          }}
        />
      </div>

      {/* live ranking context: where this score lands among this person's other movies */}
      {ranked.length > 0 &&
        (() => {
          if (score == null) return null
          const sc = score
          let idx = ranked.findIndex((r) => r.score < sc)
          if (idx === -1) idx = ranked.length
          const from = Math.max(0, idx - 2)
          const to = Math.min(ranked.length, idx + 2)
          const list = [
            ...ranked.slice(from, idx).map((r) => ({ ...r, me: false })),
            { title: movie.title, score: sc, me: true },
            ...ranked.slice(idx, to).map((r) => ({ ...r, me: false })),
          ]
          return (
            <>
              <div style={sectionLabel}>Where it ranks for {personName}</div>
              <div
                style={{
                  background: 'var(--b1, rgba(127,127,127,0.07))',
                  borderRadius: 8,
                  padding: '0.4rem 0.6rem',
                }}
              >
                {from > 0 && (
                  <div className="muted" style={{ fontSize: '0.7rem', textAlign: 'center' }}>
                    ↑ {from} higher
                  </div>
                )}
                {list.map((r, k) => (
                  <div
                    key={k}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '2px 0',
                      opacity: r.me ? 1 : 0.7,
                    }}
                  >
                    <span
                      style={{
                        width: '1.6rem',
                        textAlign: 'right',
                        fontSize: '0.72rem',
                        opacity: 0.6,
                      }}
                    >
                      {from + k + 1}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: '0.78rem',
                        fontWeight: r.me ? 800 : 400,
                        color: r.me ? color : 'inherit',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.me ? `${r.title} (this)` : r.title}
                    </span>
                    <span
                      style={{ fontSize: '0.78rem', fontWeight: 700, color: scoreColor(r.score) }}
                    >
                      {Math.round(r.score)}
                    </span>
                  </div>
                ))}
                {to < ranked.length && (
                  <div className="muted" style={{ fontSize: '0.7rem', textAlign: 'center' }}>
                    ↓ {ranked.length - to} lower
                  </div>
                )}
              </div>
            </>
          )
        })()}

      {/* vibes — stack the same reaction by clicking again */}
      <div style={sectionLabel}>
        Vibes (optional){' '}
        <span className="muted" style={{ fontWeight: 400, textTransform: 'none' }}>
          — click to add, right-click to remove
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {MV_ICONS.map((ic) => {
          const n = iconCount(ic.id)
          return (
            <button
              key={ic.id}
              type="button"
              title={`${ic.label} — click +1, right-click −1`}
              onClick={() => addIcon(ic.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                removeIcon(ic.id)
              }}
              style={{
                fontSize: '1.2rem',
                padding: '2px 7px',
                borderRadius: 8,
                cursor: 'pointer',
                border: `1px solid ${n > 0 ? 'var(--accent, #7c6af7)' : 'transparent'}`,
                background: n > 0 ? 'var(--b1, rgba(124,106,247,0.15))' : 'transparent',
                opacity: n > 0 ? 1 : 0.5,
              }}
            >
              {ic.emoji}
              {n > 1 && (
                <sup style={{ fontSize: '0.6rem', fontWeight: 700, marginLeft: 1 }}>{n}</sup>
              )}
            </button>
          )
        })}
      </div>

      {/* gut reaction */}
      <div style={sectionLabel}>Gut reaction</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {SENTIMENT.map((s, i) => (
          <Chip
            key={i}
            on={sentiment === i}
            onClick={() => setSentiment(sentiment === i ? null : i)}
          >
            {s.e} {s.l}
          </Chip>
        ))}
      </div>

      {/* do it again — "watch" for movies, generic elsewhere */}
      <div style={sectionLabel}>{isMovie ? 'Watch it again?' : 'Again?'}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {REWATCH.map((rw) => (
          <Chip
            key={rw.v}
            on={rewatch === rw.v}
            onClick={() => setRewatch(rewatch === rw.v ? null : rw.v)}
          >
            {rw.e} {rw.l}
          </Chip>
        ))}
      </div>

      {/* recommend */}
      <div style={sectionLabel}>Recommend?</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {REC.map((rc) => (
          <Chip key={rc.v} on={rec === rc.v} onClick={() => setRec(rec === rc.v ? null : rc.v)}>
            {rc.e} {rc.l}
          </Chip>
        ))}
      </div>

      {/* tip of the cap — soundtrack/plot/cinematography only make sense for movies */}
      {isMovie && (
        <>
          <div style={sectionLabel}>🎩 Tip of the cap</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {TIPS.map((t) => (
              <Chip key={t.id} on={tips.includes(t.id)} onClick={() => toggle(tips, setTips, t.id)}>
                {t.e} {t.l}
              </Chip>
            ))}
          </div>
        </>
      )}

      {/* tags */}
      <div style={sectionLabel}>Tags</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {[...new Set([...TAG_PRESETS, ...tags])].map((t) => (
          <Chip key={t} on={tags.includes(t)} onClick={() => toggle(tags, setTags, t)}>
            {t}
          </Chip>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
        <input
          value={customTag}
          placeholder="add a custom tag…"
          onChange={(e) => setCustomTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && customTag.trim()) {
              toggle(tags, setTags, customTag.trim().toLowerCase())
              setCustomTag('')
            }
          }}
          style={{ flex: 1, padding: '0.35rem 0.5rem' }}
        />
        <button
          className="btn"
          onClick={() => {
            if (customTag.trim()) {
              toggle(tags, setTags, customTag.trim().toLowerCase())
              setCustomTag('')
            }
          }}
        >
          Add
        </button>
      </div>

      {/* hot take */}
      <div style={sectionLabel}>Hot take</div>
      <textarea
        value={note}
        placeholder="a line or two…"
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        style={{ width: '100%', padding: '0.5rem', resize: 'vertical', fontFamily: 'inherit' }}
      />
    </Modal>
  )
}
