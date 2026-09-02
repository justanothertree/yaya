import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { PalettePicker } from '../theme/PalettePicker'
import { FX_STYLE_OPTIONS } from '../ui/fxStyles'
import { CURSOR_OPTIONS, type CursorSkin } from '../ui/cursorSkin'
import { previewClickFx, type FxStyle } from '../ui/clickFx'
import { useTouchOnly } from '../ui/pointerKind'
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
import {
  applyLook,
  captureLook,
  decodeLook,
  encodeLook,
  looksLikeCode,
  myLooks,
  randomLook,
  removeLook,
  saveLook,
  STARTERS,
  subscribeLooks,
  type Look,
} from '../ui/looks'
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

type Tab = 'looks' | 'colour' | 'background' | 'click' | 'trail' | 'cursor'

/** "Click" is not what you do on a phone, and the tab is the only place that word appears. */
const tabsFor = (touch: boolean): Array<[Tab, string, string]> => [
  ['looks', '🎭', 'Looks'],
  ['colour', '🎨', 'Colour'],
  ['background', '🌌', 'Background'],
  ['click', '✨', touch ? 'Tap' : 'Click'],
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

/**
 * The name of an option, from the same tables the tiles are built from.
 *
 * ⚠️ LOOKED UP, never stored on the Look. A Look holds ids because ids are what the rest of
 * the site understands; putting the label in as well would let the two disagree the first time
 * something is renamed, and a saved Look would then describe itself wrongly forever.
 */
const LABELS = {
  background: new Map(BACKDROPS.map(([id, , label]) => [id as string, label])),
  click: new Map(FX_STYLE_OPTIONS.map(([id, , label]) => [id as string, label])),
  trail: new Map(TRAIL_OPTIONS.map(([id, , label]) => [id as string, label])),
}

/**
 * One saved appearance, as a button.
 *
 * ⚠️ the swatch shows the LOOK'S colours, not the page's. A row of tiles all painted in the
 * current theme would say nothing about what pressing one does, which is the only question being
 * asked here. Looks with no palette of their own show their theme instead of pretending to a
 * colour they have not got.
 */
function LookCard({
  look,
  onApply,
  onRemove,
  onCopy,
}: {
  look: Look
  onApply: () => void
  onRemove?: () => void
  onCopy?: () => void
}) {
  const p = look.palette
  const parts = [
    LABELS.background.get(look.background),
    look.click ? LABELS.click.get(look.click) : null,
    LABELS.trail.get(look.trail),
  ].filter((x) => x && x !== 'None')
  return (
    <div className="look-card">
      <button className="look-btn" onClick={onApply}>
        <span
          className="look-chip"
          aria-hidden
          style={p ? { background: p.bg, color: p.text, borderColor: p.accent } : undefined}
        >
          {p ? 'Aa' : look.theme === 'light' ? '☀' : look.theme === 'alt' ? '◐' : '🌙'}
        </span>
        <span className="look-text">
          <span className="look-name">{look.name}</span>
          <span className="look-parts muted">{parts.join(' · ') || 'Plain'}</span>
        </span>
      </button>
      {onCopy && (
        <button
          className="btn btn-ghost look-del"
          onClick={onCopy}
          aria-label={`Copy ${look.name} as a code to share`}
          title="Copy a code to share"
        >
          ⧉
        </button>
      )}
      {onRemove && (
        <button
          className="btn btn-ghost look-del"
          onClick={onRemove}
          aria-label={`Delete ${look.name}`}
          title="Delete"
        >
          ✕
        </button>
      )}
    </div>
  )
}

/**
 * Looks: every other tab at once, under a name.
 *
 * ⚠️ applying goes through applyLook and therefore through the DIALOG'S OWN SETTERS, so the
 * other tabs show the new answer rather than the one they were opened with. The amount and speed
 * rows are the exception by construction, since they hold their own state, but each tab is
 * unmounted while it is not showing and so re-reads storage on the way back in.
 */
function LooksTab({ c, touch }: { c: AppearanceControls; touch: boolean }) {
  const mine = useSyncExternalStore(subscribeLooks, myLooks, myLooks)
  const [name, setName] = useState('')
  const [said, setSaid] = useState('')

  /**
   * ⚠️ ONE FIELD FOR BOTH JOBS, with the button saying which one it is about to do. A second
   * input for codes would sit empty almost always, and the two are never ambiguous in practice: a
   * code announces itself with a prefix and nobody names a look that.
   */
  const shared = looksLikeCode(name) ? decodeLook(name) : null
  const pasted = looksLikeCode(name)

  const say = (msg: string) => {
    setSaid(msg)
    window.setTimeout(() => setSaid(''), 2600)
  }

  const submit = () => {
    if (pasted) {
      if (!shared) return say('That code could not be read.')
      saveLook(shared)
      applyLook(shared, c)
      setName('')
      say(`Added ${shared.name}.`)
      return
    }
    if (!name.trim()) return
    saveLook(captureLook(name, c))
    setName('')
  }

  /**
   * ⚠️ WHEN THE CLIPBOARD IS REFUSED THE CODE GOES INTO THE FIELD instead. Browsers deny
   * clipboard writes for reasons the person cannot see or fix, and an apology would leave them with
   * no way at all to get the thing they asked for — whereas the box is right there and already
   * accepts codes, so it is both the fallback and the explanation.
   */
  const copy = (l: Look) => {
    const code = encodeLook(l)
    const handOver = () => {
      setName(code)
      say('Clipboard blocked — the code is in the box, copy it from there.')
    }
    const done = navigator.clipboard?.writeText(code)
    if (!done) return handOver()
    done.then(() => say('Code copied — paste it to a friend.'), handOver)
  }

  return (
    <div className="appearance-body">
      <p className="muted appearance-note">
        A Look is every tab at once — colours, background, {touch ? 'tap' : 'click'}, trail and
        pointer — under one name. Try one freely: save what you have first and it is one press to
        come back.
      </p>

      <div className="look-save">
        <input
          className="look-input"
          value={name}
          /* ⚠️ NOT capped at a name's length: a code is hundreds of characters, and an input
             that truncated the paste would cut it down to something that can never be read back.
             captureLook trims a name to 40 itself, which is the right place for that rule. */
          maxLength={4000}
          placeholder="Name this look, or paste a code"
          aria-label="Name for the look you are saving, or a shared code to add"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            /* the site reads arrow keys as navigation, and this is a text field */
            e.stopPropagation()
            if (e.key === 'Enter') submit()
          }}
        />
        <button className="btn" disabled={!name.trim()} onClick={submit}>
          {pasted ? (shared ? `Add ${shared.name}` : 'Unreadable code') : 'Save this'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => applyLook(randomLook(), c)}
          title="A random combination"
        >
          Shuffle
        </button>
      </div>
      {said && (
        <p className="muted appearance-note" role="status">
          {said}
        </p>
      )}

      {mine.length > 0 && (
        <>
          <h4 className="look-head">Yours</h4>
          <div className="look-grid">
            {mine.map((l) => (
              <LookCard
                key={l.name}
                look={l}
                onApply={() => applyLook(l, c)}
                onRemove={() => removeLook(l.name)}
                onCopy={() => copy(l)}
              />
            ))}
          </div>
        </>
      )}

      <h4 className="look-head">To start from</h4>
      <div className="look-grid">
        {STARTERS.map((l) => (
          <LookCard key={l.name} look={l} onApply={() => applyLook(l, c)} />
        ))}
      </div>
      <p className="muted appearance-note">
        Kept in this browser rather than on your account, so they stay on this device. Copy one to a
        code and anybody you send it to can add it to theirs.
      </p>
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
  /* Looks first: it is the one tab that shows what the other five add up to, and what every other
     tab has in common is that nobody was ever going to find most of it on their own */
  const [tab, setTab] = useState<Tab>('looks')
  /* a trail follows a pointer and a skin decorates one, so on a touchscreen both are choices
     about something that is not there — say so rather than offering dead buttons */
  const touch = useTouchOnly()
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
          {tabsFor(touch).map(([id, icon, label]) => (
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

        {tab === 'looks' && <LooksTab c={c} touch={touch} />}

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
            {touch && (
              <p className="muted appearance-note">
                Your screen has no pointer to skin — this one needs a mouse or a trackpad. Pick one
                anyway and it will be waiting if you open the site on a computer.
              </p>
            )}
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
            {touch && (
              <p className="muted appearance-note">
                A trail follows a pointer, and a finger already covers the place it would be — so
                this stays off on a touchscreen. Your choice is kept for when you are on a computer.
              </p>
            )}
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
