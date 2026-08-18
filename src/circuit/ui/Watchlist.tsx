// Pool — a set of options a circle is choosing between, not a list to admire.
//
// It used to be a watchlist: queued titles with a full-name vote chip per person on every row,
// which read as clutter and never actually decided anything. Same data, reframed around the
// decision — say what you're up for, then let it pick. Pools are typed (movies, food, games…)
// so one circle can run several without them mixing.
import { useMemo, useState } from 'react'
import { circuitStore, useCircuit } from '../store'
import { watchlistInGroup } from '../groupFilter'
import { MV_PIDS } from './movieMeta'
import { REVIEW_KINDS, kindEmoji, kindsPresent } from '../reviewKinds'
import { Modal } from './Modal'
import type { CircuitGroup, WatchlistItem } from '../types'

type SortW = 'votes' | 'alpha' | 'rt'

export function Watchlist({
  onWatched,
  viewGroup = '',
  groups = [],
}: {
  onWatched?: (title: string, rt?: string) => void
  /** the circuit filter you're currently looking at — '' means "all circuits" */
  viewGroup?: string
  groups?: CircuitGroup[]
} = {}) {
  const { watchlist: allWatchlist, people } = useCircuit()
  const inGroup = useMemo(
    () => watchlistInGroup(allWatchlist, viewGroup),
    [allWatchlist, viewGroup],
  )
  const [sort, setSort] = useState<SortW>('votes')
  const [kindFilter, setKindFilter] = useState<string>('')
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newRt, setNewRt] = useState('')
  const [newKind, setNewKind] = useState('movie')
  // See AddMovie.tsx for the full reasoning -- same fix, same shape: default to whatever
  // circuit you're actually looking at, only ask when there's more than one to choose from.
  const [newGroup, setNewGroup] = useState<string | undefined>(() => viewGroup || defaultGroup())
  /** the current pick, kept so it can be re-rolled or accepted */
  const [picked, setPicked] = useState<WatchlistItem | null>(null)

  const voters = useMemo(
    () => MV_PIDS.map((id) => people.find((p) => p.id === id)).filter(Boolean) as typeof people,
    [people],
  )

  // which kinds are actually present — the filter only earns its space when there's a choice
  const kindCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of inGroup) m.set(w.kind ?? 'movie', (m.get(w.kind ?? 'movie') ?? 0) + 1)
    return m
  }, [inGroup])
  const multiKind = kindCounts.size > 1

  const watchlist = useMemo(
    () => (kindFilter ? inGroup.filter((w) => (w.kind ?? 'movie') === kindFilter) : inGroup),
    [inGroup, kindFilter],
  )

  const sorted = useMemo(() => {
    const list = [...watchlist]
    if (sort === 'votes') list.sort((a, b) => (b.votes?.length ?? 0) - (a.votes?.length ?? 0))
    else if (sort === 'alpha') list.sort((a, b) => a.title.localeCompare(b.title))
    else list.sort((a, b) => (parseInt(b.rt ?? '0') || 0) - (parseInt(a.rt ?? '0') || 0))
    return list
  }, [watchlist, sort])

  /**
   * Pick one, weighted by votes: votes tilt the odds rather than deciding outright, so the
   * option nobody championed can still come up. That's the point of a randomiser — it settles
   * the argument without pretending the vote was unanimous.
   */
  function pick() {
    if (watchlist.length === 0) return
    const weights = watchlist.map((w) => 1 + (w.votes?.length ?? 0) * 2)
    const total = weights.reduce((a, b) => a + b, 0)
    let r = Math.random() * total
    for (let i = 0; i < watchlist.length; i++) {
      r -= weights[i]
      if (r <= 0) {
        setPicked(watchlist[i])
        return
      }
    }
    setPicked(watchlist[watchlist.length - 1])
  }

  function toggleVote(item: WatchlistItem, pid: string) {
    const votes = item.votes ?? []
    const next = votes.includes(pid) ? votes.filter((v) => v !== pid) : [...votes, pid]
    void circuitStore.saveWatchlist({ ...item, votes: next })
  }

  // default a new option to the circuit the pool already lives in, so friends can see + vote
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
    void circuitStore.saveWatchlist({
      id: 'wl' + (crypto.randomUUID?.() ?? String(Date.now())),
      title: t,
      rt: newRt.trim() ? newRt.trim() + '%' : undefined,
      votes: [],
      kind: newKind,
      groupId: newGroup,
    })
    setNewTitle('')
    setNewRt('')
    setAdding(false)
  }

  function markDone(item: WatchlistItem) {
    void circuitStore.deleteWatchlist(item.id)
    if (picked?.id === item.id) setPicked(null)
    onWatched?.(item.title, item.rt)
  }

  const sortBtn = (k: SortW, label: string) => (
    <button
      key={k}
      className="btn cz-tap"
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

  // RT% only means anything for films
  const moviesOnly = !multiKind && (kindCounts.has('movie') || kindCounts.size === 0)

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          flexWrap: 'wrap',
          marginBottom: '0.8rem',
        }}
      >
        <h3 style={{ margin: 0 }}>The pool</h3>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {watchlist.length} option{watchlist.length === 1 ? '' : 's'}
        </span>
        <button className="btn cz-tap" onClick={() => setAdding(true)}>
          ＋ Add
        </button>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.35rem' }}>
          {sortBtn('votes', 'Top')}
          {sortBtn('alpha', 'A–Z')}
          {moviesOnly && sortBtn('rt', 'RT%')}
        </span>
      </div>

      {/* the decision — the reason this screen exists */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button
          className="btn cz-tap"
          onClick={pick}
          disabled={watchlist.length === 0}
          style={{
            background: 'var(--accent,#7c6af7)',
            color: '#fff',
            borderColor: 'transparent',
            fontWeight: 700,
          }}
        >
          🎲 {picked ? 'Pick again' : 'Pick for us'}
        </button>
        {picked && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            <strong style={{ fontSize: '1.05rem' }}>
              {kindEmoji(picked.kind)} {picked.title}
            </strong>
            <button className="btn cz-tap" onClick={() => markDone(picked)} title="We did this one">
              ✓ Did it
            </button>
          </span>
        )}
      </div>
      {watchlist.length > 0 && (
        <p className="muted" style={{ fontSize: '0.76rem', margin: '0.4rem 0 0.9rem' }}>
          Votes tilt the odds — anything in the pool can still come up.
        </p>
      )}

      {/* kind filter, only when there's more than one kind of thing in here */}
      {multiKind && (
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
          <button
            className={'cz-chip' + (kindFilter === '' ? ' cz-on' : '')}
            style={kindFilter === '' ? { background: 'var(--accent,#7c6af7)', color: '#fff' } : {}}
            onClick={() => setKindFilter('')}
          >
            All {inGroup.length}
          </button>
          {kindsPresent(kindCounts.keys())
            .filter((k) => kindCounts.has(k.id))
            .map((k) => (
              <button
                key={k.id}
                className={'cz-chip' + (kindFilter === k.id ? ' cz-on' : '')}
                style={
                  kindFilter === k.id ? { background: 'var(--accent,#7c6af7)', color: '#fff' } : {}
                }
                onClick={() => setKindFilter(k.id)}
              >
                {k.emoji} {kindCounts.get(k.id)}
              </button>
            ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {sorted.map((item) => {
          const voteCount = item.votes?.length ?? 0
          const isPick = picked?.id === item.id
          return (
            <div
              key={item.id}
              className="cz-pool-row"
              style={isPick ? { boxShadow: '0 0 0 2px var(--accent,#7c6af7)' } : {}}
            >
              <span className="cz-pool-title">
                {multiKind && <span aria-hidden>{kindEmoji(item.kind)} </span>}
                {item.title}
                {item.rt && (
                  <span style={{ color: '#fa4242', fontWeight: 700, fontSize: '0.74rem' }}>
                    {' '}
                    {item.rt}
                  </span>
                )}
              </span>

              {/* who's up for it — initials, so a row stays one row */}
              <span className="cz-pool-votes">
                {voters.map((p) => {
                  const voted = (item.votes ?? []).includes(p.id)
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleVote(item, p.id)}
                      title={`${p.name} ${voted ? '— remove vote' : '— up for it'}`}
                      aria-pressed={voted}
                      aria-label={`${p.name} up for ${item.title}`}
                      style={{
                        background: voted ? p.color : 'transparent',
                        border: `1.5px solid ${p.color}`,
                        color: voted ? '#fff' : p.color,
                        borderRadius: '50%',
                        width: 30,
                        height: 30,
                        padding: 0,
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        opacity: voted ? 1 : 0.5,
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      {p.name[0]?.toUpperCase()}
                    </button>
                  )
                })}
              </span>

              {voteCount > 0 && <span className="cz-pool-count">{voteCount}</span>}
              <button
                className="btn cz-tap"
                onClick={() => void circuitStore.deleteWatchlist(item.id)}
                title="Take it out of the pool"
                style={{ opacity: 0.45, flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          )
        })}
        {watchlist.length === 0 && (
          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Nothing in the pool yet. Add a few options and let it choose.
          </p>
        )}
      </div>

      {adding && (
        <Modal
          title="Add to the pool"
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
          {groups.length > 1 && (
            <label style={{ display: 'grid', gap: 4, marginBottom: '0.7rem' }}>
              <span className="muted" style={{ fontSize: '0.82rem' }}>
                Circuit
              </span>
              <select
                value={newGroup ?? ''}
                onChange={(e) => setNewGroup(e.target.value || undefined)}
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                Only people in this circuit will see it.
              </span>
            </label>
          )}
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
            {REVIEW_KINDS.map((k) => (
              <button
                key={k.id}
                className={'cz-chip' + (newKind === k.id ? ' cz-on' : '')}
                style={
                  newKind === k.id ? { background: 'var(--accent,#7c6af7)', color: '#fff' } : {}
                }
                onClick={() => setNewKind(k.id)}
              >
                {k.emoji} {k.label}
              </button>
            ))}
          </div>
          <label style={{ display: 'grid', gap: 4, marginBottom: '0.6rem' }}>
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              What&apos;s the option?
            </span>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
              placeholder="Something to choose between"
              autoFocus
            />
          </label>
          {newKind === 'movie' && (
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
          )}
        </Modal>
      )}
    </div>
  )
}
