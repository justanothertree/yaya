import { useEffect, useRef, useState } from 'react'
import './game.css'
import { GameEngine } from './engine'
import { GameRenderer } from './renderer'
import { NetClient } from './net'
import {
  fetchLeaderboard,
  submitScore,
  fetchRankForScore,
  subscribeToLeaderboard,
  type LeaderboardPeriod,
} from './leaderboard'
import type { LeaderboardEntry, Mode, Settings } from './types'

const GRID = 30
const BASE_SPEED = 110
const MIN_SPEED = 50
const SPEED_STEP = 4

const DEFAULT_SETTINGS: Settings = {
  grid: GRID,
  apples: 2,
  passThroughEdges: true,
  canvasSize: 'medium',
}

function speedFor(score: number) {
  const target = BASE_SPEED - SPEED_STEP * score
  return Math.max(MIN_SPEED, target)
}

function scoreFormula(apples: number, _ms: number, settings: Settings) {
  // Prevent AFK scoring: score only from apples eaten (with slight modifiers)
  const base = apples * 10
  const applesBonus = settings.apples >= 3 ? 1.2 : 1
  const edgePenalty = settings.passThroughEdges ? 0.9 : 1
  return Math.round(base * applesBonus * edgePenalty)
}

const LS_SETTINGS_KEY = 'snake.settings.v1'
const LS_PERSIST_KEY = 'snake.persist.v1'

export function GameManager({
  autoFocus,
  onControlChange,
}: {
  autoFocus?: boolean
  onControlChange?: (v: boolean) => void
}) {
  const [mode, setMode] = useState<Mode>('solo')
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem(LS_SETTINGS_KEY)
      if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS
  })
  const [engineSeed, setEngineSeed] = useState<number>(() => Math.floor(Math.random() * 1e9))
  const [alive, setAlive] = useState(true)
  const [paused, setPaused] = useState(true)
  const [score, setScore] = useState(0)
  const [applesEaten, setApplesEaten] = useState(0)
  const startRef = useRef<number | null>(null)
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([])
  const [myRank, setMyRank] = useState<number | null>(null)
  const [period, setPeriod] = useState<LeaderboardPeriod>('all')
  const [askNameOpen, setAskNameOpen] = useState(false)
  const [playerName, setPlayerName] = useState('Player')
  const [room, setRoom] = useState('room-1')
  const [opponentScore, setOpponentScore] = useState(0)
  const wsUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WS_URL
  const capturedRef = useRef(false)
  const [captured, setCaptured] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const hintTimerRef = useRef<number | null>(null)
  const userInitiatedFocusRef = useRef(false)
  const isCoarseRef = useRef(false)
  // immersive/fullscreen disabled for now
  const restoredRef = useRef(false)

  // Canvas refs and renderers
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const oppCanvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<GameRenderer | null>(null)
  const lastWrapSizeRef = useRef<{ w: number; h: number } | null>(null)
  // Opponent renderer can be wired later when server mirrors full state

  // Engine
  const engineRef = useRef<GameEngine | null>(null)
  const acceptedTurnRef = useRef(false)

  // Net client (only used in versus)
  const netRef = useRef<NetClient | null>(null)

  // Initialize engine and renderer on mount or when settings/seed changes
  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const engine = new GameEngine(settings, engineSeed)
    engineRef.current = engine
    const renderer = new GameRenderer(canvas, settings.grid)
    rendererRef.current = renderer
    renderer.resize(wrap, settings.canvasSize)
    renderer.draw(engine.snapshot())
    // Attempt to restore a persisted paused state
    let restoredOk = false
    if (!restoredRef.current) {
      try {
        const raw = localStorage.getItem(LS_PERSIST_KEY)
        if (raw) {
          const saved = JSON.parse(raw) as {
            settings: Settings
            snapshot: ReturnType<GameEngine['snapshot']>
            applesEaten: number
            score: number
          }
          // Only restore if grid matches current settings and snapshot is alive
          if (saved.settings?.grid === settings.grid && saved.snapshot?.alive) {
            engineRef.current.loadSnapshot(saved.snapshot)
            const snap = engineRef.current.snapshot()
            rendererRef.current.draw(snap)
            setAlive(snap.alive)
            setApplesEaten(Math.max(0, saved.applesEaten || 0))
            setScore(Math.max(0, saved.score || 0))
            setPaused(true)
            restoredOk = true
          }
        }
      } catch {
        /* ignore */
      } finally {
        restoredRef.current = true
        try {
          localStorage.removeItem(LS_PERSIST_KEY)
        } catch {
          /* ignore */
        }
      }
    }
    const rect = wrap.getBoundingClientRect()
    lastWrapSizeRef.current = { w: Math.round(rect.width), h: Math.round(rect.height) }
    startRef.current = null
    if (!restoredOk) {
      setAlive(true)
      setScore(0)
      setApplesEaten(0)
    }

    const onResize = () => {
      // Avoid tiny mobile UI chrome show/hide jitter causing canvas resize
      const r = wrap.getBoundingClientRect()
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      const last = lastWrapSizeRef.current
      if (!last || Math.abs(w - last.w) > 12 || Math.abs(h - last.h) > 12) {
        renderer.resize(wrap, settings.canvasSize)
        lastWrapSizeRef.current = { w, h }
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.grid, settings.apples, settings.passThroughEdges, settings.canvasSize, engineSeed])
  // Persist paused state when navigating away or unmounting
  useEffect(() => {
    const saveState = () => {
      const snap = engineRef.current?.snapshot()
      if (!snap || !snap.alive) return
      try {
        localStorage.setItem(
          LS_PERSIST_KEY,
          JSON.stringify({ settings, snapshot: snap, applesEaten, score }),
        )
      } catch {
        /* ignore */
      }
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') saveState()
    }
    window.addEventListener('pagehide', saveState)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      saveState()
      window.removeEventListener('pagehide', saveState)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [settings, applesEaten, score])

  // Fullscreen controls removed for now per feedback

  // Focus canvas on mount when requested; inform parent that controls are captured
  useEffect(() => {
    if (autoFocus) {
      canvasRef.current?.focus?.()
      capturedRef.current = true
      onControlChange?.(true)
      return () => {
        capturedRef.current = false
        onControlChange?.(false)
      }
    }
    return
  }, [autoFocus, onControlChange])

  // Detect coarse pointer (mobile/tablet); no joystick overlay
  useEffect(() => {
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        isCoarseRef.current = true
      }
    } catch {
      /* noop */
    }
  }, [])

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // ignore
    }
  }, [settings])

  // Game loop
  useEffect(() => {
    let timer: number | null = null
    const loop = () => {
      acceptedTurnRef.current = false
      const engine = engineRef.current!
      const { state, events } = engine.tick()
      rendererRef.current!.draw(state)
      for (const ev of events) {
        if (ev.type === 'eat') setApplesEaten((n) => n + 1)
        else if (ev.type === 'die') setAlive(false)
      }
      if (state.alive) {
        if (startRef.current == null) startRef.current = performance.now()
        const since = performance.now() - startRef.current
        setScore(
          scoreFormula(
            applesEaten + (events.some((e) => e.type === 'eat') ? 1 : 0),
            since,
            settings,
          ),
        )
        const sp = speedFor(applesEaten)
        timer = window.setTimeout(loop, sp)
      } else {
        rendererRef.current!.animateDeath(state).then(() => setAskNameOpen(true))
      }
    }
    // kick off
    if (!paused) timer = window.setTimeout(loop, 0)
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [settings, applesEaten, paused])

  // Redraw when theme attributes change (so paused frames still update colors)
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => {
      const snap = engineRef.current?.snapshot()
      if (snap) rendererRef.current?.draw(snap)
    })
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => obs.disconnect()
  }, [])

  // Controls
  useEffect(() => {
    // Basic swipe: track pointer movement on the focused canvas and choose cardinal based on angle
    const canvas = canvasRef.current
    if (!canvas) return
    let tracking = false
    let ox = 0
    let oy = 0
    const onDown = (e: PointerEvent) => {
      // prevent site-level swipe/scroll gestures while interacting with the game
      e.preventDefault()
      tracking = true
      ox = e.clientX
      oy = e.clientY
      userInitiatedFocusRef.current = true
      try {
        ;(e.target as Element).setPointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
    }
    const onMove = (e: PointerEvent) => {
      // prevent site-level swipe/scroll gestures while interacting with the game
      e.preventDefault()
      if (!tracking || paused || acceptedTurnRef.current) return
      const dx = e.clientX - ox
      const dy = e.clientY - oy
      const dead = 16
      if (Math.hypot(dx, dy) < dead) return
      const angle = Math.atan2(dy, dx)
      const pi = Math.PI
      const eng = engineRef.current!
      if (angle > -pi * 0.25 && angle <= pi * 0.25) eng.setDirection({ x: 1, y: 0 })
      else if (angle > pi * 0.25 && angle <= pi * 0.75) eng.setDirection({ x: 0, y: 1 })
      else if (angle > -pi * 0.75 && angle <= -pi * 0.25) eng.setDirection({ x: 0, y: -1 })
      else eng.setDirection({ x: -1, y: 0 })
      acceptedTurnRef.current = true
      tracking = false
    }
    const onUp = (e: PointerEvent) => {
      tracking = false
      try {
        ;(e.target as Element).releasePointerCapture(e.pointerId)
      } catch {
        /* noop */
      }
    }
    const onKey = (e: KeyboardEvent) => {
      const key = e.key
      // Esc releases capture (blur canvas) so site navigation keys work again
      if (key === 'Escape') {
        if (capturedRef.current) {
          e.preventDefault()
          canvasRef.current?.blur()
          capturedRef.current = false
          onControlChange?.(false)
        }
        return
      }
      const isArrow =
        key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight'
      const isWASD =
        key === 'w' ||
        key === 'W' ||
        key === 'a' ||
        key === 'A' ||
        key === 's' ||
        key === 'S' ||
        key === 'd' ||
        key === 'D'
      const isSpace = key === ' '
      if (!(isArrow || isWASD || isSpace)) return
      // Only handle keys when game has focus/captured
      if (!capturedRef.current) return
      e.preventDefault()
      const eng = engineRef.current!
      if (isSpace) {
        if (!alive) doRestart()
        else setPaused((p) => !p)
        return
      }
      if (paused) return
      if (acceptedTurnRef.current) return
      if (key === 'ArrowUp' || key === 'w' || key === 'W') eng.setDirection({ x: 0, y: -1 })
      if (key === 'ArrowDown' || key === 's' || key === 'S') eng.setDirection({ x: 0, y: 1 })
      if (key === 'ArrowLeft' || key === 'a' || key === 'A') eng.setDirection({ x: -1, y: 0 })
      if (key === 'ArrowRight' || key === 'd' || key === 'D') eng.setDirection({ x: 1, y: 0 })
      acceptedTurnRef.current = true
      if (mode === 'versus' && netRef.current) {
        const k = key
        const norm: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' =
          k === 'ArrowUp' || k === 'w' || k === 'W'
            ? 'ArrowUp'
            : k === 'ArrowDown' || k === 's' || k === 'S'
              ? 'ArrowDown'
              : k === 'ArrowLeft' || k === 'a' || k === 'A'
                ? 'ArrowLeft'
                : 'ArrowRight'
        netRef.current.send({ type: 'input', key: norm })
      }
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [alive, mode, paused, onControlChange])

  // Leaderboard: fetch on period change and subscribe to realtime updates
  useEffect(() => {
    let disposed = false
    const refresh = () =>
      fetchLeaderboard(period, 15)
        .then((d) => {
          if (!disposed) setLeaders(d)
        })
        .catch(() => {
          if (!disposed) setLeaders([])
        })
    refresh()
    const unsub = subscribeToLeaderboard(refresh)
    let poll: number | null = null
    if (!unsub) poll = window.setInterval(refresh, 15000)
    return () => {
      disposed = true
      if (unsub) unsub()
      if (poll) window.clearInterval(poll)
    }
  }, [period])

  // Versus wiring
  const connectVs = () => {
    if (!wsUrl) return
    const net = new NetClient(wsUrl, {
      onMessage: (msg) => {
        if (msg.type === 'seed') {
          setEngineSeed(msg.seed)
          setSettings(msg.settings)
        } else if (msg.type === 'tick') {
          setOpponentScore(msg.score)
        }
      },
    })
    netRef.current = net
    net.connect(room)
  }

  const doRestart = () => {
    setEngineSeed(Math.floor(Math.random() * 1e9))
    setPaused(true)
    try {
      localStorage.removeItem(LS_PERSIST_KEY)
    } catch {
      /* ignore */
    }
  }

  const onSaveScore = async () => {
    const entry: LeaderboardEntry = {
      username: playerName.trim() || 'Player',
      score,
      date: new Date().toISOString(),
    }
    try {
      await submitScore(entry)
      // refresh from server (or fallback) and compute rank
      const [top, rank] = await Promise.all([
        fetchLeaderboard(period, 15),
        fetchRankForScore(entry.score, period),
      ])
      setLeaders(top)
      setMyRank(rank)
    } finally {
      setAskNameOpen(false)
    }
  }

  return (
    <div>
      {/* Settings & Mode */}
      <div className="snake-toolbar">
        <div className="muted">Mode:</div>
        {(['solo', 'versus'] as Mode[]).map((m) => (
          <button
            key={m}
            className="btn"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            data-active={mode === m || undefined}
          >
            {m}
          </button>
        ))}

        {/* Canvas size fixed to medium for now */}

        <div className="muted group-label">Apples</div>
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            className="btn"
            aria-pressed={settings.apples === n}
            onClick={() => setSettings({ ...settings, apples: n })}
            data-active={settings.apples === n || undefined}
          >
            {n}
          </button>
        ))}

        <div className="muted group-label">Edges</div>
        {['wrap', 'walls'].map((lab) => (
          <button
            key={lab}
            className="btn"
            aria-pressed={(settings.passThroughEdges ? 'wrap' : 'walls') === lab}
            onClick={() => setSettings({ ...settings, passThroughEdges: lab === 'wrap' })}
            data-active={(settings.passThroughEdges ? 'wrap' : 'walls') === lab || undefined}
          >
            {lab}
          </button>
        ))}

        <button
          className="btn btn--stable"
          onClick={() => {
            if (!alive) {
              doRestart()
              setPaused(false)
              // capture focus on play
              canvasRef.current?.focus()
              capturedRef.current = true
              setCaptured(true)
              onControlChange?.(true)
              return
            }
            setPaused((p) => {
              const next = !p
              if (next) {
                canvasRef.current?.focus()
                capturedRef.current = true
                setCaptured(true)
                onControlChange?.(true)
              }
              return next
            })
          }}
          aria-pressed={!paused}
          title={paused ? 'Play' : 'Pause'}
        >
          {paused ? 'Play' : 'Pause'}
        </button>

        <button className="btn" onClick={doRestart}>
          Restart
        </button>

        {/* Joystick removed */}

        {mode === 'versus' && wsUrl && (
          <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              style={{
                padding: '0.5rem',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text)',
              }}
            />
            <button className="btn" onClick={connectVs}>
              Connect
            </button>
            <div className="muted">Opponent score: {opponentScore}</div>
          </div>
        )}
      </div>

      {/* Canvases */}
      <div ref={wrapRef} className="snake-grid" data-versus={mode === 'versus' || undefined}>
        <div className="snake-canvas-wrap" data-captured={captured || undefined}>
          <button
            className="btn snake-fab"
            onClick={() => {
              if (!alive) {
                doRestart()
                setPaused(false)
                canvasRef.current?.focus()
                capturedRef.current = true
                setCaptured(true)
                onControlChange?.(true)
                return
              }
              setPaused((p) => {
                const next = !p
                if (next) {
                  canvasRef.current?.focus()
                  capturedRef.current = true
                  setCaptured(true)
                  onControlChange?.(true)
                }
                return next
              })
            }}
            aria-pressed={!paused}
            title={paused ? 'Play' : 'Pause'}
          >
            {paused ? 'Play' : 'Pause'}
          </button>
          {/* Fullscreen buttons temporarily removed */}
          <canvas
            ref={canvasRef}
            tabIndex={0}
            className="snake-canvas"
            onFocus={() => {
              capturedRef.current = true
              setCaptured(true)
              onControlChange?.(true)
              // show hint chip briefly only for fine pointers and only on user-initiated focus
              if (!isCoarseRef.current && userInitiatedFocusRef.current) {
                if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current)
                setHintVisible(true)
                hintTimerRef.current = window.setTimeout(() => setHintVisible(false), 2000)
              }
              userInitiatedFocusRef.current = false
            }}
            onBlur={() => {
              capturedRef.current = false
              setCaptured(false)
              onControlChange?.(false)
              // auto-pause when leaving the game
              setPaused(true)
            }}
            onPointerDown={() => {
              // focus on first interaction, capture controls
              userInitiatedFocusRef.current = true
              canvasRef.current?.focus()
            }}
          />
          {!isCoarseRef.current && (
            <div className="snake-hint" aria-live="polite" data-show={hintVisible || undefined}>
              Game controls active — Esc to release
            </div>
          )}
          {/* Joystick removed; swipe and keys remain */}
        </div>
        {mode === 'versus' && (
          <canvas ref={oppCanvasRef} className="snake-canvas snake-canvas--opp" />
        )}
      </div>

      <div className="snake-hud">
        <div className="muted">Score: {score}</div>
        <div className="muted hud-paused" aria-live="polite">
          {paused ? 'Paused' : ''}
        </div>
        {!alive && (
          <div className="muted" aria-live="polite">
            Press Space to restart
          </div>
        )}
      </div>

      {/* Leaderboard */}
      {leaders.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 className="section-title" style={{ marginTop: 0, marginBottom: 0 }}>
              Top 15 —
            </h3>
            {(
              [
                { k: 'all', label: 'All time' },
                { k: 'month', label: 'This month' },
                { k: 'today', label: 'Today' },
              ] as Array<{ k: LeaderboardPeriod; label: string }>
            ).map((p) => (
              <button
                key={p.k}
                className="btn"
                aria-pressed={period === p.k}
                data-active={period === p.k || undefined}
                onClick={() => setPeriod(p.k)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {myRank != null && (
            <div className="muted" style={{ marginBottom: 6 }}>
              Your rank: <strong style={{ color: 'var(--text)' }}>{myRank}</strong>
            </div>
          )}
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {leaders.map((l, i) => (
              <li key={i} className="muted">
                <strong style={{ color: 'var(--text)' }}>{l.username}</strong> — {l.score}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Save score modal */}
      {askNameOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Save your score"
          onClick={() => setAskNameOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 300,
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 420,
              width: '90%',
              cursor: 'auto',
              background: 'var(--bg)',
              borderColor: 'var(--border-strong)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="section-title" style={{ marginTop: 0 }}>
              Save your score
            </h2>
            <div className="muted" style={{ marginBottom: 6 }}>
              Your score: {score}
            </div>
            <label className="muted" htmlFor="player-name">
              Name
            </label>
            <input
              id="player-name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text)',
              }}
            />
            <div
              style={{ marginTop: '0.75rem', display: 'flex', gap: 8, justifyContent: 'flex-end' }}
            >
              <button className="btn" onClick={() => setAskNameOpen(false)}>
                Cancel
              </button>
              <button className="btn" onClick={onSaveScore}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
