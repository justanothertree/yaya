// Ratings — the standalone home for shared experience ratings: Reviews (movies, food, beer,
// anything) + the Watchlist of things to try. Pulled out of the Circuit so the Circuit can be
// fitness-only; both boards stay group/circuit-scoped and synced through the same shared store.
import { useEffect, useState } from 'react'
import { connectCircuit } from '../circuit/connect'
import { useCircuit } from '../circuit/store'
import { Movies } from '../circuit/ui/Movies'
import { Watchlist } from '../circuit/ui/Watchlist'
import { Toast } from '../circuit/ui/Toast'
import { useScrollFade } from '../hooks/useScrollFade'

type RTab = 'reviews' | 'watchlist'
const TAB_KEY = 'ratings_tab'

function initialTab(): RTab {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const fromLink = q.get('tab')
  if (fromLink === 'reviews' || fromLink === 'watchlist') return fromLink
  try {
    const saved = localStorage.getItem(TAB_KEY)
    if (saved === 'reviews' || saved === 'watchlist') return saved
  } catch {
    /* ignore */
  }
  return 'reviews'
}

export function Ratings() {
  const state = useCircuit()
  const groups = state.groups ?? []
  const tabsRef = useScrollFade<HTMLSpanElement>()
  const [tab, setTabRaw] = useState<RTab>(() => initialTab())
  const setTab = (t: RTab) => {
    setTabRaw(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* ignore */
    }
  }

  // ensure the shared store is wired even if the visitor lands here before the Circuit
  useEffect(() => {
    void connectCircuit()
  }, [])

  // a #ratings?tab=… deep link can arrive while we're already mounted — switch live
  useEffect(() => {
    const onHash = () => {
      const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
      const t = q.get('tab')
      if (t === 'reviews' || t === 'watchlist') setTab(t)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // one shared circuit filter across the whole app (same key the Circuit uses)
  const [viewGroup, setViewGroup] = useState<string>(() => {
    try {
      return localStorage.getItem('circuit_view_group') ?? ''
    } catch {
      return ''
    }
  })
  const pickGroup = (g: string) => {
    setViewGroup(g)
    try {
      localStorage.setItem('circuit_view_group', g)
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    if (viewGroup && groups.length && !groups.some((g) => g.id === viewGroup)) pickGroup('')
  }, [groups, viewGroup])

  const groupPicker = groups.length > 1 && (
    <label
      className="muted"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}
      title="Show just one of your circuits"
    >
      👥
      <select
        value={viewGroup}
        onChange={(e) => pickGroup(e.target.value)}
        style={{ padding: '0.25rem 0.4rem' }}
      >
        <option value="">All circuits</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  )

  const tabs: { id: RTab; label: string }[] = [
    { id: 'reviews', label: '📝 Reviews' },
    { id: 'watchlist', label: '🍿 Watchlist' },
  ]

  return (
    <div className={`cz-tab-${tab}`}>
      <div
        className="cz-head"
        style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}
      >
        <h2 className="section-title" style={{ margin: 0 }}>
          Ratings
        </h2>
        <span className="muted cz-subtitle" style={{ fontSize: '0.85rem' }}>
          reviews &amp; watchlist, shared with your circles
        </span>
      </div>

      <div
        className="cz-toolbar"
        style={{
          display: 'flex',
          gap: '0.5rem',
          margin: '0.9rem 0 1.1rem',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span className="cz-tabs" ref={tabsRef}>
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`cz-tab${tab === t.id ? ' cz-on' : ''}`}
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
            >
              {t.label}
            </button>
          ))}
        </span>
        {groupPicker && <span style={{ marginLeft: 'auto' }}>{groupPicker}</span>}
      </div>

      <div className="cz-pane" key={tab}>
        {tab === 'reviews' && <Movies viewGroup={viewGroup} />}
        {tab === 'watchlist' && <Watchlist viewGroup={viewGroup} />}
      </div>

      <Toast />
    </div>
  )
}
