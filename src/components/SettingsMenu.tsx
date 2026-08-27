import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PalettePicker } from '../theme/PalettePicker'
import { FX_STYLE_OPTIONS } from '../ui/fxStyles'
import { previewClickFx, type FxStyle } from '../ui/clickFx'
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
  ambientOn,
  onToggleAmbient,
  motionOff,
  motionBySystem,
  onToggleMotion,
  sparksOn,
  onToggleSparks,
  sparksStyle,
  onSparksStyle,
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
  /** the effective answer: the site switch, or the OS asking */
  motionOff: boolean
  /** true when the OS is the reason, in which case the switch is locked on */
  motionBySystem: boolean
  onToggleMotion: () => void
  sparksOn: boolean
  onToggleSparks: () => void
  sparksStyle: FxStyle
  onSparksStyle: (style: FxStyle) => void
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
  /** same reasoning as palOpen: a dozen style tiles inline turned the whole cog menu into a
   * scroll every time flair was on, so picking a style opens its own dialog instead */
  const [styleOpen, setStyleOpen] = useState(false)
  const [callSound, setCallSound] = useState(ringtoneEnabled)
  const currentFx = FX_STYLE_OPTIONS.find(([id]) => id === sparksStyle)
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

  // Escape closes the palette dialog. Its own listener because the menu's one only knows about
  // the dropdown, and the dialog outlives it now.
  useEffect(() => {
    if (!palOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPalOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [palOpen])

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
              {/* A fourth option beside the three, not buried on another page — it belongs
                  where you already go to change how the site looks. */}
              <button
                className={'btn' + (customPalette ? ' is-on' : '')}
                aria-pressed={customPalette}
                aria-expanded={palOpen}
                aria-label="Make your own palette"
                onClick={() => {
                  // close the dropdown as the dialog opens, so it isn't sitting behind it
                  setPalOpen(true)
                  setOpen(false)
                }}
                title="Make your own palette"
              >
                🎨
              </button>
            </span>
          </div>

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

          {/* ONE row, not a toggle plus a conditional style row. Off is now a look you pick
              ("None") rather than a separate switch, so there's nowhere to strand yourself:
              turning flair off used to hide the very row that leads back to the picker. */}
          <button
            className="nav-menu-row"
            role="menuitem"
            onClick={() => {
              setStyleOpen(true)
              setOpen(false)
            }}
            title="A small burst of light wherever you click"
          >
            <span>
              ⁕ Click flair
              <span className="muted"> · {sparksOn ? currentFx?.[2] : 'None'}</span>
            </span>
            <span className="muted">›</span>
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

      {/* A dialog rather than another row inside the cog. The editor has three colour pickers,
          three hex fields, a contrast readout and a preview — at the popover's ~230px that was
          a column of slivers, and on a phone the popover is most of the screen already. */}
      {/* Portalled to <body>, and it has to be. `.nav` sets `will-change: transform`, which
          makes it a containing block for `position: fixed` — so a fixed scrim rendered in here
          is positioned against the NAV's box, not the viewport. Measured before the portal: the
          sheet didn't fit on screen and its colour swatch wasn't even hit-testable. This is the
          same containing-block trap that has bitten the notification panel. */}
      {palOpen &&
        createPortal(
          <div
            className="pal-scrim"
            role="dialog"
            aria-modal="true"
            aria-label="Make your own palette"
            onPointerDown={(e) => {
              // backdrop only — a pointerdown that started inside shouldn't close it
              if (e.target === e.currentTarget) setPalOpen(false)
            }}
          >
            <div className="pal-sheet">
              <div className="pal-sheet-head">
                <strong>Your colours</strong>
                <button className="btn" onClick={() => setPalOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>
              <PalettePicker active={customPalette} onActiveChange={onCustomPalette} />
            </div>
          </div>,
          document.body,
        )}

      {/* Same reasoning and the same containing-block trap as the palette dialog above -- a
          dozen tiles is real depth, not a menu row, and this has to portal to <body> for the
          same reason that one does. Each tile plays its own effect at its own centre on click,
          so choosing a style IS trying it, no separate preview area needed. */}
      {styleOpen &&
        createPortal(
          <div
            className="pal-scrim"
            role="dialog"
            aria-modal="true"
            aria-label="Choose a click flair style"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setStyleOpen(false)
            }}
          >
            <div className="pal-sheet fx-sheet">
              <div className="pal-sheet-head">
                <strong>Click flair style</strong>
                <button className="btn" onClick={() => setStyleOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>
              <div className="fx-style-row">
                {/* "None" belongs in the list of looks, not only on the toggle two menus back:
                    when you're standing in the picker deciding you'd rather have nothing, the
                    answer should be here. It drives the same switch the toggle does. */}
                <button
                  className={'fx-style-btn' + (!sparksOn ? ' is-on' : '')}
                  aria-pressed={!sparksOn}
                  title="No flair"
                  onClick={() => {
                    if (sparksOn) onToggleSparks()
                  }}
                >
                  <span aria-hidden>∅</span>
                  <span className="fx-style-label">None</span>
                </button>
                {FX_STYLE_OPTIONS.map(([id, icon, label]) => (
                  <button
                    key={id}
                    className={'fx-style-btn' + (sparksOn && sparksStyle === id ? ' is-on' : '')}
                    aria-pressed={sparksOn && sparksStyle === id}
                    title={label}
                    onClick={(e) => {
                      onSparksStyle(id)
                      // picking a look from None is also how you turn flair back on
                      if (!sparksOn) onToggleSparks()
                      const r = e.currentTarget.getBoundingClientRect()
                      previewClickFx(id, r.left + r.width / 2, r.top + r.height / 2)
                    }}
                  >
                    <span aria-hidden>{icon}</span>
                    <span className="fx-style-label">{label}</span>
                  </button>
                ))}
              </div>
              {/* Somewhere to actually try it. The effect already fires anywhere you click, but
                  the tiles are small and packed, so the burst you're judging lands half behind
                  the next button. This is just open room with nothing to hit — deliberately
                  WITHOUT a handler of its own, since the global one already covers it and two
                  would fire two bursts from one click. */}
              <div className="fx-testpad">
                <span className="muted">
                  {sparksOn ? 'Click around in here to try it' : 'Flair is off'}
                </span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
