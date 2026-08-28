import { useContext, useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { avatarStyle } from '../profile/look'
import type { ProfileData } from '../profile/profileData'
import { previewMember, PREVIEW_PROFILES } from '../dev/previewMember'
import { applyPalette, derivePalette, loadPalette } from '../theme/customTheme'
import { previewClickFx, setClickFxScope, type FxStyle } from '../ui/clickFx'
import { beatLink } from '../game/challenge'
import { isBackdropId, setBackdropOverride, type BackdropId } from '../profile/backdrops'
import { SiteBackdrop } from '../profile/SiteBackdrop'
import { InCanvasWindow } from '../circuit/ui/canvasContext'
import { setPaneLook } from '../circuit/ui/paneLook'
import { ProfileCall } from '../voice/ProfileCall'
import {
  ProfileBlocksEditor,
  ProfileBlocksView,
  type ActivityItem,
  type ProfileTrophy,
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

/**
 * `#profile?u=me&edit=look` opens straight into the look editor.
 *
 * The backdrop and flair pickers live behind "Customize page" on your own profile, which is the
 * right home for them — they change that page and you watch it change. It is not, however, where
 * anyone looks for a setting: the cog is. So the cog links here rather than growing a duplicate
 * copy of the controls, and this is what makes that link land somewhere useful instead of on a
 * page with a button you still have to find.
 */
const editFromHash = () =>
  new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('edit') === 'look'

type Person = { username: string; name: string; is_friend: boolean }

/** viewer's choice: do other people's themes apply on their pages */
const LOOK_KEY = 'profile_wear_their_look_v1'

/**
 * `username` PINS this instance to one person, instead of following the hash.
 *
 * ⚠️ That distinction is what lets several profiles be open at once on the canvas. The hash can
 * only ever name one person, so a second window reading it would show the same profile as the
 * first and both would change subject together — which is exactly the behaviour that made
 * "another profile window" impossible. A pinned window ignores the hash entirely; the page and
 * the nav's own Profile window leave it off and keep following it as before.
 */
export function Profile({ authed, username }: { authed: boolean; username?: string }) {
  const pinned = username != null
  const [u, setU] = useState(() => username ?? userFromHash())
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
  const [trophies, setTrophies] = useState<ProfileTrophy[]>([])
  const [editing, setEditing] = useState(editFromHash)
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
  /**
   * On/off for THE PAGE YOU ARE ON, not a site-wide mode.
   *
   * It used to write LOOK_KEY and govern every profile at once, which is why the button had to
   * be labelled "Their theme / My theme" — it was describing a mode rather than a switch. Turning
   * someone's colours off is nearly always about THAT person's colours, so the switch belongs to
   * their page and resets when you leave it.
   *
   * LOOK_KEY still supplies the DEFAULT, so anyone who previously turned looks off stays opted
   * out; it is no longer rewritten from here. A permanent "never wear anyone's look" belongs in
   * settings rather than on one person's page, if it is ever wanted.
   */
  const setWear = (on: boolean) => setWearTheirLook(on)
  // a fresh profile is a fresh page: back to the default rather than carrying the last
  // person's decision onto someone who had nothing to do with it
  useEffect(() => {
    try {
      setWearTheirLook(localStorage.getItem(LOOK_KEY) !== '0')
    } catch {
      setWearTheirLook(true)
    }
  }, [u])

  // a pinned window follows its prop instead of the hash — and the prop can change if the same
  // window is reused for a different person
  useEffect(() => {
    if (username != null) setU(username)
  }, [username])

  // moving between profiles changes only the ?u= — the section stays 'profile', so App
  // won't remount us; track the hash ourselves. Pinned windows sit this out, or every open
  // profile would jump to whoever you clicked last.
  useEffect(() => {
    if (pinned) return
    const onHash = () => {
      setU(userFromHash())
      if (editFromHash()) setEditing(true)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [pinned])

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
    // ⚠️ Separate from the activity feed on purpose: that one is time-ordered and capped at 20,
    // so trophies older than a member's last twenty events silently vanished from their profile.
    void sb.rpc('get_member_trophies', { p_username: u }).then(({ data }) => {
      if (live && data) setTrophies(data as ProfileTrophy[])
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
  /**
   * ⚠️ SOMEONE ELSE'S LOOK ONLY. Your own page used to be included here, on the reasoning that it
   * should render in your own colours — but your colours are already on <html>, so it inherits
   * them for free. What including yourself actually did was pin the page to the copy the SERVER
   * sent at load: the wrapper wore a stale palette and the flair scope a stale style, so changing
   * either while your profile was open did nothing until a refetch. In a canvas window, where the
   * page never reloads on navigation, that meant a full refresh.
   *
   * Nothing to apply on your own page, and nothing to go stale.
   */
  const theirFlair =
    state.kind === 'ok' && !state.p.is_me && wearTheirLook ? (state.p.look?.flair ?? null) : null
  // derived up here beside the flair, and for the same reason: it drives a hook, and a hook
  // cannot sit below the loading / missing / error returns further down
  const theirLook =
    state.kind === 'ok' && !state.p.is_me && wearTheirLook ? (state.p.look ?? null) : null
  /**
   * A profile is either the whole page or one window on the canvas, and their look belongs to
   * whichever of those it is. As a page it repaints the page; as a window it repaints the
   * window and leaves the rest of the canvas alone.
   */
  const { inWindow: inCanvasWindow, paneId } = useContext(InCanvasWindow)
  const lookRef = useRef<HTMLDivElement | null>(null)

  /**
   * Their flair plays on their page. Yours still plays everywhere else.
   *
   * ⚠️ This used to swap the SITE-WIDE style and put yours back on the way out, so their sparks
   * fired on the nav and every other window while their page happened to be open. Scoping it by
   * suppressing outside clicks then traded that for no flair at all out there. An override does
   * what was actually wanted: inside their page it is theirs, outside it is yours, and the
   * site-wide setting is never touched — so there is nothing to restore and no way to leave a
   * visitor wearing a stranger's flair.
   */
  useEffect(() => {
    if (!theirFlair) return
    setClickFxScope(lookRef.current, theirFlair as FxStyle)
    return () => setClickFxScope(null, null)
  }, [theirFlair])

  /**
   * Their background, on the one site-wide layer.
   *
   * ⚠️ Not a second canvas scoped to the profile. Running one behind the page and another inside
   * it means two simulations painting at once for a single visible result — the thing the whole
   * budget exists to avoid. The layer already exists and is already the right size; this only
   * changes what it draws, and puts it back when you leave. Same shape as the click flair's
   * override, for the same reason.
   */
  /**
   * ⚠️ IN A WINDOW, THEIR BACKGROUND BELONGS TO THE WINDOW.
   *
   * As a full page, their profile IS the page, so taking over the one site-wide layer is right.
   * In canvas mode it is one window among several — repainting the whole canvas because you
   * opened someone's profile changes the background behind every OTHER window too, which is the
   * same takeover the look scoping was written to prevent, arriving by a different route.
   *
   * So: override the site layer on a page, and draw a scoped one inside the window otherwise.
   * That is a second canvas, and it is the one case worth paying for — it is window-sized, the
   * particle count scales with area, and the alternative is being wrong.
   */
  const theirBackdrop: BackdropId =
    theirLook && isBackdropId(theirLook.backdrop) ? theirLook.backdrop : 'none'
  useEffect(() => {
    if (!theirLook || inCanvasWindow) return
    setBackdropOverride(theirBackdrop)
    return () => setBackdropOverride(null)
  }, [theirLook, inCanvasWindow, theirBackdrop])

  /**
   * Hand the look up to the window, so the WHOLE window wears it.
   *
   * ⚠️ Setting it on this element can only ever reach this element's descendants — the title bar,
   * the border and the shell are ancestors, so they kept the viewer's colours and the result read
   * as a half-painted window rather than a theme. The shell subscribes and applies what is
   * published here; cleared on the way out so the window goes back to yours.
   */
  useEffect(() => {
    if (!inCanvasWindow || !paneId) return
    if (!theirLook) {
      setPaneLook(paneId, null)
      return
    }
    setPaneLook(paneId, {
      vars: theirLook.palette ? (derivePalette(theirLook.palette) as Record<string, string>) : {},
      theme: theirLook.palette ? null : (theirLook.theme ?? null),
    })
    return () => setPaneLook(paneId, null)
  }, [inCanvasWindow, paneId, theirLook])

  /**
   * ⚠️ PAGE MODE ONLY. Standing on its own, a profile IS the page, so their palette goes where
   * the site's own does: applyPalette writes inline custom properties on <html>, the same call
   * the theme picker uses, and data-theme='custom' is deliberately a name no stylesheet block
   * matches so the values inherit the whole way down. Nothing else can repaint the page from
   * inside it — `.card` fills with `--surface`, a near-transparent overlay, so a wrapper that
   * carries the tokens without drawing them leaves the page showing through underneath.
   *
   * In a canvas window this must NOT run: repainting <html> would put their colours on the nav,
   * the launcher and every other open window, which is a takeover rather than a profile. There
   * the wrapper paints the window instead.
   *
   * Put back on the way out, always — someone else's palette must not follow you off their page.
   */
  useEffect(() => {
    if (!theirLook || inCanvasWindow) return
    const root = document.documentElement
    const prevTheme = root.getAttribute('data-theme')
    if (theirLook.palette) {
      applyPalette(theirLook.palette)
      root.setAttribute('data-theme', 'custom')
    } else if (theirLook.theme) {
      root.setAttribute('data-theme', theirLook.theme)
    }
    return () => {
      applyPalette(loadPalette())
      if (prevTheme) root.setAttribute('data-theme', prevTheme)
      else root.removeAttribute('data-theme')
    }
  }, [theirLook, inCanvasWindow])

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
  const wearing = theirLook
  const lookVars = wearing?.palette
    ? (derivePalette(wearing.palette) as React.CSSProperties)
    : undefined

  /** what this profile has nothing of, in the words each case deserves */
  const nothingYet = [
    p.shared_circuits.length === 0 && (p.is_me ? 'no circuits yet' : 'no circuits together'),
    p.movies_rated === 0 && (p.is_me ? 'no ratings yet' : 'no ratings you can see'),
    !p.snake_best && (p.is_me ? 'no Snake score — go set one' : 'no Snake score'),
  ].filter((x): x is string => typeof x === 'string')

  return (
    /**
     * Their look lives on THIS ELEMENT and stops here.
     *
     * ⚠️ It has to PAINT, not merely hold the tokens. `.card` fills with `--surface`, a
     * near-transparent overlay, so cards show whatever is behind them — and if this element
     * draws nothing, that is the page, which is still the viewer's. Their `--bg` was set,
     * inherited correctly, and never drawn, so only the accent and the cursor changed.
     *
     * Applying it to <html> instead would fix that by repainting the whole site around you,
     * which is worse: you would be reading someone else's colours on the nav, the launcher and
     * every other window on the canvas. Scoped and painted is the version that means "their
     * page" rather than "your site, briefly theirs".
     */
    <div
      ref={lookRef}
      data-theme={wearing?.palette ? undefined : (wearing?.theme ?? undefined)}
      /* In a window it PAINTS — the window is the page here, so it fills the body edge to edge
         with no border or extra padding, which is also why toggling cannot shift the layout.
         As a standalone page the effect above has already repainted <html>, so it must not draw
         a second panel on top of it. */
      className={
        [
          wearing && inCanvasWindow ? 'profile-look-window' : '',
          wearing && inCanvasWindow && theirBackdrop !== 'none' ? 'profile-has-backdrop' : '',
        ]
          .filter(Boolean)
          .join(' ') || undefined
      }
      style={{ display: 'grid', gap: 'var(--sp-3, 1rem)', ...lookVars }}
    >
      {/* their background, inside their window — see the note over theirBackdrop */}
      {wearing && inCanvasWindow && theirBackdrop !== 'none' && (
        <SiteBackdrop id={theirBackdrop} inline />
      )}
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
                        ? 'Turn off — show profiles in your own theme instead. Remembered for every profile.'
                        : 'Turn on — let profiles show their own theme. Remembered for every profile.'
                    }
                  >
                    {/* On/off for THIS window, not a mode swap. "Their theme / My theme" read as
                        a picker between two options, so it was never obvious which one you were
                        currently looking at — the label named the choice rather than the state. */}
                    {wearTheirLook ? '🎨 Their theme on' : '🎨 Their theme off'}
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

      {/* A call that lives on this page. Renders nothing at all for a visitor with no call to
          join — which is also, deliberately, what somebody excluded from a private one sees. */}
      <ProfileCall username={p.username} displayName={display} isMe={p.is_me} />

      {/* Optional customization -- only exists on the page at all once there's something to
          show. The editor and the read view are never both mounted: editing shows the working
          copy being arranged, done-editing shows what was actually saved. */}
      {p.is_me && editing ? (
        <ProfileBlocksEditor
          initial={blocks}
          username={p.username}
          activity={activity}
          trophies={trophies}
          snakeBest={p.snake_best}
          /* Called after every autosave now, not once at the end — so leaving edit mode shows
             what is actually stored. It no longer closes the editor: you are done when you say
             you are done, not when the last keystroke lands. */
          onSaved={(saved) => setBlocks(saved)}
        />
      ) : (
        <ProfileBlocksView
          blocks={blocks}
          activity={activity}
          trophies={trophies}
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
        {p.shared_circuits.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>🏆 Circuits together</h3>
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
          </div>
        )}

        {/* movies */}
        {p.movies_rated > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>🎬 Movies</h3>
            <p style={{ margin: 0 }}>
              <strong style={{ fontSize: '1.6rem' }}>{p.movies_rated}</strong>{' '}
              <span className="muted">movies rated in your shared circuits</span>
            </p>
          </div>
        )}

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
        {p.snake_best && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>🐍 Snake</h3>
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
          </div>
        )}
      </div>

      {/**
       * The nothings, as one line.
       *
       * Circuits, Movies and Snake used to render as three headed cards whatever the answer, so
       * a profile with nothing shared was 309px of a 524px page spent saying "no", "no" and
       * "no" in three separate boxes. A card is for something worth looking at; an absence is a
       * sentence. Cards that DO have something are untouched above.
       */}
      {nothingYet.length > 0 && (
        <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
          {p.is_me ? 'Nothing on your page yet — ' : 'Nothing in common yet — '}
          {nothingYet.join(', ')}.
        </p>
      )}
    </div>
  )
}
