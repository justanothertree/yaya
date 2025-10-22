import { useEffect, useRef, useState } from 'react'
import './game.css'
import { GameEngine } from './engine'
import { GameRenderer } from './renderer'
import { NetClient } from './net'
import { fetchLeaderboard, submitScore } from './leaderboard'
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

function scoreFormula(apples: number, ms: number, settings: Settings) {
  const base = apples * 10 + Math.floor(ms / 1000) // +1 / sec
  const applesBonus = settings.apples >= 3 ? 1.2 : 1
  const edgePenalty = settings.passThroughEdges ? 0.9 : 1
  return Math.round(base * applesBonus * edgePenalty)
}

const LS_SETTINGS_KEY = 'snake.settings.v1'

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
  const [paused, setPaused] = useState(false)
  const [score, setScore] = useState(0)
  const [applesEaten, setApplesEaten] = useState(0)
  const startRef = useRef<number | null>(null)
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([])
  const [askNameOpen, setAskNameOpen] = useState(false)
  const [playerName, setPlayerName] = useState('Player')
  const [room, setRoom] = useState('room-1')
  const [opponentScore, setOpponentScore] = useState(0)
  const wsUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WS_URL
  const [showTouch, setShowTouch] = useState(false)

  // Canvas refs and renderers
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const oppCanvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<GameRenderer | null>(null)
  // Opponent renderer can be wired later when server mirrors full state

  // Engine
  const engineRef = useRef<GameEngine | null>(null)

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
    startRef.current = performance.now()
    setAlive(true)
    setScore(0)
    setApplesEaten(0)

    const onResize = () => renderer.resize(wrap, settings.canvasSize)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.grid, settings.apples, settings.passThroughEdges, settings.canvasSize, engineSeed])

  // Focus canvas on mount when requested; inform parent that controls are captured
  useEffect(() => {
    if (autoFocus) {
      canvasRef.current?.focus?.()
      onControlChange?.(true)
      return () => onControlChange?.(false)
    }
    return
  }, [autoFocus, onControlChange])

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
      const engine = engineRef.current!
      const { state, events } = engine.tick()
      rendererRef.current!.draw(state)
      for (const ev of events) {
        if (ev.type === 'eat') {
          setApplesEaten((n) => n + 1)
        } else if (ev.type === 'die') {
          setAlive(false)
        }
      }
      if (state.alive && !paused) {
        const since = startRef.current ? performance.now() - startRef.current : 0
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
        // death anim
        rendererRef.current!.animateDeath(state).then(() => {
          setAskNameOpen(true)
        })
      }
    }
    // kick off
    if (!paused) timer = window.setTimeout(loop, 0)
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [settings, applesEaten, paused])

  // Controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) return
      e.preventDefault()
      const eng = engineRef.current!
      if (e.key === ' ') {
        // restart if dead
        if (!alive) doRestart()
        return
      }
      if (e.key === 'ArrowUp') eng.setDirection({ x: 0, y: -1 })
      if (e.key === 'ArrowDown') eng.setDirection({ x: 0, y: 1 })
      if (e.key === 'ArrowLeft') eng.setDirection({ x: -1, y: 0 })
      if (e.key === 'ArrowRight') eng.setDirection({ x: 1, y: 0 })
      if (mode === 'versus' && netRef.current) {
        netRef.current.send({
          type: 'input',
          key: e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [alive, mode])

  // Leaderboard
  useEffect(() => {
    fetchLeaderboard()
      .then(setLeaders)
      .catch(() => setLeaders([]))
  }, [])

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
    setPaused(false)
  }

  const onSaveScore = async () => {
    const entry: LeaderboardEntry = {
      username: playerName.trim() || 'Player',
      score,
      date: new Date().toISOString(),
    }
    try {
      await submitScore(entry)
      setLeaders((prev) => [...prev, entry].sort((a, b) => b.score - a.score).slice(0, 10))
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

        <div className="muted group-label">Canvas</div>
        {(['small', 'medium', 'large'] as const).map((c) => (
          <button
            key={c}
            className="btn"
            aria-pressed={settings.canvasSize === c}
            onClick={() => setSettings({ ...settings, canvasSize: c })}
            data-active={settings.canvasSize === c || undefined}
          >
            {c}
          </button>
        ))}

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
          className="btn"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          title={paused ? 'Resume' : 'Pause'}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>

        <button className="btn" onClick={doRestart}>
          Restart
        </button>

        <button className="btn" onClick={() => setShowTouch((v) => !v)} aria-pressed={showTouch}>
          Touch controls
        </button>

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
        <div className="snake-canvas-wrap">
          <canvas ref={canvasRef} tabIndex={0} className="snake-canvas" />
          {showTouch && (
            <div className="snake-touch">
              <button
                aria-label="Up"
                onClick={() => engineRef.current?.setDirection({ x: 0, y: -1 })}
              >
                ▲
              </button>
              <div className="row">
                <button
                  aria-label="Left"
                  onClick={() => engineRef.current?.setDirection({ x: -1, y: 0 })}
                >
                  ◀
                </button>
                <button
                  aria-label="Down"
                  onClick={() => engineRef.current?.setDirection({ x: 0, y: 1 })}
                >
                  ▼
                </button>
                <button
                  aria-label="Right"
                  onClick={() => engineRef.current?.setDirection({ x: 1, y: 0 })}
                >
                  ▶
                </button>
              </div>
            </div>
          )}
        </div>
        {mode === 'versus' && (
          <canvas ref={oppCanvasRef} className="snake-canvas snake-canvas--opp" />
        )}
      </div>

      <div className="snake-hud">
        <div className="muted">Score: {score}</div>
        {paused && <div className="muted">Paused</div>}
        {!alive && <div className="muted">Press Space to restart</div>}
      </div>

      {/* Leaderboard */}
      {leaders.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>
            Top scores
          </h3>
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
