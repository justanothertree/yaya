// Add a new review to the board (ratings get added afterward via the rating sheet).
// A review is any rated thing — a movie, a meal, a beer, a restaurant — tagged by kind.
import { useState } from 'react'
import { circuitStore } from '../store'
import type { Movie } from '../types'
import { REVIEW_KINDS, kindOf } from '../reviewKinds'
import { Modal } from './Modal'

// A new movie must join a group everyone in the crew can see, or it's invisible to
// members (RLS scopes by group membership). Default to wherever the collection already
// lives — the group most existing movies belong to — falling back to the user's first
// group. This is what a movie added with no group silently broke: it siloed in a private
// group and friends couldn't see it.
function defaultMovieGroup(): string | undefined {
  const st = circuitStore.getState()
  const counts = new Map<string, number>()
  for (const m of st.movies) if (m.groupId) counts.set(m.groupId, (counts.get(m.groupId) ?? 0) + 1)
  let best: string | undefined
  let bestN = 0
  for (const [g, n] of counts)
    if (n > bestN) {
      bestN = n
      best = g
    }
  return best ?? st.groups?.[0]?.id ?? undefined
}

export function AddMovie({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded?: (m: Movie) => void
}) {
  const [kind, setKind] = useState('movie')
  const [title, setTitle] = useState('')
  // did-it-tonight is the overwhelming case — default today, still editable
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rt, setRt] = useState('')
  const k = kindOf(kind)
  const isMovie = kind === 'movie'

  const save = () => {
    const t = title.trim()
    if (!t) return
    const id = 'm' + (crypto.randomUUID?.() ?? String(Date.now()))
    const movie: Movie = {
      id,
      title: t,
      kind,
      date: date || undefined,
      rt: isMovie ? rt.trim() || undefined : undefined,
      ratings: {},
      groupId: defaultMovieGroup(),
    }
    void circuitStore.saveMovie(movie)
    onAdded?.(movie)
    onClose()
  }

  const field: React.CSSProperties = { width: '100%', padding: '0.45rem 0.6rem', marginTop: 4 }
  const label: React.CSSProperties = {
    fontSize: '0.8rem',
    fontWeight: 600,
    display: 'block',
    marginTop: '0.75rem',
  }

  return (
    <Modal
      title="Add a review"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={save}
            disabled={!title.trim()}
            style={{
              background: 'var(--accent, #7c6af7)',
              color: '#fff',
              borderColor: 'transparent',
            }}
          >
            Add
          </button>
        </>
      }
    >
      <span style={label}>What is it?</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: 4 }}>
        {REVIEW_KINDS.map((rk) => (
          <button
            key={rk.id}
            type="button"
            className={'cz-chip' + (kind === rk.id ? ' cz-on' : '')}
            style={
              kind === rk.id ? { background: 'var(--accent, #7c6af7)', color: '#fff' } : undefined
            }
            onClick={() => setKind(rk.id)}
          >
            {rk.emoji} {rk.label}
          </button>
        ))}
      </div>
      <label style={label}>
        {isMovie ? 'Title' : `${k.label} name`}
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder={isMovie ? 'Movie title' : `e.g. ${exampleFor(kind)}`}
          style={field}
        />
      </label>
      <label style={label}>
        {isMovie ? 'Date watched' : 'Date'} <span className="muted">(optional)</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} />
      </label>
      {isMovie && (
        <label style={label}>
          Rotten Tomatoes % <span className="muted">(optional)</span>
          <input
            value={rt}
            onChange={(e) => setRt(e.target.value)}
            placeholder="e.g. 94%"
            style={field}
          />
        </label>
      )}
    </Modal>
  )
}

function exampleFor(kind: string): string {
  switch (kind) {
    case 'food':
      return 'Margherita pizza'
    case 'beer':
      return 'Hazy IPA'
    case 'restaurant':
      return "Tony's Diner"
    case 'game':
      return 'Elden Ring'
    default:
      return 'What you rated'
  }
}
