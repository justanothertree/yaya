import type { VisibilityTier } from '../circuit/types'
import { TIER_LABEL, TIER_ORDER, TIER_HINTS, CIRCUIT_ALWAYS } from './visibilityLabels'

/**
 * "Who can see this?" — the one control for the visibility model.
 *
 * The tiers have short names in the database but those are not what anyone should have to
 * read. Each option says who, in plain words, and the line underneath says what that means
 * in practice for the thing you're setting. Wording lives in visibilityLabels.ts.
 *
 * Options wrap rather than scroll: a privacy option hidden off the edge of a phone is one
 * nobody knows exists.
 */
export function VisibilityPicker({
  value,
  onChange,
  kind = 'circuit',
  disabled = false,
  label = 'Who can see this?',
}: {
  value: VisibilityTier
  onChange: (v: VisibilityTier) => void
  /** which set of plain-language hints to show */
  kind?: 'circuit' | 'snake'
  disabled?: boolean
  label?: string
}) {
  return (
    <div className="vis-picker">
      <div className="vis-label">{label}</div>
      <div className="vis-opts" role="radiogroup" aria-label={label}>
        {TIER_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={value === t}
            disabled={disabled}
            className={'vis-opt' + (value === t ? ' is-on' : '')}
            onClick={() => onChange(t)}
          >
            {TIER_LABEL[t]}
          </button>
        ))}
      </div>
      <p className="vis-hint muted">{TIER_HINTS[kind][value]}</p>
      {kind === 'circuit' && <p className="vis-always muted">{CIRCUIT_ALWAYS}</p>}
    </div>
  )
}
