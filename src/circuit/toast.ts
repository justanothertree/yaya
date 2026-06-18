type Listener = (msg: string) => void
const _listeners = new Set<Listener>()

export function showToast(msg: string) {
  _listeners.forEach((fn) => fn(msg))
}

export function subscribeToast(fn: Listener): () => void {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}
