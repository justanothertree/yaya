import { getSupabaseClient } from '../finance/client'
import { forgetPicture } from '../pictures/seen'

/**
 * Hanging a photograph on a rating or on a day's workout.
 *
 * ⚠️ THROUGH AN RPC AND NEVER THROUGH THE TABLE, even though the table would accept it. Both of
 * these rows are directly writable by their owner under RLS, so `sb.from('circuit_ratings')
 * .update({ picture })` would work — and would skip the half of the rule that matters: that the
 * PICTURE is yours too. member_pictures is deny-all, so nothing else is checking. See
 * docs/2026-10-26-pictures-on-ratings-and-workouts.sql for what that permits if you let it.
 *
 * ⚠️ AND THE CACHE IS TOLD, because `seen.ts` remembers a miss as well as a hit. Attaching a
 * picture to a row whose id was asked for a moment ago — the usual case, since you are looking at
 * the thing you are attaching to — would otherwise draw nothing until the entry went stale.
 */
const sayWhy = (e: { message?: string } | null, fallback: string) =>
  e ? { why: e.message || fallback } : null

export async function setRatingPicture(
  movieId: string,
  picture: string | null,
): Promise<{ why: string } | null> {
  const { error } = await getSupabaseClient().rpc('circuit_rating_picture', {
    p_movie: movieId,
    p_picture: picture,
  })
  if (!error) forgetPicture(picture)
  return sayWhy(error, 'that picture did not stick')
}

export async function setLogPicture(
  logId: string,
  picture: string | null,
): Promise<{ why: string } | null> {
  const { error } = await getSupabaseClient().rpc('circuit_log_picture', {
    p_log: logId,
    p_picture: picture,
  })
  if (!error) forgetPicture(picture)
  return sayWhy(error, 'that picture did not stick')
}
