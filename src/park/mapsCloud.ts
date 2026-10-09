import { getSupabaseClient } from '../finance/client'
import { packMapDoc } from './maps'
import { readMapDoc, type MapDoc } from './mapDoc'

/**
 * Publishing a map, and walking into somebody else's.
 *
 * ⚠️ THE MAP IS NOT ON THE WIRE, AND THAT IS THE WHOLE DESIGN. The relay refuses a message over
 * 32KB; a map is 320KB in this browser and up to 2MB on the account, which is ten and sixty-four
 * times that. (This said "12,000 characters" and "200KB", and both were wrong in the same
 * direction: 12,000 is MAX_LOOK_BYTES, which caps a creature's DRAWING and is checked in only the
 * two cases that carry one, and 200KB was the map cap two changes ago. The conclusion was always
 * right and the numbers quoted for it were not.) A palette of
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

/**
 * A link straight into somebody's park.
 *
 * ⚠️ THE SAME SHAPE SNAKE'S CHALLENGE LINK HAS, deliberately: origin + pathname + a hash the
 * games room already parses. challengeLink has been posting `#snake?room=` into real chat
 * messages for months, and those messages cannot be rewritten — so a second link convention
 * would be a second thing that has to keep working forever. This is the first one again.
 *
 * ⚠️ IT CARRIES THE HOST, NOT THE ROOM. A room id is a uuid that changes nothing if the host
 * reopens on a different map, and it means nothing to a person reading the message. A username
 * is the handle the whole feature is already keyed on — get_park_room takes one — and it
 * survives the host closing and reopening.
 */
export const parkLink = (host: string): string =>
  `${location.origin}${location.pathname}#games?play=park&park=${encodeURIComponent(host)}`

/** Whose park this page was opened for, if any. Loose on purpose: it is only ever a username. */
export function parkFromHash(): string | null {
  const m = (window.location.hash || '').match(/[?&]park=([^&]+)/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1]).trim().slice(0, 40) || null
  } catch {
    return null
  }
}

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

/**
 * Put a map on the account, or replace the one of that name already there.
 *
 * ⚠️ THIS IS WHERE A MAP LIVES NOW, not a published copy of one. It was opt-in because each row
 * was a thing other people could fetch; it is the source of truth because the browser cannot be
 * one — localStorage is five megabytes for the whole origin, shared with the gallery, the songs
 * and the minions, and that is what decided a map could be 320KB. Nothing about the SIZE of a
 * map should be decided by the smallest place it is kept.
 *
 * ⚠️ SHARING IS A DIFFERENT QUESTION AND STAYS SEPARATE. Being on your account is storage; being
 * walkable by somebody else is open_park_room. Rolling them together is what made "share" a
 * prerequisite nobody could see.
 */
export async function saveMapToAccount(doc: MapDoc): Promise<Said> {
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

/**
 * One of mine, in full, so a browser that has never seen it can hold it.
 *
 * ⚠️ VALIDATED ON THE WAY OUT through readMapDoc, like every other map this file hands back.
 * It is my own row, but localStorage is editable by anything on this origin and so is a round
 * trip through a database — "a trusted path wrote it" is not a thing that can be said about
 * anything coming back over a wire.
 */
export async function fetchMyMap(name: string): Promise<MapDoc | null> {
  const { data, error } = await getSupabaseClient().rpc('park_map_get', { p_name: name.trim() })
  if (error || !data) return null
  return readMapDoc(data)
}

/** The ones on my account — never anybody else's, which is the RPC's own rule. */
export async function myPublished(): Promise<PublishedMap[]> {
  const { data, error } = await getSupabaseClient().rpc('park_map_mine')
  if (error || !Array.isArray(data)) return []
  return data as PublishedMap[]
}

/** Open my park on a published map, so people can come to it. */
/** what opening answers with: the usual sentence, plus the room it opened as */
export type Opened = Said & { room?: string }

export async function openPark(mapName: string, audience: ParkAudience): Promise<Opened> {
  const { data, error } = await getSupabaseClient().rpc('open_park_room', {
    p_name: mapName.trim(),
    p_audience: audience,
  })
  /* ⚠️ the id comes back, because the host needs it to walk into their OWN park — see hostRoom */
  const r = said(error)
  return r.ok && typeof data === 'string' ? { ...r, room: data } : r
}

export async function closePark(): Promise<Said> {
  const { error } = await getSupabaseClient().rpc('close_park_room')
  return said(error)
}

/**
 * My own park, if I have one open or closed.
 *
 * ⚠️ NOT get_park_room WITH MY OWN NAME. That would make finding my room depend on the client
 * holding the right handle for the account it is already signed in as — and a client that had it
 * slightly wrong would host a park it could not then join. auth.uid() is the thing that is
 * actually known, so the RPC asks that instead.
 */
export async function myPark(): Promise<FoundPark | null> {
  const { data, error } = await getSupabaseClient().rpc('my_park_room')
  if (error || !Array.isArray(data) || !data.length) return null
  const r = data[0] as Omit<FoundPark, 'is_owner'>
  return { ...r, is_owner: true }
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

export type Invitee = { username: string; name: string }

/**
 * Who I have let in.
 *
 * ⚠️ THE OWNER'S ALONE, and the RPC is where that is decided rather than here — `r.owner =
 * auth.uid()` is its whole access rule, so a guest asking gets an empty list rather than
 * somebody else's guest list. Verified: host 1, guest 0, anon refused outright.
 */
export async function parkInvites(): Promise<Invitee[]> {
  const { data, error } = await getSupabaseClient().rpc('list_park_room_invites')
  if (error || !Array.isArray(data)) return []
  return data as Invitee[]
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
