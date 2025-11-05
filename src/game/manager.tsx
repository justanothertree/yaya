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
  // immersive/fullscreen disabled for now
  const restoredRef = useRef(false)
  const deepLinkConnectRef = useRef(false)

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
    (roomOverride?: string) => {
      if (!wsUrl) return
      setJoining(true)
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
            setMyId(msg.id)
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
          if (msg.type === 'seed') {
            setEngineSeed(msg.seed)
            setSettings(msg.settings)
            setReady(false)
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
          }
        },
      })
      netRef.current = net
      setConn('connecting')
      net.connect(roomOverride ?? room)
    },
    [wsUrl, room, roomName, playerName, myId],
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

  // Countdown effect once both are ready
  useEffect(() => {
    // compute number of ready players (include self via `ready` flag)
    const othersReady = Object.entries(players).reduce((acc, [id, p]) => {
      if (id !== myId && p.ready) acc += 1
      return acc
    }, 0)
    const totalReady = othersReady + (ready ? 1 : 0)
    if (
      !(
        mode === 'versus' &&
        conn === 'connected' &&
        presence >= 2 &&
        totalReady >= 2 &&
        countdown == null
      )
    )
      return
    let n = 3
    setCountdown(n)
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
            {m === 'versus' ? 'multiplayer' : m}
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
            if (mode === 'versus') {
              // Use Ready flow in versus
              if (conn !== 'connected') return
              if (!playerName.trim()) return
              setReady(true)
              // reflect in local players map
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
              // We just transitioned to unpaused -> capture controls
              if (!next) {
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
          disabled={mode === 'versus' && (!playerName.trim() || conn !== 'connected' || ready)}
        >
          {mode === 'versus' ? (ready ? 'Ready ✓' : 'Ready') : paused ? 'Play' : 'Pause'}
        </button>

        <button className="btn" onClick={doRestart}>
          Restart
        </button>

        {/* Joystick removed */}

        {mode === 'versus' && wsUrl && (
          <div
            className="vs-inline"
            style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          >
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
                    // keep a ref so we don't auto-override on future welcomes
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
                  minWidth: 140,
                }}
              />
            </label>
            {/* Multiplayer stepper */}
            {multiStep === 'landing' && (
              <div
                style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <button className="btn" onClick={() => setMultiStep('create')}>
                  Create lobby
                </button>
                <button className="btn" onClick={() => setMultiStep('join')}>
                  Join lobby
                </button>
              </div>
            )}
            {multiStep === 'create' && (
              <div
                style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
              >
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
                    }}
                  />
                </label>
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
                      setTimeout(() => connectVs(id), 50)
                    } else if (conn === 'disconnected') connectVs(id)
                  }}
                  disabled={joining}
                >
                  Host
                </button>
                <button className="btn" onClick={() => setMultiStep('landing')}>
                  Back
                </button>
              </div>
            )}
            {multiStep === 'join' && (
              <div
                style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
              >
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
                    }}
                  />
                </label>
                <button
                  className="btn"
                  onClick={() => {
                    if (joining) return
                    const rc = room.trim()
                    if (conn === 'disconnected' && rc) {
                      setMultiStep('lobby')
                      connectVs(rc)
                    }
                  }}
                  disabled={conn !== 'disconnected' || joining || !room.trim()}
                >
                  Join
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    // Use a temporary WS connection to fetch the room list without joining a room
                    try {
                      if (!wsUrl) return
                      const ws = new WebSocket(wsUrl)
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
                          if (msg && msg.type === 'rooms' && Array.isArray(msg.items))
                            setRooms(msg.items)
                        } catch {
                          /* noop */
                        } finally {
                          try {
                            ws.close()
                          } catch {
                            /* noop */
                          }
                        }
                      }
                      ws.onerror = () => {
                        try {
                          ws.close()
                        } catch {
                          /* noop */
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
              <div
                style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
              >
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
        {mode === 'versus' && multiStep !== 'landing' && (
          <details className="card" style={{ marginTop: 8 }} open>
            <summary style={{ cursor: 'pointer' }}>Lobby</summary>
            <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
              {multiStep === 'join' &&
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
                  <div className="muted">No lobbies yet — click Browse in Join to refresh.</div>
                ))}
              {/* Players in current room */}
              {multiStep === 'lobby' && (
                <div className="card" style={{ padding: 8 }}>
                  <div className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>
                    Players ({presence})
                  </div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div
                      className="muted"
                      style={{ display: 'flex', justifyContent: 'space-between' }}
                    >
                      <span>{playerName?.trim() || 'You'}</span>
                      <span>{ready ? 'Ready ✓' : 'Not ready'}</span>
                    </div>
                    {Object.entries(players)
                      .filter(([id]) => id !== myId)
                      .map(([id, p]) => (
                        <div
                          key={id}
                          className="muted"
                          style={{ display: 'flex', justifyContent: 'space-between' }}
                        >
                          <span>{p.name || 'Player'}</span>
                          <span>{p.ready ? 'Ready ✓' : 'Not ready'}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        )}
      </div>

      {/* Canvases */}
      <div ref={wrapRef} className="snake-grid" data-versus={mode === 'versus' || undefined}>
        <div className="snake-canvas-wrap" data-captured={captured || undefined}>
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
            }}
            aria-pressed={!paused}
            title={paused ? 'Play' : 'Pause'}
            disabled={mode === 'versus' && (!playerName.trim() || conn !== 'connected' || ready)}
          >
            {mode === 'versus' ? (ready ? 'Ready ✓' : 'Ready') : paused ? 'Play' : 'Pause'}
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
              // No auto-pause in versus mode
              if (mode !== 'versus') setPaused(true)
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

      <div className="snake-hud">
        <div className="muted">Score: {score}</div>
        <div className="muted hud-paused" aria-live="polite">
          {paused ? 'Paused' : ''}
        </div>
        {mode === 'versus' && countdown != null && (
          <div className="muted" aria-live="assertive" style={{ fontSize: 18 }}>
            Starting in… {countdown}
          </div>
        )}
        {!alive && (
          <div className="muted" aria-live="polite">
            Press Space to restart
          </div>
        )}
      </div>

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
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {leaders.map((l, i) => (
              <li key={i} className="muted">
                <strong style={{ color: 'var(--text)' }}>{l.username}</strong> — {l.score}
              </li>
            ))}
          </ol>
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
