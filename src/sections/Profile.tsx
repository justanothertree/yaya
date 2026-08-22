import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { avatarStyle } from '../profile/look'
import type { ProfileData } from '../profile/profileData'
import { previewMember, PREVIEW_PROFILES } from '../dev/previewMember'
import { derivePalette } from '../theme/customTheme'
import { previewClickFx, setClickFxStyle, type FxStyle } from '../ui/clickFx'
import { beatLink } from '../game/challenge'
import {
  ProfileBlocksEditor,
  ProfileBlocksView,
  type ActivityItem,
  type ProfileBlock,
  type Tier,
} from './ProfileBlocks'

// duplicated from ProfileBlocks.tsx's own (unexported) copy -- kept local rather than shared,
// since exporting a plain constant alongside components there breaks Fast Refresh
const TIER_LABEL: Record<Tier, string> = {
  public: 'Anyone',
  friends: 'Friends',
  members: 'Members',
  private: 'Only me',
}

/**
 * A member's profile — the page behind every name on the site.
 *
 * v1 shows the viewer ONLY what they could already see elsewhere: the circuits you're
 * both in, movie ratings inside those circuits, and the snake best they already posted
 * under their own name on the public leaderboard. No new exposure — the server RPC
 * (get_member_profile) enforces that, not this component. The owner-controlled
 * visibility tiers (public / friends / members / private) layer on top of this later.
 */

const userFromHash = () =>
  new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('u') ?? ''

type Person = { username: string; name: string; is_friend: boolean }

/** viewer's choice: do other people's themes apply on their pages */
const LOOK_KEY = 'profile_wear_their_look_v1'

export function Profile({ authed }: { authed: boolean }) {
  const [u, setU] = useState(userFromHash)
  const [people, setPeople] = useState<Person[]>([])
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'missing' }
    | { kind: 'error'; msg: string }
    | { kind: 'ok'; p: ProfileData }
  >({ kind: 'loading' })
  // blocks + activity load ALONGSIDE the profile, not gated behind it -- an empty array here
  // just means "no blocks yet", which is the common case and shouldn't hold up the rest of
  // the page rendering
  const [blocks, setBlocks] = useState<ProfileBlock[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [editing, setEditing] = useState(false)
  /**
   * Whether to wear other people's looks at all.
   *
   * Someone else's palette and flair are the point of a profile, but they're also a stranger's
   * taste landing on your screen unasked — and not everyone wants that, especially anyone who
   * picked a high-contrast or quiet theme deliberately. Off means their page renders in YOUR
   * theme; their avatar colour stays either way, since that's how you recognise whose page
   * you're on rather than a style choice.
   */
  const [wearTheirLook, setWearTheirLook] = useState(() => {
    try {
      return localStorage.getItem(LOOK_KEY) !== '0'
    } catch {
      return true
    }
  })
  const setWear = (on: boolean) => {
    setWearTheirLook(on)
    try {
      localStorage.setItem(LOOK_KEY, on ? '1' : '0')
    } catch {
      /* private mode — it just won't stick */
    }
  }

  // moving between profiles changes only the ?u= — the section stays 'profile', so App
  // won't remount us; track the hash ourselves
  useEffect(() => {
    const onHash = () => setU(userFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // blocks + activity, alongside the main profile fetch below. Reset (not left stale) on every
  // navigation between profiles, and dropped when leaving edit mode isn't required -- editing
  // resets itself because it's keyed off `u` too, below.
  useEffect(() => {
    if (!authed || !u) return
    let live = true
    setEditing(false)
    const sb = getSupabaseClient()
    void sb.rpc('get_profile_blocks', { p_username: u }).then(({ data }) => {
      if (live && data) setBlocks(data as ProfileBlock[])
    })
    void sb.rpc('get_member_activity', { p_username: u, p_limit: 20 }).then(({ data }) => {
      if (live && data) setActivity(data as ActivityItem[])
    })
    return () => {
      live = false
    }
  }, [u, authed])

  useEffect(() => {
    if (!authed || !u) return
    let live = true
    setState({ kind: 'loading' })
    if (previewMember) {
      const hit = PREVIEW_PROFILES[u]
      setState(hit ? { kind: 'ok', p: hit } : { kind: 'missing' })
      return
    }
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

  /**
   * Wear their click flair while their page is open, and put yours back on the way out.
   *
   * The flair is part of how the site feels to them, so showing their colours without it is half
   * a picture. Restoring reads the viewer's own choice from the same key App persists it to,
   * which keeps this self-contained — Profile never needs to be handed the visitor's settings.
   */
  const theirFlair =
    state.kind === 'ok' && (wearTheirLook || state.p.is_me) ? (state.p.look?.flair ?? null) : null
  useEffect(() => {
    if (!theirFlair) return
    setClickFxStyle(theirFlair as FxStyle)
    return () => {
      let mine = 'sparks'
      try {
        mine = localStorage.getItem('click_fx_style_v1') || 'sparks'
      } catch {
        /* private mode — the default is right anyway */
      }
      setClickFxStyle(mine as FxStyle)
    }
  }, [theirFlair])

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
    if (!error && data) window.location.hash = '#chat?room=' + data
  }
  const display = p.first_name || p.username
  const initial = display[0]?.toUpperCase() ?? '★'

  /**
   * Their look, applied to THIS PAGE ONLY.
   *
   * Scoped rather than global on purpose: browsing to someone's profile should show you their
   * taste, not silently repaint the site around you and leave you wondering what you changed.
   * A custom palette becomes inline tokens (derivePalette is pure, so it works on any element,
   * not just <html>); a built-in theme becomes a nested data-theme, which works because those
   * are plain attribute selectors — dark needed an explicit block added for the same reason.
   */
  const look = p.look ?? null
  // your own page always renders in your own look, so the toggle can't make it look wrong to you
  const wearing = look && (wearTheirLook || p.is_me) ? look : null
  const lookVars = wearing?.palette
    ? (derivePalette(wearing.palette) as React.CSSProperties)
    : undefined

  return (
    <div
      data-theme={wearing?.palette ? undefined : (wearing?.theme ?? undefined)}
      style={{ display: 'grid', gap: 'var(--sp-3, 1rem)', ...lookVars }}
    >
      {/* identity header */}
      <div className="card profile-head">
        {/* Their colour, not the site's. This used to be var(--accent) for everyone, so all
            thirty-odd profiles opened looking like the same page with a different letter. */}
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '3.4rem',
            height: '3.4rem',
            borderRadius: '50%',
            fontSize: '1.5rem',
            fontWeight: 700,
            flexShrink: 0,
            ...avatarStyle(p.username),
          }}
        >
          {initial}
        </span>
        <div className="profile-head-who">
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
          {/* Says whose taste you're looking at, so their colours read as theirs rather than as
              the site behaving oddly. The button fires their effect on demand — otherwise the
              flair is invisible until you happen to click something. */}
          {look && (look.theme || look.palette || look.flair) && (
            <p className="muted" style={{ margin: '0.15rem 0 0', fontSize: '0.75rem' }}>
              {p.is_me ? 'Your look' : `${display}'s look`}
              {/* Lives here rather than in the cog: this is where you notice the page looks
                  different, so it's where the way out belongs. */}
              {!p.is_me && (
                <>
                  {' · '}
                  <button
                    className="btn"
                    style={{ padding: '0 0.4rem', fontSize: '0.72rem' }}
                    aria-pressed={wearTheirLook}
                    onClick={() => setWear(!wearTheirLook)}
                    title={
                      wearTheirLook
                        ? 'Show every profile in your own theme instead'
                        : 'Let profiles show their own theme again'
                    }
                  >
                    {wearTheirLook ? '🎨 Their theme' : '🎨 My theme'}
                  </button>
                </>
              )}
              {wearing?.flair && (
                <>
                  {' · '}
                  <button
                    className="btn"
                    style={{ padding: '0 0.4rem', fontSize: '0.72rem' }}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      previewClickFx(
                        wearing.flair as FxStyle,
                        r.left + r.width / 2,
                        r.top + r.height / 2,
                      )
                    }}
                  >
                    ✨ {wearing.flair}
                  </button>
                </>
              )}
            </p>
          )}
        </div>
        {p.is_me && (
          <span className="profile-head-actions">
            <select
              className="btn"
              value={p.activity_visibility}
              title="Who can see your circuits, ratings, snake results and activity"
              onChange={async (e) => {
                const tier = e.target.value as Tier
                const { error } = await getSupabaseClient().rpc('set_my_activity_visibility', {
                  p_tier: tier,
                })
                if (!error) setState({ kind: 'ok', p: { ...p, activity_visibility: tier } })
              }}
            >
              {(Object.keys(TIER_LABEL) as Tier[]).map((t) => (
                <option key={t} value={t}>
                  Activity: {TIER_LABEL[t]}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Done editing' : '🎨 Customize page'}
            </button>
          </span>
        )}
        {!p.is_me && (
          <span className="profile-head-actions">
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

      {/* Optional customization -- only exists on the page at all once there's something to
          show. The editor and the read view are never both mounted: editing shows the working
          copy being arranged, done-editing shows what was actually saved. */}
      {p.is_me && editing ? (
        <ProfileBlocksEditor
          initial={blocks}
          username={p.username}
          onSaved={(saved) => {
            setBlocks(saved)
            setEditing(false)
          }}
        />
      ) : (
        <ProfileBlocksView
          blocks={blocks}
          activity={activity}
          snakeBest={p.snake_best}
          username={p.username}
          isMe={p.is_me}
        />
      )}

      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3, 1rem)',
          // min() is load-bearing: the root font is fluid, so 15rem measured 356.9px inside a
          // 343px column on a phone — and minmax's first argument is a hard floor, so the
          // track ran off the right edge where overflow-x: hidden clipped it. See
          // .profile-blocks-grid in index.css, which had exactly the same bug.
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(15rem, 100%), 1fr))',
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
                    className="cz-chip profile-person-chip"
                    href={'#profile?u=' + encodeURIComponent(m.username)}
                    style={{ textDecoration: 'none' }}
                    title={m.is_friend ? 'Friend' : 'View profile'}
                  >
                    {/* the same colour their page opens in, so the list is recognisable at a
                        glance rather than a wall of identical chips */}
                    <span
                      className="profile-person-dot"
                      style={avatarStyle(m.username)}
                      aria-hidden
                    >
                      {(m.name[0] ?? '★').toUpperCase()}
                    </span>
                    {m.name}
                    {m.is_friend && <span aria-label="Friend"> ⭐</span>}
                  </a>
                ))}
            </div>
          </div>
        )}

        {/* snake */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🐍 Snake</h3>
          {p.snake_best ? (
            <>
              <p style={{ margin: 0 }}>
                <strong style={{ fontSize: '1.6rem' }}>{p.snake_best.score}</strong>{' '}
                <span className="muted">
                  personal best{p.snake_best.game_mode ? ` · ${p.snake_best.game_mode}` : ''} ·{' '}
                  {p.snake_best.achieved}
                </span>
              </p>
              {/* The challenge a PROFILE can make. Inviting someone to a room needs you both
                  online at once; a score is sitting here either way, so this works whether
                  they're around or not — and it turns a number you were only reading into
                  something you can answer. Not on your own page: you can't race yourself. */}
              {/* You vs them, stated plainly. Only when you HAVE a score — telling someone who
                  has never played that they're behind by 310 is discouraging, not competitive,
                  and the Beat button below already invites them in. */}
              {!p.is_me && p.viewer_snake_best && (
                <p className="profile-h2h" style={{ margin: '0.5rem 0 0' }}>
                  {p.viewer_snake_best.score > p.snake_best.score ? (
                    <>
                      <strong>You lead</strong>{' '}
                      <span className="muted">
                        {p.viewer_snake_best.score} to {p.snake_best.score}
                      </span>
                    </>
                  ) : p.viewer_snake_best.score === p.snake_best.score ? (
                    <>
                      <strong>Dead even</strong>{' '}
                      <span className="muted">at {p.snake_best.score}</span>
                    </>
                  ) : (
                    <>
                      <strong>They lead</strong>{' '}
                      <span className="muted">
                        {p.snake_best.score} to {p.viewer_snake_best.score} — you need{' '}
                        {p.snake_best.score - p.viewer_snake_best.score + 1} more
                      </span>
                    </>
                  )}
                </p>
              )}
              {!p.is_me && (
                <a
                  className="btn"
                  href={beatLink(p.snake_best.score, display)}
                  style={{ marginTop: '0.6rem', display: 'inline-block' }}
                  title={`Play Snake trying to beat ${p.snake_best.score}`}
                >
                  ⚔️ Beat {p.snake_best.score}
                </a>
              )}
            </>
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
