import { PalettePicker } from '../theme/PalettePicker'
import { previewClickFx, type FxStyle } from '../ui/clickFx'
import { FX_STYLE_OPTIONS } from '../ui/fxStyles'
import { BACKDROPS, type BackdropId } from '../profile/backdrops'
import { motionReduced } from '../ui/motion'
import type { Theme } from '../components/SettingsMenu'

/**
 * Your look, edited on the page it changes.
 *
 * ⚠️ THESE ARE NOT A SECOND SET OF SETTINGS. Your profile wears the theme, palette and flair you
 * already use on the site — App mirrors them up with set_my_profile_look whenever they change —
 * so this edits the same values the cog does, through the same handlers. A separate "profile
 * theme" would be two sources of truth to keep in step forever, which is exactly the shape the
 * mirroring was chosen to avoid.
 *
 * What it adds is somewhere to make those choices where you can SEE them. The cog is a popover
 * anchored to the nav: it covers the page, it is ~230px wide, and the thing it changes — your
 * profile, as other people meet it — is not usually on screen at all. Here every control sits on
 * the page it repaints, and because your own profile always renders in your own look, the answer
 * to "what will this look like" is the page behind the panel.
 */
export type LookControls = {
  theme: Theme
  onTheme: (t: Theme) => void
  sparksOn: boolean
  onToggleSparks: () => void
  sparksStyle: FxStyle
  onSparksStyle: (s: FxStyle) => void
  customPalette: boolean
  onCustomPalette: (on: boolean) => void
  backdrop: BackdropId
  onBackdrop: (b: BackdropId) => void
}

const THEMES: Array<[Theme, string, string]> = [
  ['light', '☀', 'Light'],
  ['dark', '🌙', 'Dark'],
  ['alt', '◐', 'Alt'],
]

export function ProfileLookEditor({ look }: { look: LookControls }) {
  return (
    <div className="card profile-look-editor">
      <h3 className="section-title" style={{ marginTop: 0 }}>
        🎨 Your look
      </h3>
      <p className="muted" style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>
        The colours and click effect you use on the site — visitors see them here too. Changes apply
        to the page behind this panel as you make them.
      </p>

      <div className="profile-look-row">
        <span className="muted profile-look-label">Theme</span>
        <div className="profile-look-choices">
          {THEMES.map(([t, icon, label]) => (
            <button
              key={t}
              className="btn"
              aria-pressed={!look.customPalette && look.theme === t}
              data-active={(!look.customPalette && look.theme === t) || undefined}
              onClick={() => {
                // picking a built-in theme means you no longer want the custom one on top of it
                if (look.customPalette) look.onCustomPalette(false)
                look.onTheme(t)
              }}
            >
              <span aria-hidden>{icon}</span> {label}
            </button>
          ))}
          <button
            className="btn"
            aria-pressed={look.customPalette}
            data-active={look.customPalette || undefined}
            onClick={() => look.onCustomPalette(!look.customPalette)}
            title="Your own three colours, on top of any theme"
          >
            <span aria-hidden>🎨</span> Custom
          </button>
        </div>
      </div>

      {/* Only when it is on: the picker is tall, and a colour editor for colours that are not in
          use is a row of controls that appear to do nothing. */}
      {look.customPalette && (
        <div className="profile-look-palette">
          <PalettePicker active={look.customPalette} onActiveChange={look.onCustomPalette} />
        </div>
      )}

      <div className="profile-look-row">
        <span className="muted profile-look-label">Backdrop</span>
        <div className="profile-look-choices">
          {BACKDROPS.map(([id, icon, label]) => (
            <button
              key={id}
              className="btn"
              aria-pressed={look.backdrop === id}
              data-active={look.backdrop === id || undefined}
              onClick={() => look.onBackdrop(id)}
            >
              <span aria-hidden>{icon}</span> {label}
            </button>
          ))}
        </div>
      </div>
      {/* ⚠️ Said plainly rather than left as a mystery. With reduce motion on, the backdrop is
          not drawn at all — the canvas is never created — so a picker that looked live while
          nothing happened would read as broken rather than as the setting working. */}
      {motionReduced() && look.backdrop !== 'none' && (
        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
          Reduce motion is on, so backdrops are not drawn. Your choice is saved and visitors without
          it will see it.
        </p>
      )}

      <div className="profile-look-row">
        <span className="muted profile-look-label">Click flair</span>
        <div className="profile-look-choices">
          <button
            className="btn"
            aria-pressed={look.sparksOn}
            data-active={look.sparksOn || undefined}
            onClick={look.onToggleSparks}
          >
            {look.sparksOn ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {look.sparksOn && (
        <div className="profile-look-choices profile-look-flairs">
          {FX_STYLE_OPTIONS.map(([s, icon, label]) => (
            <button
              key={s}
              className="btn"
              aria-pressed={look.sparksStyle === s}
              data-active={look.sparksStyle === s || undefined}
              title={label}
              /**
               * Plays the effect where you clicked, on the button you clicked.
               *
               * Picking a flair from a list of names is choosing blind — the whole point of a
               * flair is what it DOES. previewClickFx already existed for the cog; here there is
               * room to show every option and let you try them one after another.
               */
              onClick={(e) => {
                look.onSparksStyle(s)
                previewClickFx(s, e.clientX, e.clientY)
              }}
            >
              <span aria-hidden>{icon}</span> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
