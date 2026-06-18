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
import { CircuitCanvas, type CanvasPane } from '../circuit/ui/CircuitCanvas'

type Tab = 'board' | 'log' | 'feed' | 'charts' | 'movies' | 'watchlist'

const todayISO = () => new Date().toISOString().slice(0, 10)
const isDesktop = () => typeof window !== 'undefined' && window.innerWidth >= 820

export function Circuit({ authed = false }: { authed?: boolean } = {}) {
  const [tab, setTab] = useState<Tab>('board')
  const [logTarget, setLogTarget] = useState<{ personId: string; date: string } | null>(null)
  const [canvas, setCanvas] = useState(false)
  const [focusPane, setFocusPane] = useState<{ id: string; nonce: number } | null>(null)
  const [desktop, setDesktop] = useState(isDesktop())

  useEffect(() => {
    void connectCircuit()
  }, [])

  useEffect(() => {
    const onResize = () => setDesktop(isDesktop())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // canvas is desktop-only; drop out if the viewport shrinks
  useEffect(() => {
    if (!desktop && canvas) setCanvas(false)
  }, [desktop, canvas])

  function handleLog(personId: string, date: string) {
    setLogTarget({ personId, date })
    if (canvas) setFocusPane({ id: 'log', nonce: Date.now() })
    else setTab('log')
  }
  const handleLogToday = (personId: string) => handleLog(personId, todayISO())

  const logNode = (
    <Log
      key={logTarget ? `${logTarget.personId}-${logTarget.date}` : 'default'}
      defaultPersonId={logTarget?.personId}
      defaultDate={logTarget?.date}
    />
  )

  const tabs: { id: Tab; label: string }[] = [
    { id: 'board', label: '🏆 Board' },
    { id: 'log', label: '✏️ Log' },
    { id: 'feed', label: '📋 Feed' },
    { id: 'charts', label: '📊 Charts' },
    { id: 'movies', label: '🎬 Movies' },
    { id: 'watchlist', label: '🍿 Watchlist' },
  ]

  const canvasPanes: CanvasPane[] = [
    {
      id: 'board',
      title: '🏆 Board',
      node: <Board onLogToday={handleLogToday} onLogDate={handleLog} />,
    },
    { id: 'log', title: '✏️ Log', node: logNode },
    { id: 'feed', title: '📋 Feed', node: <Feed /> },
    { id: 'charts', title: '📊 Charts', node: <Charts onDayClick={handleLog} /> },
    { id: 'movies', title: '🎬 Movies', node: <Movies /> },
    { id: 'watchlist', title: '🍿 Watchlist', node: <Watchlist /> },
  ]

  // Non-member preview: board is visible read-only; no other tabs
  if (!authed) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            The Circuit
          </h2>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            fitness + movies tracker
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
            padding: '0.6rem 0.9rem',
            margin: '0.9rem 0',
            background: 'rgba(124,106,247,0.08)',
            borderRadius: 10,
            border: '1px solid rgba(124,106,247,0.25)',
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>🔒</span>
          <span style={{ flex: 1, fontSize: '0.9rem' }}>
            <strong>Members-only app.</strong>{' '}
            <span className="muted">
              Sign in to log workouts, rate movies, and track progress with the group.
            </span>
          </span>
          <a
            href="#signin"
            className="btn"
            style={{ background: 'var(--accent, #7c6af7)', color: '#fff', fontSize: '0.85rem' }}
          >
            Sign in
          </a>
        </div>
        <Board />
        <Toast />
      </div>
    )
  }

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

      {canvas ? (
        <div style={{ marginTop: '0.9rem' }}>
          <CircuitCanvas
            panes={canvasPanes}
            focusPane={focusPane}
            onExit={() => setCanvas(false)}
          />
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              gap: '0.4rem',
              margin: '0.9rem 0 1.1rem',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
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
            {desktop && (
              <button
                className="btn"
                onClick={() => setCanvas(true)}
                title="Free canvas — drag & resize windows"
                style={{ marginLeft: 'auto' }}
              >
                ⛶ Canvas
              </button>
            )}
          </div>

          {tab === 'board' && <Board onLogToday={handleLogToday} onLogDate={handleLog} />}
          {tab === 'log' && logNode}
          {tab === 'feed' && <Feed />}
          {tab === 'charts' && <Charts onDayClick={handleLog} />}
          {tab === 'movies' && <Movies />}
          {tab === 'watchlist' && <Watchlist />}
        </>
      )}

      <Toast />
    </div>
  )
}
