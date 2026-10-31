import type { VisibilityTier } from '../circuit/types'
import {
  TIER_LABEL,
  TIER_HINTS,
  CIRCUIT_ALWAYS,
  offeredTiers,
  isOverCeiling,
} from './visibilityLabels'
import { useMyCeiling } from './useMyCeiling'

/**
 * "Who can see this?" — the one control for the visibility model.
 *
 * The tiers have short names in the database but those are not what anyone should have to
 * read. Each option says who, in plain words, and the line underneath says what that means
 * in practice for the thing you're setting. Wording lives in visibilityLabels.ts.
 *
 * Options wrap rather than scroll: a privacy option hidden off the edge of a phone is one
 * nobody knows exists.
 *
 * ⚠️ IT OFFERS ONLY WHAT THE ACCOUNT CAN ACTUALLY CHOOSE. Every setter clamps a tier above the
 * account's ceiling and says nothing, which is deliberate — refusing would make the profile
 * editor's own default unsaveable for a new member whose age band is still unknown. The cost of
 * that silence is paid here: a control that never offers an unreachable level never has to
 * narrow one. See useMyCeiling.ts.
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
  const { tier: ceiling, failed } = useMyCeiling()
  const offered = offeredTiers(ceiling, value)
  const overCeiling = isOverCeiling(ceiling, value)
  /** Not known yet is not "no limit": hold still rather than offer a level we may take away. */
  const waiting = ceiling === undefined

  return (
    <div className="vis-picker">
      <div className="vis-label">{label}</div>
      <div className="vis-opts" role="radiogroup" aria-label={label}>
        {offered.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={value === t}
            disabled={disabled || waiting}
            className={'vis-opt' + (value === t ? ' is-on' : '')}
            onClick={() => onChange(t)}
          >
            {TIER_LABEL[t]}
          </button>
        ))}
      </div>
      <p className="vis-hint muted">{TIER_HINTS[kind][value]}</p>
      {failed && (
        <p className="vis-hint muted" role="status">
          Couldn’t check which levels this account can use, so nothing can be changed here right
          now. Reload the page to try again.
        </p>
      )}
      {overCeiling && ceiling && (
        <p className="vis-hint muted">
          This account shares with {TIER_LABEL[ceiling].toLowerCase()} at most, so that is who sees
          it now. Changing this setting will save the narrower choice.
        </p>
      )}
      {kind === 'circuit' && <p className="vis-always muted">{CIRCUIT_ALWAYS}</p>}
    </div>
  )
}
