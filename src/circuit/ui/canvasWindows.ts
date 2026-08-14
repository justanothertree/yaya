import { useSyncExternalStore } from 'react'

/**
 * A tiny registry so the window launcher can offer windows it does not own.
 *
 * The Circuit builds its own panes — the board, the log, the feed and so on — deep inside its
 * own component, and renders them on its own canvas. The launcher lives at the app root, which
 * means it has no way to see them, and they were the one set of windows you could NOT filter:
 * all six appeared on the canvas whether or not you wanted them there.
 *
 * Rather than lift the Circuit's pane construction up to the root (which would drag its data
 * loading, its group state and its sub-tab routing with it), the Circuit publishes just the
 * NAMES of its windows here, and reads back which of them the user has hidden. Two small facts
 * cross the boundary instead of a whole subtree.
 */

export type RegisteredWindow = { id: string; title: string }

const HIDDEN_KEY = 'canvas_hidden_v1'

let registered: RegisteredWindow[] = []
let hidden: string[] = load()
const listeners = new Set<() => void>()

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function emit() {
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Publish the windows a surface owns. Called during render, so it bails out when nothing has
 * changed — notifying listeners unconditionally here would re-render the launcher on every
 * Circuit render, and the launcher's re-render would feed straight back.
 */
export function registerWindows(list: RegisteredWindow[]) {
  const same =
    list.length === registered.length &&
    list.every((w, i) => registered[i]?.id === w.id && registered[i]?.title === w.title)
  if (same) return
  registered = list
  emit()
}

export function useRegisteredWindows(): RegisteredWindow[] {
  return useSyncExternalStore(
    subscribe,
    () => registered,
    () => registered,
  )
}

export function useHiddenWindows(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => hidden,
    () => hidden,
  )
}

/** Hide or show one of the registered windows. */
export function toggleHidden(id: string) {
  hidden = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden))
  } catch {
    /* ignore */
  }
  emit()
}

export function isRegistered(id: string) {
  return registered.some((w) => w.id === id)
}
