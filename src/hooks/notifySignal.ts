/**
 * "Something the bell counts just changed."
 *
 * The bell used to refresh only on `hashchange`, plus a realtime hook for incoming
 * messages. That misses the two ways its counts actually go stale:
 *
 *  - tapping a conversation row calls mark_room_read and sets React state, but never
 *    touches the hash, so no hashchange fires and the badge keeps its old count
 *  - clicking a bell entry whose href equals the current hash is a no-op navigation,
 *    so the same thing happens — most visibly when you are already on the chat page
 *
 * A window event rather than a prop chain because the emitters (Chat, People) and the
 * listener (the nav's bell) sit on opposite sides of the tree, and Chat is lazy-loaded.
 * Same shape as the existing `yaya:*` events.
 */
const EVT = 'yaya:notifications-stale'

/** call after an action that should change what the bell shows, once it has persisted */
export function notificationsChanged() {
  window.dispatchEvent(new Event(EVT))
}

/** subscribe; returns the unsubscriber, so it drops straight into a useEffect */
export function onNotificationsChanged(fn: () => void): () => void {
  window.addEventListener(EVT, fn)
  return () => window.removeEventListener(EVT, fn)
}
