import { useEffect, useRef, useState } from 'react'
import { onParty, sendParty } from '../../voice/voiceSession'
import { cleanLine, mayTalk, readLiveLine } from '../matches/chat'
import { ChatHud, type HudLine } from '../matches/ChatHud'
import { seatOf, type Rules } from './room'
import { tableSeats, type Table } from './table'

/** the party's kind for a live match's chat line: `{ sub, text }` (chat.ts, readLiveLine) */
export const CHAT_KIND = 'labchat'
/** a live chat keeps this many lines on the page and no more; nothing is kept anywhere else */
const KEEP = 40

/**
 * A live game's chat, in a call: the snake games' kind of chat, for every Lab toy played at a
 * table (CallTable mounts it; Four in a row, which draws its own table, mounts it itself).
 *
 * ⚠️ NOTHING IS KEPT. A line travels as the party's `labchat` kind on the call's own channel, which
 * realtime.messages RLS already limits to the call (voiceSession.ts, "THE CALL IS THE PARTY"), and
 * lives in this page's memory until the page goes. No table, no migration.
 *
 * ⚠️ ONLY THE TWO SEATED PLAYERS SEE IT OR WRITE IN IT, as Evan asked: the panel is shown only to a
 * seated player, and a line is shown only when it came from somebody seated at this toy's table.
 * What this cannot do, being on the call's channel, is keep the bytes from the call's other members'
 * browsers — the same people who can already hear the call — which would take a topic of its own
 * per table. A watcher's page drops them unread.
 *
 * Five lines in four seconds, as the snake games' relay allows (chat.ts, mayTalk).
 */
export function CallChat<G, M>({ table, rules }: { table: Table<G, M>; rules: Rules<G, M> }) {
  const { room, who, mySeat } = tableSeats(table, rules)
  const [lines, setLines] = useState<HudLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const times = useRef<number[]>([])
  const n = useRef(0)
  // the listener reads the room as it is now, without being made again on every move
  const roomRef = useRef(room)
  roomRef.current = room
  const namesRef = useRef(table.names)
  namesRef.current = table.names

  const sub = room?.sub ?? null
  // the pair at the table: a new pair is a new conversation
  const pair = room ? [...room.seats].sort().join(',') : ''
  useEffect(() => {
    setLines([])
    setError(null)
    times.current = []
  }, [sub, pair])

  useEffect(() => {
    if (!sub) return
    return onParty((m) => {
      if (m.kind !== CHAT_KIND) return
      const text = readLiveLine(m.body, sub)
      const r = roomRef.current
      // read only by a seated player, and only from somebody seated at this table
      if (!text || !r || seatOf(r) === null || !r.seats.includes(m.from)) return
      const name = namesRef.current[m.from] ?? (m.name || 'A friend')
      setLines((held) => [
        ...held.slice(-(KEEP - 1)),
        { key: ++n.current, who: name, mine: false, text },
      ])
    })
  }, [sub])

  if (!room || !table.live || mySeat === null) return null
  const them = room.seats[mySeat === 0 ? 1 : 0]

  const send = (raw: string) => {
    const text = cleanLine(raw)
    if (!text) return false
    const t = mayTalk(times.current, Date.now())
    times.current = t.times
    if (!t.ok) {
      setError('Five lines in four seconds is the most. Give it a moment.')
      return false
    }
    setError(null)
    sendParty(CHAT_KIND, { sub: room.sub, text })
    // the call's channel does not echo a line to its sender, so ours is added here
    setLines((held) => [
      ...held.slice(-(KEEP - 1)),
      { key: ++n.current, who: 'You', mine: true, text },
    ])
    return true
  }

  return (
    <ChatHud
      label={them ? `Chat with ${who(them)}` : 'Chat at the table'}
      lines={lines}
      onSend={send}
      error={error}
      empty={
        them
          ? `Only you and ${who(them)} see this, and only while the call lasts.`
          : 'When somebody sits down opposite you, you can talk here.'
      }
    />
  )
}
