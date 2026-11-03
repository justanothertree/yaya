import type { VisibilityTier } from '../circuit/types'
import {
  TIER_LABEL,
  TIER_HINTS,
  CIRCUIT_ALWAYS,
  offeredTiers,
  isOverCeiling,
  type HintKind,
} from './visibilityLabels'
import { useMyCeiling } from './useMyCeiling'
import { CertainChooser, CertainForItem } from './CertainChooser'

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
 *
 * ⚠️ AND PICKING `certain` IS HALF A DECISION, so the chooser comes with it rather than hiding
 * behind a second control. A tier that says "certain friends" and does not ask which is a
 * setting whose audience is nobody — the list is the level, and an item at `certain` with an
 * empty list reaches only its owner. Callers that have nowhere to put a list pass
 * `omit={['certain']}` instead of offering a choice they cannot honour; a snake handle is the
 * one such surface today, because its setter moves every handle at once.
 */
export function VisibilityPicker({
  value,
  onChange,
  kind = 'circuit',
  disabled = false,
  label = 'Who can see this?',
  omit,
  certain,
  onCertainChange,
  certainItem,
}: {
  value: VisibilityTier
  onChange: (v: VisibilityTier) => void
  /** which set of plain-language hints to show */
  kind?: HintKind
  disabled?: boolean
  label?: string
  /** levels this surface cannot store at all — see offeredTiers */
  omit?: VisibilityTier[]
  /**
   * Usernames on this item's Certain list, for a caller that owns the saving — a profile block,
   * whose list rides along in the page save because a block has no id the client ever holds.
   * Both this and `onCertainChange` are required for the chooser to appear.
   */
  certain?: string[]
  onCertainChange?: (next: string[]) => void
  /**
   * The alternative: an item with a stable id, where the chooser loads and saves itself through
   * `visibility_certain_get` / `visibility_certain_set`. One of the two, never both — and the
   * caller-owned pair wins if somebody passes both, because a component that saves behind a
   * caller's back is the worse surprise.
   */
  certainItem?: { kind: string; id: string }
}) {
  const { tier: ceiling, failed } = useMyCeiling()
  const offered = offeredTiers(ceiling, value, omit)
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
      {/**
       * ⚠️ RENDERED ONLY AT `certain`, AND ONLY WHEN THE CALLER CAN SAVE IT. A chooser shown at
       * `friends` would read as a narrowing nobody asked for, and one shown without
       * `onCertainChange` would take input and drop it — which is worse than not being there.
       */}
      {value === 'certain' &&
        (certain && onCertainChange ? (
          <CertainChooser value={certain} onChange={onCertainChange} disabled={disabled} />
        ) : certainItem ? (
          <CertainForItem kind={certainItem.kind} id={certainItem.id} disabled={disabled} />
        ) : null)}
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
