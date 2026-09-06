// People — the member directory as a real social surface: who's here, who's asked to be
// friends, and one tap to message or add. The RPCs already existed (they powered the buttons
// on a single profile); what was missing was somewhere to see everyone at once.
//
// Grouped rather than flat, because the groups are what you act on: requests waiting on you
// come first (they're the only rows with a decision attached), then your friends, then
// everyone else.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { notificationsChanged, onNotificationsChanged } from '../hooks/notifySignal'
import { getSupabaseClient } from '../finance/client'
import { previewMember, PREVIEW_PEOPLE, type PreviewPerson } from '../dev/previewMember'
import { usePresence } from '../hooks/usePresence'
import {
  myStatus,
  onStatusChange,
  setMyStatus,
  STATUS_OPTIONS,
  type MyStatus,
} from '../hooks/presenceStatus'
import { avatarStyle } from '../profile/look'

type Rel = 'none' | 'in' | 'out' | 'friend'
// user_id is present for anyone from the DIRECTORY (list_member_directory), which is exactly
// presence's own audience -- optional because handle lookup (find_member_by_username) can
// surface someone OUTSIDE that audience, and presence must not extend there
type Person = { user_id?: string; username: string; name: string; rel: Rel }

/** directory + friendships, folded into one row per person */
async function loadPeople(): Promise<Person[]> {
  const sb = getSupabaseClient()
  const [dir, friends] = await Promise.all([
    sb.rpc('list_member_directory'),
    sb.rpc('list_friends'),
  ])
  const rel = new Map<string, Rel>()
  for (const f of (friends.data ?? []) as {
    username: string
    status: string
    direction: string
  }[]) {
    rel.set(f.username, f.status === 'accepted' ? 'friend' : f.direction === 'in' ? 'in' : 'out')
  }
  return ((dir.data ?? []) as { user_id: string; username: string; name: string }[]).map((p) => ({
    user_id: p.user_id,
    username: p.username,
    name: p.name,
    rel: rel.get(p.username) ?? 'none',
  }))
}

/**
 * Your own status, on the page that shows everybody else's.
 *
 * ⚠️ IT LIVED IN THE ACCOUNT MENU, behind the initial, between "Reduce motion" and "Call
 * sound" — so this page showed a green dot beside every person on it except the one reading it,
 * and the control for that dot was three taps away in a panel about preferences. Availability is
 * not a preference like text size; it is a thing you change because of what you are doing right
 * now, and you change it while looking at who else is around.
 *
 * ⚠️ Invisible is offered plainly rather than hidden as an advanced option. Somebody who wants
 * to be here without being seen should not have to hunt for it, and SeenStatus deliberately has
 * no such value — nobody can tell the difference between invisible and offline.
 */
function MyPresence() {
  const [mine, setMine] = useState<MyStatus>(() => myStatus())
  useEffect(() => onStatusChange(() => setMine(myStatus())), [])
  return (
    <span className="ppl-me" style={{ marginLeft: 'auto' }}>
      <span className="muted" style={{ fontSize: '0.78rem' }}>
        You&apos;re
      </span>
      {STATUS_OPTIONS.map(([id, dot, label]) => (
        <button
          key={id}
          className={'ppl-me-btn' + (mine === id ? ' is-on' : '')}
          aria-pressed={mine === id}
          onClick={() => setMyStatus(id)}
          title={
            id === 'invisible'
              ? 'Nothing is broadcast at all — not hidden, not sent'
              : `Show as ${label.toLowerCase()}`
          }
        >
          <span aria-hidden>{dot}</span> {label}
        </button>
      ))}
    </span>
  )
}

export function People({ authed = false }: { authed?: boolean }) {
  const [people, setPeople] = useState<Person[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  useEffect(() => {
    if (previewMember || !authed) return
    let live = true
    void getSupabaseClient()
      .auth.getSession()
      .then(({ data }) => live && setMeId(data.session?.user.id ?? null))
    return () => {
      live = false
    }
  }, [authed])
  // Friends-or-circuit is exactly this page's own audience (list_member_directory), so
  // presence for everyone shown here is a single hook call, not a per-row subscription.
  const online = usePresence(
    meId,
    people.map((p) => p.user_id).filter((id): id is string => !!id),
  )
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // The directory only lists people you already share something with, so finding someone new
  // is an explicit act: look up their exact handle (they had to share it with you).
  const [found, setFound] = useState<Person[] | null>(null)
  /**
   * Unread DMs per person.
   *
   * ⚠️ From list_chat_overview — the SAME function the bell reads, rather than a second count
   * of its own. "Unread" is a subtle predicate (not written by you, not under a lounge
   * pseudonym of yours, since your last read) and two copies of it would disagree the first
   * time either was touched, leaving the bell and this page quietly telling you different
   * numbers.
   *
   * ⚠️ Keyed on peer_user_id, not on the room's name. A DM is named after the other person's
   * first name, and matching rows on that works right up until two friends share one.
   */
  const [waiting, setWaiting] = useState<Record<string, number>>({})
  const [looking, setLooking] = useState(false)

  const refresh = useCallback(async () => {
    if (previewMember) {
      setPeople(PREVIEW_PEOPLE.map((p: PreviewPerson) => ({ ...p })))
      return
    }
    if (!authed) return
    try {
      setPeople(await loadPeople())
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load members')
    }
  }, [authed])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const loadWaiting = useCallback(async () => {
    if (previewMember || !authed) return
    const { data } = await getSupabaseClient().rpc('list_chat_overview')
    const rows = (data ?? []) as { peer_user_id?: string | null; unread?: number }[]
    const next: Record<string, number> = {}
    for (const r of rows) {
      /* ⚠️ defensive on the column, not just the value: before the migration runs this key is
         simply absent, and the page should show no badges rather than break. */
      if (r.peer_user_id && (r.unread ?? 0) > 0) next[r.peer_user_id] = r.unread ?? 0
    }
    setWaiting(next)
  }, [authed])

  /**
   * ⚠️ RE-READ WHEN THE BELL DOES, not only on mount.
   *
   * A count fetched once at page load is wrong the moment somebody writes to you while you are
   * looking at the page — and "who is waiting on you" going stale in front of you is worse than
   * not showing it, because you would trust it. notificationsChanged() already fires on exactly
   * the events that move this number, and the bell already listens to it; this is the same
   * signal, not a second mechanism.
   */
  useEffect(() => {
    void loadWaiting()
    return onNotificationsChanged(() => void loadWaiting())
  }, [loadWaiting])

  /** run a friendship RPC, then reflect the new standing */
  async function act(username: string, kind: 'add' | 'remove' | 'accept' | 'decline') {
    setBusy(username)
    setErr(null)
    if (previewMember) {
      setPeople((prev) =>
        prev.map((p) =>
          p.username === username
            ? { ...p, rel: kind === 'add' ? 'out' : kind === 'accept' ? 'friend' : 'none' }
            : p,
        ),
      )
      setBusy(null)
      return
    }
    const sb = getSupabaseClient()
    const { error } =
      kind === 'accept' || kind === 'decline'
        ? await sb.rpc('respond_friend', { p_username: username, p_accept: kind === 'accept' })
        : await sb.rpc(kind === 'add' ? 'request_friend' : 'remove_friend', {
            p_username: username,
          })
    if (error) setErr(error.message)
    else {
      await refresh()
      // answering a request changes the bell's count, and this screen never navigates
      notificationsChanged()
    }
    setBusy(null)
  }

  async function lookUp() {
    const handle = q.trim()
    if (handle.length < 2) return
    setLooking(true)
    setErr(null)
    if (previewMember) {
      const hit = PREVIEW_PEOPLE.filter((p) => p.username.toLowerCase() === handle.toLowerCase())
      setFound(hit.map((p) => ({ ...p })))
      setLooking(false)
      return
    }
    const { data, error } = await getSupabaseClient().rpc('find_member_by_username', {
      p_username: handle,
    })
    if (error) setErr(error.message)
    else {
      const rows = (data ?? []) as { username: string; name: string; is_friend: boolean }[]
      setFound(
        rows.map((r) => ({
          username: r.username,
          name: r.name,
          rel: r.is_friend ? 'friend' : 'none',
        })),
      )
    }
    setLooking(false)
  }

  async function message(username: string) {
    if (previewMember) {
      window.location.hash = '#chat'
      return
    }
    const { data, error } = await getSupabaseClient().rpc('open_dm', { p_username: username })
    if (error) setErr(error.message)
    else if (data) window.location.hash = '#chat?room=' + data
  }

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const match = (p: Person) =>
      !needle || p.name.toLowerCase().includes(needle) || p.username.toLowerCase().includes(needle)
    const hit = people.filter(match)
    return {
      requests: hit.filter((p) => p.rel === 'in'),
      friends: hit.filter((p) => p.rel === 'friend'),
      others: hit.filter((p) => p.rel === 'none' || p.rel === 'out'),
    }
  }, [people, q])

  if (!authed && !previewMember)
    return (
      <p className="muted" style={{ margin: 0 }}>
        The member directory is for members — sign in to find your people.
      </p>
    )

  /** how many messages of theirs you have not read; 0 when there is no DM or nothing waiting */
  const unreadFor = (p: Person) => (p.user_id ? (waiting[p.user_id] ?? 0) : 0)
  /**
   * ⚠️ People waiting on you come first, and ONLY within the group they were already in.
   *
   * The temptation was a fourth section at the top called "Waiting on you", and it is wrong:
   * this page is a directory, and a directory whose order changes as messages arrive is one you
   * cannot learn the shape of. Somebody stays where you expect to find them; they just rise
   * within their own group and carry a count.
   */
  const waitingFirst = (list: Person[]) => [...list].sort((a, b) => unreadFor(b) - unreadFor(a))

  const row = (p: Person) => (
    <div key={p.username} className="cz-person">
      <a
        className="cz-person-main"
        href={'#profile?u=' + encodeURIComponent(p.username)}
        title={`See ${p.name}'s profile`}
      >
        {/* Their own colour, the same one their profile opens in — so the directory reads as
            a row of people rather than a list of identical initials, and someone you've been
            to is recognisable before you've read the name. */}
        <span className="cz-person-av" aria-hidden style={avatarStyle(p.username)}>
          {(p.name[0] ?? '★').toUpperCase()}
          {/* A missing entry covers offline AND invisible with one answer, deliberately: if
              those two rendered differently, invisible would be detectable and therefore
              pointless. See usePresence. */}
          {!!p.user_id && online[p.user_id] && (
            <span
              className="cz-person-online"
              data-status={online[p.user_id]}
              title={online[p.user_id] === 'away' ? 'Away' : 'Online now'}
            />
          )}
        </span>
        <span className="cz-person-text">
          <span className="cz-person-name">{p.name}</span>
          {/* Spelled out, not only a dot. A 10px circle in the corner of an avatar is the whole
              of what presence used to say, which is easy to have never noticed at all — and
              impossible to read if the difference between the two states is a hue. */}
          <span className="cz-person-handle muted">
            @{p.username}
            {!!p.user_id && online[p.user_id] && (
              <> · {online[p.user_id] === 'away' ? 'Away' : 'Online'}</>
            )}
          </span>
        </span>
      </a>
      <span className="cz-person-actions">
        {p.rel === 'in' && (
          <>
            <button
              className="btn cz-tap"
              disabled={busy === p.username}
              onClick={() => void act(p.username, 'accept')}
              style={{
                background: 'var(--accent, #7c6af7)',
                color: 'var(--btn-text)',
                borderColor: 'transparent',
              }}
            >
              Accept
            </button>
            <button
              className="btn cz-tap"
              disabled={busy === p.username}
              onClick={() => void act(p.username, 'decline')}
            >
              Decline
            </button>
          </>
        )}
        {p.rel === 'friend' && (
          <button
            className={'btn cz-tap' + (unreadFor(p) ? ' ppl-waiting' : '')}
            onClick={() => void message(p.username)}
            title={
              unreadFor(p)
                ? `${unreadFor(p)} unread — they are waiting on you`
                : `Message ${p.name}`
            }
          >
            💬 {unreadFor(p) ? `${unreadFor(p)} waiting` : 'Message'}
          </button>
        )}
        {p.rel === 'out' && (
          <button
            className="btn cz-tap"
            disabled={busy === p.username}
            onClick={() => void act(p.username, 'remove')}
            title="Cancel request"
            style={{ opacity: 0.7 }}
          >
            Requested
          </button>
        )}
        {p.rel === 'none' && (
          <button
            className="btn cz-tap"
            disabled={busy === p.username}
            onClick={() => void act(p.username, 'add')}
          >
            ＋ Add
          </button>
        )}
      </span>
    </div>
  )

  const section = (title: string, list: Person[], empty?: string) =>
    list.length > 0 || empty ? (
      <div style={{ marginBottom: '1.1rem' }}>
        <div className="cz-sec" style={{ marginBottom: '0.4rem' }}>
          {title} {list.length > 0 && `(${list.length})`}
        </div>
        {list.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{list.map(row)}</div>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            {empty}
          </p>
        )}
      </div>
    ) : null

  return (
    <div>
      <div
        className="cz-head"
        style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}
      >
        <h2 className="section-title" style={{ margin: 0 }}>
          People
        </h2>
        <span className="muted cz-subtitle" style={{ fontSize: '0.85rem' }}>
          friends, requests, and people in your circles
        </span>
        <MyPresence />
      </div>

      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setFound(null)
        }}
        onKeyDown={(e) => e.key === 'Enter' && void lookUp()}
        placeholder="Search, or type an exact @handle"
        aria-label="Search people"
        style={{
          width: '100%',
          margin: '0.9rem 0 1rem',
          padding: '0.55rem 0.7rem',
          borderRadius: 10,
        }}
      />

      {err && (
        <p className="muted" style={{ fontSize: '0.85rem', color: 'var(--accent-2, #ff5566)' }}>
          {err}
        </p>
      )}

      {found !== null &&
        (found.length > 0 ? (
          section('Found', found)
        ) : (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            No member with the handle “{q.trim()}”.
          </p>
        ))}

      {q.trim().length >= 2 &&
        found === null &&
        groups.requests.length + groups.friends.length + groups.others.length === 0 && (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Nobody you share a circle with matches that.{' '}
            <button className="btn cz-tap" onClick={() => void lookUp()} disabled={looking}>
              {looking ? 'Looking…' : `Look up @${q.trim()}`}
            </button>
          </p>
        )}

      {section('Wants to be friends', groups.requests)}
      {section('Your friends', waitingFirst(groups.friends), 'No friends yet — add someone below.')}
      {section('Everyone else', groups.others)}

      {people.length > 0 &&
        groups.requests.length + groups.friends.length + groups.others.length === 0 && (
          <p className="muted">No one matches “{q}”.</p>
        )}
    </div>
  )
}
