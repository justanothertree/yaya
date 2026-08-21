import { useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import './InviteFriends.css'

/**
 * "Send this to a friend" — pick someone, and a message lands in your DM with them.
 *
 * Deliberately the shortest path that exists: `open_dm` gives (or creates) the conversation,
 * `send_chat_message` posts the line. Both are already the app's own gated paths, so this adds
 * no new way to reach anyone — you can only send to people you could already message.
 *
 * Only accepted friends are listed. An invite is an unprompted ping, and the one thing Evan has
 * been consistent about is that people who haven't agreed to know each other shouldn't be able
 * to poke each other.
 *
 * Generic because there are two of these now: Snake's "challenge a friend" and the Circuit's
 * "invite to this circuit". The only difference between them is the sentence that gets posted,
 * so that is the only thing this takes.
 */

type Friend = { username: string; name?: string }

/** Keep in step with `.invite-friends-panel`'s max-height — it decides which way to open. */
const PANEL_MAX_PX = 16 * 16

export function InviteFriends({
  body,
  label,
  title,
  verb,
  hint,
  emptyHint,
}: {
  /** the line that gets posted into the DM */
  body: string
  label: string
  title: string
  /** the word on each row while idle — "challenge", "invite" */
  verb: string
  /** shown once at least one has gone out, describing what they will see */
  hint: string
  emptyHint: string
}) {
  const [open, setOpen] = useState(false)
  /** open downward when there isn't room above — see the click handler */
  const [dropDown, setDropDown] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
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

  async function sendTo(username: string) {
    setBusy(username)
    setErr(null)
    const sb = getSupabaseClient()
    const dm = await sb.rpc('open_dm', { p_username: username })
    if (dm.error || !dm.data) {
      setBusy(null)
      setErr('Couldn’t open that conversation.')
      return
    }
    const post = await sb.rpc('send_chat_message', { p_room: dm.data as string, p_body: body })
    setBusy(null)
    if (post.error) {
      setErr('Couldn’t send the invite.')
      return
    }
    setSent((s) => [...s, username])
  }

  if (!authed) return null

  return (
    <div className="invite-friends">
      <button
        ref={btnRef}
        className="btn"
        onClick={() => {
          // Decide which way to open BEFORE opening. The panel used to always go upward and
          // slid under the fixed banner, which sits at z-index 100 — raising the panel above
          // that would only have covered the nav instead. Opening where there's room is the
          // actual fix.
          const r = btnRef.current?.getBoundingClientRect()
          const navH = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--nav-h') || '54',
          )
          setDropDown(!!r && r.top - navH < PANEL_MAX_PX)
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        title={title}
      >
        {label}
      </button>

      {open && (
        <div className={'invite-friends-panel' + (dropDown ? ' is-down' : '')}>
          {friends === null && <p className="muted">Loading…</p>}
          {/* `!err` matters: the error path also lands on an empty list, and showing "no friends
              yet" next to "couldn't load your friends" tells someone their friends are gone
              when the truth is we failed to ask. */}
          {friends?.length === 0 && !err && <p className="muted">{emptyHint}</p>}
          {friends?.map((f) => {
            const done = sent.includes(f.username)
            return (
              <button
                key={f.username}
                className={'btn invite-friends-row' + (done ? ' is-sent' : '')}
                disabled={busy === f.username || done}
                onClick={() => void sendTo(f.username)}
              >
                <span>{f.name ?? f.username}</span>
                <span className="muted">
                  {done ? 'invite sent ✓' : busy === f.username ? 'sending…' : verb}
                </span>
              </button>
            )
          })}
          {err && <p className="voice-err">{err}</p>}
          {sent.length > 0 && <p className="muted invite-friends-hint">{hint}</p>}
        </div>
      )}
    </div>
  )
}
