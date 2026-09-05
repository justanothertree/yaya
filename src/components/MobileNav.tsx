import { useEffect, useRef, useState } from 'react'
import { navFor, type Viewer } from '../nav/places'

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
  viewer,
  onOpenSettings,
  initial,
  suspended,
  onSignOut,
  onProfile,
  unreadChats = 0,
  friendRequests = 0,
}: {
  active: string
  go: (section: MobileSection, tab?: string) => void
  authed: boolean
  hasAuth: boolean
  /** ⚠️ the whole viewer, not loose flags: the shared list asks the questions, not this file */
  viewer: Viewer
  /** raise the settings sheet — it belongs on the bar, not at the top of the screen */
  onOpenSettings: () => void
  /** ⚠️ the same letter the cog draws, computed once by App so the two cannot disagree */
  initial: string
  suspended: boolean
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

  /**
   * Everything you can reach — the launcher grid.
   *
   * ⚠️ THE PLACES COME FROM nav/places.ts, the same list the desktop strip draws from. This
   * array used to be written out by hand and that is exactly how Paint came to be missing here
   * while existing everywhere else: two lists of the same thing, one of them forgotten.
   *
   * The tab shortcuts below are the launcher's OWN, and rightly so — "Quick log" and "Circuits"
   * are two doors into the Circuit rather than two places, and a phone has room to offer them
   * where a desktop strip does not. They are extra doors to a room the shared list already
   * knows about, which is a different thing from a room only this file knows about.
   */
  const shared = navFor(viewer)
  const extras: Record<string, Dest[]> = {
    circuit: member
      ? [{ key: 'log', label: 'Quick log', icon: '✏️', section: 'circuit', tab: 'log' }]
      : [],
    people: member
      ? [{ key: 'circuits', label: 'Circuits', icon: '👥', section: 'circuit', tab: 'circuits' }]
      : [],
  }
  const all: Dest[] = shared.flatMap((place) => [
    {
      key: place.id,
      label: place.label,
      icon: place.icon,
      section: place.id as MobileSection,
    },
    ...(extras[place.id] ?? []),
  ])

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
        {/**
         * ⚠️ YOU, ON THE BAR. The settings panel became a sheet along the bottom, and the button
         * that raised it stayed in the top-right corner — so you reached to the far end of the
         * screen to make something appear under your thumb. The trigger belongs with the thing
         * it opens. The cog above hides at this width rather than staying as a second way in,
         * because two triggers for one panel is what put a theme cycle and a theme picker in the
         * same corner earlier.
         *
         * It takes Ratings' slot rather than becoming a sixth: five is what fits, Ratings is one
         * tap away in the launcher beside it, and settings is reached more often than a rating.
         */}
        {member && (
          <button
            className="mnav-item"
            aria-haspopup="menu"
            onClick={onOpenSettings}
            aria-label="You and your settings"
          >
            <span className="mnav-ic" aria-hidden>
              {initial}
            </span>
            <span className="mnav-lbl">You</span>
          </button>
        )}
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
              {/**
               * ⚠️ NO THEME BUTTON HERE. There was one, and it was the worse of two.
               *
               * The cog in the header carries a theme PICKER — light, dark, alt and the full
               * appearance dialog — and it stays tappable while this launcher is open, because
               * the header sits above the overlay. This one was a blind CYCLE: same word, same
               * corner of the screen, different behaviour, and no way to tell which you were
               * about to get. Two doors to one setting is a nuisance; two doors that do
               * different things is a trap.
               *
               * Profile and Sign out below are duplicated too, but harmlessly — they do exactly
               * what the cog's versions do, and a launcher is a reasonable place to find them.
               */}
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
