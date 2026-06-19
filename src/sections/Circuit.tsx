// The Circuit — in-site module shell. Sub-tabs mirror the standalone app.
// Backed by the shared store (localStorage now → Supabase realtime later, no UI change).
import { useEffect, useState } from 'react'
import { connectCircuit } from '../circuit/connect'
import { circuitStore, useCircuitHistory } from '../circuit/store'
import { showToast } from '../circuit/toast'
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
  const { canUndo, canRedo } = useCircuitHistory()

  const doUndo = () => {
    if (!circuitStore.getHistoryState().canUndo) return
    void circuitStore.undo()
    showToast('Undone')
  }
  const doRedo = () => {
    if (!circuitStore.getHistoryState().canRedo) return
    void circuitStore.redo()
    showToast('Redone')
  }

  useEffect(() => {
    void connectCircuit()
  }, [])

  // Undo/redo keyboard shortcuts (skip while typing in a field). Works in the
  // signed-out sandbox too, since edits there are local-only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return
      e.preventDefault()
      if (e.shiftKey) doRedo()
      else doUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          The Circuit
        </h2>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {authed ? 'fitness + movies, synced for you and friends' : 'fitness + movies tracker'}
        </span>
      </div>

      {!authed && <DemoBanner />}

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
              gap: '0.5rem',
              margin: '0.9rem 0 1.1rem',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <span className="cz-tabs">
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
            <span style={{ display: 'inline-flex', gap: '0.4rem', marginLeft: 'auto' }}>
              <button
                className="btn btn-ghost"
                onClick={doUndo}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
              >
                ↶
              </button>
              <button
                className="btn btn-ghost"
                onClick={doRedo}
                disabled={!canRedo}
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
              >
                ↷
              </button>
              {desktop && (
                <button
                  className="btn"
                  onClick={() => setCanvas(true)}
                  title="Free canvas — drag & resize windows"
                >
                  ⛶ Canvas
                </button>
              )}
            </span>
          </div>

          <div className="cz-pane" key={tab}>
            {tab === 'board' && <Board onLogToday={handleLogToday} onLogDate={handleLog} />}
            {tab === 'log' && logNode}
            {tab === 'feed' && <Feed />}
            {tab === 'charts' && <Charts onDayClick={handleLog} />}
            {tab === 'movies' && <Movies />}
            {tab === 'watchlist' && <Watchlist />}
          </div>
        </>
      )}

      <Toast />
    </div>
  )
}

// Shown to signed-out visitors: this is Evan's public demo. They can try every feature;
// edits live only in their browser. Sign in to save and start their own group.
function DemoBanner() {
  const reset = () => {
    try {
      localStorage.removeItem('circuit_state_v1')
    } catch {
      /* ignore */
    }
    window.location.reload()
  }
  return (
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
      <span style={{ fontSize: '1.1rem' }}>👋</span>
      <span style={{ flex: 1, minWidth: 220, fontSize: '0.9rem' }}>
        <strong>You’re exploring Evan’s Circuit.</strong>{' '}
        <span className="muted">
          Try every feature with my real data — anything you change stays in your browser and won’t
          touch mine. Sign in to save your own progress and start a Circuit with your friends.
        </span>
      </span>
      <span style={{ display: 'inline-flex', gap: '0.4rem' }}>
        <button
          className="btn btn-ghost"
          onClick={reset}
          title="Restore the demo to Evan’s data"
          style={{ fontSize: '0.85rem' }}
        >
          Reset demo
        </button>
        <a
          href="#signin"
          className="btn"
          style={{ background: 'var(--accent, #7c6af7)', color: '#fff', fontSize: '0.85rem' }}
        >
          Sign in
        </a>
      </span>
    </div>
  )
}
