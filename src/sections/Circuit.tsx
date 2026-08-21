// The Circuit — in-site module shell. Sub-tabs mirror the standalone app.
// Backed by the shared store (localStorage now → Supabase realtime later, no UI change).
import { useEffect, useState, useMemo } from 'react'
import type { ReactNode } from 'react'
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
import type { CanvasPane } from '../circuit/ui/CircuitCanvas'
import { CircuitsPanel } from '../circuit/ui/CircuitsPanel'
import { Chat } from '../circuit/ui/Chat'
import { onLogIntent, requestLog, requestLogToday, takePendingLog } from '../circuit/logIntent'
import { useScrollFade } from '../hooks/useScrollFade'
import { previewMember, PREVIEW_GROUPS } from '../dev/previewMember'
import { hasJoinCodeInUrl, parkJoinCode } from '../circuit/inviteLink'

type Tab = 'board' | 'log' | 'feed' | 'charts' | 'movies' | 'watchlist' | 'chat' | 'circuits'

const isDesktop = () => typeof window !== 'undefined' && window.innerWidth >= 820

// A phone bookmark/shortcut to `#circuit?tab=log` opens straight to logging — the on-the-fly
// convenience friends had with the spreadsheet. Otherwise the Circuit reopens on whatever
// sub-tab you were on last (navigating away unmounts this component, so it's persisted).
const TAB_KEY = 'circuit_tab'
function initialTab(authed: boolean): Tab {
  // Members get the fitness-only Circuit — Reviews/Watchlist moved to the Ratings
  // destination. The signed-out demo keeps them so a visitor can try everything in one place.
  const valid: Tab[] = [
    'board',
    'log',
    'feed',
    'charts',
    ...(authed ? (['circuits'] as Tab[]) : (['movies', 'watchlist'] as Tab[])),
  ]
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const fromLink = q.get('tab') as Tab | null
  if (fromLink && valid.includes(fromLink)) return fromLink
  // Followed a circuit invite from a DM: open where the join actually happens and is reported,
  // rather than dropping them on the Log with a circuit they can't tell they joined.
  if (authed && hasJoinCodeInUrl()) return 'circuits'
  // Members land on the Log: logging is the daily reason to open the Circuit, and now that
  // the bottom bar carries Ratings instead of a Log shortcut, this IS the quick-log path.
  // (The signed-out demo still opens on the Board — a visitor wants the story, not a form.)
  if (authed) return 'log'
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
  isActiveTab = true,
  focusPing = 0,
  voiceIn,
  onCanvasPanesChange,
  onOpenCanvasPane,
}: {
  authed?: boolean
  // App owns canvas state now (one shared canvas, persists across every page); Circuit reflects
  // it and, when it's on, reports its own sub-tab windows up rather than rendering a canvas of
  // its own.
  canvasMode?: boolean
  /** whether Circuit is the page nav/the URL is actually pointing at right now, as opposed to
   * just staying mounted in the background (see App.tsx's render condition) so its windows
   * keep reporting into the shared canvas's catalog while you're elsewhere */
  isActiveTab?: boolean
  /** bumped on every nav click, including one on the tab you're already on — see App's navPing.
   *  Without it, clicking Circuit while already on Circuit couldn't pan the camera back. */
  focusPing?: number
  /** who is in each room's call — subscribed once in App, see useVoicePresence */
  voiceIn?: Record<string, string[]>
  /** hand the shared canvas fresh copies of every sub-tab pane, and the circuit-filter picker
   * to show in its toolbar, whenever what they'd render changes */
  onCanvasPanesChange?: (panes: CanvasPane[], toolbar: ReactNode | null) => void
  /** ensure a specific pane (Board, on becoming the active tab; Log, on "Log today") is open on
   * the shared canvas and bring it to front */
  onOpenCanvasPane?: (pane: CanvasPane) => void
} = {}) {
  const [tab, setTabRaw] = useState<Tab>(() => initialTab(authed))
  const setTab = (t: Tab) => {
    setTabRaw(t)
    // Switching sub-tabs is a page-level change, but it doesn't change the section, so
    // App's scroll-to-top never covered it — you'd land on a new tab still scrolled part
    // way down the previous one. Done here rather than in an effect on `tab` so it fires
    // on the actual navigation, including hash-driven ones (which route through here too).
    if (t !== tab) window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    try {
      localStorage.setItem(TAB_KEY, t)
    } catch {
      /* ignore */
    }
  }
  /**
   * A circuit invite tapped while signed out.
   *
   * The invite arrives by DM, but the device it gets opened on may not have a session. Parking
   * the code now — out of the URL, into the session — means signing in and coming back still
   * joins, instead of the invite quietly expiring on the sign-in screen. When they ARE signed
   * in, CircuitsPanel spends it instead; this branch deliberately does nothing then.
   */
  useEffect(() => {
    if (authed || !hasJoinCodeInUrl()) return
    parkJoinCode()
    showToast('Sign in and you’ll join that circuit.')
  }, [authed])

  // A #circuit?tab=… deep link (the mobile quick-action buttons) can arrive while the
  // Circuit is already mounted — switch the sub-tab live instead of only reading on mount.
  useEffect(() => {
    const onHash = () => {
      const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
      const t = q.get('tab') as Tab | null
      const valid: Tab[] = [
        'board',
        'log',
        'feed',
        'charts',
        ...(authed ? (['circuits'] as Tab[]) : (['movies', 'watchlist'] as Tab[])),
      ]
      if (t && valid.includes(t)) setTab(t)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [authed])
  const tabsRef = useScrollFade<HTMLSpanElement>()

  const [logTarget, setLogTarget] = useState<{ personId: string; date: string } | null>(null)
  const [desktop, setDesktop] = useState(isDesktop())
  const { canUndo, canRedo } = useCircuitHistory()
  const canvas = canvasMode && desktop
  // Which circuit is being viewed — one shared filter for EVERY tab (was Board-only).
  // '' = all circuits you can see. Persisted so it sticks across visits.
  const state = useCircuit()
  // the DEV harness supplies stand-in circuits so the filter can be exercised
  /**
   * Memoised so the fallback isn't a fresh [] on every render.
   *
   * The effect below depends on `groups`, and an array literal is a new reference each time —
   * so for anyone without circuits (every signed-out visitor, and members until their groups
   * load) that effect re-ran on EVERY render. Harmless in what it does, needless in how often
   * it did it.
   */
  const groups = useMemo(
    () => (state.groups?.length ? state.groups : previewMember ? PREVIEW_GROUPS : []),
    [state.groups],
  )
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
  /**
   * ⚠️ Apply the saved filter only when it names a circuit we can actually see.
   *
   * A filter saved while signed in used to keep applying after signing out, where there
   * are no circuits at all: it matched nobody, so the demo board rendered "No one's in
   * this circuit yet" with no picker on screen to undo it — and a hard refresh doesn't
   * clear localStorage, so it stayed broken. That's why the demo looked fine in one
   * browser and empty in another.
   *
   * Resolving it per-render rather than clearing the stored value avoids a race: `groups`
   * is briefly empty while signed in before the adapter loads, and `authed` can be false
   * for a beat during boot, so *erasing* on either signal throws away a real choice.
   * This way the member's pick survives a signed-out visit and simply doesn't apply
   * while it can't be honoured.
   */
  const activeGroup = viewGroup && groups.some((g) => g.id === viewGroup) ? viewGroup : ''

  // Tidy storage only in the unambiguous case: signed in, groups loaded, group gone for good.
  useEffect(() => {
    if (viewGroup && authed && groups.length && !groups.some((g) => g.id === viewGroup)) {
      pickGroup('')
    }
  }, [groups, viewGroup, authed])

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
    if (canvas) {
      // `canvasPanes` is declared further down in this same function body -- fine, since
      // handleLog is only ever CALLED later (from the intent listener below), by which point
      // this render's canvasPanes has already been assigned.
      const log = canvasPanes.find((p) => p.id === 'log')
      if (log) onOpenCanvasPane?.(log)
    } else setTab('log')
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
      viewGroup={activeGroup}
    />
  )

  const allTabs: { id: Tab; label: string }[] = [
    { id: 'board', label: '🏆 Board' },
    { id: 'log', label: '✏️ Log' },
    { id: 'feed', label: '📋 Feed' },
    { id: 'charts', label: '📊 Charts' },
    // Reviews/Watchlist live under Ratings for members; the demo keeps them here.
    // Chat + circuit management are members-only.
    ...(authed
      ? [{ id: 'circuits' as Tab, label: '👥 Circuits' }]
      : [
          { id: 'movies' as Tab, label: '📝 Reviews' },
          { id: 'watchlist' as Tab, label: '🎲 Pool' },
        ]),
  ]
  // On a phone six chips can't fit, and two of them don't belong in a daily strip anyway:
  // Chat is a bottom-bar destination and Circuits is management (it lives in the ☰ launcher).
  // Dropping them leaves four that nearly fit, so the strip reads as a row rather than a
  // squeezed scroller. Both stay routable — only their chips are hidden — and whichever tab
  // is open always keeps a chip so the active state is never orphaned.
  const dailyTabs: Tab[] = ['board', 'log', 'feed', 'charts']
  // Once you've opened a non-daily tab (Circuits, from the launcher), its chip STAYS for the
  // rest of the visit. Showing it only while active meant it vanished the moment you tapped
  // another tab, stranding you with no way back except the launcher.
  const [visitedExtra, setVisitedExtra] = useState<Tab[]>([])
  useEffect(() => {
    if (!dailyTabs.includes(tab)) setVisitedExtra((v) => (v.includes(tab) ? v : [...v, tab]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])
  const tabs =
    desktop || !authed
      ? allTabs
      : allTabs.filter(
          (t) => dailyTabs.includes(t.id) || t.id === tab || visitedExtra.includes(t.id),
        )

  const canvasPanes: CanvasPane[] = [
    {
      id: 'board',
      title: '🏆 Board',
      node: <Board onLogToday={requestLogToday} onLogDate={requestLog} viewGroup={activeGroup} />,
    },
    { id: 'log', title: '✏️ Log', node: logNode },
    {
      id: 'feed',
      title: '📋 Feed',
      node: <Feed onOpenLog={requestLog} authed={authed} viewGroup={activeGroup} />,
    },
    {
      id: 'charts',
      title: '📊 Charts',
      node: <Charts onDayClick={requestLog} viewGroup={activeGroup} />,
    },
    ...(authed
      ? [{ id: 'chat', title: '💬 Chat', node: <Chat authed voiceIn={voiceIn} /> }]
      : [
          {
            id: 'movies',
            title: '📝 Reviews',
            node: <Movies viewGroup={activeGroup} groups={groups} />,
          },
          {
            id: 'watchlist',
            title: '🎲 Pool',
            node: <Watchlist viewGroup={activeGroup} groups={groups} />,
          },
        ]),
  ]

  // shared circuit picker — shown in the toolbar and above the canvas when you're in 2+
  const groupPicker = groups.length > 1 && (
    <label
      className="muted"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem' }}
      title="Show just one of your circuits, across every tab"
    >
      👥
      <select
        value={activeGroup}
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

  /**
   * Hand the shared canvas fresh copies of every sub-tab pane, and the toolbar to show
   * alongside them, whenever what they'd render changes.
   *
   * This is the ONE thing that makes these windows exist for the shared canvas at all now --
   * there's no separate "registered windows" store any more (that used to be a second,
   * parallel way of tracking "does this window exist" alongside pinning; folding it into the
   * same reporting channel App already used for refreshing pinned panes removed the second
   * system rather than keeping both in sync). App decides what to actually DO with the full
   * list (refresh whichever are already open, offer the rest in the Windows menu) -- this
   * effect's only job is keeping App's copy current.
   *
   * Runs whenever what the panes would render changes, same inputs the old refresh-only
   * version used -- not on every render, so App's setState here can't bounce into another
   * publish.
   */
  useEffect(() => {
    onCanvasPanesChange?.(canvasPanes, groupPicker || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup, authed, logTarget])

  // Becoming the active tab while the shared canvas is on is Circuit's version of nav's
  // open-or-focus effect in App.tsx -- App can't do this one itself, because it needs Circuit's
  // OWN pane data, which isn't there yet on the very first frame Circuit mounts.
  useEffect(() => {
    if (!canvas || !isActiveTab) return
    const board = canvasPanes.find((p) => p.id === 'board')
    if (board) onOpenCanvasPane?.(board)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, isActiveTab, focusPing])

  // The shared canvas itself is owned and rendered by App now — Circuit doesn't render one of
  // its own any more. While `canvas` is on, Circuit renders NOTHING visible at all (not even
  // this section wrapper): its whole job at that point is staying mounted so the effects above
  // keep reporting fresh panes, not showing anything itself. `<Toast/>` is the one exception,
  // kept outside this condition since a toast (e.g. "Logged") can fire from a Board window
  // that's open while you're looking at a completely different page.
  return (
    <>
      {!canvas && (
        <section id="circuit" className="card reveal" data-tab={tab}>
          {/* ⚠️ the sub-tab above goes on a data attribute, NOT into className. React rewrites
              the whole class attribute whenever the className string changes, which silently
              wiped the `reveal-in` added by useReveal — so every tab click faded this section
              to opacity 0 and left it there. */}
          <div
            className="cz-head"
            style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}
          >
            <h2 className="section-title" style={{ margin: 0 }}>
              The Circuit
            </h2>
            <span className="muted cz-subtitle" style={{ fontSize: '0.85rem' }}>
              {authed ? 'fitness + movies, synced for you and friends' : 'fitness + movies tracker'}
            </span>
            {/* the circuit filter rides up here on the title line rather than taking a row of
                its own below the tabs — and because it lives in the header it now shows on
                every tab, including the Log, instead of appearing and vanishing */}
            {groupPicker && (
              <span className="cz-head-filter" style={{ marginLeft: 'auto' }}>
                {groupPicker}
              </span>
            )}
          </div>

          {!authed && <DemoBanner />}

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
            <span
              style={{
                display: 'inline-flex',
                gap: '0.5rem',
                marginLeft: 'auto',
                alignItems: 'center',
              }}
            >
              {/* the circuit filter moved up to the header line (see cz-head above) */}
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
              <Board onLogToday={requestLogToday} onLogDate={requestLog} viewGroup={activeGroup} />
            )}
            {tab === 'log' && logNode}
            {tab === 'feed' && (
              <Feed onOpenLog={requestLog} authed={authed} viewGroup={activeGroup} />
            )}
            {tab === 'charts' && <Charts onDayClick={requestLog} viewGroup={activeGroup} />}
            {tab === 'chat' && <Chat authed={authed} voiceIn={voiceIn} />}
            {tab === 'movies' && <Movies viewGroup={activeGroup} groups={groups} />}
            {tab === 'watchlist' && <Watchlist viewGroup={activeGroup} groups={groups} />}
            {tab === 'circuits' && <CircuitsPanel />}
          </div>
        </section>
      )}

      <Toast />
    </>
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
          style={{
            background: 'var(--accent, #7c6af7)',
            color: 'var(--btn-text)',
            fontSize: '0.85rem',
          }}
        >
          Sign in
        </a>
      </span>
    </div>
  )
}
