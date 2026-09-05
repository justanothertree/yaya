// Tiny external store for The Circuit. React subscribes via useSyncExternalStore;
// mutations update local state optimistically, then persist through whatever adapter
// was supplied to init() — localStorage when signed out, Supabase + realtime when in.
//
// Every mutation is a reversible command (save/delete on one collection), so the
// store keeps a 30-step undo/redo history. Signing in or out resets it; a realtime
// change from somebody else does not — see adoptState for why.
import { useSyncExternalStore } from 'react'
import type { CircuitAdapter } from './adapter'
import { showToast } from './toast'
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
/** collection + row, the identity a replayed op is keyed by */
function opKey(op: Op): string {
  return `${op.coll}:${op.kind === 'save' ? (op.item as { id: ID }).id : op.id}`
}

/** The inverse command, computed against the state *before* op is applied. */
function inverseOf(s: CircuitState, op: Op): Op {
  const arr = s[op.coll] as Array<{ id: ID }>
  const id = op.kind === 'save' ? (op.item as { id: ID }).id : op.id
  const prev = arr.find((x) => x.id === id)
  if (prev) return { kind: 'save', coll: op.coll, item: clone(prev) as Entity }
  return { kind: 'delete', coll: op.coll, id }
}

function createCircuitStore(): CircuitStore {
  let state: CircuitState = emptyCircuitState()
  let adapter: CircuitAdapter | null = null
  let unsub: (() => void) | null = null
  const listeners = new Set<() => void>()
  const undoStack: HistEntry[] = []
  const redoStack: HistEntry[] = []
  let histSnap: HistoryState = { canUndo: false, canRedo: false }
  /**
   * Our own recent writes, replayed on top of any snapshot that arrives while they might still
   * be in flight.
   *
   * ⚠️ THIS REPLACED A 2.5-SECOND DEAF WINDOW, and the window had a hole in it. Realtime hands
   * us a whole fresh board on any change — including the echo of our own write — and applying
   * one mid-edit reverted the optimistic change we had just painted. The fix was to ignore
   * incoming boards for 2.5s after any local write and reconcile once things went quiet. But
   * "quiet" was measured from OUR writing, and the reconcile was scheduled once rather than
   * rescheduled: keep adding things for ten seconds and a friend's change that arrived in the
   * middle was not deferred, it was DROPPED, until the next unrelated event happened to bring
   * it in. Two people adding options at the same time is the one moment the pool exists for,
   * and it was the one moment each of them went blind to the other.
   *
   * Replaying is both simpler and more correct than deferring. A save we have not confirmed is
   * re-applied over the snapshot; a delete is re-removed. If the snapshot already contains our
   * write the replay changes nothing, and if it was queried before our write committed — the
   * real race, and the reason this outlives the promise resolving — it stops the row flickering
   * out and back. After a few seconds the server is simply right and we stop arguing with it.
   */
  const recent = new Map<string, { op: Op; at: number }>()
  const RECENT_MS = 4000

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
  /**
   * ⚠️ A WRITE THAT FAILED USED TO LOOK EXACTLY LIKE ONE THAT WORKED.
   *
   * State is applied optimistically and was never rolled back, the rejection went to the
   * console, and the promise resolved successfully — so a member logging their day offline,
   * or after their token expired, saw the entry appear, the undo stack advance, and no
   * error. It was gone on the next reload with nothing to explain it.
   *
   * Same shape as the mark_activity_seen bug already fixed in useNotifications ("do not let
   * the bell claim it cleared"). Reloading discards the edit, which is the point: what is on
   * screen should be what actually exists. Saying so is the part that was missing.
   */
  const persistFailed = (what: string, err: unknown) => {
    console.error(`[circuit] ${what} failed`, err)
    showToast('Not saved — check your connection')
    const a = adapter
    if (a)
      void a
        .load()
        .then(replaceState)
        .catch(() => undefined)
  }
  const clearHistory = () => {
    undoStack.length = 0
    redoStack.length = 0
    refreshHist()
  }
  /** A different board entirely — a sign-in, a sign-out, or a write we had to take back. */
  const replaceState = (next: CircuitState) => {
    state = next
    clearHistory()
    emit()
  }
  /**
   * A newer version of the SAME board, from realtime. Undo survives it.
   *
   * ⚠️ THIS USED TO CLEAR THE HISTORY, on the reasoning that the base had shifted underneath us.
   * That was safe only while realtime was being ignored for 2.5s after every local write: once
   * boards land promptly, YOUR OWN WRITE ECHOES BACK as a change like any other, so clearing
   * here would empty the undo stack a moment after every single edit — undo would be permanently
   * greyed out on a board with more than one person on it, and nobody would ever learn why.
   *
   * Keeping it is coherent rather than merely convenient. Each entry is a whole-row save of what
   * that row looked like before, so applying it to a newer board restores that row and touches
   * nothing else. Where it collides with somebody else's edit to the same row, the loser is the
   * earlier write — which is the rule this whole store already runs on (see the same argument in
   * party/transport.ts). A stale undo is survivable; an undo button that quietly stops working
   * is not.
   */
  const adoptState = (next: CircuitState) => {
    state = next
    emit()
  }
  /** An incoming board, with our own too-recent writes put back on top. See `recent`. */
  const withRecent = (next: CircuitState): CircuitState => {
    const now = Date.now()
    let out = next
    // insertion order, so several edits to the same board replay in the order they were made
    for (const [key, entry] of recent) {
      if (now - entry.at > RECENT_MS) {
        recent.delete(key)
        continue
      }
      out = applyOpToState(out, entry.op)
    }
    return out
  }
  /**
   * Apply an op locally, remember it briefly, and persist it.
   *
   * ⚠️ A FAILED WRITE IS FORGOTTEN IMMEDIATELY, before persistFailed reloads. Replaying it over
   * the board we are about to fetch would paint the edit back on — the precise illusion that
   * reload exists to dispel.
   */
  const runOp = (op: Op, what: string): Promise<void> => {
    const key = opKey(op)
    recent.set(key, { op, at: Date.now() })
    return persistOp(need(), op).catch((err) => {
      recent.delete(key)
      persistFailed(what, err)
    })
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
    return runOp(op, 'save')
  }

  return {
    async init(a) {
      if (adapter === a) return
      if (unsub) {
        unsub()
        unsub = null
      }
      adapter = a
      recent.clear()
      replaceState(await a.load())
      // Every board from elsewhere lands straight away — including the echo of our own write,
      // which is why `recent` exists to put the last few seconds of our edits back on top.
      unsub = a.subscribe((external) => adoptState(withRecent(external)))
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
      return runOp(entry.undo, 'undo')
    },
    redo() {
      const entry = redoStack.pop()
      if (!entry) return Promise.resolve()
      state = applyOpToState(state, entry.do)
      undoStack.push(entry)
      refreshHist()
      emit()
      return runOp(entry.do, 'redo')
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
