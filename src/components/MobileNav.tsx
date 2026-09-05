import { useEffect, useRef, useState } from 'react'

/**
 * The phone's navigation. A cramped horizontal scroll strip is the wrong shape for a
 * thumb — this replaces it with two native-feeling pieces:
 *
 *  1. A bottom bar of the daily destinations (thumb zone), with the primary action raised
 *     and accented — Log for members, Sign in / Snake for guests.
 *  2. A full-screen launcher (☰) with a roomy tile for every place you can go, so nothing
 *     is ever hidden past a scroll edge. This is the spacious "dial" — the whole site at a
 *     glance, one tap away.
 *
 * Desktop keeps the top nav untouched; this renders only below the desktop breakpoint.
 */

export type MobileSection =
  | 'home'
  | 'circuit'
  | 'ratings'
  | 'chat'
  | 'people'
  | 'signin'
  | 'investments'
  | 'account-settings'
  | 'snake'
  | 'visualizer'
  | 'instrument'
  | 'paint'
  | 'contact'
  | 'admin'
  | 'profile'

type Dest = {
  key: string
  label: string
  icon: string
  section: MobileSection
  tab?: string
  primary?: boolean
}

export function MobileNav({
  active,
  go,
  authed,
  hasAuth,
  canFinance,
  isAdmin,
  suspended,
  theme,
  onCycleTheme,
  onSignOut,
  onProfile,
  unreadChats = 0,
  friendRequests = 0,
}: {
  active: string
  go: (section: MobileSection, tab?: string) => void
  authed: boolean
  hasAuth: boolean
  canFinance: boolean
  isAdmin: boolean
  suspended: boolean
  theme: 'light' | 'dark' | 'alt'
  onCycleTheme: () => void
  onSignOut: () => void
  onProfile?: () => void
  /** what's waiting, so the bar can pip it without opening anything */
  unreadChats?: number
  friendRequests?: number
}) {
  const [open, setOpen] = useState(false)
  const member = authed && !suspended

  // close the launcher on Escape, and whenever the section changes under it
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => setOpen(false), [active])

  const nav = (d: Dest) => {
    setOpen(false)
    go(d.section, d.tab)
  }
  const isOn = (d: Dest) => active === d.section && !d.tab

  const bar: Dest[] = member
    ? [
        { key: 'home', label: 'Home', icon: '🏠', section: 'home' },
        { key: 'circuit', label: 'Circuit', icon: '🏆', section: 'circuit' },
        { key: 'ratings', label: 'Ratings', icon: '⭐', section: 'ratings' },
        { key: 'chat', label: 'Chat', icon: '💬', section: 'chat' },
      ]
    : [
        { key: 'home', label: 'Home', icon: '🏠', section: 'home' },
        { key: 'snake', label: 'Snake', icon: '🎮', section: 'snake', primary: !hasAuth },
        ...(hasAuth
          ? [
              {
                key: 'signin',
                label: 'Sign in',
                icon: '🔑',
                section: 'signin',
                primary: true,
              } as Dest,
            ]
          : []),
        { key: 'contact', label: 'Say hi', icon: '✉️', section: 'contact' },
      ]

  // everything you can reach — the launcher grid
  const all: Dest[] = [
    { key: 'home', label: 'Home', icon: '🏠', section: 'home' },
    ...(member
      ? ([
          { key: 'circuit', label: 'Circuit', icon: '🏆', section: 'circuit' },
          { key: 'log', label: 'Quick log', icon: '✏️', section: 'circuit', tab: 'log' },
          { key: 'ratings', label: 'Ratings', icon: '⭐', section: 'ratings' },
          { key: 'chat', label: 'Chat', icon: '💬', section: 'chat' },
          { key: 'people', label: 'People', icon: '🧑‍🤝‍🧑', section: 'people' },
          // circuit management: out of the daily tab strip, but one tap from here
          { key: 'circuits', label: 'Circuits', icon: '👥', section: 'circuit', tab: 'circuits' },
        ] as Dest[])
      : []),
    ...(member && canFinance
      ? ([{ key: 'invest', label: 'Investments', icon: '📈', section: 'investments' }] as Dest[])
      : []),
    { key: 'snake', label: 'Snake', icon: '🎮', section: 'snake' },
    // the launcher, not the four-slot bar: this is a thing you go looking for, not a daily tab
    { key: 'visualizer', label: 'Visualiser', icon: '🎚️', section: 'visualizer' },
    { key: 'instrument', label: 'Instrument', icon: '🎹', section: 'instrument' },
    /* ⚠️ Paint belongs with these two and was simply missed when it was built — it is on the
       desktop nav between Instrument and Contact, so on a phone it was a page you could only
       reach by typing the URL. A room with no door is the same as a room that is not there. */
    { key: 'paint', label: 'Paint', icon: '🎨', section: 'paint' },
    ...(member
      ? ([{ key: 'account', label: 'Account', icon: '👤', section: 'account-settings' }] as Dest[])
      : []),
    ...(isAdmin
      ? ([{ key: 'admin', label: 'Admin', icon: '🛠', section: 'admin' }] as Dest[])
      : []),
    ...(hasAuth && !authed
      ? ([{ key: 'signin', label: 'Sign in', icon: '🔑', section: 'signin' }] as Dest[])
      : []),
    { key: 'contact', label: 'Contact', icon: '✉️', section: 'contact' },
  ]

  /**
   * Publish the bar's real height as `--mnav-h` so anything else pinned to the bottom of the
   * screen can clear it without hardcoding a copy of this number. Same approach as `--nav-h`
   * for the top bar, and for the same reason: the height comes from content and padding, so a
   * label change or a font swap moves it.
   *
   * Below the breakpoint the bar is `display: none`, which measures as 0 — so the token is
   * self-zeroing on desktop and no media query is needed anywhere downstream.
   */
  const barRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const publish = () => {
      const h = el.getBoundingClientRect().height
      document.documentElement.style.setProperty('--mnav-h', `${Math.round(h)}px`)
    }
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    // ResizeObserver is NOT enough on its own: it doesn't notify for an element that has no
    // box, so crossing the desktop breakpoint — where the bar becomes `display: none` —
    // left the token stuck at its last visible height. The dock then floated 60px too high on
    // desktop. Measured, not theorised: the token read 60px while the bar measured 0.
    const onResize = () => publish()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    // a font swap grows the labels after mount, which ResizeObserver alone can also miss
    void document.fonts?.ready.then(publish).catch(() => {})
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      document.documentElement.style.removeProperty('--mnav-h')
    }
  }, [])

  const themeIcon = theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '✦'

  return (
    <>
      <nav className="mnav" aria-label="Primary (mobile)" ref={barRef}>
        {bar.map((d) => (
          <button
            key={d.key}
            className={'mnav-item' + (d.primary ? ' is-primary' : '') + (isOn(d) ? ' is-on' : '')}
            aria-current={isOn(d) ? 'page' : undefined}
            onClick={() => nav(d)}
          >
            <span className="mnav-ic" aria-hidden>
              {d.icon}
            </span>
            <span className="mnav-lbl">{d.label}</span>
            {d.key === 'chat' && unreadChats > 0 && (
              <span className="mnav-pip">{unreadChats > 9 ? '9+' : unreadChats}</span>
            )}
          </button>
        ))}
        <button
          className={'mnav-item' + (open ? ' is-on' : '')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="mnav-ic" aria-hidden>
            ☰
          </span>
          <span className="mnav-lbl">Menu</span>
          {friendRequests > 0 && (
            <span className="mnav-pip">{friendRequests > 9 ? '9+' : friendRequests}</span>
          )}
        </button>
      </nav>

      {open && (
        <div className="mlaunch" role="dialog" aria-modal="true" aria-label="Go anywhere">
          <button
            className="mlaunch-scrim"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="mlaunch-sheet">
            <div className="mlaunch-grab" aria-hidden />
            <div className="mlaunch-grid">
              {all.map((d, i) => (
                <button
                  key={d.key}
                  className={'mtile' + (isOn(d) ? ' is-on' : '')}
                  style={{ animationDelay: `${Math.min(i, 8) * 28}ms` }}
                  onClick={() => nav(d)}
                >
                  <span className="mtile-ic" aria-hidden>
                    {d.icon}
                  </span>
                  <span className="mtile-lbl">{d.label}</span>
                  {d.key === 'people' && friendRequests > 0 && (
                    <span className="mnav-pip">{friendRequests}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="mlaunch-foot">
              {onProfile && member && (
                <button
                  className="mlaunch-foot-btn"
                  onClick={() => {
                    setOpen(false)
                    onProfile()
                  }}
                >
                  🪪 My profile
                </button>
              )}
              <button className="mlaunch-foot-btn" onClick={onCycleTheme}>
                {themeIcon} Theme
              </button>
              {member && (
                <button
                  className="mlaunch-foot-btn"
                  onClick={() => {
                    setOpen(false)
                    onSignOut()
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
