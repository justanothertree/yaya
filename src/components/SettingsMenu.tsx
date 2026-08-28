import { useEffect, useRef, useState } from 'react'
import { playCallSound, ringtoneEnabled, setRingtoneEnabled } from '../voice/ringtone'

export type Theme = 'light' | 'dark' | 'alt'

/**
 * The cog: one control for everything that makes the site *yours* — who you are, and how
 * it looks. It replaces four separate nav controls (the A−/100%/A+ cluster, the theme
 * toggle, the canvas toggle and Sign out) that between them ate ~250px of the bar and
 * appeared/vanished per page, shifting everything around them.
 *
 * It's deliberately shaped like an account menu rather than a settings dialog: identity on
 * top, your stuff under it, preferences below. That's the seed of a real profile surface —
 * this is where a display name, avatar and public page grow later.
 *
 * The nav sits OUTSIDE the zoomed <main>, so the menu holds still while the content scales
 * behind it: you can sit on − / + and watch the page resize without the button sliding out
 * from under the cursor.
 */
export function SettingsMenu({
  theme,
  onTheme,
  uiScale,
  onScale,
  canvasOpen,
  onToggleCanvas,
  canvasCapable,
  canvasReason,
  desktop,
  motionOff,
  motionBySystem,
  onToggleMotion,
  customPalette,
  authed,
  isAdmin,
  name,
  email,
  onAccount,
  onProfile,
  onAppearance,
  onSignIn,
  onSignOut,
}: {
  theme: Theme
  onTheme: (t: Theme) => void
  uiScale: number
  onScale: (n: number) => void
  canvasOpen: boolean
  onToggleCanvas: () => void
  canvasCapable: boolean
  /** why canvas is unavailable, when it is — a disabled control should say why */
  canvasReason?: string
  desktop: boolean
  /** the effective answer: the site switch, or the OS asking */
  motionOff: boolean
  /** true when the OS is the reason, in which case the switch is locked on */
  motionBySystem: boolean
  onToggleMotion: () => void
  /** true when the user's own palette is overriding the built-in theme */
  customPalette: boolean
  authed: boolean
  isAdmin: boolean
  /** their actual name, once the profile lands — an email address is not a name */
  name: string | null
  email: string | null
  onAccount: () => void
  /** opens their own profile page; absent until the username is known */
  /** opens the one dialog that holds colour, background, click and trail */
  onAppearance: () => void
  onProfile?: () => void
  onSignIn: () => void
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  /** the palette editor is collapsed by default — it's the one control here with real depth */
  /** same reasoning as palOpen: a dozen style tiles inline turned the whole cog menu into a
   * scroll every time flair was on, so picking a style opens its own dialog instead */
  const [styleOpen, setStyleOpen] = useState(false)
  const [callSound, setCallSound] = useState(ringtoneEnabled)
  const wrapRef = useRef<HTMLDivElement>(null)
  const cogRef = useRef<HTMLButtonElement>(null)

  // close on outside click / Escape, and hand focus back to the cog so keyboard users
  // aren't dropped at the top of the document
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      cogRef.current?.focus()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Same as above, its own listener for the same reason: the style dialog outlives the dropdown
  // that opened it.
  useEffect(() => {
    if (!styleOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStyleOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [styleOpen])

  const pct = Math.round(uiScale * 100)
  // prefer the name; the email is only a stand-in until the profile arrives
  const initial = (name?.trim()[0] ?? email?.[0] ?? '★').toUpperCase()

  return (
    <div className="nav-cog-wrap" ref={wrapRef}>
      <button
        ref={cogRef}
        className={'btn nav-cog' + (open ? ' is-open' : '')}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={authed ? 'You and your settings' : 'Settings'}
        title={authed ? 'You and your settings' : 'Settings'}
        onClick={() => setOpen((o) => !o)}
      >
        {authed ? <span className="nav-cog-avatar">{initial}</span> : '⚙'}
      </button>

      {open && (
        <div className="nav-menu" role="menu">
          {authed ? (
            <div className="nav-menu-id">
              <span className="nav-cog-avatar lg">{initial}</span>
              <span className="nav-menu-id-text">
                <strong>{name ?? email ?? 'Signed in'}</strong>
                <span className="muted">
                  {name && email ? email : isAdmin ? 'Admin' : 'Member'}
                </span>
              </span>
            </div>
          ) : (
            <button
              className="nav-menu-row is-cta"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSignIn()
              }}
            >
              <span>🔑 Sign in</span>
              <span className="muted">or claim your name</span>
            </button>
          )}

          {authed && onProfile && (
            <button
              className="nav-menu-row"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onProfile()
              }}
            >
              <span>🪪 My profile</span>
              <span className="muted">›</span>
            </button>
          )}
          {authed && (
            <button
              className="nav-menu-row"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onAccount()
              }}
            >
              <span>👤 Account</span>
              <span className="muted">›</span>
            </button>
          )}

          <div className="nav-menu-sep" />
          <div className="nav-menu-label">Make it yours</div>

          <div className="nav-menu-row is-static">
            <span>Text size</span>
            <span className="nav-menu-steps">
              <button
                className="btn"
                onClick={() => onScale(-0.1)}
                disabled={uiScale <= 0.85}
                aria-label="Smaller text"
              >
                −
              </button>
              <button className="btn nav-menu-pct" onClick={() => onScale(0)} title="Reset to 100%">
                {pct}%
              </button>
              <button
                className="btn"
                onClick={() => onScale(0.1)}
                disabled={uiScale >= 1.3}
                aria-label="Bigger text"
              >
                +
              </button>
            </span>
          </div>

          <div className="nav-menu-row is-static">
            <span>Theme</span>
            <span className="nav-menu-steps">
              {(['light', 'dark', 'alt'] as Theme[]).map((t) => (
                <button
                  key={t}
                  className={'btn' + (theme === t && !customPalette ? ' is-on' : '')}
                  aria-pressed={theme === t && !customPalette}
                  /* The glyph is the whole label, and "☀" is not a word — a screen reader
                     reads it as "sun" at best and nothing at all at worst, so the three
                     buttons were indistinguishable. The name says which theme; aria-pressed
                     already says which one you are on. */
                  aria-label={
                    t === 'light' ? 'Light theme' : t === 'dark' ? 'Dark theme' : 'Alt theme'
                  }
                  title={t === 'light' ? 'Light theme' : t === 'dark' ? 'Dark theme' : 'Alt theme'}
                  onClick={() => onTheme(t)}
                >
                  {t === 'light' ? '☀' : t === 'dark' ? '☾' : '✦'}
                </button>
              ))}
              {/* ⚠️ THE WAY IN TO EVERYTHING, not a fourth theme.
                  It sits beside the three built-in themes because that is where you already go
                  to change how the site looks — and what it opens is now the whole Appearance
                  dialog (colours, background, click, trail) rather than only the colour picker.
                  A separate menu row for the same subject was one row too many: the umbrella
                  belongs on the button people already reach for. */}
              <button
                className={'btn' + (customPalette ? ' is-on' : '')}
                aria-pressed={customPalette}
                aria-label="Appearance: colours, background, click effect and mouse trail"
                onClick={() => {
                  // close the dropdown as the dialog opens, so it isn't sitting behind it
                  setOpen(false)
                  onAppearance()
                }}
                title="Appearance — colours, background, click and trail"
              >
                🎨
              </button>
            </span>
          </div>

          {/**
           * ⚠️ Not buried, and phrased as a plain statement of what it does.
           *
           * The site has honoured prefers-reduced-motion for a long time, and that was never the
           * problem: it is an OS setting, and the people who most need it are the least likely to
           * know it exists or where to find it. This is the same protection reachable by someone
           * who just knows the page makes them feel unwell.
           *
           * Locked on when the system already asks for it — the switch can add reduction and
           * must never be able to remove it — and it says why rather than looking broken.
           */}
          <button
            className="nav-menu-row"
            role="menuitemcheckbox"
            aria-checked={motionOff}
            disabled={motionBySystem}
            onClick={onToggleMotion}
            title={
              motionBySystem
                ? 'Your device is set to reduce motion, so this stays on'
                : 'Stop animations: no drifting glow, no click effects, no movement as things appear'
            }
          >
            <span>🧘 Reduce motion</span>
            <span className={'nav-menu-switch' + (motionOff ? ' is-on' : '')} aria-hidden />
          </button>

          {/* Local to this menu rather than lifted into App: nothing else needs to know, and the
              sound module reads the same key it writes. Clicking it also PLAYS the sound — a
              switch for something you can't hear is a switch you can't judge, and the click
              itself is the gesture that unblocks audio in the first place. */}
          <button
            className="nav-menu-row"
            role="menuitemcheckbox"
            aria-checked={callSound}
            onClick={() => {
              const next = !callSound
              setCallSound(next)
              setRingtoneEnabled(next)
              if (next) playCallSound('ring')
            }}
            title="Play a sound when someone starts a call you can join"
          >
            <span>🔔 Call sound</span>
            <span className={'nav-menu-switch' + (callSound ? ' is-on' : '')} aria-hidden />
          </button>

          {desktop && (
            <button
              className="nav-menu-row"
              role="menuitemcheckbox"
              aria-checked={canvasOpen}
              disabled={!canvasCapable}
              onClick={() => onToggleCanvas()}
              title={
                canvasCapable
                  ? 'Float this page as draggable windows'
                  : (canvasReason ?? 'Canvas isn’t available on this page')
              }
            >
              <span>⛶ Canvas</span>
              <span className={'nav-menu-switch' + (canvasOpen ? ' is-on' : '')} aria-hidden />
            </button>
          )}

          {authed && (
            <>
              <div className="nav-menu-sep" />
              <button
                className="nav-menu-row"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onSignOut()
                }}
              >
                <span className="muted">Sign out</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
