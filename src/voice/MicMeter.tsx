import { useEffect, useRef } from 'react'

/**
 * Live mic loudness with the gate threshold marked on it.
 *
 * A threshold slider without a meter is unusable — you'd be guessing at a number with no
 * way to tell whether your voice clears it. Speak, watch where the bar reaches, put the
 * marker just under that.
 *
 * Reads the level by polling rather than from React state: it changes every frame, and
 * pushing that through state would re-render the app sixty times a second. The DOM is
 * written directly here, which is the one place that's the right call.
 */
export function MicMeter({
  getLevel,
  isOpen,
  threshold,
}: {
  getLevel: () => number
  isOpen: () => boolean
  threshold: number
}) {
  const fill = useRef<HTMLSpanElement>(null)
  const wrap = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const el = fill.current
      if (el) {
        el.style.width = `${Math.round(getLevel() * 100)}%`
        // green while transmitting, grey while the gate is holding you shut
        el.dataset.open = isOpen() ? '1' : '0'
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getLevel, isOpen])

  return (
    <span className="mic-meter" ref={wrap} aria-hidden>
      <span className="mic-meter-fill" ref={fill} data-open="1" />
      {threshold > 0 && (
        <span className="mic-meter-mark" style={{ left: `${Math.round(threshold * 100)}%` }} />
      )}
    </span>
  )
}
