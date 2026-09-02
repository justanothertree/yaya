import { useSyncExternalStore } from 'react'

/**
 * Whether this is a device with no pointer to decorate.
 *
 * ⚠️ ONE DEFINITION, USED BY BOTH THE EFFECT AND ITS CONTROL. The mouse trail already refused to
 * install on a touchscreen — for a good reason, a trail under your own thumb is a smear — but the
 * picker for it carried on offering twelve styles that could not do anything, and the pointer
 * skins sat next to it offering a cursor to a device that has no cursor. A control that silently
 * does nothing reads as a broken feature rather than an inapplicable one, which is exactly how it
 * was reported. Sharing the query means the switch and the thing it switches can never disagree.
 *
 * ⚠️ Live, not read once. A tablet with a keyboard case attached gains a real pointer part-way
 * through a visit, and the note should stop being true at the same moment the effect starts
 * working.
 */
const QUERY = '(hover: none) and (pointer: coarse)'

export function touchOnly(): boolean {
  return !!window.matchMedia?.(QUERY).matches
}

export function onPointerKindChange(fn: () => void): () => void {
  const mq = window.matchMedia?.(QUERY)
  if (!mq) return () => {}
  mq.addEventListener('change', fn)
  return () => mq.removeEventListener('change', fn)
}

/** Server-side and in tests there is no matchMedia; a pointer is the safer assumption. */
export function useTouchOnly(): boolean {
  return useSyncExternalStore(onPointerKindChange, touchOnly, () => false)
}
