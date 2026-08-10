import { useEffect, useRef, useState } from 'react'
import { PalettePicker } from '../theme/PalettePicker'

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
  ambientOn,
  onToggleAmbient,
  customPalette,
  onCustomPalette,
  authed,
  isAdmin,
  name,
  email,
  onAccount,
  onProfile,
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
  ambientOn: boolean
  onToggleAmbient: () => void
  /** true when the user's own palette is overriding the built-in theme */
  customPalette: boolean
  onCustomPalette: (on: boolean) => void
  authed: boolean
  isAdmin: boolean
  /** their actual name, once the profile lands — an email address is not a name */
  name: string | null
  email: string | null
  onAccount: () => void
  /** opens their own profile page; absent until the username is known */
  onProfile?: () => void
  onSignIn: () => void
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  /** the palette editor is collapsed by default — it's the one control here with real depth */
  const [palOpen, setPalOpen] = useState(false)
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
                  onClick={() => onTheme(t)}
                >
                  {t === 'light' ? '☀' : t === 'dark' ? '☾' : '✦'}
                </button>
              ))}
              {/* A fourth option beside the three, not buried on another page — it belongs
                  where you already go to change how the site looks. */}
              <button
                className={'btn' + (customPalette ? ' is-on' : '')}
                aria-pressed={customPalette}
                aria-expanded={palOpen}
                onClick={() => setPalOpen((o) => !o)}
                title="Make your own palette"
              >
                🎨
              </button>
            </span>
          </div>
          {palOpen && (
            <div className="nav-menu-row is-static nav-menu-pal">
              <PalettePicker active={customPalette} onActiveChange={onCustomPalette} />
            </div>
          )}

          <button
            className="nav-menu-row"
            role="menuitemcheckbox"
            aria-checked={ambientOn}
            onClick={onToggleAmbient}
            title="A soft glow behind the page that drifts and follows your cursor"
          >
            <span>✨ Ambient glow</span>
            <span className={'nav-menu-switch' + (ambientOn ? ' is-on' : '')} aria-hidden />
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
