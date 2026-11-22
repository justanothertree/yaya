import type { Msg } from '../circuit/chatRooms'
import type { ChatSong } from '../circuit/chatSongs'
import { toWav } from '../audio/wav'
import {
  PREVIEW_LOUNGE_IN,
  PREVIEW_ME,
  PREVIEW_ROOMS,
  previewMsgs,
  previewOverview,
} from './previewMember'

/**
 * A stand-in for songs in chat, so the Browser pane can draw a song message and the room picker
 * without the `chat-songs` function, its SQL or R2 (see previewMember.ts for what the harness is).
 *
 * ⚠️ IN THE SERVER'S OWN WORDS. `pvSendSong` refuses what `chat_song_claim` refuses, in its order
 * and with its sentences, and `pvRemoveSong` only takes down your own: a double kinder than the
 * server hides the bug it should have shown (CLAUDE.md, `pvStart` and `pvSaveGoal`).
 *
 * ⚠️ THE SONGS ARE KEYED TO MESSAGES IN previewMember.ts'S FIXTURE, and one message there LOOKS like
 * a song and is not: `c7`, typed by hand. It is in no list here, so it must draw as text — the
 * client's rule that song-ness is never read off the body, made something the pane can see.
 *
 * ⚠️ AND IT IS ALL BEHIND FUNCTIONS: a statement-level `let s = seed()` is a side effect rollup
 * cannot prove pure, which is how 2.78 kB of invented fixture once shipped to real users.
 */

const FILE_BYTES = 5_242_880
const ACCOUNT_BYTES = 26_214_400
const MIMES = ['audio/mp4', 'audio/webm', 'audio/ogg']

type PvSong = ChatSong & { room: string; bytes: number }

let store: PvSong[] | null = null
const songs = (): PvSong[] =>
  (store ??= [
    {
      room: 'pv-crew',
      message_id: 'c5',
      file_id: 'pv-song-1',
      name: 'Night drive, take three',
      seconds: 125,
      mime: 'audio/webm',
      mine: false,
      removed: false,
      bytes: 1_900_000,
    },
    {
      room: 'pv-crew',
      message_id: 'c6',
      file_id: 'pv-song-2',
      name: 'Sunday',
      seconds: 48,
      mime: 'audio/webm',
      mine: true,
      removed: false,
      bytes: 760_000,
    },
    {
      room: 'pv-dm',
      message_id: 'd4',
      file_id: 'pv-song-3',
      name: 'Old idea',
      seconds: 70,
      mime: 'audio/ogg',
      mine: false,
      removed: true,
      bytes: 1_100_000,
    },
  ])

/** what chat_songs_in returns of a row: never the room's bookkeeping, and never an owner */
const strip = (s: PvSong): ChatSong => ({
  message_id: s.message_id,
  file_id: s.file_id,
  name: s.name,
  seconds: s.seconds,
  mime: s.mime,
  mine: s.mine,
  removed: s.removed,
})

/** chat_song_claim's `chat_room_member`: a room in the harness, and the Lounge only once joined */
const member = (room: string) =>
  PREVIEW_ROOMS.some((r) => r.id === room && (r.kind !== 'lounge' || PREVIEW_LOUNGE_IN))

/** the harness's chat_songs_in: sent songs in a room you are in, removed ones flagged */
export function pvSongsIn(room: string): Record<string, ChatSong> {
  const out: Record<string, ChatSong> = {}
  if (!member(room)) return out
  for (const s of songs()) if (s.room === room) out[s.message_id] = strip(s)
  return out
}

/** the harness's list_chat_overview, for the picker */
export const pvChatRooms = () => previewOverview()

/** upload, ready and send_chat_song at once, refusing what chat_song_claim refuses */
export function pvSendSong(
  room: string,
  mime: string,
  bytes: number,
  seconds: number,
  name: string,
): { msg: Msg; song: ChatSong } | { why: string } {
  const title = Array.from(name.trim()).slice(0, 60).join('')
  if (!member(room)) return { why: 'not in this room' }
  if (!MIMES.includes(mime)) return { why: 'that is not a kind of recording this keeps' }
  if (!(bytes >= 1)) return { why: 'that recording came to nothing' }
  if (bytes > FILE_BYTES) return { why: 'that one is over 5 MB' }
  if (!(seconds > 0 && seconds <= 900)) return { why: 'that is not a song’s length' }
  if (!title) return { why: 'needs a name' }
  const held = songs()
    .filter((s) => s.mine && !s.removed)
    .reduce((n, s) => n + s.bytes, 0)
  if (held + bytes > ACCOUNT_BYTES)
    return { why: 'your songs in chat hold 25 MB already — remove one to send this' }
  const len = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`
  const id = 'pv-sent-' + Date.now()
  const fixture = {
    id,
    room_id: room,
    user_id: PREVIEW_ME.id,
    author_name: PREVIEW_ME.name,
    body: `🎵 ${title} (${len})`,
    created_at: new Date().toISOString(),
  }
  /* into the fixture as well, so reopening the room still has it — see sendToThread */
  previewMsgs()[room] = [...(previewMsgs()[room] ?? []), fixture]
  const song: PvSong = {
    room,
    message_id: id,
    file_id: 'pv-song-' + Date.now(),
    name: title,
    seconds,
    mime,
    mine: true,
    removed: false,
    bytes,
  }
  songs().push(song)
  const isLounge = PREVIEW_ROOMS.find((r) => r.id === room)?.kind === 'lounge'
  return {
    msg: {
      id,
      room_id: room,
      author_user_id: isLounge ? null : PREVIEW_ME.id,
      author_name: PREVIEW_ME.name,
      author_username: null,
      mine: true,
      body: fixture.body,
      created_at: fixture.created_at,
    },
    song: strip(song),
  }
}

/**
 * The harness's `play`: a short tone rather than a recording, made when ▶ is pressed. The same
 * refusal as `chat_song_get` for anything removed or not in a room you are in.
 */
export function pvPlayUrl(fileId: string): { url: string } | { why: string } {
  const s = songs().find((x) => x.file_id === fileId)
  if (!s || s.removed || !member(s.room)) return { why: 'no such song' }
  const rate = 8000
  const tone = new Float32Array(rate * 2)
  for (let i = 0; i < tone.length; i++)
    tone[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / rate) * (1 - i / tone.length)
  return { url: URL.createObjectURL(toWav(tone, rate)) }
}

/** the harness's chat_song_remove: your own, not already gone */
export function pvRemoveSong(fileId: string): { why: string } | null {
  const s = songs().find((x) => x.file_id === fileId)
  if (!s || !s.mine || s.removed) return { why: 'no such song' }
  s.removed = true
  return null
}
