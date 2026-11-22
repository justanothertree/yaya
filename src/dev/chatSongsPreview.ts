import type { Msg } from '../circuit/chatRooms'
import type { ChatSong, MySong } from '../circuit/chatSongs'
import { toWav } from '../audio/wav'
import {
  PREVIEW_LOUNGE_IN,
  PREVIEW_ME,
  PREVIEW_PEOPLE,
  PREVIEW_ROOMS,
  previewMsgs,
  previewOverview,
} from './previewMember'

/**
 * A stand-in for songs in chat, so the Browser pane can draw a song message, the room picker and
 * "Your songs in chat" without the `chat-songs` function, its SQL or R2 (see previewMember.ts for
 * what the harness is).
 *
 * ⚠️ IN THE SERVER'S OWN WORDS. `pvUploadSong` refuses what `chat_song_claim` refuses, in its
 * order and with its sentences (docs/2026-11-22-chat-songs.DRAFT.sql; chatSongsPreview.test.ts
 * reads them from there), `pvSendSong` what `send_chat_song` does, and `pvRemoveSong` only takes
 * down your own: a double kinder than the server hides the bug it should have shown (CLAUDE.md,
 * `pvStart` and `pvSaveGoal`).
 *
 * ⚠️ TWO STEPS, AS THE REAL ONE IS: the upload (claim, check, keep, mark ready) answers an id, and
 * only `send_chat_song` writes a message. So a send that fails between them leaves a song that is
 * yours, holds room and is in no chat — which is what "Your songs in chat" is for.
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
const HOUR = 3_600_000

/** a row of chat_song_files, as much of it as the harness needs */
type PvRow = {
  file_id: string
  room: string | null
  /** null until it is sent */
  message_id: string | null
  name: string
  seconds: number
  mime: string
  mine: boolean
  /** `deleted_at is not null`: removed by its sender, or let go unsent */
  removed: boolean
  ready: boolean
  bytes: number
  created: number
  /** the harness's one recording no browser can play: bytes that are not audio at all */
  broken?: boolean
}

let store: PvRow[] | null = null
const rows = (): PvRow[] =>
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
      ready: true,
      bytes: 1_900_000,
      created: Date.now() - 9 * 60_000,
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
      ready: true,
      bytes: 760_000,
      created: Date.now() - 6 * 60_000,
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
      ready: true,
      bytes: 1_100_000,
      created: Date.now() - 30 * 60_000,
    },
    /* the newest message of a thread long enough to scroll: its answer lands after the log has
       pinned, so the bubble grows under a reader who is at the bottom */
    {
      room: 'pv-dm-morgan',
      message_id: 'm40',
      file_id: 'pv-song-4',
      name: 'Late answer',
      seconds: 31,
      mime: 'audio/mp4',
      mine: false,
      removed: false,
      ready: true,
      bytes: 480_000,
      created: Date.now() - 4 * 60_000,
    },
    {
      room: 'pv-lounge',
      message_id: 'l3',
      file_id: 'pv-song-5',
      name: 'Rough mix',
      seconds: 20,
      mime: 'audio/ogg',
      mine: false,
      removed: false,
      ready: true,
      bytes: 300_000,
      created: Date.now() - 200 * 60_000,
      broken: true,
    },
    /* yours, gone up and never sent: in no chat, still holding room */
    {
      room: 'pv-crew',
      message_id: null,
      file_id: 'pv-song-6',
      name: 'Half an idea',
      seconds: 12,
      mime: 'audio/webm',
      mine: true,
      removed: false,
      ready: true,
      bytes: 210_000,
      created: Date.now() - 20 * 60_000,
    },
  ])

/** what chat_songs_in returns of a row: never the room's bookkeeping, and never an owner */
const strip = (s: PvRow & { message_id: string }): ChatSong => ({
  message_id: s.message_id,
  file_id: s.file_id,
  name: s.name,
  seconds: s.seconds,
  mime: s.mime,
  mine: s.mine,
  removed: s.removed,
})

const roomOf = (room: string | null) => PREVIEW_ROOMS.find((r) => r.id === room)

/** chat_song_claim's `chat_room_member`: a room in the harness, and the Lounge only once joined */
const member = (room: string | null) => {
  const r = roomOf(room)
  return !!r && (r.kind !== 'lounge' || PREVIEW_LOUNGE_IN)
}

/** the harness's chat_songs_in: sent songs in a room you are in, removed ones flagged */
export function pvSongsIn(room: string): Record<string, ChatSong> {
  const out: Record<string, ChatSong> = {}
  if (!member(room)) return out
  for (const s of rows())
    if (s.room === room && s.message_id)
      out[s.message_id] = strip({ ...s, message_id: s.message_id })
  return out
}

/** the harness's chat_songs_mine: yours, not removed, newest first, asked through no room */
export function pvSongsMine(): MySong[] {
  return rows()
    .filter((s) => s.mine && !s.removed)
    .sort((a, b) => b.created - a.created)
    .map((s) => ({
      file_id: s.file_id,
      name: s.name,
      seconds: s.seconds,
      bytes: s.bytes,
      sent: !!s.message_id,
      room_kind: roomOf(s.room)?.kind ?? null,
    }))
}

/** the harness's list_chat_overview, for the picker */
export const pvChatRooms = () => previewOverview()

/** the harness's list_member_directory, which is where a DM's peer is given a username */
export const pvDirectory = () =>
  PREVIEW_PEOPLE.map((p) => ({ user_id: p.user_id, username: p.username }))

/**
 * The harness's `upload`: `chat_song_claim`'s refusals, in its order and its words, then the
 * function's check (which the harness takes as passed — what it is handed is a real export) and
 * `chat_song_ready`.
 */
export function pvUploadSong(
  room: string,
  mime: string,
  bytes: number,
  seconds: number,
  name: string,
): { id: string } | { why: string } {
  /* the claim's own sum: whitespace runs to one space, trimmed, cut to 60, trimmed again */
  const title = Array.from(name.replace(/\s+/g, ' ').trim()).slice(0, 60).join('').trim()
  if (!member(room)) return { why: 'not in this room' }
  if (!MIMES.includes(mime)) return { why: 'that is not a kind of recording this keeps' }
  if (!(bytes >= 1)) return { why: 'that recording came to nothing' }
  if (bytes > FILE_BYTES) return { why: 'that one is over 5 MB' }
  if (!(seconds > 0)) return { why: 'that recording has no length' }
  if (seconds > 900) return { why: 'that one is over 15 minutes' }
  if (!title) return { why: 'needs a name' }
  /* a song not sent within the hour is let go, so it stops counting */
  for (const s of rows())
    if (s.mine && !s.message_id && !s.removed && s.created < Date.now() - HOUR) s.removed = true
  const held = rows()
    .filter((s) => s.mine && !s.removed)
    .reduce((n, s) => n + s.bytes, 0)
  if (held + bytes > ACCOUNT_BYTES)
    return { why: 'your songs in chat come to 25 MB — remove one first' }
  const id = 'pv-song-' + Date.now() + '-' + rows().length
  rows().push({
    room,
    message_id: null,
    file_id: id,
    name: title,
    seconds,
    mime,
    mine: true,
    removed: false,
    ready: true,
    bytes,
    created: Date.now(),
  })
  return { id }
}

/** the harness's send_chat_song: one message, refusing what it refuses */
export function pvSendSong(id: string): { msg: Msg; song: ChatSong } | { why: string } {
  const s = rows().find((x) => x.file_id === id)
  if (!s || !s.mine || s.removed) return { why: 'no such song' }
  if (!s.ready) return { why: 'that song has not finished going up' }
  if (s.message_id) return { why: 'that song is already sent' }
  if (!s.room || !roomOf(s.room)) return { why: 'that room is gone' }
  /* send_chat_message's own check, which send_chat_song goes through */
  if (!member(s.room)) return { why: 'not in this room' }
  const len = `${Math.floor(s.seconds / 60)}:${String(Math.floor(s.seconds) % 60).padStart(2, '0')}`
  const msgId = 'pv-sent-' + Date.now()
  const fixture = {
    id: msgId,
    room_id: s.room,
    user_id: PREVIEW_ME.id,
    author_name: PREVIEW_ME.name,
    body: `🎵 ${s.name} (${len})`,
    created_at: new Date().toISOString(),
  }
  /* into the fixture as well, so reopening the room still has it — see sendToThread */
  previewMsgs()[s.room] = [...(previewMsgs()[s.room] ?? []), fixture]
  s.message_id = msgId
  const isLounge = roomOf(s.room)?.kind === 'lounge'
  return {
    msg: {
      id: msgId,
      room_id: s.room,
      author_user_id: isLounge ? null : PREVIEW_ME.id,
      author_name: PREVIEW_ME.name,
      author_username: null,
      mine: true,
      body: fixture.body,
      created_at: fixture.created_at,
    },
    song: strip({ ...s, message_id: msgId }),
  }
}

/**
 * The harness's `play`: a short tone rather than a recording, made when ▶ is pressed. The same
 * refusal as `chat_song_get` for anything removed, never sent, or not in a room you are in.
 *
 * ⚠️ ONE SONG IS BYTES NO BROWSER CAN PLAY (`broken`), so the pane can see a player end on "this
 * browser can't play" rather than offering ▶ for ever.
 */
export function pvPlayUrl(fileId: string): { url: string } | { why: string } {
  const s = rows().find((x) => x.file_id === fileId)
  if (!s || s.removed || !s.message_id || !member(s.room)) return { why: 'no such song' }
  if (s.broken) return { url: URL.createObjectURL(new Blob(['not a recording'], { type: s.mime })) }
  const rate = 8000
  const tone = new Float32Array(rate * 2)
  for (let i = 0; i < tone.length; i++)
    tone[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / rate) * (1 - i / tone.length)
  return { url: URL.createObjectURL(toWav(tone, rate)) }
}

/** the harness's chat_song_remove: your own, not already gone, sent or not */
export function pvRemoveSong(fileId: string): { why: string } | null {
  const s = rows().find((x) => x.file_id === fileId)
  if (!s || !s.mine || s.removed) return { why: 'no such song' }
  s.removed = true
  return null
}
