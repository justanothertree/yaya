/**
 * "Log this" as a request that outlives the Circuit component.
 *
 * The Board can float over any page now (pin it), so its "Log today" has to work when the
 * Circuit itself isn't mounted. It used to call straight into Circuit's setState, which
 * React silently drops once that component is gone — so on any other tab the button looked
 * alive and did nothing at all.
 *
 * The request goes to this module instead. Raise one from anywhere: if the Circuit is
 * listening it acts immediately, and if it isn't, the request waits while we take you to
 * where the log lives — the Circuit reads it as it mounts.
 */
import { todayISO } from './dates'

export type LogIntent = { personId: string; date: string; nonce: number }

let pending: LogIntent | null = null
const listeners = new Set<(i: LogIntent) => void>()

export function requestLog(personId: string, date: string) {
  const intent: LogIntent = { personId, date, nonce: Date.now() }
  if (listeners.size) {
    listeners.forEach((l) => l(intent))
    return
  }
  // nobody home: hold the request and go to the Circuit, which will pick it up on mount
  pending = intent
  if (typeof location !== 'undefined' && location.hash.split('?')[0] !== '#circuit') {
    location.hash = '#circuit'
  }
}

export const requestLogToday = (personId: string) => requestLog(personId, todayISO())

export function onLogIntent(cb: (i: LogIntent) => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** The request raised before the Circuit mounted, if any. Consumed once. */
export function takePendingLog(): LogIntent | null {
  const p = pending
  pending = null
  return p
}
