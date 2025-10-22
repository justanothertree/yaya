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
        Use arrow keys to move, Space to restart. Adjust settings above for canvas size, apples, and
        edge behavior.
      </p>
    </section>
  )
}
