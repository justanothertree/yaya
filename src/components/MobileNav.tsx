import { useEffect, useState } from 'react'

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
  | 'signin'
  | 'investments'
  | 'account-settings'
  | 'snake'
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
        { key: 'log', label: 'Log', icon: '✏️', section: 'circuit', tab: 'log', primary: true },
        { key: 'chat', label: 'Chat', icon: '💬', section: 'circuit', tab: 'chat' },
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
          { key: 'chat', label: 'Chat', icon: '💬', section: 'circuit', tab: 'chat' },
        ] as Dest[])
      : []),
    ...(member && canFinance
      ? ([{ key: 'invest', label: 'Investments', icon: '📈', section: 'investments' }] as Dest[])
      : []),
    { key: 'snake', label: 'Snake', icon: '🎮', section: 'snake' },
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

  const themeIcon = theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '✦'

  return (
    <>
      <nav className="mnav" aria-label="Primary (mobile)">
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
