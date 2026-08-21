import { useEffect, useState } from 'react'
import { subscribeToast } from '../toast'

export function Toast() {
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const unsub = subscribeToast((m) => {
      clearTimeout(timer)
      setMsg(m)
      timer = setTimeout(() => setMsg(null), 2200)
    })
    return () => {
      unsub()
      clearTimeout(timer)
    }
  }, [])

  /**
   * ⚠️ The live region is ALWAYS mounted; only its contents change.
   *
   * This used to `return null` with no message, so the whole element appeared and disappeared.
   * Two problems: nothing carried aria-live at all, so "Logged", "Undone" and the rest were
   * never announced — a screen-reader user got no confirmation their action had worked — and
   * adding aria-live to an element that mounts at the same moment as its text is unreliable,
   * because assistive tech watches an EXISTING region for changes. A region that arrives
   * already-populated is often missed entirely.
   *
   * So the positioning wrapper stays in the DOM permanently and carries the announcement, and
   * the visible pill is what comes and goes inside it. `role="status"` implies polite +
   * atomic, which is right here: these are confirmations, not warnings, and should never
   * interrupt what is being read.
   */
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '2.5rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        pointerEvents: 'none',
      }}
    >
      {msg && (
        <div
          style={{
            background: 'var(--accent, #7c6af7)',
            color: '#fff',
            padding: '0.45rem 1.25rem',
            borderRadius: 24,
            fontWeight: 600,
            fontSize: '0.88rem',
            boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
            whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
          }}
        >
          {msg}
        </div>
      )}
    </div>
  )
}
