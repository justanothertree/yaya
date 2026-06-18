// Number input you can drag (mouse) or scroll to scrub, and still type into normally.
// Touch keeps the native numeric keyboard — drag is mouse-only so it never hijacks scroll.
import { useRef, useState } from 'react'

export function ScrubInput({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  style,
  placeholder = '0',
}: {
  value: string
  onChange: (v: string) => void
  step?: number
  min?: number
  max?: number
  style?: React.CSSProperties
  placeholder?: string
}) {
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ startY: number; startVal: number; moved: boolean } | null>(null)

  const clamp = (n: number) => {
    let v = n
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    // keep clean decimals for fractional steps
    return Math.round(v * 1000) / 1000
  }
  const bump = (dir: number) => {
    const cur = parseFloat(value) || 0
    onChange(String(clamp(cur + dir * step)))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    drag.current = { startY: e.clientY, startVal: parseFloat(value) || 0, moved: false }
    const onMove = (ev: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const dy = d.startY - ev.clientY
      if (Math.abs(dy) < 3 && !d.moved) return
      if (!d.moved) {
        d.moved = true
        setDragging(true)
        document.body.style.cursor = 'ns-resize'
        document.body.style.userSelect = 'none'
      }
      ev.preventDefault()
      const steps = Math.round(dy / 4) // ~4px per step
      onChange(String(clamp(d.startVal + steps * step)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDragging(false)
      drag.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    // only when the field is focused or hovered-with-intent; require it to be the active scrub
    if (document.activeElement !== e.currentTarget) return
    e.preventDefault()
    bump(e.deltaY < 0 ? 1 : -1)
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      title="Drag up/down or scroll to adjust"
      style={{
        cursor: dragging ? 'ns-resize' : 'ns-resize',
        touchAction: 'manipulation',
        ...style,
      }}
    />
  )
}
