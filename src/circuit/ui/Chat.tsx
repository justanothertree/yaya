import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '../../finance/client'

/**
 * Chat — the crew's rooms. One rooms model serves every shape: each circuit has a room
 * (membership = the circuit's), The Lounge is everyone with an account, and DMs slot in
 * later once friendships exist. Reads ride RLS directly (realtime included); sends go
 * through send_chat_message, which resolves the author's name server-side so it can't
 * be spoofed.
 */

type Room = { id: string; kind: string; name: string }
type Msg = {
  id: string
  room_id: string
  user_id: string
  author_name: string
  body: string
  created_at: string
}

export function Chat({ authed = false }: { authed?: boolean }) {
  const sb = authed ? getSupabaseClient() : null
  const [rooms, setRooms] = useState<Room[]>([])
  const [room, setRoom] = useState<Room | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const [me, setMe] = useState<string | null>(null)

  useEffect(() => {
    if (!sb) return
    let live = true
    void sb.auth.getSession().then(({ data }) => live && setMe(data.session?.user.id ?? null))
    void sb.rpc('list_chat_rooms').then(({ data }) => {
      if (!live || !data) return
      const rs = data as Room[]
      setRooms(rs)
      // a ?room= deep link (the profile's Message button) wins; otherwise land in your
      // circuit's room with the lounge one chip away
      const wanted = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('room')
      setRoom(
        (wanted ? rs.find((r) => r.id === wanted) : undefined) ??
          rs.find((r) => r.kind === 'circuit') ??
          rs[0] ??
          null,
      )
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  const scrollDown = useCallback(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  // load + live-follow the open room
  useEffect(() => {
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
        },
      )
      .subscribe()
    return () => {
      live = false
      void sb.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, authed])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!sb || !room || !draft.trim() || sending) return
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

  if (!authed)
    return (
      <p className="muted" style={{ margin: 0 }}>
        Chat is for members — sign in and your crew&apos;s room is waiting.
      </p>
    )

  const dayOf = (iso: string) => iso.slice(0, 10)
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0 }}>
      {rooms.length > 1 && (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {rooms.map((r) => (
            <button
              key={r.id}
              className={'cz-chip' + (room?.id === r.id ? ' cz-on' : '')}
              style={room?.id === r.id ? { background: 'var(--accent, #7c6af7)' } : undefined}
              onClick={() => setRoom(r)}
            >
              {r.kind === 'lounge' ? '🛋️' : '👥'} {r.name}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: '14rem',
          maxHeight: '24rem',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.45rem',
          padding: '0.5rem',
          background: 'var(--b1, rgba(127,127,127,0.08))',
          borderRadius: 10,
        }}
      >
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
                  style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
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

      <form onSubmit={send} style={{ display: 'flex', gap: '0.4rem' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={room ? `Message ${room.name}` : 'Pick a room'}
          maxLength={2000}
          style={{ flex: 1, padding: '0.55rem 0.7rem', borderRadius: 10 }}
        />
        <button className="btn" disabled={!draft.trim() || sending || !room} type="submit">
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
