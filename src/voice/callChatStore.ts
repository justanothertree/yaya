// Text for a call that has no conversation to put it in.
//
// A call in a DM, a circuit or the Lounge is a call in a chat room: its id IS the room's, so the
// anchor's chat panel shows that room's own thread and what you type is kept. A call on
// somebody's PROFILE is not — profile_rooms are not chat rooms, send_chat_message would refuse
// them, and there is nowhere for a message to be stored. This is the chat for those calls.
//
// ⚠️ IT RIDES THE CALL'S OWN CHANNEL, AND THAT IS THE WHOLE PERMISSION STORY — the same one
// voiceSession spells out for pointers. `voice:<room>` is gated server-side before anybody may
// join the topic, so the audience for a line of text is by construction the audience that can
// already hear you say it aloud. No table, no migration, no second copy of who is allowed.
//
// ⚠️ AND IT LASTS AS LONG AS THE CALL DOES, FOR EACH PERSON SEPARATELY. Nothing is stored, so
// somebody who joins late does not see what was said before they arrived, and hanging up clears
// it. The panel says so, because a chat that forgets without warning reads as a chat that lost
// your messages.
import { useSyncExternalStore } from 'react'
import { onParty, sendParty, voiceSession } from './voiceSession'
import type { Msg } from '../circuit/chatRooms'

/** the room_id every message here carries — there is no room, but MessageLog keys a thread on one */
const ROOM = 'call'
const MAX_TEXT = 2000
/** how many lines are kept; a long call's chat should not grow without end in a tab's memory */
const KEEP = 300

let msgs: Msg[] = []
let callRoom: string | null = null
const listeners = new Set<() => void>()
let wired = false

function push(m: Msg) {
  msgs = [...msgs, m].slice(-KEEP)
  for (const fn of listeners) fn()
}

/**
 * Start listening, once, for as long as the page lives.
 *
 * ⚠️ NOT WHEN THE PANEL OPENS. A message sent while yours is closed has to be there when you
 * open it, and has to be able to put a count on the button — so the listener cannot belong to
 * a component that is only mounted while you are looking.
 */
function wire() {
  if (wired) return
  wired = true
  onParty((m) => {
    if (m.kind !== 'chat') return
    /* ⚠️ everything here was put on the wire by another member's browser, and the client that
       put it there is one anybody can rewrite: take a string, bound it, and render it as text */
    const text = (m.body as { text?: unknown } | null)?.text
    if (typeof text !== 'string' || !text.trim()) return
    push({
      id: `${m.from}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      room_id: ROOM,
      author_user_id: m.from,
      author_name: String(m.name ?? '').slice(0, 40) || 'Someone',
      // never a profile link: the name came from the sender's own client, not from the server
      author_username: null,
      mine: false,
      body: text.slice(0, MAX_TEXT),
      created_at: new Date().toISOString(),
    })
  })
  /* a different call, or no call, is a different (empty) chat */
  voiceSession.subscribe(() => {
    const s = voiceSession.getState()
    const now = s.inCall ? s.roomId : null
    if (now === callRoom) return
    callRoom = now
    if (msgs.length) {
      msgs = []
      for (const fn of listeners) fn()
    }
  })
  const s = voiceSession.getState()
  callRoom = s.inCall ? s.roomId : null
}

function subscribe(fn: () => void) {
  wire()
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const snapshot = () => msgs

/** this call's own messages, oldest first */
export function useCallChat(): Msg[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Say something to everybody in the call. Resolves to what went wrong, or null. */
export async function sendCallChat(text: string): Promise<string | null> {
  const body = text.trim().slice(0, MAX_TEXT)
  if (!body) return null
  if (!voiceSession.getState().inCall) return 'You are not in a call any more.'
  sendParty('chat', { text: body })
  // the channel does not echo your own broadcast back, so your copy is added here
  push({
    id: `me:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    room_id: ROOM,
    author_user_id: null,
    author_name: 'You',
    author_username: null,
    mine: true,
    body,
    created_at: new Date().toISOString(),
  })
  return null
}
