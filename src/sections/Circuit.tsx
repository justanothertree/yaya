// The Circuit — in-site module shell. Sub-tabs mirror the standalone app.
// Backed by the shared store (localStorage now → Supabase realtime later, no UI change).
import { useEffect, useState } from 'react'
import { connectCircuit } from '../circuit/connect'
import { Board } from '../circuit/ui/Board'
import { Log } from '../circuit/ui/Log'
import { Feed } from '../circuit/ui/Feed'
import { Charts } from '../circuit/ui/Charts'
import { Movies } from '../circuit/ui/Movies'
import { Watchlist } from '../circuit/ui/Watchlist'
import { Toast } from '../circuit/ui/Toast'

type Tab = 'board' | 'log' | 'feed' | 'charts' | 'movies' | 'watchlist'

const todayISO = () => new Date().toISOString().slice(0, 10)

export function Circuit() {
  const [tab, setTab] = useState<Tab>('board')
  const [logTarget, setLogTarget] = useState<{ personId: string; date: string } | null>(null)

  useEffect(() => {
    void connectCircuit()
  }, [])

  function handleLogToday(personId: string) {
    setLogTarget({ personId, date: todayISO() })
    setTab('log')
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'board', label: '🏆 Board' },
    { id: 'log', label: '✏️ Log' },
    { id: 'feed', label: '📋 Feed' },
    { id: 'charts', label: '📊 Charts' },
    { id: 'movies', label: '🎬 Movies' },
    { id: 'watchlist', label: '🍿 Watchlist' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          The Circuit
        </h2>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          fitness + movies, synced for you and friends
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', margin: '0.9rem 0 1.1rem', flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className="btn"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            style={
              tab === t.id
                ? {
                    background: 'var(--accent, #7c6af7)',
                    color: '#fff',
                    borderColor: 'transparent',
                  }
                : undefined
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'board' && <Board onLogToday={handleLogToday} />}
      {tab === 'log' && (
        <Log
          key={logTarget ? `${logTarget.personId}-${logTarget.date}` : 'default'}
          defaultPersonId={logTarget?.personId}
          defaultDate={logTarget?.date}
        />
      )}
      {tab === 'feed' && <Feed />}
      {tab === 'charts' && <Charts />}
      {tab === 'movies' && <Movies />}
      {tab === 'watchlist' && <Watchlist />}

      <Toast />
    </div>
  )
}
