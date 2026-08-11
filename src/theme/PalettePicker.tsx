import { useEffect, useState } from 'react'
import {
  type PaletteSeed,
  DEFAULT_SEED,
  applyPalette,
  contrast,
  derivePalette,
  loadPalette,
  rate,
  savePalette,
} from './customTheme'
import { ColorField } from './ColorField'
import { SnakePreview } from './SnakePreview'
import { PRESET_GROUPS } from './presets'

/**
 * Make your own palette.
 *
 * Three colours, everything else derived (see customTheme.ts for why). Changes apply live as
 * you drag, because a colour picker that needs a Save button before you can see anything is a
 * guessing game — and reverting is one button, so there's nothing to lose by trying.
 *
 * The contrast readout is the part that earns its place. It isn't a badge for its own sake: it's
 * how you find out that a colour you like is unreadable *before* you save it, which is exactly
 * the mistake already sitting in one of the built-in themes.
 */

function Row({ label, ratio }: { label: string; ratio: number }) {
  const r = rate(ratio)
  return (
    <div className="pal-check">
      <span className="pal-check-label">{label}</span>
      <span className={'pal-check-val is-' + r}>
        {ratio.toFixed(2)}:1{' '}
        {r === 'aa' ? 'good' : r === 'large' ? 'large text only' : 'hard to read'}
      </span>
    </div>
  )
}

export function PalettePicker({
  active,
  onActiveChange,
}: {
  /** true when the custom palette is the one in use */
  active: boolean
  onActiveChange: (on: boolean) => void
}) {
  const [seed, setSeed] = useState<PaletteSeed>(() => loadPalette() ?? DEFAULT_SEED)
  /** which colour's shade pad is expanded — one at a time, so the dialog never has to scroll */
  const [openField, setOpenField] = useState<keyof PaletteSeed | null>(null)

  // Live preview: while this is the active theme, every edit lands on the page immediately.
  useEffect(() => {
    if (active) applyPalette(seed)
  }, [seed, active])

  const derived = derivePalette(seed)
  const set = (k: keyof PaletteSeed) => (v: string) => setSeed((s) => ({ ...s, [k]: v }))

  const checks = [
    { label: 'Body text on the background', ratio: contrast(seed.text, seed.bg) },
    { label: 'Accent used as text', ratio: contrast(seed.accent, seed.bg) },
    // Not a free choice — it's computed from the accent — so this row should always pass. It's
    // shown anyway, because a number you can see is how you trust that it did.
    { label: 'Text on an accent button', ratio: contrast(derived['--btn-text'], seed.accent) },
  ]
  const worst = Math.min(...checks.map((c) => c.ratio))

  return (
    <div className="pal">
      {/* Two columns on a desktop: controls here, the preview parked beside them. Opening a
          colour picker adds a shade pad inline, which in one column pushed the preview off
          screen — so the thing you're adjusting a colour *for* disappeared exactly when you
          started adjusting it. */}
      <div className="pal-main">
        <label className="pal-toggle">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => {
              const on = e.target.checked
              onActiveChange(on)
              if (on) {
                savePalette(seed)
                applyPalette(seed)
              } else {
                applyPalette(null)
              }
            }}
          />
          <span>Use my own colours</span>
        </label>

        <div className="pal-seeds">
          {(
            [
              ['bg', 'Background'],
              ['text', 'Text'],
              ['accent', 'Accent'],
            ] as Array<[keyof PaletteSeed, string]>
          ).map(([k, label]) => (
            <ColorField
              key={k}
              label={label}
              value={seed[k]}
              onChange={set(k)}
              open={openField === k}
              onOpen={(on) => setOpenField(on ? k : null)}
            />
          ))}
        </div>

        <div className="pal-checks">
          {checks.map((c) => (
            <Row key={c.label} label={c.label} ratio={c.ratio} />
          ))}
          {worst < 4.5 && (
            <p className="pal-warn">
              Some of this is hard to read at normal text size. Try a lighter text colour on a dark
              background — or a darker one on a light background — until every line above says good.
            </p>
          )}
        </div>

        {/* Presets show their three colours rather than only a name: you can find the one you want
          by eye, which is the whole reason someone opens this. */}
        <div className="pal-presets">
          {PRESET_GROUPS.map((g) => (
            <div className="pal-preset-group" key={g.group}>
              <span className="pal-check-label">{g.group}</span>
              <div className="pal-preset-row">
                {g.items.map((p) => {
                  const on =
                    p.seed.bg === seed.bg &&
                    p.seed.text === seed.text &&
                    p.seed.accent === seed.accent
                  return (
                    <button
                      key={p.label}
                      className={'pal-preset' + (on ? ' is-on' : '')}
                      onClick={() => setSeed(p.seed)}
                      title={p.label}
                      aria-pressed={on}
                    >
                      <span className="pal-preset-chips" aria-hidden>
                        <i style={{ background: p.seed.bg }} />
                        <i style={{ background: p.seed.text }} />
                        <i style={{ background: p.seed.accent }} />
                      </span>
                      <span className="pal-preset-name">{p.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky beside the controls on a desktop, so it stays put while you work through the
          colours; a normal block above the presets on a phone, where there's only one column. */}
      <aside className="pal-side">
        <div className="pal-preview" style={derived as React.CSSProperties}>
          <div className="pal-preview-card">
            <strong>Preview</strong>
            <p className="muted">Secondary text sits here.</p>
            <SnakePreview tokens={derived} />
            <span className="pal-preview-btn">Button</span>
          </div>
        </div>
      </aside>

      <div className="pal-actions">
        <button
          className="btn"
          onClick={() => {
            savePalette(seed)
            onActiveChange(true)
            applyPalette(seed)
          }}
        >
          Save
        </button>
        <button
          className="btn"
          onClick={() => {
            setSeed(DEFAULT_SEED)
            savePalette(null)
            onActiveChange(false)
            applyPalette(null)
          }}
          title="Forget my colours and go back to the built-in themes"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
