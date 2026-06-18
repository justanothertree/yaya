// Tiny external store for The Circuit. React subscribes via useSyncExternalStore;
// mutations update local state optimistically, then persist through whatever adapter
// was supplied to init() — localStorage when signed out, Supabase + realtime when in.
//
// Every mutation is a reversible command (save/delete on one collection), so the
// store keeps a 30-step undo/redo history. External (realtime) changes reset it,
// since the base state shifted underneath us.
import { useSyncExternalStore } from 'react'
import type { CircuitAdapter } from './adapter'
import type { CircuitState, DayLog, Movie, Person, WatchlistItem, ID } from './types'
import { emptyCircuitState } from './types'

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
}

export interface CircuitStore {
  init(adapter: CircuitAdapter): Promise<void>
  getState(): CircuitState
  subscribe(listener: () => void): () => void
  getHistoryState(): HistoryState
  undo(): Promise<void>
  redo(): Promise<void>
  savePerson(p: Person): Promise<void>
  deletePerson(id: ID): Promise<void>
  saveLog(log: DayLog): Promise<void>
  deleteLog(id: ID): Promise<void>
  saveMovie(m: Movie): Promise<void>
  deleteMovie(id: ID): Promise<void>
  saveWatchlist(w: WatchlistItem): Promise<void>
  deleteWatchlist(id: ID): Promise<void>
}

function upsert<T extends { id: ID }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.id === item.id)
  if (i === -1) return [...arr, item]
  const next = arr.slice()
  next[i] = item
  return next
}
const removeById = <T extends { id: ID }>(arr: T[], id: ID): T[] => arr.filter((x) => x.id !== id)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

// ---- command model for undo/redo ------------------------------------------
type Coll = 'people' | 'logs' | 'movies' | 'watchlist'
type Entity = Person | DayLog | Movie | WatchlistItem
type Op = { kind: 'save'; coll: Coll; item: Entity } | { kind: 'delete'; coll: Coll; id: ID }
interface HistEntry {
  do: Op
  undo: Op
}
const HISTORY_LIMIT = 30
const METHOD = {
  people: { save: 'savePerson', del: 'deletePerson' },
  logs: { save: 'saveLog', del: 'deleteLog' },
  movies: { save: 'saveMovie', del: 'deleteMovie' },
  watchlist: { save: 'saveWatchlist', del: 'deleteWatchlist' },
} as const

function applyOpToState(s: CircuitState, op: Op): CircuitState {
  const arr = s[op.coll] as Array<{ id: ID }>
  if (op.kind === 'save') return { ...s, [op.coll]: upsert(arr, op.item as { id: ID }) }
  return { ...s, [op.coll]: removeById(arr, op.id) }
}
function persistOp(a: CircuitAdapter, op: Op): Promise<void> {
  if (op.kind === 'save') {
    const fn = a[METHOD[op.coll].save] as (x: Entity) => Promise<void>
    return fn(op.item)
  }
  const fn = a[METHOD[op.coll].del] as (id: ID) => Promise<void>
  return fn(op.id)
}
/** The inverse command, computed against the state *before* op is applied. */
function inverseOf(s: CircuitState, op: Op): Op {
  const arr = s[op.coll] as Array<{ id: ID }>
  const id = op.kind === 'save' ? (op.item as { id: ID }).id : op.id
  const prev = arr.find((x) => x.id === id)
  if (prev) return { kind: 'save', coll: op.coll, item: clone(prev) as Entity }
  return { kind: 'delete', coll: op.coll, id }
}

export function createCircuitStore(): CircuitStore {
  let state: CircuitState = emptyCircuitState()
  let adapter: CircuitAdapter | null = null
  let unsub: (() => void) | null = null
  const listeners = new Set<() => void>()
  const undoStack: HistEntry[] = []
  const redoStack: HistEntry[] = []
  let histSnap: HistoryState = { canUndo: false, canRedo: false }

  const emit = () => listeners.forEach((l) => l())
  const refreshHist = () => {
    const cu = undoStack.length > 0
    const cr = redoStack.length > 0
    if (cu !== histSnap.canUndo || cr !== histSnap.canRedo) histSnap = { canUndo: cu, canRedo: cr }
  }
  const need = (): CircuitAdapter => {
    if (!adapter) throw new Error('circuit store not initialized')
    return adapter
  }
  const clearHistory = () => {
    undoStack.length = 0
    redoStack.length = 0
    refreshHist()
  }
  // Replace whole state (init / external realtime change): history no longer valid.
  const replaceState = (next: CircuitState) => {
    state = next
    clearHistory()
    emit()
  }
  const dispatch = (op: Op, record: boolean): Promise<void> => {
    const inv = inverseOf(state, op)
    state = applyOpToState(state, op)
    if (record) {
      undoStack.push({ do: op, undo: inv })
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
      redoStack.length = 0
    }
    refreshHist()
    emit()
    return persistOp(need(), op).catch((err) => {
      console.error('[circuit] persist failed', err)
    })
  }

  return {
    async init(a) {
      if (adapter === a) return
      if (unsub) {
        unsub()
        unsub = null
      }
      adapter = a
      replaceState(await a.load())
      unsub = a.subscribe((external) => replaceState(external))
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getHistoryState: () => histSnap,
    undo() {
      const entry = undoStack.pop()
      if (!entry) return Promise.resolve()
      state = applyOpToState(state, entry.undo)
      redoStack.push(entry)
      refreshHist()
      emit()
      return persistOp(need(), entry.undo).catch((err) => {
        console.error('[circuit] undo persist failed', err)
      })
    },
    redo() {
      const entry = redoStack.pop()
      if (!entry) return Promise.resolve()
      state = applyOpToState(state, entry.do)
      undoStack.push(entry)
      refreshHist()
      emit()
      return persistOp(need(), entry.do).catch((err) => {
        console.error('[circuit] redo persist failed', err)
      })
    },
    savePerson: (p) => dispatch({ kind: 'save', coll: 'people', item: p }, true),
    deletePerson: (id) => dispatch({ kind: 'delete', coll: 'people', id }, true),
    saveLog: (log) => dispatch({ kind: 'save', coll: 'logs', item: log }, true),
    deleteLog: (id) => dispatch({ kind: 'delete', coll: 'logs', id }, true),
    saveMovie: (m) => dispatch({ kind: 'save', coll: 'movies', item: m }, true),
    deleteMovie: (id) => dispatch({ kind: 'delete', coll: 'movies', id }, true),
    saveWatchlist: (w) => dispatch({ kind: 'save', coll: 'watchlist', item: w }, true),
    deleteWatchlist: (id) => dispatch({ kind: 'delete', coll: 'watchlist', id }, true),
  }
}

/** App-wide singleton. Call connectCircuit() (see connect.ts) to wire an adapter. */
export const circuitStore = createCircuitStore()

/** React hook: re-renders on any Circuit state change. */
export function useCircuit(): CircuitState {
  return useSyncExternalStore(circuitStore.subscribe, circuitStore.getState)
}

/** React hook: undo/redo availability. */
export function useCircuitHistory(): HistoryState {
  return useSyncExternalStore(circuitStore.subscribe, circuitStore.getHistoryState)
}
