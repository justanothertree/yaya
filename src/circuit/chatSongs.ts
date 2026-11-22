import { getSupabaseClient } from '../finance/client'
import { getFinanceEnv } from '../finance/env'
import { readFunctionError, type FunctionFailure } from '../finance/functionError'
import { previewMember } from '../dev/previewMember'
import { pvPlayUrl, pvRemoveSong, pvSendSong, pvSongsIn } from '../dev/chatSongsPreview'
import { addToThread, songGone } from './roomThread'
import type { Msg } from './chatRooms'

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
 * `chat_song_claim` refuses `seconds <= 0` as "not a song's length" — a sub-second recording is
 * still a recording, and that sentence would be wrong about it. An export is a bar and a tail at
 * the least, so this floor is a guard rather than something anybody meets.
 */
export function songSeconds(duration: number): number {
  return Math.max(1, Math.floor(duration))
}

/**
 * A recorder's type without its codec details: `audio/webm;codecs=opus` is `audio/webm`.
 *
 * ⚠️ THE CLAIM, THE PUT AND THE SERVER'S HEAD MUST ALL AGREE ON IT. `chat_song_claim` keeps
 * exactly `audio/mp4`, `audio/webm` or `audio/ogg`, and the function drops an object whose
 * `content-type` is not the claimed one — and MediaRecorder's own type carries the codec.
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
  if (previewMember) return { songs: pvSongsIn(room) }
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
 * Send a recording into a room: claim it, put the bytes in R2, have the server check them, then
 * send the message.
 *
 * ⚠️ FOUR STEPS, AND ONLY THE LAST ONE IS SEEN BY ANYBODY. The claim reserves a key and checks
 * every ceiling before a byte moves; the PUT goes straight to R2, so nothing but JSON crosses
 * Supabase; `ready` is the function measuring what actually arrived (a signed PUT binds neither
 * length nor type); and only then does `send_chat_song` write the message. A failure part way
 * leaves a claim nobody sees, which the next claim lets go of after an hour.
 */
export async function sendSong(
  room: string,
  blob: Blob,
  name: string,
  seconds: number,
): Promise<{ msg: Msg } | { why: string }> {
  const mime = bareMime(blob.type)
  /* the server cuts a name to 60 characters (`left(btrim(name), 60)`); cut here first, trimmed
     after the cut as well, so what it keeps is exactly what was sent — and the song drawn at once
     carries the same name as the one read back later */
  const title = Array.from(name.trim()).slice(0, 60).join('').trim()
  if (previewMember) {
    const sent = pvSendSong(room, mime, blob.size, seconds, title)
    if ('why' in sent) return sent
    addToThread(room, sent.msg, sent.song)
    return { msg: sent.msg }
  }
  const sb = getSupabaseClient()
  const { data, error } = await sb.functions.invoke('chat-songs', {
    body: { op: 'upload', room, mime, bytes: blob.size, seconds, name: title },
  })
  if (error) return { why: await functionFailed(error, 'That song didn’t go up.') }
  const mint = data as { id?: string; put?: string } | null
  if (!mint?.id || !mint.put) return { why: 'That song didn’t go up.' }

  /**
   * ⚠️ THE TYPE IS SET HERE, BARE, AND NOT LEFT TO THE BLOB. `fetch` with a Blob body sends the
   * blob's own type when no header is given, and MediaRecorder's carries `;codecs=opus` — which is
   * not the type that was claimed, so `ready` would drop the object as "not the recording this
   * account was told about".
   *
   * ⚠️ AND A REJECTION IS CAUGHT, because `fetch` rejects on a CORS failure rather than answering:
   * without the catch it would leave the caller's busy flag set for ever (pictures/cloud.ts).
   */
  try {
    const res = await fetch(mint.put, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': mime },
    })
    if (!res.ok) return { why: `The store refused the upload (${res.status}).` }
  } catch {
    return { why: 'The upload couldn’t reach the store. Try again.' }
  }

  const { error: badReady } = await sb.functions.invoke('chat-songs', {
    body: { op: 'ready', id: mint.id },
  })
  if (badReady) return { why: await functionFailed(badReady, 'That song didn’t go up.') }

  const { data: sent, error: badSend } = await sb.rpc('send_chat_song', { p_id: mint.id })
  if (badSend) return { why: sayRpcError(badSend, 'That song didn’t send.') }
  // ⚠️ send_chat_song returns a SET, like send_chat_message, so this is an array
  const msg = (sent as unknown as Msg[] | null)?.[0]
  if (!msg?.id) return { why: 'That song didn’t send.' }
  addToThread(room, msg, {
    message_id: msg.id,
    file_id: mint.id,
    name: title,
    seconds,
    mime,
    mine: true,
    removed: false,
  })
  return { msg }
}
