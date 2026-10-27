import { useCallback, useEffect, useRef } from 'react'
import { holdDelay } from './hold'

/**
 * A button that fires once when pressed and keeps firing, faster, while it is held.
 *
 * ⚠️ POINTER EVENTS AND NOT MOUSE OR TOUCH, so one implementation covers a finger, a mouse and a
 * stylus. `setPointerCapture` is the part that is easy to leave out and expensive to leave out:
 * without it, sliding a thumb a few pixels off a small button sends `pointerup` somewhere else
 * and the repeat never stops — a minute button that runs away after you have let go.
 *
 * ⚠️ AND IT CLEARS ITS TIMER ON UNMOUNT. These sit inside a modal that can be closed mid-press
 * (the ⨯, Escape, or Save while a finger is down), and a surviving timer would go on calling
 * `onStep` into a component that is gone.
 *
 * ⚠️ `touch-action: manipulation` AND `user-select: none` ARE NOT COSMETIC. A long press on a
 * phone otherwise starts a text selection or pops the context menu over the thing being held,
 * and double-tapping a +1 twice quickly gets treated as a zoom gesture.
 */
export function HoldButton({
  onStep,
  label,
  className,
  disabled,
  children,
}: {
  /** called once on press, then repeatedly while held */
  onStep: () => void
  /** what a screen reader says — these are glyphs, so there is nothing to read otherwise */
  label: string
  className?: string
  disabled?: boolean
  children: React.ReactNode
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(0)
  /* the newest onStep, so a repeat always steps from the CURRENT value rather than from whatever
     was captured when the press began — the bug would be a hold that ramps and then overwrites
     its own earlier steps */
  const step = useRef(onStep)
  step.current = onStep

  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    fired.current = 0
  }, [])

  useEffect(() => stop, [stop])

  const start = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return
    stop()
    /**
     * ⚠️ THE STEP HAPPENS BEFORE THE CAPTURE, AND THE CAPTURE CANNOT STOP IT. This was the other
     * way round, and `setPointerCapture` THROWS `InvalidPointerId` for a pointer the browser does
     * not consider active — so one throw took the whole handler down with it and the button did
     * nothing at all. Measured in the pane: a held press moved nine minutes and a tap moved
     * ZERO, which reads as a broken control rather than as a capture that failed.
     *
     * Capture is an enhancement — it is what stops a repeat running away when a thumb slides off
     * a small button. The step is the entire point of pressing. So the point goes first and the
     * enhancement is allowed to fail.
     */
    step.current()
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      /* no capture: a pointer that leaves the button simply keeps repeating until it is released,
         which is the behaviour before capture existed and is not dangerous */
    }
    const again = () => {
      step.current()
      fired.current++
      timer.current = setTimeout(again, holdDelay(fired.current))
    }
    timer.current = setTimeout(again, holdDelay(0))
  }

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      /* ⚠️ KEYBOARD GETS ONE STEP PER PRESS, DELIBERATELY. Holding a key fires `keydown` on the
         OS's own repeat schedule, which would race this timer and produce two overlapping ramps.
         One step per press is slower and always says what it did. */
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          step.current()
        }
      }}
      style={{ touchAction: 'manipulation', userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      {children}
    </button>
  )
}
