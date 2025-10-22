import { useRef } from 'react'

export function Joystick({
  paused,
  onDirection,
  onActivate,
}: {
  paused: boolean
  onDirection: (x: -1 | 0 | 1, y: -1 | 0 | 1) => void
  onActivate?: () => void
}) {
  const originRef = useRef<{ x: number; y: number } | null>(null)
  const activeRef = useRef(false)

  return (
    <div
      className="snake-joystick"
      onPointerDown={(e) => {
        onActivate?.()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        originRef.current = { x: e.clientX, y: e.clientY }
        activeRef.current = true
      }}
      onPointerMove={(e) => {
        if (!activeRef.current || !originRef.current) return
        const dx = e.clientX - originRef.current.x
        const dy = e.clientY - originRef.current.y
        const dead = 10
        const max = 36
        const nx = Math.max(-1, Math.min(1, dx / max))
        const ny = Math.max(-1, Math.min(1, dy / max))
        const knob = e.currentTarget.querySelector('.knob') as HTMLDivElement | null
        const kx = Math.round(nx * 24)
        const ky = Math.round(ny * 24)
        if (knob) knob.style.transform = `translate(${kx}px, ${ky}px)`
        if (paused) return
        const dist = Math.hypot(dx, dy)
        if (dist > dead) {
          const angle = Math.atan2(ny, nx)
          const pi = Math.PI
          if (angle > -pi * 0.25 && angle <= pi * 0.25) onDirection(1, 0)
          else if (angle > pi * 0.25 && angle <= pi * 0.75) onDirection(0, 1)
          else if (angle > -pi * 0.75 && angle <= -pi * 0.25) onDirection(0, -1)
          else onDirection(-1, 0)
        }
      }}
      onPointerUp={(e) => {
        activeRef.current = false
        const knob = e.currentTarget.querySelector('.knob') as HTMLDivElement | null
        if (knob) knob.style.transform = 'translate(0px, 0px)'
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* noop */
        }
      }}
    >
      <div className="ring" />
      <div className="knob" />
    </div>
  )
}
