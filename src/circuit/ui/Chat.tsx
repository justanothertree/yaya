import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '../../finance/client'
import {
  previewMember,
  PREVIEW_ME,
  PREVIEW_MSGS,
  PREVIEW_UNREAD,
  previewOverview,
  PREVIEW_LOUNGE_IN,
} from '../../dev/previewMember'
import { notificationsChanged } from '../../hooks/notifySignal'
import { useVoiceSession } from '../../voice/useVoiceSession'
import { useVoicePresence } from '../../voice/useVoicePresence'
import { VoiceBar } from '../../voice/VoiceBar'

/**
 * Chat — a real messaging screen, not a row of room chips. You land on a list of
 * conversations (last message + who said it + unread badge, newest first) and tap one to
 * open its thread; on a phone the list and the thread take turns, on a wide screen they sit
 * side by side. One rooms model still serves every shape: each circuit has a room, The
 * Lounge is everyone with an account, and DMs come from friendships.
 *
 * Reads ride RLS directly (realtime included); sends go through send_chat_message, which
 * resolves the author's name server-side so it can't be spoofed. The list comes from
 * list_chat_overview, and opening a room calls mark_room_read to clear its badge.
 */

type Room = { id: string; kind: string; name: string }
type Overview = Room & {
  last_body: string | null
  last_author: string | null
  last_at: string | null
  unread: number
}
type Msg = {
  id: string
  room_id: string
  user_id: string
  author_name: string
  body: string
  created_at: string
}

const roomIcon = (kind: string) => (kind === 'lounge' ? '🛋️' : kind === 'dm' ? '✉️' : '👥')

/** compact "when" for a conversation row: 4:07 PM today, weekday this week, else a date */
function whenLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const days = (now.getTime() - d.getTime()) / 86400000
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}

export function Chat({ authed = false }: { authed?: boolean }) {
  // DEV member preview: render with fake rooms/messages, no Supabase session (see previewMember)
  const sb = authed && !previewMember ? getSupabaseClient() : null
  const [rooms, setRooms] = useState<Overview[]>([])
  const [room, setRoom] = useState<Room | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [me, setMe] = useState<string | null>(previewMember ? PREVIEW_ME.id : null)
  // The Lounge is opt-in: nobody is placed in a room with every other account by
  // default. null = not looked up yet, so the invite card doesn't flash on load.
  const [loungeIn, setLoungeIn] = useState<boolean | null>(previewMember ? PREVIEW_LOUNGE_IN : null)
  const [loungeBusy, setLoungeBusy] = useState(false)
  // Voice rides the room you're already in: a DM is a 1:1 call, a circuit room a small
  // group one. The call lives in voiceSession, not here, so it survives navigating away or
  // toggling canvas — this component only reads and controls it.
  const voice = useVoiceSession()
  // Live occupancy for every conversation you can see, so a call in progress is visible
  // from the list without opening it — the thing that makes people join.
  const voiceIn = useVoicePresence(
    previewMember || !sb ? [] : rooms.map((r) => r.id),
    previewMember ? 'Preview You' : 'You',
    // the room the CALL is in, which is no longer necessarily the one you're looking at —
    // you can browse other conversations without leaving the call
    voice.inCall ? voice.roomId : null,
  )

  const loadOverview = useCallback(async () => {
    if (previewMember) {
      setRooms(previewOverview())
      return
    }
    if (!sb) return
    const { data } = await sb.rpc('list_chat_overview')
    if (data) setRooms(data as Overview[])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  // initial load — plus a ?room= deep link (the profile's Message button) opens that thread
  useEffect(() => {
    let live = true
    if (previewMember) {
      const list = previewOverview()
      setRooms(list)
      const wanted = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('room')
      if (wanted) {
        const r = list.find((x) => x.id === wanted) ?? null
        setRoom(r)
        // arriving straight into a room (from the bell, or a profile's Message button) has
        // to clear its unread the same way tapping the row does — it didn't, so the badge
        // kept counting messages you were literally looking at
        if (r) {
          PREVIEW_UNREAD[r.id] = 0
          setRooms((prev) => prev.map((x) => (x.id === r.id ? { ...x, unread: 0 } : x)))
        }
      }
      return
    }
    if (!sb) return
    void sb.auth.getSession().then(({ data }) => live && setMe(data.session?.user.id ?? null))
    void sb.rpc('my_lounge_opt_in').then(({ data }) => live && setLoungeIn(data === true))
    void sb.rpc('list_chat_overview').then(({ data }) => {
      if (!live || !data) return
      const rs = data as Overview[]
      setRooms(rs)
      const wanted = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('room')
      if (wanted) {
        const r = rs.find((x) => x.id === wanted) ?? null
        setRoom(r)
        if (r) {
          setRooms((prev) => prev.map((x) => (x.id === r.id ? { ...x, unread: 0 } : x)))
          void sb.rpc('mark_room_read', { p_room: r.id }).then(() => notificationsChanged())
        }
      }
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  // keep the conversation list fresh: any message we're allowed to see bumps it. RLS applies
  // to realtime too, so this only ever fires for rooms we're actually in.
  useEffect(() => {
    if (!sb) return
    const ch = sb
      .channel('chat:overview')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => void loadOverview(),
      )
      .subscribe()
    return () => {
      void sb.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  /**
   * A ?room= link has to work when this screen is already open. It was only read on mount, so
   * tapping an unread DM in the bell did nothing if you happened to be on the chat page — the
   * hash changed under a mounted component and nobody was listening.
   */
  useEffect(() => {
    const onHash = () => {
      const wanted = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('room')
      if (!wanted) return
      setRooms((prev) => {
        const hit = prev.find((x) => x.id === wanted)
        if (hit) {
          setRoom(hit)
          if (previewMember) {
            PREVIEW_UNREAD[hit.id] = 0
            notificationsChanged()
          } else if (sb) {
            void sb.rpc('mark_room_read', { p_room: hit.id }).then(() => notificationsChanged())
          }
          return prev.map((x) => (x.id === hit.id ? { ...x, unread: 0 } : x))
        }
        return prev
      })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  const scrollDown = useCallback(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  // load + live-follow the open room
  useEffect(() => {
    if (previewMember) {
      if (room) {
        setMsgs(PREVIEW_MSGS[room.id] ?? [])
        setTimeout(scrollDown, 60)
      }
      return
    }
    if (!sb || !room) return
    let live = true
    void sb
      .from('chat_messages')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (!live) return
        if (error) setErr(error.message)
        else {
          setMsgs(((data as Msg[]) ?? []).reverse())
          setTimeout(scrollDown, 60)
        }
      })
    const ch = sb
      .channel('chat:' + room.id)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const m = payload.new as Msg
          setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
          setTimeout(scrollDown, 60)
          // We're looking at it, so keep it read. The bell reloads off this same INSERT,
          // so without announcing after the write lands it races us and badges a room
          // you are actively reading — with nothing left to re-read and clear it.
          void sb.rpc('mark_room_read', { p_room: m.room_id }).then(() => notificationsChanged())
        },
      )
      .subscribe()
    return () => {
      live = false
      void sb.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, authed])

  function openRoom(r: Overview) {
    setRoom(r)
    setErr(null)
    // clear the badge locally right away, then persist it
    setRooms((prev) => prev.map((x) => (x.id === r.id ? { ...x, unread: 0 } : x)))
    if (previewMember) {
      PREVIEW_UNREAD[r.id] = 0
      notificationsChanged()
      return
    }
    // Tapping a row doesn't change the hash, so the bell has no other way to learn this
    // room is read. Announce only once the write lands, or it re-counts what we just read.
    if (sb) void sb.rpc('mark_room_read', { p_room: r.id }).then(() => notificationsChanged())
  }

  function backToList() {
    setRoom(null)
    setMsgs([])
    void loadOverview()
  }

  // Joining/leaving changes what chat_room_member() allows, so the room appears in
  // or vanishes from list_chat_overview on the next load — no local splicing needed.
  async function setLounge(on: boolean) {
    if (!sb || loungeBusy) return
    setLoungeBusy(true)
    setErr(null)
    const { error } = await sb.rpc('set_lounge_opt_in', { p_on: on })
    if (error) {
      setErr(error.message)
    } else {
      setLoungeIn(on)
      if (!on && room?.kind === 'lounge') {
        setRoom(null)
        setMsgs([])
      }
      await loadOverview()
    }
    setLoungeBusy(false)
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!room || !draft.trim() || sending) return
    if (previewMember) {
      const m: Msg = {
        id: 'pv' + Date.now(),
        room_id: room.id,
        user_id: PREVIEW_ME.id,
        author_name: PREVIEW_ME.name,
        body: draft.trim(),
        created_at: new Date().toISOString(),
      }
      setMsgs((prev) => [...prev, m])
      PREVIEW_MSGS[room.id] = [...(PREVIEW_MSGS[room.id] ?? []), m]
      setDraft('')
      setTimeout(scrollDown, 60)
      return
    }
    if (!sb) return
    setSending(true)
    setErr(null)
    const { data, error } = await sb.rpc('send_chat_message', {
      p_room: room.id,
      p_body: draft.trim(),
    })
    setSending(false)
    if (error) {
      setErr(error.message)
      return
    }
    setDraft('')
    const m = data as unknown as Msg
    if (m?.id) setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    setTimeout(scrollDown, 60)
  }

  if (!authed && !previewMember)
    return (
      <p className="muted" style={{ margin: 0 }}>
        Chat is for members — sign in and your crew&apos;s room is waiting.
      </p>
    )

  const dayOf = (iso: string) => iso.slice(0, 10)
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return (
    <div className="cz-chat" data-view={room ? 'thread' : 'list'}>
      {/* ── conversations ─────────────────────────────────────────────── */}
      <div className="cz-chat-list">
        {rooms.length === 0 && (
          <p className="muted" style={{ margin: '0.5rem', fontSize: '0.85rem' }}>
            No conversations yet.
          </p>
        )}
        {rooms.map((r) => (
          <button
            key={r.id}
            className={'cz-conv' + (room?.id === r.id ? ' is-open' : '')}
            onClick={() => openRoom(r)}
          >
            <span className="cz-conv-ic" aria-hidden>
              {roomIcon(r.kind)}
            </span>
            <span className="cz-conv-main">
              <span className="cz-conv-top">
                <span className="cz-conv-name">{r.name}</span>
                <span className="cz-conv-when muted">{whenLabel(r.last_at)}</span>
              </span>
              <span className="cz-conv-last muted">
                {r.last_body ? (
                  <>
                    {r.kind !== 'dm' && r.last_author ? `${r.last_author}: ` : ''}
                    {r.last_body}
                  </>
                ) : (
                  'No messages yet'
                )}
              </span>
            </span>
            {/* Someone's in there right now — shown before the unread count, because a live
                call is a reason to act and an unread message is a reason to read. */}
            {(voiceIn[r.id]?.length ?? 0) > 0 && (
              <span
                className="cz-conv-voice"
                title={`In the call: ${voiceIn[r.id].join(', ')}`}
                aria-label={`${voiceIn[r.id].length} in the call`}
              >
                🎙 {voiceIn[r.id].length}
              </span>
            )}
            {r.unread > 0 && <span className="cz-conv-badge">{r.unread}</span>}
          </button>
        ))}

        {/* The Lounge is the one room that isn't yours by default — offer it rather
            than assuming it. Hidden until we know the answer, so it can't flash. */}
        {loungeIn === false && (
          <div className="cz-lounge-invite">
            <span className="cz-lounge-ic" aria-hidden>
              🛋️
            </span>
            <div className="cz-lounge-copy">
              <strong>The Lounge</strong>
              <span className="muted">One open room shared by everyone with an account.</span>
            </div>
            <button className="btn" onClick={() => void setLounge(true)} disabled={loungeBusy}>
              {loungeBusy ? 'Joining…' : 'Join'}
            </button>
          </div>
        )}
      </div>

      {/* ── the open thread ───────────────────────────────────────────── */}
      <div className="cz-chat-thread">
        {room ? (
          <>
            <div className="cz-thread-head">
              <button className="cz-thread-back" onClick={backToList} aria-label="Back to messages">
                ‹
              </button>
              <span className="cz-thread-ic" aria-hidden>
                {roomIcon(room.kind)}
              </span>
              <span className="cz-thread-name">{room.name}</span>
              {room.kind === 'lounge' && loungeIn && (
                <button
                  className="btn btn-ghost cz-thread-leave"
                  onClick={() => void setLounge(false)}
                  disabled={loungeBusy}
                  title="Stop seeing The Lounge. You can rejoin any time."
                >
                  {loungeBusy ? 'Leaving…' : 'Leave'}
                </button>
              )}
            </div>

            {/* Voice only makes sense with a real session — the DEV harness has no peers. */}
            {!previewMember && sb && me && (
              <VoiceBar
                // Only show this room's call here. If the call is in another conversation,
                // the app-wide bar is what controls it — two live "Leave" buttons for
                // different rooms on one screen would be a trap.
                inCall={voice.inCall && voice.roomId === room.id}
                peers={voice.peers}
                muted={voice.muted}
                error={voice.error}
                onJoin={() => void voice.join(room.id, room.name, me, 'You')}
                onLeave={voice.leave}
                onToggleMute={voice.toggleMute}
                label={room.name}
              />
            )}

            <div className="cz-chat-log">
              {msgs.length === 0 && (
                <p className="muted" style={{ margin: 'auto', fontSize: '0.85rem' }}>
                  Nothing here yet — say the first thing.
                </p>
              )}
              {msgs.map((m, i) => {
                const mine = m.user_id === me
                const newDay = i === 0 || dayOf(m.created_at) !== dayOf(msgs[i - 1].created_at)
                return (
                  <div key={m.id}>
                    {newDay && (
                      <div
                        className="muted"
                        style={{ textAlign: 'center', fontSize: '0.7rem', margin: '0.35rem 0' }}
                      >
                        {dayOf(m.created_at)}
                      </div>
                    )}
                    <div
                      style={{
                        maxWidth: '85%',
                        marginLeft: mine ? 'auto' : 0,
                        padding: '0.4rem 0.6rem',
                        borderRadius: 10,
                        background: mine
                          ? 'var(--accent, #7c6af7)'
                          : 'var(--card2, rgba(127,127,127,0.15))',
                        color: mine ? 'var(--btn-text, #fff)' : 'var(--text, #eeeef8)',
                      }}
                    >
                      {!mine && (
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, opacity: 0.85 }}>
                          {m.author_name}
                        </div>
                      )}
                      <div
                        style={{
                          fontSize: '0.9rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {m.body}
                      </div>
                      <div style={{ fontSize: '0.65rem', opacity: 0.7, textAlign: 'right' }}>
                        {timeOf(m.created_at)}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={endRef} />
            </div>

            {err && (
              <p
                className="muted"
                style={{ margin: 0, fontSize: '0.8rem', color: 'var(--accent-2, #ff5566)' }}
              >
                {err}
              </p>
            )}

            <form
              className="cz-chat-form"
              onSubmit={send}
              style={{ display: 'flex', gap: '0.4rem' }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message ${room.name}`}
                maxLength={2000}
                style={{ flex: 1, padding: '0.55rem 0.7rem', borderRadius: 10 }}
              />
              <button className="btn" disabled={!draft.trim() || sending} type="submit">
                {sending ? '…' : 'Send'}
              </button>
            </form>
          </>
        ) : (
          <p className="muted cz-thread-empty">Pick a conversation to start reading.</p>
        )}
      </div>
    </div>
  )
}
