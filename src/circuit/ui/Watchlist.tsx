// Watchlist — queued movies with per-person vote buttons, sortable.
import { useMemo, useState } from 'react'
import { circuitStore, useCircuit } from '../store'
import { watchlistInGroup } from '../groupFilter'
import { MV_PIDS } from './movieMeta'
import { Modal } from './Modal'
import type { WatchlistItem } from '../types'

type SortW = 'votes' | 'alpha' | 'rt'

export function Watchlist({
  onWatched,
  viewGroup = '',
}: {
  onWatched?: (title: string, rt?: string) => void
  viewGroup?: string
} = {}) {
  const { watchlist: allWatchlist, people } = useCircuit()
  // scope to the viewed circuit (shared filter)
  const watchlist = useMemo(
    () => watchlistInGroup(allWatchlist, viewGroup),
    [allWatchlist, viewGroup],
  )
  const [sort, setSort] = useState<SortW>('votes')
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newRt, setNewRt] = useState('')

  const voters = useMemo(
    () => MV_PIDS.map((id) => people.find((p) => p.id === id)).filter(Boolean) as typeof people,
    [people],
  )

  const sorted = useMemo(() => {
    const list = [...watchlist]
    if (sort === 'votes') list.sort((a, b) => (b.votes?.length ?? 0) - (a.votes?.length ?? 0))
    else if (sort === 'alpha') list.sort((a, b) => a.title.localeCompare(b.title))
    else list.sort((a, b) => (parseInt(b.rt ?? '0') || 0) - (parseInt(a.rt ?? '0') || 0))
    return list
  }, [watchlist, sort])

  function toggleVote(item: WatchlistItem, pid: string) {
    const votes = item.votes ?? []
    const next = votes.includes(pid) ? votes.filter((v) => v !== pid) : [...votes, pid]
    void circuitStore.saveWatchlist({ ...item, votes: next })
  }

  // default a new item to the group the watchlist already lives in (falling back to
  // movies, then the first group) so friends can see + vote — same fix as AddMovie
  function defaultGroup(): string | undefined {
    const st = circuitStore.getState()
    const counts = new Map<string, number>()
    for (const w of st.watchlist)
      if (w.groupId) counts.set(w.groupId, (counts.get(w.groupId) ?? 0) + 1)
    for (const m of st.movies)
      if (m.groupId) counts.set(m.groupId, (counts.get(m.groupId) ?? 0) + 1)
    let best: string | undefined
    let bestN = 0
    for (const [g, n] of counts)
      if (n > bestN) {
        bestN = n
        best = g
      }
    return best ?? st.groups?.[0]?.id ?? undefined
  }

  function addItem() {
    const t = newTitle.trim()
    if (!t) return
    const item: WatchlistItem = {
      id: 'wl' + (crypto.randomUUID?.() ?? String(Date.now())),
      title: t,
      rt: newRt.trim() ? newRt.trim() + '%' : undefined,
      votes: [],
      groupId: defaultGroup(),
    }
    void circuitStore.saveWatchlist(item)
    setNewTitle('')
    setNewRt('')
    setAdding(false)
  }

  function markWatched(item: WatchlistItem) {
    void circuitStore.deleteWatchlist(item.id)
    onWatched?.(item.title, item.rt)
  }

  const sortBtn = (k: SortW, label: string) => (
    <button
      key={k}
      className="btn"
      onClick={() => setSort(k)}
      style={
        sort === k
          ? { background: 'var(--accent,#7c6af7)', color: '#fff', borderColor: 'transparent' }
          : {}
      }
    >
      {label}
    </button>
  )

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          flexWrap: 'wrap',
          marginBottom: '1rem',
        }}
      >
        <h3 style={{ margin: 0 }}>Watchlist</h3>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {watchlist.length} queued
        </span>
        <button className="btn" onClick={() => setAdding(true)}>
          ＋ Add
        </button>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
          {sortBtn('votes', 'Top')}
          {sortBtn('alpha', 'A–Z')}
          {sortBtn('rt', 'RT%')}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        {sorted.map((item, i) => {
          const voteCount = item.votes?.length ?? 0
          return (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.45rem 0.65rem',
                background: 'var(--b1,rgba(127,127,127,0.07))',
                borderRadius: 8,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ opacity: 0.4, fontSize: '0.78rem', width: '1.5rem', flexShrink: 0 }}>
                {i + 1}
              </span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: '0.88rem', minWidth: 100 }}>
                {item.title}
              </span>
              {item.rt && (
                <span
                  style={{ color: '#fa4242', fontWeight: 700, fontSize: '0.76rem', flexShrink: 0 }}
                >
                  {item.rt}
                </span>
              )}
              {/* Per-person vote chips */}
              <span style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                {voters.map((p) => {
                  const voted = (item.votes ?? []).includes(p.id)
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleVote(item, p.id)}
                      title={`${p.name} ${voted ? '— remove vote' : '— vote to watch'}`}
                      style={{
                        background: voted ? p.color : 'transparent',
                        border: `1.5px solid ${p.color}`,
                        color: voted ? '#fff' : p.color,
                        borderRadius: 10,
                        padding: '1px 7px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        opacity: voted ? 1 : 0.55,
                        transition: 'opacity 0.12s, background 0.12s',
                        lineHeight: 1.6,
                      }}
                    >
                      {p.name.split(' ')[0]}
                    </button>
                  )
                })}
              </span>
              {voteCount > 0 && (
                <span
                  style={{
                    fontSize: '0.76rem',
                    color: 'var(--accent,#7c6af7)',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {voteCount} 🗳
                </span>
              )}
              <button
                className="btn"
                style={{
                  fontSize: '0.74rem',
                  padding: '2px 9px',
                  background: 'rgba(34,204,120,0.12)',
                  borderColor: '#22cc78',
                  color: '#22cc78',
                  flexShrink: 0,
                }}
                onClick={() => markWatched(item)}
                title="We watched it — move to Movies"
              >
                ✓ Watched
              </button>
              <button
                className="btn"
                style={{ fontSize: '0.74rem', padding: '2px 6px', opacity: 0.45, flexShrink: 0 }}
                onClick={() => void circuitStore.deleteWatchlist(item.id)}
                title="Remove"
              >
                ✕
              </button>
            </div>
          )
        })}
        {watchlist.length === 0 && (
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Nothing queued yet. Add movies to watch together.
          </p>
        )}
      </div>

      {adding && (
        <Modal
          title="Add to Watchlist"
          onClose={() => setAdding(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button
                className="btn"
                onClick={addItem}
                disabled={!newTitle.trim()}
                style={{
                  background: 'var(--accent,#7c6af7)',
                  color: '#fff',
                  borderColor: 'transparent',
                }}
              >
                Add
              </button>
            </>
          }
        >
          <label style={{ display: 'grid', gap: 4, marginBottom: '0.6rem' }}>
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              Title
            </span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
              placeholder="Movie title"
              autoFocus
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              RT% (optional)
            </span>
            <input
              value={newRt}
              onChange={(e) => setNewRt(e.target.value)}
              placeholder="e.g. 87"
              type="number"
              min={0}
              max={100}
            />
          </label>
        </Modal>
      )}
    </div>
  )
}
