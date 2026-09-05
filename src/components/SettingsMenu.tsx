import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playCallSound, ringtoneEnabled, setRingtoneEnabled } from '../voice/ringtone'

import {
  effectiveStatus,
  myStatus,
  onStatusChange,
  setMyStatus,
  STATUS_OPTIONS,
  type MyStatus,
} from '../hooks/presenceStatus'

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
  open,
  onOpenChange,
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
  onReportBug,
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
  onReportBug: () => void
  /** the panel's open state, held by App so the phone's bottom bar can raise it too */
  open: boolean
  onOpenChange: (open: boolean) => void
  onProfile?: () => void
  onSignIn: () => void
  onSignOut: () => void
}) {
  /**
   * ⚠️ CONTROLLED FROM OUTSIDE, because on a phone this sheet is opened from the BOTTOM BAR
   * rather than from the cog above it. The sheet slides up under your thumb; the button that
   * summons it had no business being at the far end of the screen. Two triggers for one panel
   * only works if they share one piece of state — the alternative is a second copy that can
   * disagree with the first, which is the bug this codebase keeps finding.
   */
  const setOpen = useCallback(
    (v: boolean | ((p: boolean) => boolean)) => onOpenChange(typeof v === 'function' ? v(open) : v),
    /* ⚠️ memoised so the listeners below can name it honestly. It is not a useState setter any
       more, so it is a NEW function every render unless this is here — and an effect that
       depends on it would rebind on every keystroke while claiming to depend only on `open`. */
    [open, onOpenChange],
  )
  // mirrored into state so the row re-renders on a change; presenceStatus is the source of truth
  const [status, setStatus] = useState<MyStatus>(myStatus)
  /**
   * What other people actually see, which is not always what you picked: choosing Online and then
   * going quiet for five minutes shows you as away. Without this line the setting gives no
   * feedback at all — you press a button and nothing anywhere confirms it did something, which is
   * most of the reason presence felt like it was not working.
   */
  const [seen, setSeen] = useState(effectiveStatus)
  useEffect(() => onStatusChange(() => setSeen(effectiveStatus())), [])
  /** the palette editor is collapsed by default — it's the one control here with real depth */
  /** same reasoning as palOpen: a dozen style tiles inline turned the whole cog menu into a
   * scroll every time flair was on, so picking a style opens its own dialog instead */
  const [styleOpen, setStyleOpen] = useState(false)
  const [callSound, setCallSound] = useState(ringtoneEnabled)
  const wrapRef = useRef<HTMLDivElement>(null)
  const cogRef = useRef<HTMLButtonElement>(null)
  /**
   * ⚠️ THE PANEL NEEDS ITS OWN REF BECAUSE IT IS NOT ALWAYS INSIDE THE WRAPPER.
   *
   * The outside-click handler below asks "did this land inside wrapRef?" — which was true of
   * the dropdown and is FALSE of the portalled sheet, since that lives on document.body. Without
   * this the sheet would close on the first tap you made inside it, which reads as the menu
   * refusing to work at all.
   */
  const sheetRef = useRef<HTMLDivElement>(null)

  /**
   * Whether to draw the sheet or the dropdown.
   *
   * ⚠️ matchMedia rather than a width read, and it LISTENS: a phone that turns landscape crosses
   * this line, and a menu left in the wrong frame is stuck half off the screen. Same breakpoint
   * as the CSS, stated in one place each because there is no way to share it.
   */
  const [phone, setPhone] = useState(
    () => window.matchMedia?.('(max-width: 780px)').matches ?? false,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 780px)')
    if (!mq) return
    const on = () => setPhone(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // close on outside click / Escape, and hand focus back to the cog so keyboard users
  // aren't dropped at the top of the document
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      // ⚠️ both: the dropdown is inside the wrapper, the portalled sheet is not — see sheetRef
      if (wrapRef.current?.contains(t) || sheetRef.current?.contains(t)) return
      setOpen(false)
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
  }, [open, setOpen])

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

  /**
   * ⚠️ THE ROWS, WRITTEN ONCE.
   *
   * When this grew a second frame — a dropdown on a desktop, a sheet on a phone — the rows got
   * copied into both. That is the same duplication that kept Paint off the phone for its whole
   * life, committed a few hours after writing a file whose whole purpose was to prevent it. A
   * frame is a frame; the panel inside it is one thing.
   */
  const panel = (
    <>
      {authed ? (
        <div className="nav-menu-id">
          <span className="nav-cog-avatar lg">{initial}</span>
          <span className="nav-menu-id-text">
            <strong>{name ?? email ?? 'Signed in'}</strong>
            <span className="muted">{name && email ? email : isAdmin ? 'Admin' : 'Member'}</span>
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

      {/* ⚠️ on every page, because a bug you have to remember until you are somewhere else
              gets reported as "something went weird once", if it gets reported at all */}
      <button
        className="nav-menu-row"
        role="menuitem"
        onClick={() => {
          setOpen(false)
          onReportBug()
        }}
      >
        <span>🐞 Report a bug</span>
        <span className="muted">›</span>
      </button>
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

      {/**
       * ⚠️ Only for people who HAVE an audience. Presence is broadcast to accepted friends
       * and circuit-mates; a signed-out visitor announces nothing to anyone, so a control
       * implying otherwise would be theatre.
       */}
      {authed && (
        <div className="nav-menu-row is-static">
          <span title="Who sees you as online — accepted friends and circuit-mates">Status</span>
          <span className="nav-menu-steps">
            {STATUS_OPTIONS.map(([id, icon, label]) => (
              <button
                key={id}
                className={'btn' + (status === id ? ' is-on' : '')}
                aria-pressed={status === id}
                aria-label={label}
                title={
                  id === 'invisible'
                    ? 'Appear offline. Nothing is broadcast at all — not hidden, not sent.'
                    : id === 'away'
                      ? 'Shown as away, even while you are here'
                      : 'Shown as online (and as away after a few idle minutes)'
                }
                onClick={() => {
                  setStatus(id)
                  setMyStatus(id)
                }}
              >
                {icon}
              </button>
            ))}
          </span>
        </div>
      )}
      {authed && status === 'invisible' && (
        <p className="nav-menu-note muted">
          Invisible on this device — nothing is broadcast from this browser at all. Other devices
          you are signed in on announce themselves separately.
        </p>
      )}
      {authed && status !== 'invisible' && (
        <p className="nav-menu-note muted">
          {seen === 'away'
            ? status === 'away'
              ? 'Friends and circuit-mates see you as away.'
              : 'Friends and circuit-mates see you as away — you have been quiet for a few minutes.'
            : 'Friends and circuit-mates see you as online.'}
        </p>
      )}

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
              aria-label={t === 'light' ? 'Light theme' : t === 'dark' ? 'Dark theme' : 'Alt theme'}
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
            title="Appearance — colours, background, click, trail and pointer"
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
    </>
  )

  return (
    <div className="nav-cog-wrap" ref={wrapRef}>
      <button
        ref={cogRef}
        className={'btn nav-cog' + (open ? ' is-open' : '') + (authed ? ' has-bar-trigger' : '')}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={authed ? 'You and your settings' : 'Settings'}
        title={authed ? 'You and your settings' : 'Settings'}
        onClick={() => setOpen((o) => !o)}
      >
        {authed ? <span className="nav-cog-avatar">{initial}</span> : '⚙'}
        {/**
         * ⚠️ A CARET, BECAUSE A LETTER IN A CIRCLE DOES NOT SAY "MENU".
         *
         * Signed out this control is a ⚙, which everybody reads as settings. Signed in it
         * becomes your initial — and an avatar looks like a picture of you rather than a button
         * that opens anything, so the whole settings menu was sitting behind an affordance that
         * did not announce itself. Every app that puts an avatar in a corner pairs it with this
         * mark for exactly that reason.
         *
         * Screen readers already knew — aria-haspopup and aria-expanded were there — so this is
         * the visual half of a promise the markup was already making.
         */}
        <span className="nav-cog-caret" aria-hidden>
          ▾
        </span>
      </button>

      {/**
       * ⚠️ A SHEET ON A PHONE, A DROPDOWN ON A DESKTOP — same contents, two frames.
       *
       * As a dropdown this was 240px of a 375px screen pinned to the top-right: the narrowest
       * part of the widest thing available, at the end furthest from a thumb. A sheet along the
       * bottom is where a phone expects its menus and where your hand already is.
       *
       * ⚠️ PORTALLED TO THE BODY, and it has to be. `.nav` sets `will-change: transform` to keep
       * itself on its own compositor layer, which makes it a containing block for fixed
       * children — so `position: fixed; bottom: 0` inside it would measure from the NAV's box,
       * not the viewport, and the sheet would hang under the header instead of sitting on the
       * floor. The note on that CSS rule says as much, and .notif-panel already works around it.
       * Leaving the nav alone and moving the sheet out is the cheaper half of that trade.
       */}
      {open &&
        (phone ? (
          createPortal(
            <>
              {/* ⚠️ a real element rather than a pointerdown handler: a sheet that covers the
                  page needs something to dim and something to tap, and the same node does both */}
              <div className="nav-sheet-back" onClick={() => setOpen(false)} aria-hidden />
              <div className="nav-sheet" role="menu" ref={sheetRef}>
                <span className="nav-sheet-grip" aria-hidden />
                {panel}
                {/**
                 * ⚠️ CLOSE SITS AT THE BOTTOM, AND THAT IS THE SAFETY FIX.
                 *
                 * Measured: the sheet opens from a button at y=759 and Sign out landed at y=758.
                 * You tapped "You" and the destructive action arrived exactly under the finger
                 * that tapped it. Whatever is last in a bottom sheet is what your thumb is
                 * already touching, so the last thing has to be the harmless one — and closing
                 * is also the likeliest thing you want if you opened this by accident.
                 *
                 * It doubles as the answer to "how do I get out of this without choosing
                 * something", which the backdrop technically offered and nothing announced.
                 */}
                <button className="nav-sheet-close" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </>,
            document.body,
          )
        ) : (
          <div className="nav-menu" role="menu" ref={sheetRef}>
            {panel}
          </div>
        ))}
    </div>
  )
}
