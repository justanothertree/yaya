import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { voiceSession } from './voiceSession'
import { useVoiceSession } from './useVoiceSession'

/**
 * A voice channel that belongs to a person, on their profile page.
 *
 * ⚠️ EVERY RULE HERE IS ALSO A SERVER RULE, and the server's copy is the real one. This component
 * renders a Join button when get_profile_room() returns a room — but the button is a convenience,
 * not the gate. The realtime topic the call runs on is protected by profile_room_member() in RLS,
 * so a person who is not welcome is refused by Postgres whether or not a button was ever drawn
 * for them, and whether or not they are running our client. If this file were deleted the
 * security properties would be unchanged.
 *
 * ⚠️ And the read is silent about calls you may not join: get_profile_room returns NO ROW rather
 * than a row saying "there is a call, but not for you". "So-and-so is on a private call right
 * now" is itself the private fact, so the answer for an outsider is byte-identical to "there is
 * no call" — which is the only version of that promise that can actually be kept.
 */

type Room = { room_id: string; audience: string; is_owner: boolean; open_since: string | null }
type Invitee = { username: string; name: string }

export function ProfileCall({
  username,
  displayName,
  isMe,
}: {
  username: string
  displayName: string
  isMe: boolean
}) {
  // resolved here rather than threaded down through Profile: this is the only thing on the page
  // that needs to know who you are, and a prop chain for one component is a prop chain to keep
  // in step forever
  const [myId, setMyId] = useState<string | null>(null)
  const [myName, setMyName] = useState('You')
  const [room, setRoom] = useState<Room | null>(null)
  const [invites, setInvites] = useState<Invitee[]>([])
  const [invitee, setInvitee] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const v = useVoiceSession()

  const load = useCallback(async () => {
    if (!myId) return
    const sb = getSupabaseClient()
    const { data } = await sb.rpc('get_profile_room', { p_username: username })
    const r = (data as Room[] | null)?.[0] ?? null
    setRoom(r)
    if (r?.is_owner) {
      const { data: list } = await sb.rpc('list_profile_room_invites')
      setInvites((list as Invitee[] | null) ?? [])
    } else {
      setInvites([])
    }
  }, [username, myId])

  useEffect(() => {
    let live = true
    const sb = getSupabaseClient()
    void sb.auth.getSession().then(({ data }) => live && setMyId(data.session?.user.id ?? null))
    void sb.rpc('get_my_profile').then(({ data }) => {
      const row = (Array.isArray(data) ? data[0] : data) as {
        nickname?: string | null
        first_name?: string | null
        username?: string | null
      } | null
      const n = row?.nickname || row?.first_name || row?.username
      if (live && n) setMyName(n)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!myId) return null

  const inThisCall = v.inCall && room && v.roomId === room.room_id
  const open = !!room?.open_since

  /**
   * Run one RPC and show what it said.
   *
   * ⚠️ PostgREST RETURNS errors, it does not throw them: a `raise exception` in the function
   * arrives as `{ error }` on a resolved promise. A try/catch around this would look like error
   * handling and silently swallow every refusal the server made — "open your call first",
   * "no such member", "account suspended" — leaving a button that appears to do nothing.
   */
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true)
    setErr(null)
    try {
      const { error } = await fn()
      if (error) {
        setErr(error.message)
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  const sb = () => getSupabaseClient()

  // Nothing to show a visitor when there is no call they can join — and, by design, that is also
  // exactly what an excluded visitor sees when there IS one.
  if (!isMe && !open) return null

  return (
    <div className="card profile-call">
      <div className="profile-call-head">
        <strong>🎙 {isMe ? 'Your call' : `${displayName}'s call`}</strong>
        {open && (
          <span className="muted profile-call-tier">
            {room?.audience === 'private' ? 'invite only' : 'open to friends'}
          </span>
        )}
      </div>

      {isMe && !open && (
        <>
          <p className="muted profile-call-note">
            Start a call on your own page. Friends can walk in, or you can name exactly who may
            join.
          </p>
          <div className="profile-call-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(() => sb().rpc('open_profile_room', { p_audience: 'friends' }))
              }
            >
              👥 Open to friends
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(() => sb().rpc('open_profile_room', { p_audience: 'private' }))
              }
            >
              🔒 Invite only
            </button>
          </div>
        </>
      )}

      {open && (
        <div className="profile-call-actions">
          {inThisCall ? (
            <button className="btn" onClick={() => voiceSession.leave()}>
              📴 Leave
            </button>
          ) : (
            <button
              className="btn"
              disabled={busy || v.joining}
              onClick={() =>
                void voiceSession.join(
                  room!.room_id,
                  isMe ? 'Your call' : `${displayName}'s call`,
                  myId,
                  myName,
                )
              }
            >
              {v.joining ? 'Connecting…' : '🎧 Join call'}
            </button>
          )}
          {isMe && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => void run(() => sb().rpc('close_profile_room'))}
            >
              ⏹ Close
            </button>
          )}
        </div>
      )}

      {/* The guest list is the owner's alone. It is also the only place invites can be undone,
          which matters more than it looks: a list you can add to but not remove from is a
          permission that quietly outlives the reason for it. */}
      {isMe && open && (
        <div className="profile-call-guests">
          <label className="profile-call-invite">
            <span className="muted">Invite</span>
            <input
              value={invitee}
              placeholder="username"
              onChange={(e) => setInvitee(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !invitee.trim()) return
                const who = invitee.trim()
                void run(async () => {
                  const res = await sb().rpc('invite_to_profile_room', { p_username: who })
                  // cleared only on success, so a typo'd name stays in the box to be corrected
                  if (!res.error) setInvitee('')
                  return res
                })
              }}
            />
          </label>
          {!!invites.length && (
            <ul className="profile-call-list">
              {invites.map((g) => (
                <li key={g.username}>
                  <span>{g.name}</span>
                  <button
                    className="btn"
                    disabled={busy}
                    title={`Remove ${g.name} from the guest list`}
                    onClick={() =>
                      void run(() =>
                        sb().rpc('uninvite_from_profile_room', { p_username: g.username }),
                      )
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {room?.audience === 'private' && !invites.length && (
            <p className="muted profile-call-note">
              Invite only, and nobody is invited yet — so right now this call is just you.
            </p>
          )}
        </div>
      )}

      {err && <p className="muted profile-call-note">{err}</p>}
    </div>
  )
}
