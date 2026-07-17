import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

/**
 * A member's profile — the page behind every name on the site.
 *
 * v1 shows the viewer ONLY what they could already see elsewhere: the circuits you're
 * both in, movie ratings inside those circuits, and the snake best they already posted
 * under their own name on the public leaderboard. No new exposure — the server RPC
 * (get_member_profile) enforces that, not this component. The owner-controlled
 * visibility tiers (public / friends / members / private) layer on top of this later.
 */

type ProfileData = {
  username: string
  first_name: string | null
  member_since: string
  is_me: boolean
  friend_status: 'friends' | 'pending_out' | 'pending_in' | null
  shared_circuits: { name: string; people: string[] }[]
  movies_rated: number
  snake_best: { score: number; game_mode: string | null; achieved: string } | null
}

const userFromHash = () =>
  new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('u') ?? ''

type Person = { username: string; name: string; is_friend: boolean }

export function Profile({ authed }: { authed: boolean }) {
  const [u, setU] = useState(userFromHash)
  const [people, setPeople] = useState<Person[]>([])
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'missing' }
    | { kind: 'error'; msg: string }
    | { kind: 'ok'; p: ProfileData }
  >({ kind: 'loading' })

  // moving between profiles changes only the ?u= — the section stays 'profile', so App
  // won't remount us; track the hash ourselves
  useEffect(() => {
    const onHash = () => setU(userFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!authed || !u) return
    let live = true
    setState({ kind: 'loading' })
    getSupabaseClient()
      .rpc('get_member_profile', { p_username: u })
      .then(({ data, error }) => {
        if (!live) return
        if (error) setState({ kind: 'error', msg: error.message })
        else if (!data) setState({ kind: 'missing' })
        else setState({ kind: 'ok', p: data as ProfileData })
      })
    return () => {
      live = false
    }
  }, [u, authed])

  // the People list — how you find everyone else's page
  useEffect(() => {
    if (!authed) return
    let live = true
    void getSupabaseClient()
      .rpc('list_member_directory')
      .then(({ data }) => {
        if (live && data) setPeople(data as Person[])
      })
    return () => {
      live = false
    }
  }, [authed])

  if (!authed)
    return (
      <div>
        <h2 className="section-title">Profile</h2>
        <p className="muted">
          Profiles are for members — <a href="#signin">sign in</a> to see who&apos;s who.
        </p>
      </div>
    )
  if (!u)
    return (
      <div>
        <h2 className="section-title">Profile</h2>
        <p className="muted">No one to show — open a profile from a member&apos;s name.</p>
      </div>
    )
  if (state.kind === 'loading')
    return (
      <div className="card" aria-busy>
        Loading profile…
      </div>
    )
  if (state.kind === 'missing')
    return (
      <div>
        <h2 className="section-title">Profile</h2>
        <p className="muted">No member named “{u}”.</p>
      </div>
    )
  if (state.kind === 'error')
    return (
      <div>
        <h2 className="section-title">Profile</h2>
        <p className="muted">Couldn&apos;t load this profile: {state.msg}</p>
      </div>
    )

  const p = state.p
  async function act(
    kind: 'request_friend' | 'remove_friend' | 'respond_accept' | 'respond_decline',
  ) {
    const sb = getSupabaseClient()
    const { error } =
      kind === 'respond_accept' || kind === 'respond_decline'
        ? await sb.rpc('respond_friend', { p_username: u, p_accept: kind === 'respond_accept' })
        : await sb.rpc(kind, { p_username: u })
    if (!error) {
      // refetch so the button reflects the new standing
      const { data } = await sb.rpc('get_member_profile', { p_username: u })
      if (data) setState({ kind: 'ok', p: data as ProfileData })
    }
  }
  async function message() {
    const sb = getSupabaseClient()
    const { data, error } = await sb.rpc('open_dm', { p_username: u })
    if (!error && data) window.location.hash = '#circuit?tab=chat&room=' + data
  }
  const display = p.first_name || p.username
  const initial = display[0]?.toUpperCase() ?? '★'

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3, 1rem)' }}>
      {/* identity header */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '3.4rem',
            height: '3.4rem',
            borderRadius: '50%',
            background: 'var(--accent)',
            color: 'var(--btn-text, #fff)',
            fontSize: '1.5rem',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initial}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            {display}{' '}
            {p.is_me && (
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                (you)
              </span>
            )}
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            @{p.username} · member since {p.member_since}
          </p>
        </div>
        {!p.is_me && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
            {p.friend_status === 'friends' && (
              <>
                <button className="btn" onClick={() => void message()}>
                  💬 Message
                </button>
                <button
                  className="btn"
                  title="Remove friend"
                  onClick={() => void act('remove_friend')}
                  style={{ opacity: 0.7 }}
                >
                  ✓ Friends
                </button>
              </>
            )}
            {p.friend_status === 'pending_out' && (
              <button
                className="btn"
                title="Cancel request"
                onClick={() => void act('remove_friend')}
              >
                Request sent
              </button>
            )}
            {p.friend_status === 'pending_in' && (
              <>
                <button className="btn" onClick={() => void act('respond_accept')}>
                  Accept friend
                </button>
                <button
                  className="btn"
                  style={{ opacity: 0.7 }}
                  onClick={() => void act('respond_decline')}
                >
                  Decline
                </button>
              </>
            )}
            {!p.friend_status && (
              <button className="btn" onClick={() => void act('request_friend')}>
                ➕ Add friend
              </button>
            )}
          </span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3, 1rem)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))',
        }}
      >
        {/* circuits you share */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🏆 Circuits together</h3>
          {p.shared_circuits.length ? (
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {p.shared_circuits.map((g) => (
                <li key={g.name}>
                  <strong>{g.name}</strong>
                  {g.people.length > 0 && (
                    <span className="muted"> — as {g.people.join(', ')}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {p.is_me ? 'You’re not in any circuits yet.' : 'No circuits together yet.'}
            </p>
          )}
        </div>

        {/* movies */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🎬 Movies</h3>
          {p.movies_rated > 0 ? (
            <p style={{ margin: 0 }}>
              <strong style={{ fontSize: '1.6rem' }}>{p.movies_rated}</strong>{' '}
              <span className="muted">movies rated in your shared circuits</span>
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No ratings where you can see them.
            </p>
          )}
        </div>

        {/* everyone else — the door to their pages */}
        {people.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>🧑‍🤝‍🧑 People</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {people
                .filter((m) => m.username.toLowerCase() !== p.username.toLowerCase())
                .map((m) => (
                  <a
                    key={m.username}
                    className="cz-chip"
                    href={'#profile?u=' + encodeURIComponent(m.username)}
                    style={{ textDecoration: 'none' }}
                    title={m.is_friend ? 'Friend' : 'View profile'}
                  >
                    {m.is_friend ? '⭐' : '👤'} {m.name}
                  </a>
                ))}
            </div>
          </div>
        )}

        {/* snake */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🐍 Snake</h3>
          {p.snake_best ? (
            <p style={{ margin: 0 }}>
              <strong style={{ fontSize: '1.6rem' }}>{p.snake_best.score}</strong>{' '}
              <span className="muted">
                personal best{p.snake_best.game_mode ? ` · ${p.snake_best.game_mode}` : ''} ·{' '}
                {p.snake_best.achieved}
              </span>
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No score on the board under their name{p.is_me ? ' — go set one!' : ' yet.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
