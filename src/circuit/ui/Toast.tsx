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

  if (!msg) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '2.5rem',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--accent, #7c6af7)',
        color: '#fff',
        padding: '0.45rem 1.25rem',
        borderRadius: 24,
        fontWeight: 600,
        fontSize: '0.88rem',
        zIndex: 2000,
        pointerEvents: 'none',
        boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
        whiteSpace: 'nowrap',
        letterSpacing: '0.01em',
      }}
    >
      {msg}
    </div>
  )
}
