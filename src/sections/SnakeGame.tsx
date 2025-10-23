import { useEffect } from 'react'
import { GameManager } from '../game/manager'

export function SnakeGame(props: { onControlChange?: (v: boolean) => void; autoFocus?: boolean }) {
  const { onControlChange } = props
  // If not auto-focusing the game, signal that the page retains control.
  useEffect(() => {
    if (!props.autoFocus) {
      onControlChange?.(false)
      return () => onControlChange?.(false)
    }
    return
  }, [onControlChange, props.autoFocus])
  // Keep the same component name for compatibility with the rest of the app
  return (
    <section className="snake-wrap">
      <GameManager autoFocus={props.autoFocus} onControlChange={onControlChange} />
      <p className="muted" style={{ marginTop: '0.75rem' }}>
        Click or tap the canvas to capture controls. Use Arrow keys or WASD to move; Space to
        pause/play; swipe on the canvas to control on touch devices. Adjust apples and edge behavior
        in the toolbar.
      </p>
    </section>
  )
}
