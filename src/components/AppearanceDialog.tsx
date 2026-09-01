import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PalettePicker } from '../theme/PalettePicker'
import { FX_STYLE_OPTIONS } from '../ui/fxStyles'
import { CURSOR_OPTIONS, type CursorSkin } from '../ui/cursorSkin'
import { previewClickFx, type FxStyle } from '../ui/clickFx'
import { BACKDROPS, type BackdropId } from '../profile/backdrops'
import { previewTrail, TRAIL_OPTIONS, type TrailStyle } from '../ui/mouseTrail'
import {
  AMOUNT_LEVELS,
  amountLevel,
  effectScale,
  setAmountLevel,
  setEffectScale,
  type AmountLevel,
  type EffectCategory,
  type ScaleKind,
} from '../ui/effectAmount'
import type { Theme } from './SettingsMenu'

/**
 * One dialog for everything that decides how the site LOOKS.
 *
 * ⚠️ It replaces four separate rows in the cog, each opening its own sheet. That arrangement had
 * two costs: the cog grew a row every time an effect was added, and — worse — the four decisions
 * were presented as unrelated when they are obviously one subject. Somebody choosing a look wants
 * to see the colours, the background, the click and the trail together, because they have to live
 * together.
 *
 * Tabs rather than one long scroll, because the four sections are genuinely separate choices and
 * a wall of sixty tiles is the cluttered thing this is meant to avoid. Four tabs is small enough
 * to read at a glance and never grows: a new effect joins an existing tab rather than adding a
 * row somewhere.
 *
 * Every tile applies immediately. There is no Save, and no preview pane — the site behind the
 * dialog is the preview, which is the only one that cannot drift from the real thing.
 */

export type AppearanceControls = {
  theme: Theme
  onTheme: (t: Theme) => void
  customPalette: boolean
  onCustomPalette: (on: boolean) => void
  background: BackdropId
  onBackground: (b: BackdropId) => void
  sparksOn: boolean
  onToggleSparks: () => void
  sparksStyle: FxStyle
  onSparksStyle: (s: FxStyle) => void
  trailStyle: TrailStyle
  onTrailStyle: (t: TrailStyle) => void
  cursor: CursorSkin
  setCursor: (c: CursorSkin) => void
}

type Tab = 'colour' | 'background' | 'click' | 'trail' | 'cursor'

const TABS: Array<[Tab, string, string]> = [
  ['colour', '🎨', 'Colour'],
  ['background', '🌌', 'Background'],
  ['click', '✨', 'Click'],
  ['trail', '🪄', 'Trail'],
  ['cursor', '↖', 'Pointer'],
]

const THEMES: Array<[Theme, string, string]> = [
  ['light', '☀', 'Light'],
  ['dark', '🌙', 'Dark'],
  ['alt', '◐', 'Alt'],
]

/**
 * How much of an effect, per category.
 *
 * Sits under the tiles rather than beside them: you pick the thing first and then decide how much
 * of it, which is the order people actually make the decision in.
 */
function AmountRow({ cat, label }: { cat: EffectCategory; label: string }) {
  const [level, setLevel] = useState<AmountLevel>(() => amountLevel(cat))
  return (
    <div className="appearance-amount">
      <span className="muted">{label}</span>
      <div className="appearance-amount-choices">
        {AMOUNT_LEVELS.map(([id, name]) => (
          <button
            key={id}
            className="btn"
            aria-pressed={level === id}
            data-active={level === id || undefined}
            onClick={() => {
              setLevel(id)
              setAmountLevel(cat, id)
            }}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Size and speed, as actual numbers.
 *
 * ⚠️ A slider here and named steps for "how much", deliberately. How much of an effect is a
 * decision you make once, and three names cover it; size and speed are the ones you want to nudge
 * until something feels right under your own hand, and no set of three words covers "slightly
 * bigger". Both are multipliers around 1, so leaving them alone is exactly the old behaviour.
 *
 * ⚠️ Per tab, NOT shared across all three. They were shared, on the reasoning that wanting things
 * bigger means wanting everything bigger — but the three are different sizes of thing in
 * different places, so one slider made every setting a compromise. A background wants to be large
 * and slow or it stops being a background; a click wants to be quick or it outstays the click.
 */
function ScaleRow({ cat, kind, label }: { cat: EffectCategory; kind: ScaleKind; label: string }) {
  const [v, setV] = useState(() => effectScale(cat, kind))
  return (
    <label className="appearance-slider">
      <span className="muted">{label}</span>
      <input
        type="range"
        min={0.5}
        max={2.5}
        step={0.1}
        value={v}
        onChange={(e) => {
          const next = Number(e.target.value)
          setV(next)
          setEffectScale(cat, kind, next)
        }}
      />
      <span className="appearance-slider-val">{v.toFixed(1)}×</span>
    </label>
  )
}

/**
 * The flair ramp, shown as the colours it actually is.
 *
 * ⚠️ Read off the live document rather than derived here. These five drive the click effects,
 * the trails and the animated backgrounds, and there is exactly one place that decides them
 * (customTheme.ts) — recomputing them for the preview would be a second implementation to keep
 * in step, and the first time it drifted the preview would be confidently wrong.
 *
 * Worth showing at all because the ramp is derived, not chosen: without this you change one
 * accent and four other colours move with no way to see what they became.
 */
function RampStrip() {
  const [stops, setStops] = useState<string[]>([])
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement)
      setStops([0, 1, 2, 3, 4].map((i) => cs.getPropertyValue(`--fx-${i}`).trim()).filter(Boolean))
    }
    read()
    // the palette editor writes custom properties as you drag, and fires this when it does
    window.addEventListener('yaya:palette', read)
    return () => window.removeEventListener('yaya:palette', read)
  }, [])
  if (stops.length < 2) return null
  return (
    <div className="appearance-ramp">
      <span className="muted">Effect colours</span>
      <span className="appearance-ramp-strip" aria-hidden>
        {stops.map((c, i) => (
          <i key={i} style={{ background: c }} />
        ))}
      </span>
      <span className="muted appearance-ramp-note">from your accent</span>
    </div>
  )
}

export function AppearanceDialog({
  controls,
  onClose,
}: {
  controls: AppearanceControls
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('colour')
  const c = controls

  return createPortal(
    <div
      className="pal-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Appearance"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="pal-sheet appearance-sheet">
        <div className="pal-sheet-head">
          <strong>Appearance</strong>
          <button className="btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="appearance-tabs" role="tablist">
          {TABS.map(([id, icon, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={'appearance-tab' + (tab === id ? ' is-on' : '')}
              onClick={() => setTab(id)}
            >
              <span aria-hidden>{icon}</span> {label}
            </button>
          ))}
        </div>

        {tab === 'colour' && (
          <div className="appearance-body">
            <div className="fx-style-row">
              {THEMES.map(([t, icon, label]) => (
                <button
                  key={t}
                  className={'fx-style-btn' + (!c.customPalette && c.theme === t ? ' is-on' : '')}
                  aria-pressed={!c.customPalette && c.theme === t}
                  onClick={() => {
                    // a built-in theme means you no longer want the custom one layered on it
                    if (c.customPalette) c.onCustomPalette(false)
                    c.onTheme(t)
                  }}
                >
                  <span aria-hidden>{icon}</span>
                  <span className="fx-style-label">{label}</span>
                </button>
              ))}
              <button
                className={'fx-style-btn' + (c.customPalette ? ' is-on' : '')}
                aria-pressed={c.customPalette}
                onClick={() => c.onCustomPalette(!c.customPalette)}
                title="Your own three colours"
              >
                <span aria-hidden>🎨</span>
                <span className="fx-style-label">Custom</span>
              </button>
            </div>
            {/* only when it is on: a colour editor for colours not in use is a row of controls
                that appear to do nothing */}
            <RampStrip />
            {c.customPalette && (
              <div className="appearance-palette">
                <PalettePicker active={c.customPalette} onActiveChange={c.onCustomPalette} />
              </div>
            )}
          </div>
        )}

        {tab === 'background' && (
          <div className="appearance-body">
            <div className="fx-style-row">
              {BACKDROPS.map(([id, icon, label]) => (
                <button
                  key={id}
                  className={'fx-style-btn' + (c.background === id ? ' is-on' : '')}
                  aria-pressed={c.background === id}
                  onClick={() => c.onBackground(id)}
                >
                  <span aria-hidden>{icon}</span>
                  <span className="fx-style-label">{label}</span>
                </button>
              ))}
            </div>
            <AmountRow cat="background" label="How busy" />
            <ScaleRow cat="background" kind="size" label="Size" />
            <ScaleRow cat="background" kind="speed" label="Speed" />
            <p className="muted appearance-note">
              Behind the whole site, and visitors see it on your profile. Off under Reduce motion.
            </p>
          </div>
        )}

        {tab === 'click' && (
          <div className="appearance-body">
            <div className="fx-style-row">
              <button
                className={'fx-style-btn' + (!c.sparksOn ? ' is-on' : '')}
                aria-pressed={!c.sparksOn}
                onClick={() => {
                  if (c.sparksOn) c.onToggleSparks()
                }}
              >
                <span aria-hidden>∅</span>
                <span className="fx-style-label">None</span>
              </button>
              {FX_STYLE_OPTIONS.map(([id, icon, label]) => (
                <button
                  key={id}
                  className={'fx-style-btn' + (c.sparksOn && c.sparksStyle === id ? ' is-on' : '')}
                  aria-pressed={c.sparksOn && c.sparksStyle === id}
                  onClick={(e) => {
                    c.onSparksStyle(id)
                    // picking a style from None is also how you turn flair back on
                    if (!c.sparksOn) c.onToggleSparks()
                    const r = e.currentTarget.getBoundingClientRect()
                    previewClickFx(id, r.left + r.width / 2, r.top + r.height / 2)
                  }}
                >
                  <span aria-hidden>{icon}</span>
                  <span className="fx-style-label">{label}</span>
                </button>
              ))}
            </div>
            <AmountRow cat="click" label="How much" />
            <ScaleRow cat="click" kind="size" label="Size" />
            <ScaleRow cat="click" kind="speed" label="Speed" />
            <p className="muted appearance-note">Click anywhere to try it.</p>
          </div>
        )}

        {tab === 'cursor' && (
          <div className="appearance-body">
            <div className="fx-style-row">
              {CURSOR_OPTIONS.map(([id, icon, label]) => (
                <button
                  key={id}
                  className={'fx-style-btn' + (c.cursor === id ? ' is-on' : '')}
                  aria-pressed={c.cursor === id}
                  onClick={() => c.setCursor(id)}
                >
                  <span aria-hidden>{icon}</span>
                  <span className="fx-style-label">{label}</span>
                </button>
              ))}
            </div>
            {/* ⚠️ No preview swatch here on purpose: the preview IS your pointer, which is
                already on this dialog and changes the instant you pick one. Drawing a second
                copy of it in a box would be showing you a picture of the thing you are
                holding. */}
            <p className="muted appearance-note">
              It takes your accent colour, so it follows your palette. Text boxes keep their I-beam
              — that one is telling you where you can type, not decorating the page.
            </p>
          </div>
        )}

        {tab === 'trail' && (
          <div className="appearance-body">
            <div className="fx-style-row">
              {TRAIL_OPTIONS.map(([id, icon, label]) => (
                <button
                  key={id}
                  className={'fx-style-btn' + (c.trailStyle === id ? ' is-on' : '')}
                  aria-pressed={c.trailStyle === id}
                  onClick={(e) => {
                    c.onTrailStyle(id)
                    // a trail is what MOVING looks like, so run a short stroke of it
                    const r = e.currentTarget.getBoundingClientRect()
                    previewTrail(id, r.left + r.width / 2, r.top + r.height / 2)
                  }}
                >
                  <span aria-hidden>{icon}</span>
                  <span className="fx-style-label">{label}</span>
                </button>
              ))}
            </div>
            <AmountRow cat="trail" label="How dense" />
            <ScaleRow cat="trail" kind="size" label="Size" />
            <ScaleRow cat="trail" kind="speed" label="Speed" />
            <p className="muted appearance-note">
              Move the pointer to try it. Off under Reduce motion, and not on touch — there is no
              cursor to follow.
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
