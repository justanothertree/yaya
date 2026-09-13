// Is the visualiser floating above the page right now, and where.
//
// ⚠️ A STORE RATHER THAN STATE IN App, because three unrelated places need the answer and none of
// them are children of the thing that owns it: App renders the window, the Visualiser page hides
// its inline copy while it is up, and the instrument room stands its embedded one down. Passing a
// boolean down three trees to say "somebody else is already showing this" is how you end up with
// two of them running and nobody sure which is which.
//
// ⚠️ AND IT IS NOT CANVAS MODE. The canvas turns the whole page into windows, which is a mode you
// enter; this is one panel over the page you are already on, which is a thing you open. They
// answer different wants and the canvas is not a smaller version of this one.
import { useSyncExternalStore } from 'react'

const KEY = 'viz_float_v1'

export type VizFloatState = {
  open: boolean
  /** viewport pixels from the left/top; clamped on read so a saved spot can never strand it */
  x: number
  y: number
  w: number
  h: number
}

export const MIN_W = 260
export const MIN_H = 200

const DEFAULTS: VizFloatState = { open: false, x: -1, y: -1, w: 420, h: 340 }

let state: VizFloatState = read()
const subs = new Set<() => void>()

function read(): VizFloatState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const v = JSON.parse(raw) as Partial<VizFloatState>
    const num = (n: unknown, fb: number) => (typeof n === 'number' && Number.isFinite(n) ? n : fb)
    return {
      /* ⚠️ Never restored as open. A floating panel that reappears over whatever page you land on
         next visit is something you have to dismiss before you can read anything, and nobody
         asked for it on this visit. The SIZE and PLACE are worth remembering; the state is not. */
      open: false,
      x: num(v.x, DEFAULTS.x),
      y: num(v.y, DEFAULTS.y),
      w: Math.max(MIN_W, num(v.w, DEFAULTS.w)),
      h: Math.max(MIN_H, num(v.h, DEFAULTS.h)),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ x: state.x, y: state.y, w: state.w, h: state.h }))
  } catch {
    /* private window */
  }
}

function emit() {
  for (const fn of [...subs]) fn()
}

export const vizFloat = {
  subscribe(fn: () => void) {
    subs.add(fn)
    return () => {
      subs.delete(fn)
    }
  },
  get: () => state,
  open() {
    if (state.open) return
    state = { ...state, open: true }
    emit()
  },
  close() {
    if (!state.open) return
    state = { ...state, open: false }
    emit()
  },
  toggle() {
    if (state.open) this.close()
    else this.open()
  },
  /** while dragging or resizing — persisted, but only once the gesture ends */
  place(at: Partial<Pick<VizFloatState, 'x' | 'y' | 'w' | 'h'>>) {
    state = { ...state, ...at }
    emit()
  },
  settle() {
    save()
  },
}

export function useVizFloat(): VizFloatState {
  return useSyncExternalStore(vizFloat.subscribe, vizFloat.get, vizFloat.get)
}

/** true when the visualiser is already being shown somewhere that floats over the page */
export function useVizFloating(): boolean {
  return useVizFloat().open
}
