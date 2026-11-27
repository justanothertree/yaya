import { hueFor } from '../../party/party'
import { cursorMark, type CursorSkin } from '../../ui/cursorSkin'
import { hslToHex } from '../../theme/customTheme'
import type { Place } from './tour'

/**
 * Somebody's token: their colour (hueFor — the colour of their cursor, their ring on the nav and
 * their dot on the picker), their initial, and their cursor's shape in the corner, exactly as
 * PartyCursors draws it. Filled when they are with you, tinted when they are elsewhere, dashed
 * when they are saying nothing; you are a hollow ring. Talking is a ring AND a word in the chip,
 * never colour alone, and it does not move — there is nothing for reduced motion to flatten.
 *
 * Its own module so the tour strip's chips and the party tour's scoreboard (BusPanel.tsx) draw
 * one token, without either importing the other.
 */
export function Token({
  id,
  name,
  skin,
  place,
  speaking,
  me = false,
}: {
  id: string
  name: string
  skin?: CursorSkin
  place: Place
  speaking: boolean
  me?: boolean
}) {
  const h = hueFor(id)
  const mark = skin ? cursorMark(skin, hslToHex({ h, s: 0.85, l: 0.58 })) : null
  const state = me ? 'me' : place.at === 'with' ? 'with' : place.at === 'quiet' ? 'quiet' : 'away'
  return (
    <span
      className={`lab-tour-token is-${state}${speaking ? ' is-talking' : ''}`}
      style={{ ['--h' as string]: h }}
      aria-hidden
    >
      {!me && (name.trim().charAt(0).toUpperCase() || '?')}
      {mark && <img className="lab-tour-skin" src={mark} alt="" width={12} height={12} />}
    </span>
  )
}
