import { getSupabaseClient } from '../finance/client'
import { packMapDoc } from './maps'
import { readMapDoc, type MapDoc } from './mapDoc'

/**
 * Publishing a map, and walking into somebody else's.
 *
 * ⚠️ THE MAP IS NOT ON THE WIRE, AND THAT IS THE WHOLE DESIGN. The relay refuses anything over
 * 12,000 characters; a map is capped at 200KB, which is about seventeen times that. A palette of
 * up to twenty-four drawings, the pieces, a ground drawing and a 23,040-cell no-walk grid is not
 * a message, it is a document. So it lives in Postgres, the room carries a REFERENCE, and every
 * client fetches the same bytes by id before standing on them — see
 * docs/2026-10-08-hosted-park-maps.sql.
 *
 * ⚠️ AND IT IS THE SAME BYTES THE STORE KEEPS. `packMapDoc` is the packer the local store writes
 * with, exported rather than copied: a second packer here would drift the moment either grew a
 * key, and the thing that drifts is somebody's map.
 *
 * ⚠️ PUBLISHING IS OPT-IN AND SEPARATE FROM KEEPING. A map you made is yours and local; a map you
 * published is a copy other people can fetch. Nothing syncs on its own — the one thing worse than
 * a map that is not shared is a map that is shared without being asked.
 */

/** who may walk in. 'public' is not offered — a park is for members, and the relay has no
    anonymous door. See open_park_room, which refuses rather than clamps. */
export type ParkAudience = 'friends' | 'members' | 'private'

export type PublishedMap = { id: string; name: string; bytes: number; updated_at: string }
export type OpenPark = { host: string; map_name: string; audience: string; open_since: string }
export type FoundPark = {
  room_id: string
  map_name: string
  audience: string
  is_owner: boolean
  open_since: string | null
}

/**
 * ⚠️ A REFUSAL IS A SENTENCE, NOT A CRASH. Every call here can fail for reasons a person caused
 * and can act on — four maps already, not signed in, publish it first — and the server says so in
 * words. Swallowing that into `false` would make the room invent its own worse sentence, and
 * throwing would take the editor down over a button.
 */
export type Said = { ok: true } | { ok: false; why: string }

const SIGN_IN = 'Sign in to share a map.'

const said = (error: { message?: string } | null): Said =>
  error ? { ok: false, why: error.message || 'That did not go through.' } : { ok: true }

/** Put a map on the account, or replace the one of that name already there. */
export async function publishMap(doc: MapDoc): Promise<Said> {
  const name = doc.name.trim()
  if (!name) return { ok: false, why: 'Give the map a name first.' }
  const { error } = await getSupabaseClient().rpc('park_map_put', {
    p_name: name,
    p_body: packMapDoc(doc),
  })
  return said(error)
}

export async function unpublishMap(name: string): Promise<Said> {
  const { error } = await getSupabaseClient().rpc('park_map_drop', { p_name: name.trim() })
  return said(error)
}

/** The ones I have published — never anybody else's, which is the RPC's own rule. */
export async function myPublished(): Promise<PublishedMap[]> {
  const { data, error } = await getSupabaseClient().rpc('park_map_mine')
  if (error || !Array.isArray(data)) return []
  return data as PublishedMap[]
}

/** Open my park on a published map, so people can come to it. */
export async function openPark(mapName: string, audience: ParkAudience): Promise<Said> {
  const { error } = await getSupabaseClient().rpc('open_park_room', {
    p_name: mapName.trim(),
    p_audience: audience,
  })
  return said(error)
}

export async function closePark(): Promise<Said> {
  const { error } = await getSupabaseClient().rpc('close_park_room')
  return said(error)
}

/** Somebody's park, by their name — the handle a person can actually be told. */
export async function findPark(username: string): Promise<FoundPark | null> {
  const { data, error } = await getSupabaseClient().rpc('get_park_room', {
    p_username: username.trim(),
  })
  if (error || !Array.isArray(data) || !data.length) return null
  return data[0] as FoundPark
}

/** The parks I could walk into right now, which is what "searchable" means here. */
export async function browseParks(): Promise<OpenPark[]> {
  const { data, error } = await getSupabaseClient().rpc('open_park_rooms')
  if (error || !Array.isArray(data)) return []
  return data as OpenPark[]
}

/**
 * The map behind a room, for somebody who is allowed in.
 *
 * ⚠️ IT GOES BACK THROUGH readMapDoc, which is the same door a map from localStorage comes
 * through and the security boundary for art. What arrives here was written by another member, so
 * "a trusted path wrote it" is not a thing that can be said about it at all — every drawing in
 * the palette is re-validated on the way out exactly as the gallery's note demands.
 *
 * ⚠️ NULL MEANS DO NOT ENTER, for every reason at once — not allowed, not open, not there, not
 * readable. The caller cannot tell those apart and must not try: a client that guessed would be
 * a client that joined a park it could not draw.
 */
export async function fetchParkMap(roomId: string): Promise<MapDoc | null> {
  const { data, error } = await getSupabaseClient().rpc('get_park_room_map', { p_room: roomId })
  if (error || !data) return null
  return readMapDoc(data)
}

export async function inviteToPark(username: string): Promise<Said> {
  const u = username.trim()
  if (!u) return { ok: false, why: 'Who should it be?' }
  const { error } = await getSupabaseClient().rpc('invite_to_park_room', { p_username: u })
  return said(error)
}

export async function uninviteFromPark(username: string): Promise<Said> {
  const { error } = await getSupabaseClient().rpc('uninvite_from_park_room', {
    p_username: username.trim(),
  })
  return said(error)
}

/** Whether anybody is signed in at all, so a room can say so once rather than per button. */
export async function signedIn(): Promise<boolean> {
  const { data } = await getSupabaseClient().auth.getSession()
  return !!data.session
}

export const NOT_SIGNED_IN = SIGN_IN
