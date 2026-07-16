// The Circuit — in-site module shell. Sub-tabs mirror the standalone app.
// Backed by the shared store (localStorage now → Supabase realtime later, no UI change).
import { useEffect, useState } from 'react'
import { connectCircuit } from '../circuit/connect'
import { circuitStore, useCircuit, useCircuitHistory } from '../circuit/store'
import { showToast } from '../circuit/toast'
import { Board } from '../circuit/ui/Board'
import { Log } from '../circuit/ui/Log'
import { Feed } from '../circuit/ui/Feed'
import { Charts } from '../circuit/ui/Charts'
import { Movies } from '../circuit/ui/Movies'
import { Watchlist } from '../circuit/ui/Watchlist'
import { Toast } from '../circuit/ui/Toast'
import { CircuitCanvas, type CanvasPane } from '../circuit/ui/CircuitCanvas'
import { CircuitsPanel } from '../circuit/ui/CircuitsPanel'
import { onLogIntent, requestLog, requestLogToday, takePendingLog } from '../circuit/logIntent'

type Tab = 'board' | 'log' | 'feed' | 'charts' | 'movies' | 'watchlist' | 'circuits'

const isDesktop = () => typeof window !== 'undefined' && window.innerWidth >= 820

// A phone bookmark/shortcut to `#circuit?tab=log` opens straight to logging — the on-the-fly
// convenience friends had with the spreadsheet. Otherwise the Circuit reopens on whatever
// sub-tab you were on last (navigating away unmounts this component, so it's persisted).
const TAB_KEY = 'circuit_tab'
function initialTab(authed: boolean): Tab {
  const valid: Tab[] = [
    'board',
    'log',
    'feed',
    'charts',
    'movies',
    'watchlist',
    ...(authed ? (['circuits'] as Tab[]) : []),
  ]
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const fromLink = q.get('tab') as Tab | null
  if (fromLink && valid.includes(fromLink)) return fromLink
  try {
    const saved = localStorage.getItem(TAB_KEY) as Tab | null
    if (saved && valid.includes(saved)) return saved
  } catch {
    /* ignore */
  }
  return 'board'
}

export function Circuit({
  authed = false,
  canvasMode = false,
  pinnedPanes = [],
  pinnedIds = [],
  onTogglePin,
  onRefreshPinned,
}: {
  authed?: boolean
  // App owns canvas state now (one launcher, persists across tabs); the Circuit reflects it
  canvasMode?: boolean
  // windows pinned on other tabs ride along into this canvas too
  pinnedPanes?: CanvasPane[]
  pinnedIds?: string[]
  onTogglePin?: (pane: CanvasPane) => void
  /** hand App fresh copies of our pinned panes when what they render changes */
  onRefreshPinned?: (panes: CanvasPane[]) => void
} = {}) {
  const [tab, setTabRaw] = useState<Tab>(() => initialTab(authed))
  const setTab = (t: Tab) => {
    setTabRaw(t)
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* ignore */
    }
  }
  const [logTarget, setLogTarget] = useState<{ personId: string; date: string } | null>(null)
  const [focusPane, setFocusPane] = useState<{ id: string; nonce: number } | null>(null)
  const [desktop, setDesktop] = useState(isDesktop())
  const { canUndo, canRedo } = useCircuitHistory()
  const canvas = canvasMode && desktop
  // Which circuit is being viewed — one shared filter for EVERY tab (was Board-only).
  // '' = all circuits you can see. Persisted so it sticks across visits.
  const state = useCircuit()
  const groups = state.groups ?? []
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
  // if the viewed group vanished (left/deleted), fall back to "all"
  useEffect(() => {
    if (viewGroup && groups.length && !groups.some((g) => g.id === viewGroup)) pickGroup('')
  }, [groups, viewGroup])

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

  function handleLog(personId: string, date: string) {
    setLogTarget({ personId, date })
    if (canvas) setFocusPane({ id: 'log', nonce: Date.now() })
    else setTab('log')
  }

  // Panes hand out `requestLog` (a module function) rather than this closure, so a pinned
  // Board floating over another tab still works — its button used to call into an unmounted
  // Circuit and silently do nothing. Here we just answer the requests.
  useEffect(() => {
    return onLogIntent((i) => handleLog(i.personId, i.date))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas])
  // a request raised while we weren't mounted (that's what brought us here)
  useEffect(() => {
    const p = takePendingLog()
    if (p) handleLog(p.personId, p.date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const logNode = (
    <Log
      key={logTarget ? `${logTarget.personId}-${logTarget.date}` : 'default'}
      defaultPersonId={logTarget?.personId}
      defaultDate={logTarget?.date}
      viewGroup={viewGroup}
    />
  )

  const tabs: { id: Tab; label: string }[] = [
    { id: 'board', label: '🏆 Board' },
    { id: 'log', label: '✏️ Log' },
    { id: 'feed', label: '📋 Feed' },
    { id: 'charts', label: '📊 Charts' },
    { id: 'movies', label: '🎬 Movies' },
    { id: 'watchlist', label: '🍿 Watchlist' },
    // circuit management (create/join/invite/claim) is members-only
    ...(authed ? [{ id: 'circuits' as Tab, label: '👥 Circuits' }] : []),
  ]

  const canvasPanes: CanvasPane[] = [
    {
      id: 'board',
      title: '🏆 Board',
      node: <Board onLogToday={requestLogToday} onLogDate={requestLog} viewGroup={viewGroup} />,
    },
    { id: 'log', title: '✏️ Log', node: logNode },
    {
      id: 'feed',
      title: '📋 Feed',
      node: <Feed onOpenLog={requestLog} authed={authed} viewGroup={viewGroup} />,
    },
    {
      id: 'charts',
      title: '📊 Charts',
      node: <Charts onDayClick={requestLog} viewGroup={viewGroup} />,
    },
    { id: 'movies', title: '🎬 Movies', node: <Movies viewGroup={viewGroup} /> },
    { id: 'watchlist', title: '🍿 Watchlist', node: <Watchlist viewGroup={viewGroup} /> },
  ]

  // App pins the pane OBJECTS (it has to — they must outlive this component when you
  // navigate away), which means they freeze whatever they were built with. Change the
  // circuit filter and a pinned Board would still be showing the circuit you pinned it
  // from — the wrong numbers, silently. So re-hand App fresh copies whenever the inputs
  // behind them change. Keyed on those inputs and not on every render, so App's setState
  // can't bounce straight back into another publish.
  useEffect(() => {
    if (!onRefreshPinned || !pinnedIds.length) return
    const mine = canvasPanes.filter((p) => pinnedIds.includes(p.id))
    if (mine.length) onRefreshPinned(mine)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewGroup, authed, logTarget, pinnedIds.join(',')])

  // shared circuit picker — shown in the toolbar and above the canvas when you're in 2+
  const groupPicker = groups.length > 1 && (
    <label
      className="muted"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}
      title="Show just one of your circuits, across every tab"
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
          {groupPicker && <div style={{ marginBottom: '0.6rem' }}>{groupPicker}</div>}
          <CircuitCanvas
            panes={[
              ...canvasPanes,
              ...pinnedPanes.filter((p) => !canvasPanes.some((c) => c.id === p.id)),
            ]}
            focusPane={focusPane}
            pinnedIds={pinnedIds}
            onTogglePin={onTogglePin}
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
            <span
              style={{
                display: 'inline-flex',
                gap: '0.5rem',
                marginLeft: 'auto',
                alignItems: 'center',
              }}
            >
              {groupPicker}
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
              {/* the ⛶ Canvas launcher lives in the top nav now (one launcher for every
                  tab); it toggles this canvas via the yaya:toggle-canvas event above */}
            </span>
          </div>

          <div className="cz-pane" key={tab}>
            {tab === 'board' && (
              <Board onLogToday={requestLogToday} onLogDate={requestLog} viewGroup={viewGroup} />
            )}
            {tab === 'log' && logNode}
            {tab === 'feed' && (
              <Feed onOpenLog={requestLog} authed={authed} viewGroup={viewGroup} />
            )}
            {tab === 'charts' && <Charts onDayClick={requestLog} viewGroup={viewGroup} />}
            {tab === 'movies' && <Movies viewGroup={viewGroup} />}
            {tab === 'watchlist' && <Watchlist viewGroup={viewGroup} />}
            {tab === 'circuits' && <CircuitsPanel />}
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
