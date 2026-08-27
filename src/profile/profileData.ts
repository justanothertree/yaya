import type { PaletteSeed } from '../theme/customTheme'
import type { Tier } from '../sections/ProfileBlocks'

/**
 * One member's profile, exactly as get_member_profile returns it.
 *
 * Lives here rather than inside Profile.tsx so the DEV preview fixtures can be typed against
 * it. They used to be a bare Record<string, unknown>, which meant a fixture missing a field
 * the page reads typechecked fine and blew up in the browser instead.
 */
export type ProfileData = {
  username: string
  first_name: string | null
  member_since: string
  is_me: boolean
  friend_status: 'friends' | 'pending_out' | 'pending_in' | null
  shared_circuits: { name: string; people: string[] }[]
  movies_rated: number
  snake_best: { score: number; game_mode: string | null; achieved: string } | null
  /** the VIEWER's own best, so a profile can show you vs them without a second round trip */
  viewer_snake_best?: { score: number } | null
  activity_visibility: Tier
  /** the theme + flair this person actually uses on the site — see set_my_profile_look */
  look?: {
    theme: 'light' | 'dark' | 'alt' | null
    palette: PaletteSeed | null
    flair: string | null
    /** id of their animated backdrop, or null for none — see profile/backdrops.ts */
    backdrop?: string | null
  } | null
}
