import { getSupabaseClient } from '../finance/client'
import { getFinanceEnv } from '../finance/env'
import { readFunctionError, type FunctionFailure } from '../finance/functionError'
import { previewMember } from '../dev/previewMember'
import {
  pvPlayUrl,
  pvRemoveSong,
  pvSendSong,
  pvSongsIn,
  pvSongsMine,
  pvUploadSong,
} from '../dev/chatSongsPreview'
import { addToThread, songGone } from './roomThread'
import type { Msg, Overview } from './chatRooms'

/**
 * Songs in chat: a recording from the Instrument room, sent into a chat room and played there.
 * The contract is docs/2026-11-22-chat-songs.md; this is the client half of it.
 *
 * ⚠️ WHICH MESSAGE CARRIES A SONG IS THE SERVER'S ANSWER, NEVER THE TEXT. `send_chat_song` writes
 * a body that reads as itself wherever only text is shown — `🎵 Name (m:ss)` — so anybody can
 * type one, and a typed one carries nothing. A message is drawn as a song only when
 * `chat_songs_in` names its id.
 *
 * ⚠️ EVERY CALL HERE DEGRADES, because the server half ships separately and each of its steps
 * (the SQL, the function) waits for Evan's yes. Until both are there, a press says
 * {@link SONGS_OFF} and a thread draws its song messages as the text they are.
 */

/** one row of `chat_songs_in`: a song that was sent into a room */
export type ChatSong = {
  message_id: string
  file_id: string
  name: string
  seconds: number
  mime: string
  /** whether it is yours — the only thing a room is told about who sent it (the Lounge) */
  mine: boolean
  /** taken down by its sender: the message stays and says so */
  removed: boolean
}

export const SONGS_OFF = 'Songs in chat aren’t switched on yet.'
const NO_REACH = 'Couldn’t reach the server. Try again.'

/**
 * A file's ceiling, in BYTES, as `chat_song_claim` measures it, and its sentence for one over.
 *
 * ⚠️ CHECKED HERE AS WELL, BEFORE A BYTE MOVES, because the upload now carries the file itself:
 * the function stops reading at this many bytes and refuses, so a file over it would be sent in
 * full only to be turned away — and a server that answers before it has read the body can end
 * the request in a way the browser reports as no response at all, which this file would call
 * "couldn't reach the server". The same number and the same words, so the two cannot disagree.
 */
export const SONG_BYTES = 5_242_880
export const SONG_TOO_BIG = 'that one is over 5 MB'
/** an account's ceiling, counting every song not removed (sent or not), as the claim sums it */
export const SONGS_BYTES = 26_214_400
/** a name's ceiling, in characters as Postgres's `char_length` counts them: code points */
const NAME_MAX = 60

/**
 * A name with nothing in it that is half a character, cut to {@link NAME_MAX} code points. For
 * the name box as it is typed and offered — it keeps spaces, so a space can still be typed.
 *
 * ⚠️ A LONE SURROGATE IS HALF AN EMOJI, AND IT ARRIVES FROM OUTSIDE. The kept song name is cut
 * with `.slice(0, 60)`, which counts UTF-16 units, so a name ending in an emoji at the boundary
 * comes back as its first half — and `encodeURIComponent`, which the upload's name header goes
 * through, THROWS on one. So it is dropped rather than cut around: a code-point cap alone keeps
 * a lone surrogate as a "character" of its own.
 */
export function nameCap(name: string): string {
  return wholeChars(name).slice(0, NAME_MAX).join('')
}

/** a string's code points, without any that is half of one */
const wholeChars = (s: string) =>
  Array.from(s).filter((c) => !(c.length === 1 && c >= '\uD800' && c <= '\uDFFF'))

/**
 * A name as it is sent: whole characters, one line, trimmed, at most 60 — in the order
 * `chat_song_claim` does it, `btrim(left(btrim(regexp_replace(name, '\s+', ' ', 'g')), 60))`, so
 * the name drawn at once is the name read back later. (Cutting BEFORE the spaces are squeezed
 * would keep fewer characters than the server does from a name with a run of them in it.)
 */
export function songTitle(name: string): string {
  const line = wholeChars(name).join('').replace(/\s+/g, ' ').trim()
  return Array.from(line).slice(0, NAME_MAX).join('').trim()
}

/**
 * A song's length as `send_chat_song` writes it into the message:
 * `floor(seconds / 60)::int || ':' || lpad((floor(seconds)::int % 60)::text, 2, '0')`.
 *
 * ⚠️ THE SAME SUM, NOT A NICER ONE, because the two are shown side by side: the player's label
 * here, and the message's own text wherever the player is not drawn. Seconds are sent floored (see
 * ExportSong), so neither side ever meets a fraction in practice; floored again here regardless,
 * as the SQL does, so a fraction from anywhere else still agrees.
 */
export function lengthLabel(seconds: number): string {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`
}

/**
 * A recording's length as it is sent: whole seconds, floored, and never 0.
 *
 * ⚠️ FLOORED SO THE LABEL IS THE SAME SUM ON BOTH SIDES (see lengthLabel), and AT LEAST ONE because
 * `chat_song_claim` refuses `seconds <= 0` as "that recording has no length" — a sub-second
 * recording is still a recording, and that sentence would be wrong about it. An export is a bar and a tail at
 * the least, so this floor is a guard rather than something anybody meets.
 */
export function songSeconds(duration: number): number {
  return Math.max(1, Math.floor(duration))
}

/**
 * A recorder's type without its codec details: `audio/webm;codecs=opus` is `audio/webm`.
 *
 * ⚠️ THE CLAIM, THE FUNCTION'S CHECK AND THE TYPE R2 SERVES MUST ALL AGREE ON IT. `chat_song_claim`
 * keeps exactly `audio/mp4`, `audio/webm` or `audio/ogg`, the function refuses any other, and it
 * stores the object under the type it was told — and MediaRecorder's own type carries the codec.
 */
export function bareMime(type: string): string {
  return type.split(';')[0].trim().toLowerCase()
}

/** A room id the database could have made. The call's own loose chat is `'call'`, a dev call `'dev-call'`. */
export const isRoomId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

/**
 * Whether an error means the songs SQL is not applied: PostgREST cannot find the function
 * (PGRST202), or Postgres has no such function (42883).
 *
 * ⚠️ BY MESSAGE TOO, because the edge function passes an RPC's refusal on as `{error: message}`
 * and the code does not survive the trip. So a deployed function in front of unapplied SQL says
 * "Could not find the function public.chat_song_claim(…)" — which is this same answer, and must
 * not be shown to a person as if it were a refusal.
 */
export function songsSqlMissing(e: { code?: unknown; message?: unknown } | null): boolean {
  if (!e) return false
  const code = String(e.code ?? '')
  if (code === 'PGRST202' || code === '42883') return true
  const msg = String(e.message ?? '')
  return (
    /chat_song|send_chat_song|chat_songs_in/.test(msg) &&
    /could not find the function|does not exist/i.test(msg)
  )
}

/** What an RPC's error says to a person. */
export function sayRpcError(e: { code?: unknown; message?: unknown } | null, fallback: string) {
  if (songsSqlMissing(e)) return SONGS_OFF
  const msg = e?.message
  return typeof msg === 'string' && msg ? msg : fallback
}

/**
 * What a failed call to the `chat-songs` function says to a person.
 *
 * @param deployed what {@link deployed} answered, asked only when there was no response at all
 *   (`status` null): false is the platform saying there is no such function.
 *
 * ⚠️ A 404 COUNTS AS "NOT SWITCHED ON" ONLY WHEN IT CARRIES NO SENTENCE OF ITS OWN. The deployed
 * function answers `{error}` for its own refusals; the platform's 404 for a function that is not
 * there is `{"code":"NOT_FOUND"}`, with no `error` in it.
 */
export function sayFunctionFailure(
  f: FunctionFailure,
  fallback: string,
  deployed: boolean | null = null,
): string {
  if (f.said) return songsSqlMissing({ message: f.said }) ? SONGS_OFF : f.said
  if (f.status === 404) return SONGS_OFF
  if (f.status === null) return deployed === false ? SONGS_OFF : NO_REACH
  return fallback
}

/**
 * Whether the `chat-songs` function exists, asked the one way a page CAN ask it: a plain GET.
 *
 * ⚠️ FROM A PAGE, A FUNCTION THAT IS NOT DEPLOYED NEVER ARRIVES AS A 404. Measured on 22 Nov
 * against the live project: an OPTIONS preflight to `functions/v1/chat-songs` is answered **404**,
 * and a preflight that is not 2xx fails — so the browser never sends the POST, and supabase-js
 * reports a FunctionsFetchError with no status in it, exactly as it would for a dropped
 * connection. Saying "not switched on" for every fetch failure would misdiagnose a bad network;
 * saying "couldn't reach the server" for a missing function would misdiagnose this.
 *
 * A GET with no headers is a simple request, with no preflight, and the platform's answer carries
 * `Access-Control-Allow-Origin: *` and exposes `sb-error-code` — so the page can read it. Measured
 * the same day: `NOT_FOUND` with a 404 for `chat-songs`, and `UNAUTHORIZED_NO_AUTH_HEADER` with a
 * 401 for `pictures`, which is deployed. Asked only on the failing path, so a working send pays
 * nothing for it. Null when it could not be asked either.
 */
async function deployed(): Promise<boolean | null> {
  try {
    const res = await fetch(`${getFinanceEnv().supabaseUrl}/functions/v1/chat-songs`)
    if (res.status !== 404) return true
    let code = res.headers.get('sb-error-code')
    if (!code)
      code = ((await res.json().catch(() => null)) as { code?: string } | null)?.code ?? null
    return code === 'NOT_FOUND' ? false : true
  } catch {
    return null
  }
}

async function functionFailed(error: unknown, fallback: string): Promise<string> {
  const f = await readFunctionError(error)
  return sayFunctionFailure(f, fallback, f.status === null ? await deployed() : null)
}

/** a `chat_songs_in` row, normalised: `seconds` is numeric in Postgres and may arrive as text */
export function songFromRow(r: Record<string, unknown>): ChatSong {
  return {
    message_id: String(r.message_id),
    file_id: String(r.file_id),
    name: String(r.name ?? ''),
    seconds: Number(r.seconds) || 0,
    mime: String(r.mime ?? ''),
    mine: r.mine === true,
    removed: r.removed === true,
  }
}

/**
 * Two answers about a room's songs, made one.
 *
 * ⚠️ A UNION, AND `removed` ONLY EVER GOES ONE WAY. Answers can arrive out of order — a read that
 * left before a song was sent can land after `sendSong` has put that song in the thread — so
 * replacing the map with the latest answer would make a just-sent song turn back into text, and
 * an answer older than a removal would bring the removed one back. Nothing un-sends a song and
 * nothing un-removes one, so a union with a sticky `removed` is right whatever order they come in.
 */
export function mergeSongs(
  have: Record<string, ChatSong>,
  got: Record<string, ChatSong>,
): Record<string, ChatSong> {
  const out = { ...have }
  for (const [id, s] of Object.entries(got)) {
    out[id] = { ...s, removed: s.removed || !!have[id]?.removed }
  }
  return out
}

/**
 * The songs sent into a room, by message id. An error when the room may not be asked, or the
 * server has no songs yet ({@link SONGS_OFF}); the thread draws text either way.
 */
export async function songsIn(
  room: string,
): Promise<{ songs: Record<string, ChatSong> } | { why: string }> {
  if (previewMember) {
    /* a real read is a round trip, so the harness's answer lands after the messages' as it
       usually will on the site — answering at once would hide the bubble that grows after the
       log has pinned to the bottom */
    await new Promise((r) => setTimeout(r, 250))
    return { songs: pvSongsIn(room) }
  }
  /* never asked about a room the database did not make: the call's loose chat is `'call'` */
  if (!isRoomId(room)) return { songs: {} }
  const { data, error } = await getSupabaseClient().rpc('chat_songs_in', { p_room: room })
  if (error) return { why: sayRpcError(error, 'Couldn’t load the songs in this chat.') }
  const songs: Record<string, ChatSong> = {}
  for (const r of (data as Record<string, unknown>[] | null) ?? []) {
    const s = songFromRow(r)
    songs[s.message_id] = s
  }
  return { songs }
}

/** A link to hear a song, good for an hour. Fetched when ▶ is pressed, never before. */
export async function playUrl(id: string): Promise<{ url: string } | { why: string }> {
  if (previewMember) return pvPlayUrl(id)
  const { data, error } = await getSupabaseClient().functions.invoke('chat-songs', {
    body: { op: 'play', id },
  })
  if (error) return { why: await functionFailed(error, 'That song wouldn’t play.') }
  const url = (data as { url?: unknown } | null)?.url
  return typeof url === 'string' && url ? { url } : { why: 'That song wouldn’t play.' }
}

/** Take your own song down. Its message stays, and says so. Null when it went. */
export async function removeSong(id: string): Promise<{ why: string } | null> {
  if (previewMember) {
    const bad = pvRemoveSong(id)
    if (bad) return bad
    songGone(id)
    return null
  }
  const { error } = await getSupabaseClient().functions.invoke('chat-songs', {
    body: { op: 'remove', id },
  })
  if (error) return { why: await functionFailed(error, 'That song didn’t come down.') }
  songGone(id)
  return null
}

/**
 * Send a recording into a room: hand the bytes to the function, which checks and keeps them, then
 * send the message.
 *
 * ⚠️ THE BYTES GO THROUGH THE FUNCTION, NOT STRAIGHT TO R2. A signed PUT stays good after the
 * server has looked at what arrived, so a sender could put any file in its place afterwards, or
 * leave objects behind that no row knows about. Now the function holds the bytes it checks: it
 * claims them at their real length, checks them in hand (size, type, first bytes), puts them in
 * R2 itself and marks them ready, and on any failure lets the claim go and deletes what it wrote.
 * So the answer is one `{ id }` or one sentence, and nothing half-done is left for anybody.
 *
 * ⚠️ AND THE FIELDS ARE HEADERS, because the body is the file. The name is URI-encoded: a header
 * is not a place for `é` or an emoji, and {@link songTitle} has already made it something
 * `encodeURIComponent` will take (it throws on half an emoji).
 */
export async function sendSong(
  room: string,
  blob: Blob,
  name: string,
  seconds: number,
): Promise<{ msg: Msg } | { why: string }> {
  const mime = bareMime(blob.type)
  const title = songTitle(name)
  const whole = songSeconds(seconds)
  if (blob.size > SONG_BYTES) return { why: SONG_TOO_BIG }
  if (previewMember) {
    const up = pvUploadSong(room, mime, blob.size, whole, title)
    if ('why' in up) return up
    const sent = pvSendSong(up.id)
    if ('why' in sent) return sent
    addToThread(room, sent.msg, sent.song)
    return { msg: sent.msg }
  }
  const sb = getSupabaseClient()
  const { data, error } = await sb.functions.invoke('chat-songs', {
    body: blob,
    headers: {
      'x-song-op': 'upload',
      'x-song-room': room,
      'x-song-mime': mime,
      'x-song-seconds': String(whole),
      'x-song-name': encodeURIComponent(title),
    },
  })
  if (error) return { why: await functionFailed(error, 'That song didn’t go up.') }
  const id = (data as { id?: unknown } | null)?.id
  if (typeof id !== 'string' || !id) return { why: 'That song didn’t go up.' }

  const { data: sent, error: badSend } = await sb.rpc('send_chat_song', { p_id: id })
  if (badSend) return { why: sayRpcError(badSend, 'That song didn’t send.') }
  // ⚠️ send_chat_song returns a SET, like send_chat_message, so this is an array
  const msg = (sent as unknown as Msg[] | null)?.[0]
  if (!msg?.id) return { why: 'That song didn’t send.' }
  addToThread(room, msg, {
    message_id: msg.id,
    file_id: id,
    name: title,
    seconds: whole,
    mime,
    mine: true,
    removed: false,
  })
  return { msg }
}

/** one row of `chat_songs_mine`: a song of yours that still holds room, sent or not */
export type MySong = {
  file_id: string
  name: string
  seconds: number
  bytes: number
  sent: boolean
  /** the kind of room it went to, or null when that room is gone */
  room_kind: string | null
}

/**
 * Your songs that still count toward 25 MB, newest first.
 *
 * ⚠️ NOT ASKED THROUGH ANY ROOM. `chat_songs_mine` answers about the caller's own rows with no
 * membership check, because the rows that most need removing are the ones no room shows any more:
 * a song sent to a chat you have since left, or one that went up and was never sent. A suspended
 * member can still take theirs down. Every other way to Remove is a ▶ in a thread you are in.
 */
export async function songsMine(): Promise<{ songs: MySong[] } | { why: string }> {
  if (previewMember) return { songs: pvSongsMine() }
  const { data, error } = await getSupabaseClient().rpc('chat_songs_mine')
  if (error) return { why: sayRpcError(error, 'Couldn’t load your songs.') }
  return {
    songs: ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
      file_id: String(r.file_id),
      name: String(r.name ?? ''),
      seconds: Number(r.seconds) || 0,
      bytes: Number(r.bytes) || 0,
      sent: r.sent === true,
      room_kind: typeof r.room_kind === 'string' ? r.room_kind : null,
    })),
  }
}

/**
 * How much of an account's room the songs take, against the 25 MB they may.
 *
 * ⚠️ MB HERE IS 1,048,576 BYTES, because that is the MB the server's sentences use: "over 5 MB" is
 * 5,242,880 and "come to 25 MB" is 26,214,400. ⚠️ AND IT ROUNDS UP: a figure shown against a limit
 * must never read lower than the one the limit is applied to, or a refusal arrives at a number the
 * screen calls fine (Pictures learned that).
 */
export function usedLabel(bytes: number): string {
  const tenths = Math.ceil((Math.max(0, bytes) / 1_048_576) * 10)
  return `${tenths / 10} of ${SONGS_BYTES / 1_048_576} MB`
}

const KIND_WORD: Record<string, string> = { dm: 'DM', circuit: 'circuit', lounge: 'Lounge' }

/**
 * The chats a song can be sent to, each named so that no two read alike.
 *
 * ⚠️ A ROOM'S NAME IS NOT AN ID. A DM is named after the other person's first name and a circuit
 * after whatever it was called, so two friends called Alex, or two circuits called The Crew, were
 * two identical lines in a picker that sends a recording to whichever one you meant. A DM whose
 * name is shared takes its person's @username (looked up by `peer_user_id`, the key Overview says
 * a DM is matched by); anything still alike after that takes its kind and its place in the list.
 *
 * @param usernameOf a DM peer's username, or null when the directory does not know them
 */
export function roomChoices(
  rooms: Pick<Overview, 'id' | 'kind' | 'name' | 'peer_user_id'>[],
  usernameOf: (userId: string) => string | null,
): { id: string; kind: string; name: string }[] {
  const tally = (names: string[]) => {
    const n = new Map<string, number>()
    for (const s of names) n.set(s, (n.get(s) ?? 0) + 1)
    return n
  }
  const alike = tally(rooms.map((r) => r.kind + ' ' + r.name))
  const first = rooms.map((r) => {
    if ((alike.get(r.kind + ' ' + r.name) ?? 0) < 2 || r.kind !== 'dm' || !r.peer_user_id)
      return r.name
    const handle = usernameOf(r.peer_user_id)
    return handle ? `${r.name} (@${handle})` : r.name
  })
  const still = tally(rooms.map((r, i) => r.kind + ' ' + first[i]))
  const place = new Map<string, number>()
  return rooms.map((r, i) => {
    const key = r.kind + ' ' + first[i]
    if ((still.get(key) ?? 0) < 2) return { id: r.id, kind: r.kind, name: first[i] }
    const n = (place.get(key) ?? 0) + 1
    place.set(key, n)
    return { id: r.id, kind: r.kind, name: `${first[i]} (${KIND_WORD[r.kind] ?? r.kind} ${n})` }
  })
}

/** how long a link to a song is good for: the function signs it for 3600 s */
export const LINK_LIFE_MS = 3_600_000

/**
 * What a player says after its `<audio>` failed: that this browser cannot play the recording,
 * or ▶ again for a fresh link.
 *
 * ⚠️ "TRY AGAIN" WAS A LOOP FOR A RECORDING THE BROWSER CANNOT DECODE. Safari meeting an Ogg, say:
 * MEDIA_ERR_SRC_NOT_SUPPORTED (4), and a fresh link fetches the same bytes and fails the same way,
 * for ever. So a format failure ends on a sentence that says so — and so does a decode failure
 * (3), which is the same bytes failing later in the file.
 *
 * ⚠️ BUT ONLY ON A FRESH LINK, because an EXPIRED one fails with that same code: R2 answers 403,
 * and a browser reports an HTTP error on a media source as "not supported". A link close to its
 * hour is the one case where asking again is exactly the cure, so a minute's grace is given
 * against the clock and the fetch itself. A network failure (2) or an abort (1) is always worth
 * trying again.
 */
export function afterPlayError(code: number | undefined, linkAgeMs: number): 'cannot' | 'again' {
  if (linkAgeMs >= LINK_LIFE_MS - 60_000) return 'again'
  return code === 3 || code === 4 ? 'cannot' : 'again'
}

/**
 * One song sounding at a time: starting a player pauses whichever was playing.
 *
 * ⚠️ AT MODULE SCOPE, NOT IN A COMPONENT, because the players do not know about each other: a
 * thread holds many, and the same thread can be drawn twice at once (Chat and the call's panel).
 * Two songs talking over each other is never what a press meant.
 */
let sounding: { pause(): void } | null = null
export function startedPlaying(player: { pause(): void }) {
  if (sounding && sounding !== player) sounding.pause()
  sounding = player
}
export function stoppedPlaying(player: { pause(): void }) {
  if (sounding === player) sounding = null
}
