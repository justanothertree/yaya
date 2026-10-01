import type { CSSProperties } from 'react'
import type { Swipe } from './strike'

/**
 * A swing's patch, pointed the way it was thrown.
 *
 * ⚠️ ONE COMPONENT FOR THE TELEGRAPH AND THE DEBUG BOX, because they must never disagree about
 * where a swing is — that disagreement is the whole bug this module keeps paying for. It is its
 * own file now so the paint room's test field can show a swing too: a THIRD copy of this
 * arithmetic was the obvious way to do that and would have been the same bug with a new room to
 * hide in.
 *
 * ⚠️ EVERYTHING IS SIZED IN SCREEN-HEIGHTS, which are isotropic in PIXELS: one screen-height
 * across and one down are the same number of pixels, because the field's width is its height
 * times the aspect and the width percentage divides that back out. That is what makes a CSS
 * rotate correct here — rotating a box whose two sides are measured in different units would
 * shear it, and a sheared hitbox is one that lies at every angle except the four it was built on.
 *
 * ⚠️ THE CALLER SAYS WHERE THE ORIGIN IS, rather than handing in a camera. Where a swing starts
 * on screen is each room's own business — the park has a camera panning over a world, the paint
 * room has a creature standing in a fixed spot — and the part that must not be written twice is
 * everything below it: the extent, the origin of the rotation, and the rotation itself.
 */
export function SwipePatch({
  swipe,
  at,
  aspect,
  className,
  style,
}: {
  swipe: Swipe
  /** where the swing comes from, as a fraction of the field, already mapped by the caller */
  at: { x: number; y: number }
  /** the field's width over its height, so a screen-height across is the same pixels as down */
  aspect: number
  className: string
  style?: CSSProperties
}) {
  const deg = (Math.atan2(swipe.aim.y, swipe.aim.x) * 180) / Math.PI
  const long = swipe.both ? swipe.reach * 2 : swipe.reach
  return (
    <span
      className={className}
      aria-hidden
      style={{
        left: `${at.x * 100}%`,
        top: `${at.y * 100}%`,
        width: `${(long / aspect) * 100}%`,
        height: `${swipe.half * 2 * 100}%`,
        transformOrigin: swipe.both ? '50% 50%' : '0 50%',
        transform: swipe.both
          ? `translate(-50%, -50%) rotate(${deg.toFixed(1)}deg)`
          : `translateY(-50%) rotate(${deg.toFixed(1)}deg)`,
        ...style,
      }}
    />
  )
}
