// People — the member directory as a real social surface: who's here, who's asked to be
// friends, and one tap to message or add. The RPCs already existed (they powered the buttons
// on a single profile); what was missing was somewhere to see everyone at once.
//
// Grouped rather than flat, because the groups are what you act on: requests waiting on you
// come first (they're the only rows with a decision attached), then your friends, then
// everyone else.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { notificationsChanged } from '../hooks/notifySignal'
import { getSupabaseClient } from '../finance/client'
import { previewMember, PREVIEW_PEOPLE, type PreviewPerson } from '../dev/previewMember'
import { usePresence } from '../hooks/usePresence'
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
          <span className="cz-person-handle muted">@{p.username}</span>
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
          <button className="btn cz-tap" onClick={() => void message(p.username)}>
            💬 Message
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
      {section('Your friends', groups.friends, 'No friends yet — add someone below.')}
      {section('Everyone else', groups.others)}

      {people.length > 0 &&
        groups.requests.length + groups.friends.length + groups.others.length === 0 && (
          <p className="muted">No one matches “{q}”.</p>
        )}
    </div>
  )
}
