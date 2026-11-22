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
import {
  MAX_TEXT,
  ROOM,
  appendCapped,
  readChatName,
  readChatText,
  roomChange,
  senderGate,
} from './callChatLog'

let msgs: Msg[] = []
let callRoom: string | null = null
const listeners = new Set<() => void>()
let wired = false

/* one bucket per sender — see `senderGate`, and why this drops rather than delays */
const gate = senderGate()

function push(m: Msg) {
  msgs = appendCapped(msgs, m)
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
    const text = readChatText(m)
    if (text === null) return
    /* ⚠️ over their rate is DROPPED, not queued — two chat lines are two different sentences, so
       delaying them would reorder a conversation against the voices saying the same words aloud */
    if (!gate.allow(String(m.from ?? ''))) return
    push({
      id: `${m.from}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      room_id: ROOM,
      author_user_id: m.from,
      author_name: readChatName(m.name),
      // never a profile link: the name came from the sender's own client, not from the server
      author_username: null,
      mine: false,
      body: text,
      created_at: new Date().toISOString(),
    })
  })
  /* a different call, or no call, is a different (empty) chat */
  voiceSession.subscribe(() => {
    const s = voiceSession.getState()
    const now = s.inCall ? s.roomId : null
    const { changed, clear } = roomChange(callRoom, now, msgs.length)
    if (!changed) return
    callRoom = now
    /* a new call starts everybody at full tokens; the old call's rates mean nothing here */
    gate.forget()
    if (clear) {
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
