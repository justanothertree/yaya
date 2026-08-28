/**
 * Whether you appear online, away, or not at all.
 *
 * ⚠️ INVISIBLE IS ENFORCED BY SILENCE, not by asking anyone to look away.
 *
 * That distinction is the whole security design here. The tempting version is to broadcast your
 * presence as usual with a flag saying "don't show me", and let other clients hide you — which is
 * not privacy, it is a request. Anyone reading the socket, or running a patched client, sees
 * straight through it, and the repo is public so writing that client is an afternoon's work.
 *
 * Here, invisible means the presence channel is never joined and `track()` is never called. There
 * is no packet to inspect, no field to ignore, and nothing on the server to leak. A watcher
 * subscribed to your topic sees exactly what they would see if your laptop were shut.
 *
 * ⚠️ PER DEVICE, and the UI says so. Presence on this site is peer-broadcast: each tab announces
 * itself, and there is no server-side session to switch off centrally. So this setting governs
 * THIS browser. Storing it per account would read as account-wide while another signed-in device
 * carried on broadcasting — a privacy control that lies about its own reach is worse than one
 * with an honest, narrow scope.
 */

export type MyStatus = 'online' | 'away' | 'invisible'
/** What others can ever observe. `invisible` is deliberately not in this union. */
export type SeenStatus = 'online' | 'away'

export const STATUS_OPTIONS: Array<[MyStatus, string, string]> = [
  ['online', '🟢', 'Online'],
  ['away', '🌙', 'Away'],
  ['invisible', '⚫', 'Invisible'],
]

const KEY = 'presence_status_v1'
const EVENT = 'yaya:presence-status'

/** No input for this long and you are shown as away, without having to remember to say so. */
const IDLE_MS = 5 * 60 * 1000

let chosen: MyStatus = 'online'
try {
  const saved = localStorage.getItem(KEY)
  if (saved === 'online' || saved === 'away' || saved === 'invisible') chosen = saved
} catch {
  /* private mode — online is the right default */
}

let idle = false

export function myStatus(): MyStatus {
  return chosen
}

export function setMyStatus(s: MyStatus) {
  chosen = s
  // choosing a status by hand is also a sign of life, so it clears the idle timer
  idle = false
  try {
    localStorage.setItem(KEY, s)
  } catch {
    /* applies for this visit */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

/**
 * What to actually broadcast — null meaning "broadcast nothing at all".
 *
 * ⚠️ Idle never overrides invisible. Going idle while invisible must not start announcing you as
 * away: that would turn walking away from the keyboard into an appearance.
 */
export function effectiveStatus(): SeenStatus | null {
  if (chosen === 'invisible') return null
  if (chosen === 'away') return 'away'
  return idle ? 'away' : 'online'
}

export function onStatusChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

/**
 * Watch for the keyboard and mouse going quiet.
 *
 * One listener set for the whole app rather than one per hook instance, and it only fires the
 * change event when the idle state actually FLIPS — a timer that republished on every mouse move
 * would have every presence channel re-tracking sixty times a second.
 */
export function startIdleWatch(): () => void {
  if (typeof window === 'undefined') return () => {}
  let timer = 0
  const goIdle = () => {
    if (idle) return
    idle = true
    window.dispatchEvent(new CustomEvent(EVENT))
  }
  const wake = () => {
    if (idle) {
      idle = false
      window.dispatchEvent(new CustomEvent(EVENT))
    }
    clearTimeout(timer)
    timer = window.setTimeout(goIdle, IDLE_MS)
  }
  const opts = { passive: true } as const
  window.addEventListener('pointerdown', wake, opts)
  window.addEventListener('pointermove', wake, opts)
  window.addEventListener('keydown', wake, opts)
  // a hidden tab is not "activity", but coming back to it is
  const onVis = () => {
    if (document.visibilityState === 'visible') wake()
  }
  document.addEventListener('visibilitychange', onVis)
  wake()
  return () => {
    clearTimeout(timer)
    window.removeEventListener('pointerdown', wake)
    window.removeEventListener('pointermove', wake)
    window.removeEventListener('keydown', wake)
    document.removeEventListener('visibilitychange', onVis)
  }
}
