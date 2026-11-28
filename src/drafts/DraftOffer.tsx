import type { Draft } from './drafts'
import { whenKept } from './drafts'

/**
 * "Your unsaved hole · from 1:50 PM — Bring it back / Start fresh": the one way a builder asks.
 *
 * ⚠️ START FRESH ASKS FIRST, because it is the only thing on this card that cannot be undone — a
 * draft thrown away is gone, where one brought back is an edit like any other.
 */
export function DraftOffer<T>({
  draft,
  what,
  onBringBack,
  onStartFresh,
  className = '',
}: {
  draft: Draft<T>
  /** the noun: "hole", "pattern", "map" */
  what: string
  onBringBack: () => void
  onStartFresh: () => void
  className?: string
}) {
  return (
    <div className={`draft-offer ${className}`.trim()} role="group" aria-label={`Unsaved ${what}`}>
      <strong>Your unsaved {what}</strong>
      <span className="muted">from {whenKept(draft.at)}</span>
      <span className="draft-offer-do">
        <button className="btn" onClick={onBringBack}>
          Bring it back
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (window.confirm(`Throw away the unsaved ${what}? It cannot be brought back.`))
              onStartFresh()
          }}
        >
          Start fresh
        </button>
      </span>
    </div>
  )
}
