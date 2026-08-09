import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { challengeMessage } from './challenge'

/**
 * "Challenge a friend" — pick someone, and a Snake invite lands in your DM with them.
 *
 * Deliberately the shortest path that exists: `open_dm` gives (or creates) the conversation,
 * `send_chat_message` posts the invite. Both are already the app's own gated paths, so this
 * adds no new way to reach anyone — you can only challenge people you could already message.
 *
 * Only accepted friends are listed. A challenge is an unprompted ping, and the one thing Evan
 * has been consistent about is that people who haven't agreed to know each other shouldn't be
 * able to poke each other.
 */

type Friend = { username: string; name?: string }

export function ChallengeFriend({ roomId, roomLabel }: { roomId: string; roomLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  /**
   * Sign-in is decided here rather than passed in. Snake is the one part of the site that
   * anonymous visitors use heavily, and every path this button takes needs a session — so the
   * component that needs the answer is the one that asks, and it renders nothing when there
   * isn't one. Undefined means "haven't looked yet", which is not the same as signed out.
   */
  const [authed, setAuthed] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void getSupabaseClient()
      .auth.getSession()
      .then(({ data }) => {
        if (alive) setAuthed(!!data.session)
      })
      .catch(() => {
        if (alive) setAuthed(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!open || friends) return
    let alive = true
    void (async () => {
      const sb = getSupabaseClient()
      const [f, dir] = await Promise.all([sb.rpc('list_friends'), sb.rpc('list_member_directory')])
      if (!alive) return
      if (f.error) {
        setErr('Couldn’t load your friends.')
        setFriends([])
        return
      }
      // real names come from the directory; the friends list is usernames + status
      const nameOf = new Map(
        ((dir.data ?? []) as Array<{ username: string; name: string }>).map((p) => [
          p.username,
          p.name,
        ]),
      )
      const accepted = ((f.data ?? []) as Array<{ username: string; status: string }>)
        .filter((x) => x.status === 'accepted')
        .map((x) => ({ username: x.username, name: nameOf.get(x.username) }))
        .sort((a, b) => (a.name ?? a.username).localeCompare(b.name ?? b.username))
      setFriends(accepted)
    })()
    return () => {
      alive = false
    }
  }, [open, friends])

  async function challenge(username: string) {
    setBusy(username)
    setErr(null)
    const sb = getSupabaseClient()
    const dm = await sb.rpc('open_dm', { p_username: username })
    if (dm.error || !dm.data) {
      setBusy(null)
      setErr('Couldn’t open that conversation.')
      return
    }
    const post = await sb.rpc('send_chat_message', {
      p_room: dm.data as string,
      p_body: challengeMessage(roomId, roomLabel),
    })
    setBusy(null)
    if (post.error) {
      setErr('Couldn’t send the invite.')
      return
    }
    setSent((s) => [...s, username])
  }

  if (!roomId || !authed) return null

  return (
    <div className="snake-challenge">
      <button
        className="btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Send a friend an invite to this game"
      >
        ⚔️ Challenge a friend
      </button>

      {open && (
        <div className="snake-challenge-panel">
          {friends === null && <p className="muted">Loading…</p>}
          {/* `!err` matters: the error path also lands on an empty list, and showing "no friends
              yet" next to "couldn't load your friends" tells someone their friends are gone
              when the truth is we failed to ask. */}
          {friends?.length === 0 && !err && (
            <p className="muted">
              No friends yet — add someone on the People page and you can challenge them here.
            </p>
          )}
          {friends?.map((f) => {
            const done = sent.includes(f.username)
            return (
              <button
                key={f.username}
                className={'btn snake-challenge-row' + (done ? ' is-sent' : '')}
                disabled={busy === f.username || done}
                onClick={() => void challenge(f.username)}
              >
                <span>{f.name ?? f.username}</span>
                <span className="muted">
                  {done ? 'invite sent ✓' : busy === f.username ? 'sending…' : 'challenge'}
                </span>
              </button>
            )
          })}
          {err && <p className="voice-err">{err}</p>}
          {sent.length > 0 && (
            <p className="muted snake-challenge-hint">
              They’ll get it in your messages, with a button that drops them straight into this
              room.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
