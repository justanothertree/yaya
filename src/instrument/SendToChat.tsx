import { useEffect, useState } from 'react'
import { sharedCtx } from '../audio/context'
import { getSupabaseClientOrNull } from '../finance/client'
import { previewMember } from '../dev/previewMember'
import { pvChatRooms } from '../dev/chatSongsPreview'
import { roomIcon, type Overview } from '../circuit/chatRooms'
import { sendSong, songSeconds } from '../circuit/chatSongs'

/** a song's name is 60 characters at most, counted as the server counts them (code points) */
const cap = (s: string) => Array.from(s).slice(0, 60).join('')

/**
 * How long the file being sent is, in whole seconds, read from the file itself.
 *
 * ⚠️ THE SMALL FILE, NOT THE EXPORT'S OWN FIGURE. The WAV is cut where the song starts and where
 * its sound falls away; the small copy is encoded as it plays, so it carries the lead and the
 * whole tail too. The label a chat shows belongs to the file a chat plays. Only if this browser
 * cannot decode its own recording is the WAV's length used, which is the same song give or take
 * the tail — better than refusing to send it.
 */
async function lengthOf(blob: Blob, fallback: number): Promise<number> {
  try {
    const buf = await sharedCtx().decodeAudioData(await blob.arrayBuffer())
    return songSeconds(Number.isFinite(buf.duration) ? buf.duration : fallback)
  } catch {
    return songSeconds(fallback)
  }
}

/**
 * 💬 Send in a chat, under ⬇ Export song: a recording, into one of your conversations.
 * Evan, 21 Nov 2026: "shared songs become a chat attachment" (docs/2026-11-22-chat-songs.md).
 *
 * ⚠️ A PICKER IN THE PAGE, NEVER `window.prompt`: the room is a choice from a list, not something
 * to type, and `prompt` throws in the Browser pane. The chat starts unchosen on purpose — a song
 * sent to the Lounge instead of a DM is not something to have happen by default.
 *
 * ⚠️ THE STATUS LINE IS ALWAYS MOUNTED, so a screen reader hears "Sending…" and "Sent" arrive: a
 * live region that appears with its text in it is often not announced at all.
 */
export function SendToChat({
  open,
  id,
  blob,
  fallbackSeconds,
  kept,
  onClose,
}: {
  open: boolean
  /** for the button that opens this, to name what it controls */
  id: string
  /** the export's small file: M4A, WebM or Ogg — never the WAV */
  blob: Blob
  /** the export's own length, used only when the file will not decode */
  fallbackSeconds: number
  /** the song's kept name, offered as the name to send it under */
  kept: string | null
  onClose: () => void
}) {
  const [rooms, setRooms] = useState<Overview[] | null>(null)
  const [to, setTo] = useState('')
  const [title, setTitle] = useState('')
  const [sending, setSending] = useState(false)
  const [said, setSaid] = useState<{ text: string; room?: Overview } | null>(null)

  /* each opening offers the kept name again and reads the chats afresh: the bench may be another
     song by now, and a chat joined meanwhile should be there */
  useEffect(() => {
    if (!open) return
    let live = true
    setTitle(cap(kept ?? ''))
    setTo('')
    setSaid(null)
    setRooms(null)
    void (async () => {
      let list: Overview[] | null
      if (previewMember) list = pvChatRooms()
      else {
        const sb = getSupabaseClientOrNull()
        const r = sb ? await sb.rpc('list_chat_overview') : null
        list = r && !r.error ? ((r.data as Overview[] | null) ?? []) : null
      }
      if (!live) return
      if (list === null) setSaid({ text: 'Couldn’t load your chats.' })
      else if (!list.length) setSaid({ text: 'You’re not in any chats yet.' })
      setRooms(list ?? [])
    })()
    return () => {
      live = false
    }
  }, [open, kept])

  const send = async () => {
    const room = rooms?.find((r) => r.id === to)
    if (!room || !title.trim() || sending) return
    setSending(true)
    setSaid({ text: 'Sending…' })
    try {
      const seconds = await lengthOf(blob, fallbackSeconds)
      const r = await sendSong(room.id, blob, title, seconds)
      if ('why' in r) setSaid({ text: r.why })
      else {
        setSaid({ text: `Sent to ${room.name}.`, room })
        onClose()
      }
    } catch {
      setSaid({ text: 'That song didn’t send.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="inst-send">
      {open && (
        <div className="inst-send-pick" id={id}>
          <label className="inst-pick inst-send-chat">
            Chat
            <select
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={!rooms?.length || sending}
            >
              <option value="">{rooms === null ? 'Loading…' : 'Choose one'}</option>
              {rooms?.map((r) => (
                <option key={r.id} value={r.id}>
                  {roomIcon(r.kind)} {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="inst-pick inst-send-name">
            Name
            <input
              value={title}
              onChange={(e) => setTitle(cap(e.target.value))}
              placeholder="Name this song"
              disabled={sending}
            />
          </label>
          <button
            className="btn"
            disabled={!to || !title.trim() || sending}
            onClick={() => void send()}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={sending}>
            Cancel
          </button>
        </div>
      )}
      <p className="muted inst-send-say" role="status">
        {said?.text}
        {said?.room && (
          <>
            {' '}
            <a href={`#chat?room=${encodeURIComponent(said.room.id)}`}>Open the chat</a>
          </>
        )}
      </p>
    </div>
  )
}
