// One conversation's messages, loaded once and followed live, for however many places are
// showing it.
//
// ⚠️ THIS EXISTS BECAUSE A CONVERSATION CAN NOW BE ON SCREEN TWICE: in Chat, and in the call
// anchor's panel, which follows you to every page including that one. Each used to be a
// component with its own `sb.channel('chat:' + room)` — and two subscribers to one topic are not
// two channels. realtime-js dedupes by topic, so whichever unmounted first removed the channel
// out from under the other, which then sat there looking subscribed and receiving nothing. The
// same trap App's voice presence is handed down to avoid. So the channel lives HERE, counted:
// the first watcher opens it, the last one closes it, and nobody else touches it.
import { useCallback, useSyncExternalStore } from 'react'
import { getSupabaseClient } from '../finance/client'
import { notificationsChanged } from '../hooks/notifySignal'
import {
  previewMember,
  PREVIEW_ME,
  PREVIEW_PEOPLE,
  PREVIEW_UNREAD,
  previewMsgs,
} from '../dev/previewMember'
import type { Msg } from './chatRooms'
import { mergeSongs, songsIn, type ChatSong } from './chatSongs'

export type ThreadState = {
  msgs: Msg[]
  /** false until the first read has come back — an empty room and an unread one look alike */
  loaded: boolean
  err: string | null
  /**
   * The songs sent into this room, by message id (chatSongs.ts). Empty until they are read, and
   * empty for good while the server has none — the messages are drawn as their text then.
   */
  songs: Record<string, ChatSong>
}

const EMPTY: ThreadState = { msgs: [], loaded: false, err: null, songs: {} }

type Thread = {
  state: ThreadState
  listeners: Set<() => void>
  /** how many of the listeners are a person LOOKING at it — see `viewing` on useThread */
  viewers: number
  stop: (() => void) | null
}

const threads = new Map<string, Thread>()

function set(roomId: string, patch: Partial<ThreadState>) {
  const t = threads.get(roomId)
  if (!t) return
  t.state = { ...t.state, ...patch }
  for (const fn of t.listeners) fn()
}

/** append, unless it is already here — the sender's own copy and the realtime echo both arrive */
function add(roomId: string, m: Msg) {
  const t = threads.get(roomId)
  if (!t || t.state.msgs.some((x) => x.id === m.id)) return
  set(roomId, { msgs: [...t.state.msgs, m] })
}

/**
 * Ask the room's songs again, and fold the answer in. A refusal is not drawn: a thread whose
 * songs cannot be read is still a thread, and its song messages read as the text they are.
 */
function askSongs(roomId: string) {
  void songsIn(roomId).then((r) => {
    const t = threads.get(roomId)
    if (!t || !('songs' in r)) return
    set(roomId, { songs: mergeSongs(t.state.songs, r.songs) })
  })
}

/**
 * A message that arrived by another road (sendSong), with the song it carries.
 *
 * ⚠️ ONLY FOR A THREAD SOMEBODY IS FOLLOWING. A room nobody has open has nothing to add to, and
 * its first read will bring both.
 */
export function addToThread(roomId: string, m: Msg, song?: ChatSong) {
  if (!threads.has(roomId)) return
  add(roomId, m)
  const t = threads.get(roomId)
  if (song && t) set(roomId, { songs: mergeSongs(t.state.songs, { [song.message_id]: song }) })
}

/** A song was taken down: every open thread holding it says so. */
export function songGone(fileId: string) {
  for (const [roomId, t] of threads) {
    const hit = Object.values(t.state.songs).find((s) => s.file_id === fileId)
    if (hit)
      set(roomId, { songs: { ...t.state.songs, [hit.message_id]: { ...hit, removed: true } } })
  }
}

/** Read a room's songs again — after ▶ was refused, which is how a song removed elsewhere is found. */
export function refreshSongs(roomId: string) {
  if (threads.has(roomId)) askSongs(roomId)
}

/** the dev harness's read: the fixture, shaped the way list_room_messages shapes a real room */
function previewRead(roomId: string, kind: string): Msg[] {
  return (previewMsgs()[roomId] ?? []).map((m) => ({
    id: m.id,
    room_id: m.room_id,
    // Mirror what list_room_messages does server-side, so the harness exercises the real rule:
    // identity everywhere except the lounge, where the name stays unlinkable.
    author_user_id: kind === 'lounge' ? null : m.user_id,
    author_name: m.author_name,
    author_username:
      kind === 'lounge'
        ? null
        : (PREVIEW_PEOPLE.find((p) => p.name === m.author_name)?.username ?? null),
    mine: m.user_id === PREVIEW_ME.id,
    body: m.body,
    created_at: m.created_at,
  }))
}

function start(roomId: string, kind: string): () => void {
  if (previewMember) {
    set(roomId, { msgs: previewRead(roomId, kind), loaded: true })
    askSongs(roomId)
    return () => {}
  }
  const sb = getSupabaseClient()
  let live = true
  /* who "me" is, for recognising our own message in a realtime row. Resolved here rather than
     passed in: two callers passing two answers is a disagreement this file would have to settle */
  let me: string | null = null
  void sb.auth.getSession().then(({ data }) => {
    me = data.session?.user.id ?? null
  })
  // ⚠️ Through the RPC, not `from('chat_messages').select('*')`. The RPC returns an identity
  // only where it's the author's to show. The table itself no longer holds one for the
  // Lounge at all — see the lounge_message_authors migration — so neither this read nor the
  // realtime payload below can carry the alias away, whichever way someone reaches for it.
  void sb.rpc('list_room_messages', { p_room: roomId, p_limit: 50 }).then(({ data, error }) => {
    if (!live) return
    if (error) return set(roomId, { err: error.message, loaded: true })
    const read = ((data as Msg[]) ?? []).slice().reverse()
    /* keep anything that arrived over realtime while the read was in flight */
    const have = threads.get(roomId)?.state.msgs ?? []
    const extra = have.filter((m) => !read.some((x) => x.id === m.id))
    set(roomId, { msgs: [...read, ...extra], loaded: true })
  })
  /* beside the first read, not after it: the two answers are independent, and the songs map is
     keyed by message id, so whichever lands second finds the other already there */
  askSongs(roomId)
  const ch = sb
    // private: gated on being in this room, so a non-member can't even hold the subscription
    // open. The row payloads were already filtered by chat_messages' RLS — this is depth.
    .channel('chat:' + roomId, { config: { private: true } })
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
      (payload) => {
        // The raw table row. `user_id` is null for every lounge message now — the column
        // holds nothing there, so this payload cannot carry the alias away with it.
        const row = payload.new as {
          id: string
          room_id: string
          user_id: string | null
          author_name: string
          body: string
          created_at: string
        }
        const t = threads.get(roomId)
        if (!t) return
        // Resolve the username the way the RPC would, from authors already loaded for THIS
        // room, rather than trusting anything in the payload. Guarded on a non-null id:
        // matching null against null would pair a lounge message with the first other
        // lounge message in the list, which is the exact link this is meant to prevent.
        const known = row.user_id
          ? t.state.msgs.find((x) => x.author_user_id === row.user_id)
          : null
        add(roomId, {
          id: row.id,
          room_id: row.room_id,
          author_user_id: known ? row.user_id : null,
          author_name: row.author_name,
          author_username: known?.author_username ?? null,
          // A lounge echo of your OWN message has no id to match, so it can't be recognised
          // as yours here — send() already added it with mine:true, and this dedupes by id.
          mine: !!row.user_id && row.user_id === me,
          body: row.body,
          created_at: row.created_at,
        })
        /**
         * A song may have arrived with it, so the room's songs are asked again.
         *
         * ⚠️ THE PREFIX IS A CHEAP FILTER, NEVER THE ANSWER. Every song's message begins `🎵 `
         * (send_chat_song writes it), so a message that does not cannot be one and costs nothing;
         * a message that does is only a song if `chat_songs_in` says so, because anybody can type
         * the same text. The message and its song are written in one transaction and realtime
         * delivers after the commit, so the song is there to be found.
         */
        if (typeof row.body === 'string' && row.body.startsWith('🎵 ')) askSongs(roomId)
        /**
         * Somebody is looking at it, so keep it read. The bell reloads off this same INSERT,
         * so without announcing after the write lands it races us and badges a room you are
         * actively reading — with nothing left to re-read and clear it.
         *
         * ⚠️ ONLY WHILE SOMEBODY IS LOOKING. The call anchor follows a call's conversation the
         * whole time you are in the call, panel open or not, so it can tell you a message
         * arrived. Marking read on arrival for THAT watcher would clear the unread of a
         * message nobody has seen — the bell would go quiet about exactly the thing the
         * anchor's own badge is announcing.
         */
        if (t.viewers > 0)
          void sb.rpc('mark_room_read', { p_room: row.room_id }).then(() => notificationsChanged())
      },
    )
    .subscribe((status, err) => {
      if (status !== 'SUBSCRIBED' && status !== 'CLOSED')
        console.warn(
          `[realtime] chat:<room>: ${status}${err ? ` — ${err.message}` : ''} (not live)`,
        )
    })
  return () => {
    live = false
    void sb.removeChannel(ch)
  }
}

/** Follow a room. Exported for the test; components use `useThread`. */
export function watchThread(
  roomId: string,
  kind: string,
  viewing: boolean,
  fn: () => void,
): () => void {
  let t = threads.get(roomId)
  if (!t) {
    t = { state: EMPTY, listeners: new Set(), viewers: 0, stop: null }
    threads.set(roomId, t)
  }
  t.listeners.add(fn)
  if (viewing) t.viewers++
  if (!t.stop) t.stop = start(roomId, kind)
  const mine = t
  return () => {
    mine.listeners.delete(fn)
    if (viewing) mine.viewers--
    /**
     * ⚠️ NOT TORN DOWN ON THE SPOT. A watcher that only changes HOW it is watching — the
     * anchor's panel opening, which turns a follower into a viewer — unsubscribes and
     * resubscribes in the same breath, and so does every mount under React's StrictMode. Closing
     * the channel at zero would close and reopen it each time and re-read the room. One turn of
     * the event loop is enough to see whether anybody came back.
     */
    setTimeout(() => {
      if (mine.listeners.size > 0 || threads.get(roomId) !== mine) return
      mine.stop?.()
      threads.delete(roomId)
    }, 0)
  }
}

/** A room's thread as it stands, or an empty one when nobody is following it. */
export function threadNow(roomId: string): ThreadState {
  return threads.get(roomId)?.state ?? EMPTY
}

/**
 * A conversation's messages, live.
 *
 * @param viewing whether a person is LOOKING at this — true for an open thread, false for
 *   something that only follows along (the call anchor with its panel closed). Arrivals are
 *   marked read only while somebody is.
 */
export function useThread(roomId: string | null, kind: string, viewing = true): ThreadState {
  const subscribe = useCallback(
    (fn: () => void) => (roomId ? watchThread(roomId, kind, viewing, fn) : () => {}),
    [roomId, kind, viewing],
  )
  const snap = () => (roomId ? threadNow(roomId) : EMPTY)
  return useSyncExternalStore(subscribe, snap, snap)
}

/**
 * Say something in a room. Resolves to what went wrong, or null.
 *
 * Through send_chat_message, which resolves the author's name server-side so it can't be
 * spoofed, and returns the same shape list_room_messages does — which is what gives your own
 * message its `mine` flag at once, and in the lounge keeps it from saying who wrote it even to
 * the person who did.
 */
export async function sendToThread(roomId: string, text: string): Promise<string | null> {
  const body = text.trim()
  if (!body) return null
  if (previewMember) {
    const fixture = {
      id: 'pv' + Date.now(),
      room_id: roomId,
      user_id: PREVIEW_ME.id,
      author_name: PREVIEW_ME.name,
      body,
      created_at: new Date().toISOString(),
    }
    // the fixture store too: it is what the next read of this room, and the list's preview
    // line, are built from — a message only in this file's copy would vanish on reopening
    previewMsgs()[roomId] = [...(previewMsgs()[roomId] ?? []), fixture]
    add(roomId, { ...fixture, author_user_id: fixture.user_id, author_username: null, mine: true })
    return null
  }
  const { data, error } = await getSupabaseClient().rpc('send_chat_message', {
    p_room: roomId,
    p_body: body,
  })
  if (error) return error.message
  // ⚠️ send_chat_message returns a SET, so this is an array
  const m = (data as unknown as Msg[] | null)?.[0]
  if (m?.id) add(roomId, m)
  return null
}

/** You have seen this room: clear its unread, here and for the bell. */
export function markThreadRead(roomId: string) {
  if (previewMember) {
    PREVIEW_UNREAD[roomId] = 0
    notificationsChanged()
    return
  }
  void getSupabaseClient()
    .rpc('mark_room_read', { p_room: roomId })
    .then(() => notificationsChanged())
}
