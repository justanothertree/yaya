import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Filter } from 'bad-words'
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
  fetchTrophiesFor,
  awardTrophy,
  getLeaderboardIdFor,
  getNextPlayerIdNumber,
  supabaseEnvStatus,
} from './leaderboard'
import type { LeaderboardEntry, Mode, Settings, TrophyCounts } from './types'

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
  const [engineSeed, setEngineSeed] = useState<number>(() => Math.floor(Math.random() * 1e9))
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem(LS_SETTINGS_KEY)
      if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS
  })
  // Simplified flow: no tabs; sections always visible based on mode
  const [alive, setAlive] = useState(true)
  const [paused, setPaused] = useState(true)
  const [score, setScore] = useState(0)
  const [applesEaten, setApplesEaten] = useState(0)
  const startRef = useRef<number | null>(null)
  const [leaders, setLeaders] = useState<LeaderboardEntry[]>([])
  const [trophyMap, setTrophyMap] = useState<Record<number, TrophyCounts>>({})
  const [myRank, setMyRank] = useState<number | null>(null)
  const [period, setPeriod] = useState<LeaderboardPeriod>('all')
  const [showDebug, setShowDebug] = useState(false)
  const [debugInfo, setDebugInfo] = useState<{
    nextPlayerId?: number | null
    lastSaveCount?: number
    lastAwards?: Array<{ name: string; medal: 'gold' | 'silver' | 'bronze' }>
    lastFinalizeReason?: 'normal' | 'timeout'
  }>({})
  const [playerName, setPlayerName] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(LS_PLAYER_NAME_KEY)
      if (stored && stored.trim()) return stored
      // Default to a stable, unique id-based name for solo users
      let cid = localStorage.getItem('snake.clientId') || ''
      if (!cid) {
        cid = Math.random().toString(36).slice(2) + Date.now().toString(36)
        try {
          localStorage.setItem('snake.clientId', cid)
        } catch {
          /* ignore */
        }
      }
      const suffix = cid.slice(-4)
      const name = `Player${suffix}`
      try {
        localStorage.setItem(LS_PLAYER_NAME_KEY, name)
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
  // Refs to avoid effect dependency churn
  const playerNameRef = useRef<string>(playerName)
  const scoreRef = useRef<number>(score)
  const periodRef = useRef<LeaderboardPeriod>(period)
  const [room, setRoom] = useState('')
  // Opponent score removed in multiplayer; track via previews instead
  const [presence, setPresence] = useState(1)
  const [conn, setConn] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [joining, setJoining] = useState(false)
  const [ready, setReady] = useState(false)
  // peerReady removed; using players map + own ready state
  const [countdown, setCountdown] = useState<number | null>(null)
  // Deadline-based countdown end time (epoch ms) to resist timer throttling or tab visibility quirks
  const [countdownEndAt, setCountdownEndAt] = useState<number | null>(null)
  const [myId, setMyId] = useState<string | null>(null)
  const [players, setPlayers] = useState<Record<string, { name?: string; ready?: boolean }>>({})
  const prevModeRef = useRef<Mode>('solo')
  // Keep a Set of ids we've already inserted to avoid transient duplicate name entries on lobby join
  const seenPlayerIdsRef = useRef<Set<string>>(new Set())
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
  const wsUrl = useMemo(() => {
    try {
      const raw = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WS_URL
      if (raw) {
        // Auto-upgrade to wss on HTTPS pages to avoid mixed-content blocks (Safari/iOS)
        if (window.location.protocol === 'https:' && raw.startsWith('ws://')) {
          return 'wss://' + raw.slice('ws://'.length)
        }
        return raw
      }
      // Fallback: assume same-origin WS
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${scheme}//${window.location.host}`
    } catch {
      return undefined
    }
  }, [])
  const capturedRef = useRef(false)
  const [captured, setCaptured] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const hintTimerRef = useRef<number | null>(null)
  const userInitiatedFocusRef = useRef(false)
  const isCoarseRef = useRef(false)
  const suppressBlurPauseRef = useRef(false)
  const statusRef = useRef<HTMLDivElement>(null)
  // immersive/fullscreen disabled for now
  const restoredRef = useRef(false)
  const deepLinkConnectRef = useRef(false)
  const countdownLockRef = useRef<number>(0)
  // Derive host status directly from hostId === myId to avoid stale state on host transfer
  const [hostId, setHostId] = useState<string | null>(null)
  const isHost = myId != null && hostId === myId
  // hostId state declared earlier; removed duplicate
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  // Silent deep-link retry controller (avoid alert spam)
  const deepRetryTimerRef = useRef<number | null>(null)
  const deepRetryAttemptsRef = useRef(0)
  // Join error message (UI-only, non-blocking)
  const [joinError, setJoinError] = useState<string | null>(null)
  // No tabs; sections always visible by mode

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
  // Token to cancel/guard death animation completion handlers across mode switches
  const deathAnimTokenRef = useRef(0)
  // Prevent repeated death animation triggers (e.g., after UI interactions)
  const deathAnimatedRef = useRef(false)
  // Session epoch: increment to invalidate any in-flight game loop or death animation from previous session
  const sessionEpochRef = useRef(0)

  // Net client (only used in versus)
  const netRef = useRef<NetClient | null>(null)

  // Professional profanity filter (view-only)
  const profanityFilter = useMemo(() => new Filter({ placeHolder: '*' }), [])

  // Round tracking (versus)
  const roundActiveRef = useRef(false)
  const roundIdRef = useRef(0)
  const roundParticipantsRef = useRef<Set<string>>(new Set())
  const roundFinishedRef = useRef<string[]>([])
  const roundNamesRef = useRef<Record<string, string>>({})
  const roundAwardedRef = useRef<number | null>(null)
  const seedCountdownRef = useRef(false)
  // Track last known scores per player during a round (for results UI)
  const roundScoresRef = useRef<Record<string, number>>({})
  // Results UI state for the last completed round
  const [roundResults, setRoundResults] = useState<null | {
    items: Array<{ id: string; name: string; score: number; place: number }>
    total: number
  }>(null)
  const [showResults, setShowResults] = useState(false)
  // Throttle auto-seed requests to avoid duplicates
  const lastAutoSeedTsRef = useRef(0)
  const previewsRef = useRef<HTMLDivElement>(null)
  const ROOM_WORDS = useMemo(
    () => [
      'chill',
      'flow',
      'loop',
      'vibe',
      'fun',
      'fast',
      'flex',
      'cozy',
      'boss',
      'arena',
      'apex',
      'wow',
      'yaya',
    ],
    [],
  )
  const generateRoomCode = useCallback(() => {
    return ROOM_WORDS[Math.floor(Math.random() * ROOM_WORDS.length)]
  }, [ROOM_WORDS])

  // Focus game and scroll so canvas + previews are visible
  const focusCanvasAndScrollPreviews = useCallback(() => {
    try {
      canvasRef.current?.focus()
      capturedRef.current = true
      setCaptured(true)
      onControlChange?.(true)
    } catch {
      /* noop */
    }
    try {
      const wrap = wrapRef.current
      const prev = previewsRef.current
      const statusEl =
        statusRef.current || (document.querySelector('.snake-status') as HTMLElement | null)
      if (!wrap || !prev) return
      const rectCanvas = wrap.getBoundingClientRect()
      const rectPrev = prev.getBoundingClientRect()
      const rectStatus = statusEl ? statusEl.getBoundingClientRect() : null
      const canvasTopAbs = window.pageYOffset + rectCanvas.top
      const previewsTopAbs = window.pageYOffset + rectPrev.top
      const statusTopAbs = rectStatus ? window.pageYOffset + rectStatus.top : canvasTopAbs
      const current = window.pageYOffset
      const desiredTop = previewsTopAbs - (window.innerHeight - 160)
      const target = Math.min(Math.max(current, desiredTop), statusTopAbs)
      const OFFSET = 22 // slightly lower clamp to keep Score visible
      window.scrollTo({ top: Math.max(0, target - OFFSET), behavior: 'smooth' })
    } catch {
      /* ignore */
    }
  }, [onControlChange])

  // Register a player finishing the round; when all done, host awards trophies
  const tryFinalizeRound = useCallback(() => {
    if (!roundActiveRef.current) return
    const total = roundParticipantsRef.current.size
    if (total === 0) return
    const done = roundFinishedRef.current.length
    if (done < total) return
    const thisRound = roundIdRef.current
    roundActiveRef.current = false
    // Compute placements by score descending, using finish order as a tie-breaker
    const finishOrder = [...roundFinishedRef.current]
    const participants = Array.from(roundParticipantsRef.current)
    const base = participants.map((pid) => {
      const name = (roundNamesRef.current[pid] || 'Player').trim()
      const score = roundScoresRef.current[pid] ?? 0
      const finishIdx = finishOrder.indexOf(pid)
      return { id: pid, name, score, finishIdx: finishIdx >= 0 ? finishIdx : 9999 }
    })
    base.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.finishIdx - b.finishIdx
    })
    const resultsItems: Array<{ id: string; name: string; score: number; place: number }> =
      base.map((r, i) => ({ id: r.id, name: r.name, score: r.score, place: i + 1 }))
    setRoundResults({ items: resultsItems, total: participants.length })
    setShowResults(true)
    // Host-only: save scores, then award trophies, then refresh leaderboard (once per round)
    if (isHost && roundAwardedRef.current !== thisRound) {
      ;(async () => {
        roundAwardedRef.current = thisRound
        try {
          const nowIso = new Date().toISOString()
          for (const it of resultsItems) {
            const nm = (it.name || 'Player').trim()
            const sc = Number(it.score || 0)
            if (!nm || sc <= 0) continue
            await submitScore({ username: nm, score: sc, date: nowIso, gameMode: 'survival' })
          }
          const n = total
          const winners: Array<{ id: string; medal: 'gold' | 'silver' | 'bronze' }> = []
          if (resultsItems[0]) winners.push({ id: resultsItems[0].id, medal: 'gold' })
          if (n >= 3 && resultsItems[1]) winners.push({ id: resultsItems[1].id, medal: 'silver' })
          if (n >= 4 && resultsItems[2]) winners.push({ id: resultsItems[2].id, medal: 'bronze' })
          const awardsList: Array<{ name: string; medal: 'gold' | 'silver' | 'bronze' }> = []
          for (const w of winners) {
            const name = roundNamesRef.current[w.id]?.trim() || 'Player'
            const lid = await getLeaderboardIdFor(name, 'survival')
            if (lid != null) await awardTrophy(lid, w.medal)
            awardsList.push({ name, medal: w.medal })
          }
          setDebugInfo((d) => ({
            ...d,
            lastSaveCount: resultsItems.length,
            lastAwards: awardsList,
          }))
        } catch {
          /* ignore */
        } finally {
          try {
            const top = await fetchLeaderboard(period, 15)
            setLeaders(top)
          } catch {
            /* ignore */
          }
        }
      })()
    }
  }, [isHost, period])

  const registerFinish = useCallback(
    (id: string) => {
      if (!roundActiveRef.current) return
      if (!roundParticipantsRef.current.has(id)) return
      const arr = roundFinishedRef.current
      if (arr.includes(id)) return
      arr.push(id)
      tryFinalizeRound()
    },
    [tryFinalizeRound],
  )

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
    deathAnimatedRef.current = false
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

  // Keep refs in sync with latest values
  useEffect(() => {
    playerNameRef.current = playerName
  }, [playerName])
  useEffect(() => {
    scoreRef.current = score
  }, [score])
  useEffect(() => {
    periodRef.current = period
  }, [period])

  // If still using auto-generated name and Supabase is available,
  // update default to a sequential Player{maxId+1}
  useEffect(() => {
    ;(async () => {
      try {
        if (nameSourceRef.current === 'custom') return
        const nextNum = await getNextPlayerIdNumber()
        if (!nextNum) return
        const proposed = `Player${nextNum}`
        const cur = (playerNameRef.current || '').trim()
        // Only update if current name is empty or still an auto placeholder
        if (!cur || /^Player[0-9A-Za-z]+$/.test(cur)) {
          setPlayerName(proposed)
          try {
            localStorage.setItem(LS_PLAYER_NAME_KEY, proposed)
            localStorage.setItem(LS_PLAYER_NAME_SOURCE_KEY, 'auto')
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    })()
  }, [])

  // Game loop with session-epoch guard
  useEffect(() => {
    let timer: number | null = null
    const epoch = sessionEpochRef.current
    const loop = () => {
      if (epoch !== sessionEpochRef.current) return
      acceptedTurnRef.current = false
      const engine = engineRef.current!
      const { state, events } = engine.tick()
      rendererRef.current!.draw(state)
      for (const ev of events) {
        if (ev.type === 'eat') setApplesEaten((n) => n + 1)
        else if (ev.type === 'die') {
          setAlive(false)
          try {
            localStorage.removeItem(LS_PERSIST_KEY)
          } catch {
            /* ignore */
          }
          // Versus: mark local finish and notify peers
          if (mode === 'versus' && myId) {
            registerFinish(myId)
            try {
              netRef.current?.send({ type: 'over', reason: 'die' })
            } catch {
              /* noop */
            }
          }
        }
      }
      if (state.alive) {
        if (startRef.current == null) startRef.current = performance.now()
        const nextScore = scoreFormula(applesEaten + (events.some((e) => e.type === 'eat') ? 1 : 0))
        setScore(nextScore)
        // Track our own score for results
        if (mode === 'versus' && myId) {
          roundScoresRef.current[myId] = nextScore
        }
        if (mode === 'versus' && netRef.current) {
          try {
            netRef.current.send({ type: 'tick', n: state.ticks, score: nextScore })
          } catch {
            /* noop */
          }
        }
        const sp = speedFor(applesEaten)
        timer = window.setTimeout(() => {
          if (epoch === sessionEpochRef.current) loop()
        }, sp)
      } else {
        const token = ++deathAnimTokenRef.current
        const modeAtDeath = mode
        if (epoch === sessionEpochRef.current) {
          if (!deathAnimatedRef.current) {
            deathAnimatedRef.current = true
          }
          rendererRef
            .current!.animateDeath(state)
            .then(() => {
              if (
                deathAnimTokenRef.current === token &&
                mode === modeAtDeath &&
                epoch === sessionEpochRef.current
              ) {
                if (modeAtDeath === 'solo') {
                  // Auto-submit solo score to leaderboard if possible
                  const nm = (playerNameRef.current || '').trim() || 'Player'
                  const sc = scoreRef.current
                  if (sc > 0 && nm) {
                    ;(async () => {
                      try {
                        await submitScore({
                          username: nm,
                          score: sc,
                          date: new Date().toISOString(),
                        })
                        const [top, rank] = await Promise.all([
                          fetchLeaderboard(periodRef.current, 15),
                          fetchRankForScore(sc, periodRef.current),
                        ])
                        setLeaders(top)
                        setMyRank(rank)
                        setToast('Score saved!')
                        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
                        toastTimerRef.current = window.setTimeout(
                          () => setToast(null),
                          2000,
                        ) as unknown as number
                      } catch {
                        /* ignore */
                      }
                    })()
                  }
                  // Solo auto-saves; no modal needed
                }
              }
            })
            .catch(() => {
              /* ignore */
            })
        }
      }
    }
    if (!paused) timer = window.setTimeout(loop, 0)
    return () => {
      if (timer) window.clearTimeout(timer)
    }
  }, [settings, applesEaten, paused, mode, myId, registerFinish])

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
      // Initial assumption of host if creating; real host assignment comes via 'host' message
      // (isHost derived from hostId === myId)
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
          try {
            seenPlayerIdsRef.current.clear()
          } catch {
            /* noop */
          }
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
          try {
            seenPlayerIdsRef.current.clear()
          } catch {
            /* noop */
          }
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
            // Do not override an existing auto/custom name with visitor numbering.
            // Only apply visitor numbering if no name is set at all.
            if ((selfName || '').trim() === '' && msg.visitor != null) {
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
            // add self; guard against duplicate insert if welcome issued twice
            setPlayers((map) => {
              if (seenPlayerIdsRef.current.has(msg.id)) return map
              seenPlayerIdsRef.current.add(msg.id)
              return { ...map, [msg.id]: { name: selfName, ready: false } }
            })
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
            // Kick off round start countdown when a new seed arrives
            setCountdown(3)
            setCountdownEndAt(Date.now() + 3000)
            seedCountdownRef.current = true
            // Clear previous round UI state
            setShowResults(false)
            setRoundResults(null)
            roundScoresRef.current = {}
            // Clear previews to avoid stale tiles at start of a new round
            setPreviews({})
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
              // Keep previews visible to avoid flicker; they'll be cleared on next round seed
              // remove player on quit, else just clear ready
              setPlayers((map) => {
                const next = { ...map }
                if (msg.reason === 'quit') delete next[fromId]
                else if (next[fromId]) next[fromId] = { ...next[fromId], ready: false }
                return next
              })
              // Track finishing order for round placements
              registerFinish(fromId)
            }
          } else if (msg.type === 'preview') {
            // Ignore our own preview
            if (msg.from && myId && msg.from === myId) return
            const from = msg.from || 'peer'
            setPreviews((map) => ({
              ...map,
              [from]: { state: msg.state, score: msg.score, name: msg.name },
            }))
            // Track latest scores for round results
            if (msg.from) {
              roundScoresRef.current[msg.from] = msg.score ?? roundScoresRef.current[msg.from] ?? 0
            }
            if (msg.from) {
              const fromId = msg.from
              setPlayers((map) => ({
                ...map,
                [fromId]: {
                  ...(map[fromId] || {}),
                  name: msg.name || map[fromId]?.name,
                },
              }))
            }
          } else if (msg.type === 'tick') {
            // Track peer scores even if a preview hasn't arrived yet
            if (msg.from && myId && msg.from !== myId) {
              const sc = Number(msg.score ?? 0)
              if (Number.isFinite(sc)) {
                roundScoresRef.current[msg.from] = sc
              }
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
              // isHost derived from hostId === myId; no setIsHost needed
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
    // 'countdown' removed from deps (not referenced inside connectVs) to satisfy lint
    [wsUrl, room, roomName, playerName, myId, conn, hostId, registerFinish],
  )

  const doRestart = () => {
    setEngineSeed(Math.floor(Math.random() * 1e9))
    setPaused(true)
    deathAnimatedRef.current = false
    try {
      localStorage.removeItem(LS_PERSIST_KEY)
    } catch {
      /* ignore */
    }
  }

  // Helper: mark self Ready in multiplayer
  const setSelfReady = useCallback(() => {
    if (mode !== 'versus') return
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
  }, [mode, conn, playerName, myId])

  // Solo scores auto-save; manual save handler removed

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

  // Ensure auto-generated player names are unique within the lobby by incrementing if needed
  useEffect(() => {
    if (!(mode === 'versus' && conn === 'connected')) return
    if (nameSourceRef.current !== 'auto') return
    const my = (playerNameRef.current || playerName || '').trim()
    if (!my) return
    const lower = my.toLowerCase()
    const peers = new Set<string>()
    for (const [pid, info] of Object.entries(players)) {
      if (pid === myId) continue
      const nm = (info.name || '').trim().toLowerCase()
      if (nm) peers.add(nm)
    }
    if (!peers.has(lower)) return
    // Bump Player number until unique
    let next = my
    const m = /^player(\d+)$/i.exec(my)
    if (m) {
      let n = Number(m[1])
      let candidate = ''
      do {
        n += 1
        candidate = `Player${n}`
      } while (peers.has(candidate.toLowerCase()))
      next = candidate
    } else {
      let n = 2
      let candidate = ''
      do {
        candidate = `${my}${n}`
        n += 1
      } while (peers.has(candidate.toLowerCase()))
      next = candidate
    }
    setPlayerName(next)
    try {
      localStorage.setItem(LS_PLAYER_NAME_KEY, next)
      localStorage.setItem(LS_PLAYER_NAME_SOURCE_KEY, 'auto')
    } catch {
      /* ignore */
    }
    try {
      netRef.current?.send({ type: 'name', name: next })
    } catch {
      /* noop */
    }
  }, [mode, conn, players, myId, playerName])

  // When switching to solo after a multiplayer session (including game over),
  // fully reset local game state and disconnect from WS to avoid re-triggering an over state.
  // Do this only on transitions from 'versus' -> 'solo' to preserve solo mid-round persistence.
  useEffect(() => {
    const prev = prevModeRef.current
    prevModeRef.current = mode
    if (!(mode === 'solo' && prev === 'versus')) return
    try {
      netRef.current?.disconnect()
    } catch {
      /* noop */
    }
    setConn('disconnected')
    setJoining(false)
    setReady(false)
    setCountdown(null)
    setCountdownEndAt(null)
    setPreviews({})
    setPlayers({})
    setPresence(1)
    // Cancel any pending death animation completions from previous session
    deathAnimTokenRef.current += 1
    // Invalidate any in-flight game loop ticks
    sessionEpochRef.current += 1
    setAlive(true)
    setPaused(true)
    setScore(0)
    setApplesEaten(0)
    startRef.current = null
    setEngineSeed(Math.floor(Math.random() * 1e9))
  }, [mode])

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
      // Default snake page should start scrolled to top
      if (!m) {
        window.scrollTo({ top: 0, behavior: 'auto' })
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

  // Countdown effect: robust to background tab throttling by using a fixed deadline
  useEffect(() => {
    if (!(mode === 'versus' && conn === 'connected')) return
    if (countdownEndAt == null) return
    const tick = () => {
      const leftMs = countdownEndAt - Date.now()
      const left = Math.ceil(leftMs / 1000)
      if (left <= 0) {
        // Start now
        setCountdown(null)
        setCountdownEndAt(null)
        if (seedCountdownRef.current) {
          setPaused(false)
          // Initialize round tracking with participants (ready players + self)
          try {
            const pset = new Set<string>()
            const names: Record<string, string> = {}
            if (myId && ready) {
              pset.add(myId)
              names[myId] = playerName?.trim() || 'Player'
            }
            for (const [pid, info] of Object.entries(players)) {
              if (info.ready) {
                pset.add(pid)
                names[pid] = (info.name || 'Player').trim()
              }
            }
            if (pset.size >= 2) {
              roundParticipantsRef.current = pset
              roundFinishedRef.current = []
              roundNamesRef.current = names
              roundActiveRef.current = true
              roundIdRef.current += 1
              // Auto-focus and bring previews into view at round start
              focusCanvasAndScrollPreviews()
              // Fallback: force finalize after 75s if some participants never signal finish
              const thisRound = roundIdRef.current
              window.setTimeout(() => {
                if (!roundActiveRef.current) return
                if (roundIdRef.current !== thisRound) return
                // Mark any missing participants as finished to unblock finalize
                const total = roundParticipantsRef.current.size
                if (total > 0 && roundFinishedRef.current.length < total) {
                  const done = new Set(roundFinishedRef.current)
                  for (const pid of roundParticipantsRef.current) {
                    if (!done.has(pid)) roundFinishedRef.current.push(pid)
                  }
                  setDebugInfo((d) => ({ ...d, lastFinalizeReason: 'timeout' }))
                  tryFinalizeRound()
                }
              }, 75000)
            } else {
              roundActiveRef.current = false
              roundParticipantsRef.current = new Set()
              roundFinishedRef.current = []
              roundNamesRef.current = {}
            }
          } catch {
            /* noop */
          }
          // Round is starting: clear ready flags now so next round requires Ready again
          setReady(false)
          setPlayers((map) => {
            const next: typeof map = {}
            for (const [pid, info] of Object.entries(map)) next[pid] = { ...info, ready: false }
            return next
          })
          // capture focus on start
          canvasRef.current?.focus()
          capturedRef.current = true
          setCaptured(true)
          onControlChange?.(true)
          // lock local countdown trigger briefly to prevent loops
          countdownLockRef.current = Date.now() + 4000
          seedCountdownRef.current = false
          // Fresh round, allow death animation when it happens
          deathAnimatedRef.current = false
          // Reset results and per-round score cache when new round actually starts
          setShowResults(false)
          setRoundResults(null)
          roundScoresRef.current = {}
        }
        return true
      } else {
        setCountdown(left)
        return false
      }
    }
    // Run an immediate tick, then poll at a modest rate to handle throttling
    if (tick()) return
    const id = window.setInterval(() => {
      if (tick()) window.clearInterval(id)
    }, 250)
    return () => window.clearInterval(id)
  }, [
    mode,
    conn,
    presence,
    ready,
    players,
    myId,
    playerName,
    countdown,
    countdownEndAt,
    onControlChange,
    focusCanvasAndScrollPreviews,
    tryFinalizeRound,
  ])

  // Send lightweight preview of our current state periodically while running in versus
  useEffect(() => {
    if (!(mode === 'versus' && conn === 'connected' && myId)) return
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
  }, [mode, conn, score, playerName, myId])

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

  // Host: automatically request a new seed when all players are ready after a round
  useEffect(() => {
    if (!(mode === 'versus' && conn === 'connected' && isHost)) return
    // Don't spam if a countdown is already running or round is active
    if (countdown != null || seedCountdownRef.current || roundActiveRef.current) return
    const now = Date.now()
    if (now - lastAutoSeedTsRef.current < 1000) return
    const others = Object.entries(players).filter(([pid]) => pid !== myId)
    const allOthersReady = others.length > 0 && others.every(([, p]) => p.ready)
    if (ready && allOthersReady) {
      lastAutoSeedTsRef.current = now
      try {
        netRef.current?.send({ type: 'restart' })
      } catch {
        /* noop */
      }
    }
  }, [mode, conn, isHost, countdown, ready, players, myId])

  // Refresh trophy counts whenever leaderboard entries change
  useEffect(() => {
    const ids = leaders.map((l) => l.id).filter((v): v is number => typeof v === 'number')
    if (!ids.length) {
      setTrophyMap({})
      return
    }
    let disposed = false
    fetchTrophiesFor(ids)
      .then((m) => {
        if (!disposed) setTrophyMap(m)
      })
      .catch(() => {
        if (!disposed) setTrophyMap({})
      })
    return () => {
      disposed = true
    }
  }, [leaders])

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

  // When debug panel opens, fetch next sequential player id for display
  useEffect(() => {
    if (!showDebug) return
    ;(async () => {
      try {
        const nextNum = await getNextPlayerIdNumber()
        setDebugInfo((d) => ({ ...d, nextPlayerId: nextNum }))
      } catch {
        /* ignore */
      }
    })()
  }, [showDebug])

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
                  {m === 'versus' ? 'Multiplayer' : 'Solo'}
                </button>
              ))}

              <button
                className="btn btn--stable"
                onPointerDownCapture={() => {
                  suppressBlurPauseRef.current = true
                }}
                onClick={() => {
                  if (mode === 'versus') {
                    setSelfReady()
                    focusCanvasAndScrollPreviews()
                    return
                  }
                  if (!alive) {
                    doRestart()
                    setPaused(false)
                    focusCanvasAndScrollPreviews()
                    return
                  }
                  setPaused((p) => {
                    const next = !p
                    if (!next) {
                      focusCanvasAndScrollPreviews()
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
                {mode === 'versus' ? 'Force start' : 'Restart'}
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
                    if (mode === 'versus' && conn === 'connected' && roundActiveRef.current) {
                      setToast('Settings locked during active round')
                      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
                      toastTimerRef.current = window.setTimeout(
                        () => setToast(null),
                        1500,
                      ) as unknown as number
                      return
                    }
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
                    if (mode === 'versus' && conn === 'connected' && roundActiveRef.current) {
                      setToast('Settings locked during active round')
                      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
                      toastTimerRef.current = window.setTimeout(
                        () => setToast(null),
                        1500,
                      ) as unknown as number
                      return
                    }
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

          {/* RIGHT: Name input (always shown) + Multiplayer controls */}
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

            {mode === 'versus' && wsUrl && (
              <>
                {/* Multiplayer stepper */}
                {multiStep === 'landing' && (
                  <div className="controls-row">
                    <button
                      className="btn btn--wide"
                      onClick={() => {
                        setRoom('')
                        setMultiStep('create')
                      }}
                    >
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
                        const id = room.trim() || generateRoomCode()
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
                          setPlayers({})
                          setPreviews({})
                          try {
                            seenPlayerIdsRef.current.clear()
                          } catch {
                            /* noop */
                          }
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
                    <button
                      className="btn"
                      onClick={async () => {
                        const id = generateRoomCode()
                        setRoom(id)
                        setMode('versus')
                        setMultiStep('lobby')
                        if (conn === 'connected') {
                          netRef.current?.disconnect()
                          setConn('disconnected')
                          setJoining(true)
                          setPlayers({})
                          setPreviews({})
                          try {
                            seenPlayerIdsRef.current.clear()
                          } catch {
                            /* noop */
                          }
                          setTimeout(() => connectVs(id, true), 50)
                        } else if (conn === 'disconnected') connectVs(id, true)
                      }}
                    >
                      Host new lobby
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
                        // isHost derives from hostId; reset hostId
                        setHostId(null)
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
              </>
            )}
          </div>
        </div>
      </div>

      {/* Lobby box under settings, above the game */}
      {mode === 'versus' && multiStep !== 'landing' && (
        <div
          className="card"
          style={{ marginTop: 8, padding: 10, maxHeight: 150, overflowY: 'auto', minHeight: 90 }}
        >
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
          {(multiStep === 'join' || multiStep === 'create') && (
            <div style={{ display: 'grid', gap: 8 }}>
              {rooms.length > 0 ? (
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
              )}
            </div>
          )}
          {multiStep === 'lobby' && (
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
              {(() => {
                // Dedupe by display name to avoid transient duplicate rows (e.g., a placeholder 'Player')
                const seen = new Set<string>()
                const items: Array<{ id: string; name: string; ready?: boolean }> = []
                const selfName = (playerNameRef.current || playerName || 'Player')
                  .trim()
                  .toLowerCase()
                for (const [id, p] of Object.entries(players)) {
                  if (id === myId) continue
                  const nameRaw = (p.name || 'Player').trim()
                  const key = nameRaw.toLowerCase()
                  // Skip any entry whose name matches our own (guards against stale duplicate self id)
                  if (key === selfName) continue
                  if (seen.has(key)) continue
                  seen.add(key)
                  items.push({ id, name: nameRaw, ready: p.ready })
                }
                return items.map(({ id, name, ready }) => (
                  <div
                    key={id}
                    className="muted"
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
                  >
                    <span>
                      {name} {hostId === id ? <em>(Host)</em> : null}
                    </span>
                    <span style={{ marginLeft: 12 }}>{ready ? 'Ready ✓' : 'Not ready'}</span>
                  </div>
                ))
              })()}
            </div>
          )}
        </div>
      )}

      {/* Status bar (stable layout, separate from toolbar) */}
      <div ref={statusRef} className="snake-status" aria-live="polite">
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
                  setSelfReady()
                  focusCanvasAndScrollPreviews()
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

      {/* Live previews directly under the game (kept visible to avoid layout shift) */}
      {mode === 'versus' && multiStep === 'lobby' && (
        <div
          ref={previewsRef}
          className="card"
          style={{ marginTop: '0.75rem', padding: 10, minHeight: 190 }}
        >
          <div className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>
            Live previews
          </div>
          {Object.keys(previews).length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>
              Waiting for previews… players will appear here when they start.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 12,
              }}
            >
              {Object.entries(previews).map(([id, p]) => (
                <Preview
                  key={id}
                  state={p.state}
                  title={`${p.name || 'Player'} — ${p.score}${players[id]?.ready ? ' ✓' : ''}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Round results UI */}
      {mode === 'versus' && showResults && roundResults && roundResults.items.length > 0 && (
        <div className="card" style={{ marginTop: 8, padding: 10 }}>
          <div className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>
            Round results
          </div>
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {roundResults.items.map((it) => {
              const n = roundResults.total
              const medal =
                it.place === 1
                  ? '🥇'
                  : it.place === 2 && n >= 3
                    ? '🥈'
                    : it.place === 3 && n >= 4
                      ? '🥉'
                      : ''
              return (
                <li key={it.id} className="muted">
                  <strong style={{ color: 'var(--text)' }}>{profanityFilter.clean(it.name)}</strong>{' '}
                  — {it.score} {medal}
                </li>
              )
            })}
          </ol>
          <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            {isHost
              ? 'Waiting for all players to Ready… or use Force start to begin now.'
              : 'Waiting for the host to start the next round…'}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div className="card" style={{ marginTop: 8, padding: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 className="section-title" style={{ margin: 0 }}>
            Top 15
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
          {/* Filters removed per request */}
          <div style={{ marginLeft: 'auto' }} />
          <button
            className="btn"
            aria-pressed={showDebug}
            data-active={showDebug || undefined}
            onClick={() => setShowDebug((v) => !v)}
            title="Show debug info"
          >
            Debug
          </button>
        </div>
        {myRank != null && (
          <div className="muted" style={{ marginTop: 6 }}>
            Your rank: <strong style={{ color: 'var(--text)' }}>{myRank}</strong>
          </div>
        )}
        {leaders.length === 0 ? (
          <div className="muted" style={{ marginTop: 6 }}>
            No scores yet{period === 'today' ? ' today' : period === 'month' ? ' this month' : ''}—
            be the first!
          </div>
        ) : (
          <div style={{ textAlign: 'center', marginTop: 6 }}>
            <ol
              style={{
                margin: 0,
                paddingLeft: '1.25rem',
                display: 'inline-block',
                textAlign: 'left',
              }}
            >
              {leaders.map((l, i) => (
                <li key={typeof l.id === 'number' ? l.id : i} className="muted">
                  <strong style={{ color: 'var(--text)' }}>
                    {profanityFilter.clean(l.username)}
                  </strong>{' '}
                  — {l.score}
                  <span className="muted" style={{ marginLeft: 6, fontSize: 12 }}>
                    • Survival • {l.date ? new Date(l.date).toLocaleString() : ''}
                  </span>
                  {typeof l.id === 'number' && trophyMap[l.id] && (
                    <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                      {trophyMap[l.id].gold > 0 ? ` 🥇×${trophyMap[l.id].gold}` : ''}
                      {trophyMap[l.id].silver > 0 ? ` 🥈×${trophyMap[l.id].silver}` : ''}
                      {trophyMap[l.id].bronze > 0 ? ` 🥉×${trophyMap[l.id].bronze}` : ''}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {showDebug && (
        <div className="card" style={{ marginTop: 8, padding: 10 }}>
          <div className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>
            Debug Info
          </div>
          {(() => {
            const env = supabaseEnvStatus()
            return (
              <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                <div className="muted">
                  Supabase env: URL {env.hasUrl ? '✓' : '×'}, Key {env.hasAnon ? '✓' : '×'}
                </div>
                <div className="muted">Next Player id: {String(debugInfo.nextPlayerId ?? '—')}</div>
                <div className="muted">
                  Last save count: {String(debugInfo.lastSaveCount ?? '—')}
                </div>
                <div className="muted">
                  Last awards:{' '}
                  {debugInfo.lastAwards && debugInfo.lastAwards.length > 0
                    ? debugInfo.lastAwards.map((a) => `${a.name} (${a.medal})`).join(', ')
                    : '—'}
                </div>
                <div className="muted">Host: {isHost ? 'yes' : 'no'}</div>
                <div className="muted">
                  Round active: {roundActiveRef.current ? 'yes' : 'no'}; participants:{' '}
                  {roundParticipantsRef.current.size}; finished: {roundFinishedRef.current.length}
                </div>
                <div className="muted">
                  Last finalize: {debugInfo.lastFinalizeReason ? debugInfo.lastFinalizeReason : '—'}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Multiplayer section removed here to avoid duplication (moved near toolbar/canvas) */}
    </div>
  )
}
