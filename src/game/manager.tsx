import { useCallback, useEffect, useRef, useState } from 'react'
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

function scoreFormula(apples: number) {
  // 1:1 score with apples eaten
  return apples
}

const LS_SETTINGS_KEY = 'snake.settings.v1'
const LS_PERSIST_KEY = 'snake.persist.v1'
const LS_PLAYER_NAME_KEY = 'snake.playerName'
const LS_PLAYER_NAME_SOURCE_KEY = 'snake.playerName.source' // 'auto' | 'custom'

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
  const [playerName, setPlayerName] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(LS_PLAYER_NAME_KEY)
      if (stored && stored.trim()) return stored
      // provisional default; server may assign a visitor-based number
      const name = 'Player'
      localStorage.setItem(LS_PLAYER_NAME_KEY, name)
      try {
        localStorage.setItem(LS_PLAYER_NAME_SOURCE_KEY, 'auto')
      } catch {
        /* ignore */
      }
      return name
    } catch {
      return 'Player'
    }
  })
  const initialNameSource: 'auto' | 'custom' = (() => {
    try {
      return (localStorage.getItem(LS_PLAYER_NAME_SOURCE_KEY) as 'auto' | 'custom') || 'auto'
    } catch {
      return 'auto'
    }
  })()
  const nameSourceRef = useRef<'auto' | 'custom'>(initialNameSource)
  const [room, setRoom] = useState('')
  // Opponent score removed in multiplayer; track via previews instead
  const [presence, setPresence] = useState(1)
  const [conn, setConn] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [joining, setJoining] = useState(false)
  const [ready, setReady] = useState(false)
  // peerReady removed; using players map + own ready state
  const [countdown, setCountdown] = useState<number | null>(null)
  const [myId, setMyId] = useState<string | null>(null)
  const [players, setPlayers] = useState<Record<string, { name?: string; ready?: boolean }>>({})
  const [previews, setPreviews] = useState<
    Record<string, { state: ReturnType<GameEngine['snapshot']>; score: number; name?: string }>
  >({})
  const [rooms, setRooms] = useState<Array<{ id: string; name?: string; count: number }>>([])
  const [roomName] = useState<string>(() => {
    try {
      return localStorage.getItem('snake.room.name') || ''
    } catch {
      return ''
    }
  })
  const [multiStep, setMultiStep] = useState<'landing' | 'create' | 'join' | 'lobby'>('landing')
  const wsUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WS_URL
  const capturedRef = useRef(false)
  const [captured, setCaptured] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const hintTimerRef = useRef<number | null>(null)
  const userInitiatedFocusRef = useRef(false)
  const isCoarseRef = useRef(false)
  const suppressBlurPauseRef = useRef(false)
  // immersive/fullscreen disabled for now
  const restoredRef = useRef(false)
  const deepLinkConnectRef = useRef(false)
  const countdownLockRef = useRef<number>(0)
  const [isHost, setIsHost] = useState(false)
  const [hostId, setHostId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  // Silent deep-link retry controller (avoid alert spam)
  const deepRetryTimerRef = useRef<number | null>(null)
  const deepRetryAttemptsRef = useRef(0)
  // Join error message (UI-only, non-blocking)
  const [joinError, setJoinError] = useState<string | null>(null)

  // Canvas refs and renderers
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Opponent canvas removed; using previews instead
  const rendererRef = useRef<GameRenderer | null>(null)
  const lastWrapSizeRef = useRef<{ w: number; h: number } | null>(null)
  // Opponent renderer can be wired later when server mirrors full state

  // Engine
  const engineRef = useRef<GameEngine | null>(null)
  const acceptedTurnRef = useRef(false)

  // Net client (only used in versus)
  const netRef = useRef<NetClient | null>(null)

  // Mini preview canvas component for peer snapshots
  function Preview({ state, title }: { state: ReturnType<GameEngine['snapshot']>; title: string }) {
    const cRef = useRef<HTMLCanvasElement>(null)
    useEffect(() => {
      const canvas = cRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const grid = settings.grid
      const cell = Math.max(3, Math.floor(128 / grid))
      const size = grid * cell
      canvas.width = size
      canvas.height = size
      // Theme
      const styles = getComputedStyle(document.documentElement)
      const bg = styles.getPropertyValue('--bg').trim() || '#0b0f19'
      const snake = styles.getPropertyValue('--accent').trim() || '#22c55e'
      const apple = styles.getPropertyValue('--accent-2').trim() || '#ef4444'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = apple
      for (const a of state.apples) ctx.fillRect(a.x * cell, a.y * cell, cell, cell)
      ctx.fillStyle = snake
      for (const p of state.snake) ctx.fillRect(p.x * cell, p.y * cell, cell, cell)
    }, [state])
    return (
      <div style={{ display: 'grid', gap: 4 }}>
        <canvas
          ref={cRef}
          style={{ width: 128, height: 128, borderRadius: 8, border: '1px solid var(--border)' }}
        />
        <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
          {title}
        </div>
      </div>
    )
  }

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
  }, [settings, engineSeed])
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

  // Persist player name when changed (user edits); announce to room if connected
  useEffect(() => {
    try {
      if (playerName && playerName.trim()) {
        localStorage.setItem(LS_PLAYER_NAME_KEY, playerName.trim())
        if (conn === 'connected') netRef.current?.send({ type: 'name', name: playerName.trim() })
        // reflect in local players map for self
        setPlayers((map) => {
          if (!myId) return map
          const cur = map[myId] || {}
          return { ...map, [myId]: { ...cur, name: playerName.trim() } }
        })
      }
    } catch {
      /* ignore */
    }
  }, [playerName, conn, myId])

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
        else if (ev.type === 'die') {
          setAlive(false)
          // On death, clear any persisted soft save to prevent continuing a finished game
          try {
            localStorage.removeItem(LS_PERSIST_KEY)
          } catch {
            /* ignore */
          }
        }
      }
      if (state.alive) {
        if (startRef.current == null) startRef.current = performance.now()
        // Keep monotonic startRef for potential future use, but scoring is 1:1 with apples
        const nextScore = scoreFormula(applesEaten + (events.some((e) => e.type === 'eat') ? 1 : 0))
        setScore(nextScore)
        // In versus mode, send lightweight tick updates with current score to the room
        if (mode === 'versus' && netRef.current) {
          try {
            netRef.current.send({ type: 'tick', n: state.ticks, score: nextScore })
          } catch {
            /* noop */
          }
        }
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
  }, [settings, applesEaten, paused, mode])

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
        // No manual pause/play in versus mode
        if (mode === 'versus') return
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
  const connectVs = useCallback(
    (roomOverride?: string, create?: boolean) => {
      if (!wsUrl) return
      setIsHost(!!create)
      setJoining(true)
      let gotWelcome = false
      let createAttempts = 0
      const net = new NetClient(wsUrl, {
        onOpen: () => {
          setConn('connected')
          setJoining(false)
          // reset local state for new session
          setPlayers({})
          setPreviews({})
          // broadcast current meta on connect
          try {
            net.send({ type: 'roommeta', name: roomName || undefined })
          } catch {
            /* noop */
          }
          try {
            if (playerName?.trim()) net.send({ type: 'name', name: playerName.trim() })
          } catch {
            /* noop */
          }
        },
        onClose: () => {
          // If hosting and the socket closed before welcome, try a few quick silent retries
          if (create && !gotWelcome && createAttempts < 3) {
            createAttempts += 1
            const delay = 400 * createAttempts
            window.setTimeout(() => {
              setConn('connecting')
              net.connect(roomOverride ?? room, { create })
            }, delay)
            return
          }
          setConn('disconnected')
          setJoining(false)
          setReady(false)
          setPlayers({})
          setPreviews({})
        },
        onError: () => {
          setConn('disconnected')
          setJoining(false)
        },
        onMessage: (msg) => {
          if (msg.type === 'welcome') {
            gotWelcome = true
            setMyId(msg.id)
            // Move into lobby on successful welcome (covers Join flow)
            setMultiStep('lobby')
            setJoinError(null)
            // Clear any pending deep-link retries on success
            if (deepRetryTimerRef.current) {
              window.clearTimeout(deepRetryTimerRef.current)
              deepRetryTimerRef.current = null
            }
            deepRetryAttemptsRef.current = 0
            let selfName = playerName?.trim() || 'Player'
            if (msg.visitor != null && nameSourceRef.current !== 'custom') {
              selfName = `Player${msg.visitor}`
              setPlayerName(selfName)
              try {
                localStorage.setItem(LS_PLAYER_NAME_KEY, selfName)
                localStorage.setItem(LS_PLAYER_NAME_SOURCE_KEY, 'auto')
              } catch {
                /* ignore */
              }
              try {
                netRef.current?.send({ type: 'name', name: selfName })
              } catch {
                /* noop */
              }
            }
            // add self to players map with current or updated name
            const finalName = selfName
            setPlayers((map) => ({
              ...map,
              [msg.id]: { name: finalName, ready: false },
            }))
            return
          }
          if (msg.type === 'error') {
            // Room not found or other server-side error
            setJoining(false)
            // if we were trying to join, return to Join step
            setMultiStep('join')
            setJoinError(msg.message || msg.code || 'Unable to join room')
            // ensure we disconnect this temp session
            try {
              netRef.current?.disconnect()
            } catch {
              /* noop */
            }
            setConn('disconnected')
            // If deep-linking to a room, do a few silent retries in case host is still connecting
            try {
              const h = window.location.hash || ''
              if (/room=/.test(h)) {
                const target = room
                if (deepRetryTimerRef.current) {
                  window.clearTimeout(deepRetryTimerRef.current)
                  deepRetryTimerRef.current = null
                }
                if (deepRetryAttemptsRef.current < 3 && conn === 'disconnected' && target) {
                  const attempt = deepRetryAttemptsRef.current + 1
                  deepRetryAttemptsRef.current = attempt
                  const delay = 1000 * attempt
                  deepRetryTimerRef.current = window.setTimeout(() => {
                    // ensure we're still aiming for the same room and still disconnected
                    if (conn === 'disconnected' && room === target) connectVs(target)
                  }, delay) as unknown as number
                }
              }
            } catch {
              /* noop */
            }
            return
          }
          if (msg.type === 'seed') {
            setEngineSeed(msg.seed)
            setSettings(msg.settings)
            setReady(false)
            // Kick off round start countdown when a new seed arrives
            if (countdown == null) setCountdown(3)
            // reset ready flags for all players (new round)
            setPlayers((map) => {
              const next: typeof map = {}
              for (const [id, p] of Object.entries(map)) next[id] = { ...p, ready: false }
              return next
            })
          } else if (msg.type === 'presence') {
            setPresence(Math.max(1, msg.count || 1))
          } else if (msg.type === 'ready') {
            // Mark peer ready in players map (server doesn't echo to sender)
            if (msg.from && (!myId || msg.from !== myId)) {
              const fromId = msg.from
              setPlayers((map) => ({ ...map, [fromId]: { ...(map[fromId] || {}), ready: true } }))
            }
          } else if (msg.type === 'over') {
            if (msg.from) {
              const fromId = msg.from as string
              setPreviews((map) => {
                const next = { ...map }
                if (fromId in next) delete next[fromId]
                return next
              })
              // remove player on quit, else just clear ready
              setPlayers((map) => {
                const next = { ...map }
                if (msg.reason === 'quit') delete next[fromId]
                else if (next[fromId]) next[fromId] = { ...next[fromId], ready: false }
                return next
              })
            }
          } else if (msg.type === 'preview') {
            // Ignore our own preview
            if (msg.from && myId && msg.from === myId) return
            const from = msg.from || 'peer'
            setPreviews((map) => ({
              ...map,
              [from]: { state: msg.state, score: msg.score, name: msg.name },
            }))
            if (msg.from) {
              setPlayers((map) => ({
                ...map,
                [msg.from!]: { ...(map[msg.from!] || {}), name: msg.name || map[msg.from!]?.name },
              }))
            }
          } else if (msg.type === 'name') {
            if (msg.from) {
              const fromId = msg.from
              setPlayers((map) => ({
                ...map,
                [fromId]: { ...(map[fromId] || {}), name: msg.name },
              }))
              // reflect in preview tiles too (only if a preview exists already)
              setPreviews((map) => {
                if (!map[fromId]) return map
                return { ...map, [fromId]: { ...map[fromId], name: msg.name } }
              })
            }
          } else if (msg.type === 'rooms') {
            setRooms(msg.items || [])
          } else if (msg.type === 'settings') {
            if (msg.settings) setSettings(msg.settings)
          } else if (msg.type === 'host') {
            if (msg.hostId) {
              const prev = hostId
              setHostId(msg.hostId)
              if (myId) setIsHost(msg.hostId === myId)
              if (prev !== msg.hostId) {
                if (myId && msg.hostId === myId) setToast('You are now the host')
                else setToast('Host changed')
                if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
                toastTimerRef.current = window.setTimeout(
                  () => setToast(null),
                  2000,
                ) as unknown as number
              }
            }
          }
        },
      })
      netRef.current = net
      setConn('connecting')
      net.connect(roomOverride ?? room, { create })
    },
    [wsUrl, room, roomName, playerName, myId, conn, countdown, hostId],
  )

  const doRestart = () => {
    setEngineSeed(Math.floor(Math.random() * 1e9))
    setPaused(true)
    setAskNameOpen(false)
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

  // Broadcast name changes immediately when connected
  useEffect(() => {
    if (conn !== 'connected') return
    const nm = playerName.trim()
    if (!nm) return
    try {
      netRef.current?.send({ type: 'name', name: nm })
    } catch {
      /* noop */
    }
  }, [playerName, conn])

  // Parse room from hash (e.g., #snake?room=abc123) on mount
  useEffect(() => {
    try {
      const h = window.location.hash || ''
      const m = h.match(/room=([A-Za-z0-9_-]+)/)
      if (m && m[1]) {
        const rid = m[1]
        setRoom(rid)
        setMode('versus')
        setMultiStep('lobby')
        deepLinkConnectRef.current = true
      }
    } catch {
      /* ignore */
    }
  }, [])

  // Perform deep-link connect once, after state is set
  useEffect(() => {
    if (deepLinkConnectRef.current && conn === 'disconnected' && room) {
      deepLinkConnectRef.current = false
      connectVs(room)
    }
  }, [conn, room, connectVs])

  // Countdown effect: either triggered by server seed (countdown already set) or by local 'all ready'
  useEffect(() => {
    if (!(mode === 'versus' && conn === 'connected')) return
    // If no countdown is active yet, check local readiness to trigger one
    if (countdown == null) {
      // Avoid re-triggering countdown immediately after a round starts
      if (countdownLockRef.current && Date.now() < countdownLockRef.current) return
      const othersReady = Object.entries(players).reduce((acc, [id, p]) => {
        if (id !== myId && p.ready) acc += 1
        return acc
      }, 0)
      const totalReady = othersReady + (ready ? 1 : 0)
      if (presence >= 2 && totalReady >= 2) setCountdown(3)
      return
    }
    // countdown is active -> run the timer
    let n = countdown
    const id = window.setInterval(() => {
      n -= 1
      if (n <= 0) {
        window.clearInterval(id)
        setCountdown(null)
        setPaused(false)
        // capture focus on start
        canvasRef.current?.focus()
        capturedRef.current = true
        setCaptured(true)
        onControlChange?.(true)
        // lock local countdown trigger briefly to prevent loops
        countdownLockRef.current = Date.now() + 4000
      } else setCountdown(n)
    }, 900)
    return () => window.clearInterval(id)
  }, [mode, conn, presence, ready, players, myId, countdown, onControlChange])

  // Send lightweight preview of our current state periodically while running in versus
  useEffect(() => {
    if (!(mode === 'versus' && conn === 'connected')) return
    let raf: number | null = null
    const send = () => {
      try {
        const snap = engineRef.current?.snapshot()
        if (snap) {
          netRef.current?.send({ type: 'preview', state: snap, score, name: playerName })
        }
      } catch {
        /* noop */
      }
      raf = window.setTimeout(send, 250) as unknown as number
    }
    raf = window.setTimeout(send, 250) as unknown as number
    return () => {
      if (raf) window.clearTimeout(raf)
    }
  }, [mode, conn, score, playerName])

  // shareRoomLink removed (inlined where needed)

  // Request list of public rooms
  // refreshRooms removed (browse/list inlined in Join step)

  // Update current room metadata
  // sendRoomMeta removed (meta sent directly on connect)

  // No implicit auto-connect on switching to versus; user triggers Join or Create game

  // Disconnect from WS on unmount to avoid ghost connections inflating presence
  useEffect(() => {
    return () => {
      try {
        netRef.current?.disconnect()
      } catch {
        /* noop */
      }
      setConn('disconnected')
    }
  }, [])

  // Auto-refresh available lobbies when entering Join step
  useEffect(() => {
    if (!(mode === 'versus' && wsUrl && (multiStep === 'join' || multiStep === 'create'))) return
    try {
      const ws = new WebSocket(wsUrl)
      let closed = false
      const t = window.setTimeout(() => {
        if (!closed) {
          closed = true
          try {
            ws.close()
          } catch {
            /* noop */
          }
        }
      }, 2000)
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ type: 'list' }))
        } catch {
          /* noop */
        }
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string)
          if (msg && msg.type === 'rooms' && Array.isArray(msg.items)) {
            setRooms(msg.items)
            if (!closed) {
              closed = true
              window.clearTimeout(t)
              try {
                ws.close()
              } catch {
                /* noop */
              }
            }
          }
        } catch {
          /* noop */
        }
      }
      ws.onerror = () => {
        if (!closed) {
          closed = true
          window.clearTimeout(t)
          try {
            ws.close()
          } catch {
            /* noop */
          }
        }
      }
      ws.onclose = () => {
        if (!closed) {
          closed = true
          window.clearTimeout(t)
        }
      }
    } catch {
      /* noop */
    }
  }, [mode, wsUrl, multiStep])

  return (
    <div>
      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 12,
            right: 12,
            zIndex: 400,
          }}
        >
          <div className="card" style={{ padding: '6px 10px' }}>
            <div className="muted" style={{ fontWeight: 600 }}>
              {toast}
            </div>
          </div>
        </div>
      )}
      {/* Settings & Mode */}
      <div className="snake-toolbar">
        <div className="snake-layout">
          {/* LEFT: Controls & Settings */}
          <div className="controls-group">
            <div className="controls-row">
              <div className="muted">Mode:</div>
              {(['solo', 'versus'] as Mode[]).map((m) => (
                <button
                  key={m}
                  className="btn"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  data-active={mode === m || undefined}
                >
                  {m === 'versus' ? 'multiplayer' : m}
                </button>
              ))}

              <button
                className="btn btn--stable"
                onPointerDownCapture={() => {
                  suppressBlurPauseRef.current = true
                }}
                onClick={() => {
                  if (mode === 'versus') {
                    if (conn !== 'connected') return
                    if (!playerName.trim()) return
                    setReady(true)
                    setPlayers((map) => {
                      if (!myId) return map
                      const cur = map[myId] || {}
                      return {
                        ...map,
                        [myId]: { ...cur, ready: true, name: cur.name || playerName },
                      }
                    })
                    try {
                      netRef.current?.send({ type: 'ready' })
                    } catch {
                      /* noop */
                    }
                    return
                  }
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
                    if (!next) {
                      canvasRef.current?.focus()
                      capturedRef.current = true
                      setCaptured(true)
                      onControlChange?.(true)
                    }
                    return next
                  })
                  setTimeout(() => {
                    suppressBlurPauseRef.current = false
                  }, 0)
                }}
                aria-pressed={!paused}
                title={paused ? 'Play' : 'Pause'}
                disabled={
                  mode === 'versus' && (!playerName.trim() || conn !== 'connected' || ready)
                }
              >
                {mode === 'versus' ? (ready ? 'Ready ✓' : 'Ready') : paused ? 'Play' : 'Pause'}
              </button>

              <button
                className="btn"
                onClick={() => {
                  if (mode === 'versus') {
                    if (conn !== 'connected' || !isHost) return
                    try {
                      netRef.current?.send({ type: 'restart' })
                    } catch {
                      /* noop */
                    }
                    return
                  }
                  doRestart()
                }}
                disabled={mode === 'versus' && !isHost}
                title={mode === 'versus' && !isHost ? 'Host only' : undefined}
              >
                Restart
              </button>
            </div>

            <div className="controls-row">
              <div className="muted group-label">Apples</div>
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  className="btn"
                  aria-pressed={settings.apples === n}
                  onClick={() => {
                    const next = { ...settings, apples: n }
                    setSettings(next)
                    if (mode === 'versus' && conn === 'connected' && isHost) {
                      try {
                        netRef.current?.send({ type: 'settings', settings: next })
                      } catch {
                        /* noop */
                      }
                    }
                  }}
                  disabled={mode === 'versus' && conn === 'connected' && !isHost}
                  title={
                    mode === 'versus' && conn === 'connected' && !isHost
                      ? 'Locked in multiplayer'
                      : undefined
                  }
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
                  onClick={() => {
                    const nextVal = lab === 'wrap'
                    const next = { ...settings, passThroughEdges: nextVal }
                    setSettings(next)
                    if (mode === 'versus' && conn === 'connected' && isHost) {
                      try {
                        netRef.current?.send({ type: 'settings', settings: next })
                      } catch {
                        /* noop */
                      }
                    }
                  }}
                  disabled={mode === 'versus' && conn === 'connected' && !isHost}
                  title={
                    mode === 'versus' && conn === 'connected' && !isHost
                      ? 'Locked in multiplayer'
                      : undefined
                  }
                  data-active={(settings.passThroughEdges ? 'wrap' : 'walls') === lab || undefined}
                >
                  {lab}
                </button>
              ))}
            </div>
          </div>

          {/* RIGHT: Multiplayer controls */}
          {mode === 'versus' && wsUrl && (
            <div className="mp-group">
              <label
                className="muted"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                Name
                <input
                  value={playerName}
                  onChange={(e) => {
                    setPlayerName(e.target.value)
                    try {
                      localStorage.setItem(LS_PLAYER_NAME_SOURCE_KEY, 'custom')
                      nameSourceRef.current = 'custom'
                    } catch {
                      /* ignore */
                    }
                  }}
                  placeholder="Your name"
                  style={{
                    padding: '0.5rem',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text)',
                    minWidth: 160,
                    width: '100%',
                  }}
                />
              </label>

              {/* Multiplayer stepper */}
              {multiStep === 'landing' && (
                <div className="controls-row">
                  <button className="btn btn--wide" onClick={() => setMultiStep('create')}>
                    Create lobby
                  </button>
                  <button className="btn btn--wide" onClick={() => setMultiStep('join')}>
                    Join lobby
                  </button>
                </div>
              )}
              {multiStep === 'create' && (
                <div className="controls-row" style={{ alignItems: 'center' }}>
                  <label
                    className="muted"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    Room code
                    <input
                      value={room}
                      onChange={(e) => {
                        setRoom(e.target.value)
                        if (joinError) setJoinError(null)
                      }}
                      placeholder="e.g. room-abc123"
                      style={{
                        padding: '0.5rem',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--text)',
                        minWidth: 160,
                      }}
                    />
                  </label>
                  {joinError && (
                    <div className="muted" style={{ color: 'var(--danger)', fontSize: 12 }}>
                      {joinError}
                    </div>
                  )}
                  <button
                    className="btn"
                    onClick={async () => {
                      const id = room.trim() || `room-${Math.random().toString(36).slice(2, 8)}`
                      setRoom(id)
                      setMode('versus')
                      setMultiStep('lobby')
                      const url = `${location.origin}${location.pathname}#snake?room=${encodeURIComponent(id)}`
                      try {
                        await navigator.clipboard.writeText(url)
                      } catch {
                        /* noop */
                      }
                      if (conn === 'connected') {
                        netRef.current?.disconnect()
                        setConn('disconnected')
                        setTimeout(() => connectVs(id, true), 50)
                      } else if (conn === 'disconnected') connectVs(id, true)
                    }}
                    disabled={joining}
                  >
                    Host
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setJoinError(null)
                      setMultiStep('landing')
                    }}
                  >
                    Back
                  </button>
                </div>
              )}
              {multiStep === 'join' && (
                <div className="controls-row" style={{ alignItems: 'center' }}>
                  <label
                    className="muted"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    Room code
                    <input
                      value={room}
                      onChange={(e) => setRoom(e.target.value)}
                      placeholder="e.g. room-abc123"
                      style={{
                        padding: '0.5rem',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'transparent',
                        color: 'var(--text)',
                        minWidth: 160,
                      }}
                    />
                  </label>
                  <button
                    className="btn"
                    onClick={() => {
                      if (joining) return
                      const rc = room.trim()
                      if (conn === 'disconnected' && rc) {
                        connectVs(rc, false)
                      }
                    }}
                    disabled={conn !== 'disconnected' || joining || !room.trim()}
                  >
                    Join
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      try {
                        if (!wsUrl) return
                        const ws = new WebSocket(wsUrl)
                        let closed = false
                        const t = window.setTimeout(() => {
                          if (!closed) {
                            closed = true
                            try {
                              ws.close()
                            } catch {
                              /* noop */
                            }
                          }
                        }, 2000)
                        ws.onopen = () => {
                          try {
                            ws.send(JSON.stringify({ type: 'list' }))
                          } catch {
                            /* noop */
                          }
                        }
                        ws.onmessage = (ev) => {
                          try {
                            const msg = JSON.parse(ev.data as string)
                            if (msg && msg.type === 'rooms' && Array.isArray(msg.items)) {
                              setRooms(msg.items)
                              if (!closed) {
                                closed = true
                                window.clearTimeout(t)
                                try {
                                  ws.close()
                                } catch {
                                  /* noop */
                                }
                              }
                            }
                          } catch {
                            /* noop */
                          }
                        }
                        ws.onerror = () => {
                          if (!closed) {
                            closed = true
                            window.clearTimeout(t)
                            try {
                              ws.close()
                            } catch {
                              /* noop */
                            }
                          }
                        }
                        ws.onclose = () => {
                          if (!closed) {
                            closed = true
                            window.clearTimeout(t)
                          }
                        }
                      } catch {
                        /* noop */
                      }
                    }}
                  >
                    Browse lobbies
                  </button>
                  <button className="btn" onClick={() => setMultiStep('landing')}>
                    Back
                  </button>
                </div>
              )}
              {multiStep === 'lobby' && (
                <div className="controls-row" style={{ alignItems: 'center' }}>
                  <div className="muted">Room: {room || '—'}</div>
                  <div className="muted">Players: {presence}</div>
                  <div className="muted">
                    {conn === 'connected'
                      ? 'Connected'
                      : conn === 'connecting'
                        ? 'Connecting…'
                        : 'Offline'}
                  </div>
                  <button
                    className="btn"
                    onClick={async () => {
                      const code = room.trim()
                      if (!code) return
                      try {
                        await navigator.clipboard.writeText(
                          `${location.origin}${location.pathname}#snake?room=${encodeURIComponent(code)}`,
                        )
                      } catch {
                        /* noop */
                      }
                    }}
                  >
                    Copy link
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      try {
                        netRef.current?.disconnect()
                      } catch {
                        /* noop */
                      }
                      setConn('disconnected')
                      setJoining(false)
                      setIsHost(false)
                      setPresence(1)
                      setPlayers({})
                      setPreviews({})
                      setReady(false)
                      setCountdown(null)
                      setMultiStep('landing')
                    }}
                  >
                    Leave lobby
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {mode === 'versus' && multiStep !== 'landing' && (
          <div className="card" style={{ marginTop: 8, padding: 8 }}>
            <div className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>
              {multiStep === 'lobby' ? (
                <>
                  Lobby — <span style={{ color: 'var(--text)' }}>{room || '—'}</span>{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    (connected players: {presence})
                  </span>
                </>
              ) : (
                <>Available lobbies</>
              )}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {(multiStep === 'join' || multiStep === 'create') &&
                (rooms.length > 0 ? (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))',
                      gap: 8,
                    }}
                  >
                    {rooms.map((r) => (
                      <div key={r.id} className="card" style={{ padding: 8 }}>
                        <div className="muted" style={{ fontWeight: 600 }}>
                          {r.name || r.id}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          ID: {r.id}
                        </div>
                        <div className="muted">Players: {r.count}</div>
                        <div style={{ marginTop: 6 }}>
                          <button
                            className="btn"
                            disabled={joining || conn === 'connecting'}
                            onClick={() => {
                              if (joining) return
                              const rid = r.id
                              if (room !== rid) setRoom(rid)
                              setMultiStep('lobby')
                              if (conn === 'connected') {
                                netRef.current?.disconnect()
                                setConn('disconnected')
                                setJoining(true)
                                setTimeout(() => connectVs(rid), 50)
                              } else if (conn === 'disconnected') connectVs(rid)
                            }}
                          >
                            Join
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No lobbies yet — click Browse to refresh.</div>
                ))}
              {/* Players in current room */}
              {multiStep === 'lobby' && (
                <div className="card" style={{ padding: 8 }}>
                  <div className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>
                    Connected players
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {myId && (
                      <div
                        className="muted"
                        style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
                      >
                        <span>
                          {playerName?.trim() || 'You'} {isHost ? <em>(Host)</em> : null}
                        </span>
                        <span style={{ marginLeft: 12 }}>{ready ? 'Ready ✓' : 'Not ready'}</span>
                      </div>
                    )}
                    {Object.entries(players)
                      .filter(([id]) => id !== myId)
                      .map(([id, p]) => (
                        <div
                          key={id}
                          className="muted"
                          style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
                        >
                          <span>
                            {p.name || 'Player'} {hostId === id ? <em>(Host)</em> : null}
                          </span>
                          <span style={{ marginLeft: 12 }}>
                            {p.ready ? 'Ready ✓' : 'Not ready'}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Status bar (stable layout, separate from toolbar) */}
      <div className="snake-status" aria-live="polite">
        <div className="muted">
          Score: <span style={{ color: 'var(--text)' }}>{score}</span>
        </div>
        {paused && <div className="muted">Paused</div>}
        {mode === 'versus' && countdown != null && (
          <div className="muted" aria-live="assertive">
            Starting in… {countdown}
          </div>
        )}
      </div>

      {/* Canvases */}
      <div ref={wrapRef} className="snake-grid" data-versus={mode === 'versus' || undefined}>
        <div className="snake-canvas-wrap" data-captured={captured || undefined}>
          {mode === 'versus' && (
            <button
              className="btn snake-fab"
              onClick={() => {
                if (mode === 'versus') {
                  // In versus, use Ready flow to coordinate start
                  if (conn !== 'connected') return
                  if (!playerName.trim()) return
                  setReady(true)
                  setPlayers((map) => {
                    if (!myId) return map
                    const cur = map[myId] || {}
                    return { ...map, [myId]: { ...cur, ready: true, name: cur.name || playerName } }
                  })
                  try {
                    netRef.current?.send({ type: 'ready' })
                  } catch {
                    /* noop */
                  }
                  return
                }
              }}
              aria-pressed={!paused}
              title={paused ? 'Play' : 'Pause'}
              disabled={mode === 'versus' && (!playerName.trim() || conn !== 'connected' || ready)}
            >
              {mode === 'versus' ? (ready ? 'Ready ✓' : 'Ready') : paused ? 'Play' : 'Pause'}
            </button>
          )}
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
              // Solo mode: auto-pause when canvas loses focus (unless we're mid-click suppressing blur)
              if (mode === 'solo' && !suppressBlurPauseRef.current) setPaused(true)
              suppressBlurPauseRef.current = false
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
        {/* Opponent canvas removed for now; previews serve as spectator UI */}
      </div>

      {/* Peer previews (versus): show small boards for other players in the room */}
      {mode === 'versus' && Object.keys(previews).length > 0 && (
        <div className="card previews-section" style={{ marginTop: '0.75rem' }}>
          <div className="muted" style={{ marginBottom: 6 }}>
            Players in room: {presence}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 12,
            }}
          >
            {Object.entries(previews).map(([id, p]) => (
              <Preview key={id} state={p.state} title={`${p.name || 'Player'} — ${p.score}`} />
            ))}
          </div>
        </div>
      )}

      {/* Bottom HUD removed; status shown inline in the toolbar above for better visibility */}

      {/* Leaderboard */}
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
        {leaders.length === 0 ? (
          <div className="muted" style={{ marginTop: 6 }}>
            No scores yet{period === 'today' ? ' today' : period === 'month' ? ' this month' : ''}—
            be the first!
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <ol
              style={{
                margin: 0,
                paddingLeft: '1.25rem',
                display: 'inline-block',
                textAlign: 'left',
              }}
            >
              {leaders.map((l, i) => (
                <li key={i} className="muted">
                  <strong style={{ color: 'var(--text)' }}>{l.username}</strong> — {l.score}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

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
