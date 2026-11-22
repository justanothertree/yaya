import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { sharedCtx } from '../audio/context'
import { getSupabaseClientOrNull } from '../finance/client'
import { previewMember } from '../dev/previewMember'
import { pvChatRooms, pvDirectory } from '../dev/chatSongsPreview'
import { roomIcon, type Overview } from '../circuit/chatRooms'
import {
  SONGS_OFF,
  lengthLabel,
  nameCap,
  removeSong,
  roomChoices,
  songSeconds,
  songsMine,
  usedLabel,
  type MySong,
} from '../circuit/chatSongs'
import { sendOutcome, sendToChat, subscribeSendOutcome } from './sendOutcome'

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

/** the chats you are in, and the usernames a DM's name may need to be told apart by */
async function loadChoices(): Promise<{ id: string; kind: string; name: string }[] | null> {
  let rooms: Overview[] | null
  let people: { user_id: string; username: string }[] = []
  if (previewMember) {
    rooms = pvChatRooms()
    people = pvDirectory()
  } else {
    const sb = getSupabaseClientOrNull()
    if (!sb) return null
    /* the directory only names a DM's person; without it the picker still works, by place */
    const [r, d] = await Promise.all([
      sb.rpc('list_chat_overview'),
      sb.rpc('list_member_directory'),
    ])
    if (r.error) return null
    rooms = (r.data as Overview[] | null) ?? []
    if (!d.error) people = (d.data as { user_id: string; username: string }[] | null) ?? []
  }
  const byId = new Map(people.map((p) => [p.user_id, p.username]))
  return roomChoices(rooms, (id) => byId.get(id) ?? null)
}

/**
 * 💬 Send in a chat, under ⬇ Export song: a recording, into one of your conversations.
 * Evan, 21 Nov 2026: "shared songs become a chat attachment" (docs/2026-11-22-chat-songs.md).
 *
 * ⚠️ A PICKER IN THE PAGE, NEVER `window.prompt`: the room is a choice from a list, not something
 * to type, and `prompt` throws in the Browser pane. The chat starts unchosen on purpose — a song
 * sent to the Lounge instead of a DM is not something to have happen by default.
 *
 * ⚠️ HOW THE SEND WENT IS NOT DRAWN HERE. It is {@link SendStatus}, which ExportSong keeps mounted
 * whether or not this is, reading sendOutcome.ts — see there for why.
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
  const [rooms, setRooms] = useState<{ id: string; kind: string; name: string }[] | null>(null)
  const [roomsSay, setRoomsSay] = useState('')
  const [to, setTo] = useState('')
  const [title, setTitle] = useState('')
  const outcome = useSyncExternalStore(subscribeSendOutcome, sendOutcome, sendOutcome)
  /* any send in flight, this export's or an earlier one's: one at a time (sendOutcome.ts) */
  const sending = outcome?.state === 'sending'
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /* each opening offers the kept name again and reads the chats afresh: the bench may be another
     song by now, and a chat joined meanwhile should be there. It does NOT clear how the last send
     went — reopening is how somebody comes back to read that. */
  useEffect(() => {
    if (!open) return
    let live = true
    setTitle(nameCap(kept ?? ''))
    setTo('')
    setRoomsSay('')
    setRooms(null)
    void loadChoices().then((list) => {
      if (!live) return
      if (list === null) setRoomsSay('Couldn’t load your chats.')
      else if (!list.length) setRoomsSay('You’re not in any chats yet.')
      setRooms(list ?? [])
    })
    return () => {
      live = false
    }
  }, [open, kept])

  const send = async () => {
    const room = rooms?.find((r) => r.id === to)
    if (!room || !title.trim() || sending) return
    const went = await sendToChat(blob, room, title, () => lengthOf(blob, fallbackSeconds))
    /* only this picker closes, and only if it is still here: a picker for a newer export may be
       open by the time an older send lands, and it is not this send's to close */
    if (went && alive.current) onClose()
  }

  return (
    <div className="inst-send">
      {open && (
        <div className="inst-send-pick" id={id}>
          <div className="inst-send-form">
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
                onChange={(e) => setTitle(nameCap(e.target.value))}
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
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
          {roomsSay && <p className="muted inst-send-say">{roomsSay}</p>}
          <YourSongs again={outcome?.state} />
        </div>
      )}
    </div>
  )
}

/**
 * How the last send went — always mounted where it is shown (ExportSong), so a screen reader hears
 * "Sending…" and "Sent" arrive: a live region that appears with its text in it is often not
 * announced at all.
 */
export function SendStatus() {
  const outcome = useSyncExternalStore(subscribeSendOutcome, sendOutcome, sendOutcome)
  return (
    <p className="muted inst-send-say" role="status">
      {outcome?.text}
      {outcome?.room && (
        <>
          {' '}
          <a href={`#chat?room=${encodeURIComponent(outcome.room.id)}`}>Open the chat</a>
        </>
      )}
    </p>
  )
}

/**
 * "Your songs in chat": every song of yours that still counts toward 25 MB, and Remove.
 *
 * ⚠️ BESIDE SEND, BECAUSE THAT IS WHERE THE CEILING IS MET. "Your songs in chat come to 25 MB —
 * remove one first" is the claim's answer, and before this the only Remove was a ▶ in a thread —
 * which a song sent to a chat you have left, or one that went up and was never sent, does not
 * have. So the refusal named a remedy nobody could reach.
 *
 * ⚠️ REMOVE IS TWO PRESSES, INLINE, NOT `window.confirm` — the Pictures pattern: the second press
 * says what it will do, a phone has no modal to mis-tap, and the Browser pane can drive it.
 *
 * @param again re-read when a send settles: it may have added one
 */
function YourSongs({ again }: { again: string | undefined }) {
  const [list, setList] = useState<MySong[] | null>(null)
  const [off, setOff] = useState(false)
  const [sure, setSure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState('')

  const load = useCallback(async () => {
    const r = await songsMine()
    if ('songs' in r) {
      setOff(false)
      setList(r.songs)
    } else if (r.why === SONGS_OFF) setOff(true)
    else setSay(r.why)
  }, [])

  useEffect(() => {
    if (again === 'sending') return
    void load()
  }, [again, load])

  const remove = async (s: MySong) => {
    if (busy) return
    if (sure !== s.file_id) return setSure(s.file_id)
    setSure(null)
    setBusy(true)
    setSay('')
    const bad = await removeSong(s.file_id)
    setBusy(false)
    if (bad) setSay(bad.why)
    await load()
  }

  /* nothing at all while the server has no songs, and nothing to list until there is one */
  if (off) return null
  if (!list || !list.length)
    return say ? (
      <p className="muted inst-send-say" role="status">
        {say}
      </p>
    ) : null
  const used = list.reduce((n, s) => n + s.bytes, 0)

  return (
    <section className="inst-send-mine" aria-label="Your songs in chat">
      <p className="inst-send-mine-head">
        Your songs in chat <span className="muted">· {usedLabel(used)}</span>
      </p>
      <ul className="inst-send-mine-list">
        {list.map((s) => (
          <li key={s.file_id} className="inst-send-mine-one">
            <span className="inst-send-mine-name">
              {s.sent && s.room_kind ? roomIcon(s.room_kind) + ' ' : ''}
              {s.name}
            </span>
            <span className="muted inst-send-mine-len">
              {lengthLabel(s.seconds)}
              {s.sent ? '' : ' · not sent'}
            </span>
            <span className="inst-send-mine-act">
              {sure === s.file_id && (
                <span className="inst-send-mine-sure">
                  {s.sent ? 'Remove it for everyone?' : 'Remove it?'}
                </span>
              )}
              <button
                className={'btn btn-ghost inst-send-mine-x' + (sure === s.file_id ? ' is-on' : '')}
                onClick={() => void remove(s)}
                disabled={busy}
                aria-label={sure === s.file_id ? `Remove ${s.name}` : `Remove ${s.name}…`}
              >
                {sure === s.file_id ? 'Remove' : 'Remove…'}
              </button>
              {sure === s.file_id && (
                <button className="btn btn-ghost inst-send-mine-x" onClick={() => setSure(null)}>
                  Keep it
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {say && (
        <p className="muted inst-send-say" role="status">
          {say}
        </p>
      )}
    </section>
  )
}
