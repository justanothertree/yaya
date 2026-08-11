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
import { ColorRow, ShadePad } from './ColorField'
import { SnakePreview } from './SnakePreview'
import { PRESET_GROUPS } from './presets'

/**
 * Make your own palette.
 *
 * Three colours, everything else derived (see customTheme.ts for why). Changes apply live as
 * you drag, because a colour picker that needs a Save button before you can see anything is a
 * guessing game.
 *
 * THERE IS NO SAVE BUTTON, and that's the fix for a real bug rather than a simplification for
 * its own sake: picking a starting point, not saving, and closing the dialog left the site
 * showing one palette and the stored seed holding another, so the next reload snapped back to
 * something you'd already moved on from. Every edit persists immediately, so what you see and
 * what is stored can't disagree.
 *
 * The contrast readout is the part that earns its place. It isn't a badge for its own sake: it's
 * how you find out that a colour you like is unreadable *before* you commit to it, which is
 * exactly the mistake already sitting in one of the built-in themes.
 */

const SEEDS: Array<[keyof PaletteSeed, string]> = [
  ['bg', 'Background'],
  ['text', 'Text'],
  ['accent', 'Accent'],
]

/** Plain-language help for a contrast number, because "14.44:1" means nothing on its own. */
function explain(ratio: number): string {
  const r = rate(ratio)
  const scale =
    ratio >= 12
      ? 'Very high contrast — crisp at any size.'
      : ratio >= 7
        ? 'Comfortable at any size, including small print.'
        : ratio >= 4.5
          ? 'Fine for normal text, though not luxurious.'
          : ratio >= 3
            ? 'Only safe for big or bold text; ordinary text will strain.'
            : 'Hard to read — the two colours are too close in brightness.'
  return (
    `${ratio.toFixed(2)} to 1 is how much brighter the lighter colour is than the darker one. ` +
    `1:1 is invisible, 21:1 is black on white. ${scale} ` +
    `The accessibility standard asks for at least 4.5:1 for normal text and 3:1 for large text` +
    (r === 'aa' ? ', which this clears.' : ', which this does not reach.')
  )
}

function Row({ label, ratio }: { label: string; ratio: number }) {
  const r = rate(ratio)
  return (
    <div className="pal-check" title={explain(ratio)}>
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
  /** which colour the shade pad is editing — the pad itself never goes away */
  const [field, setField] = useState<keyof PaletteSeed>('accent')

  // Persist and apply together, so the stored palette and the visible one are never different
  // things. This is what removes the "picked a starter, closed, got the old colours" bug.
  useEffect(() => {
    savePalette(seed)
    if (active) applyPalette(seed)
  }, [seed, active])

  const derived = derivePalette(seed)
  const set = (k: keyof PaletteSeed) => (v: string) => setSeed((s) => ({ ...s, [k]: v }))
  const fieldLabel = SEEDS.find(([k]) => k === field)?.[1] ?? 'Colour'

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
      {/* Two columns on a desktop: controls here, the preview parked beside them, so the thing
          you're adjusting a colour FOR stays on screen while you adjust it. */}
      <div className="pal-controls">
        <label className="pal-toggle">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => {
              const on = e.target.checked
              onActiveChange(on)
              applyPalette(on ? seed : null)
            }}
          />
          <span>Use my own colours</span>
        </label>

        <div className="pal-seeds">
          {SEEDS.map(([k, label]) => (
            <ColorRow
              key={k}
              label={label}
              value={seed[k]}
              selected={field === k}
              onSelect={() => setField(k)}
              onChange={set(k)}
            />
          ))}
          <ShadePad label={fieldLabel} value={seed[field]} onChange={set(field)} />
        </div>
      </div>

      {/* Split from the controls so a phone can put the preview BETWEEN them: the colour rows
          and the pad are what you touch, so they come first, and the preview sits right under
          them rather than pushing them off screen. On a desktop both halves stack in the left
          column with the preview beside. */}
      <div className="pal-extras">
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

        {/* Presets show their three colours rather than only a name: you can find the one you
            want by eye, which is the whole reason someone opens this. */}
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

      {/* Sticky beside the controls on a desktop; a normal block on a phone, where there's only
          one column. */}
      <aside className="pal-side">
        <div className="pal-preview" style={derived as React.CSSProperties}>
          <div className="pal-preview-card">
            <strong>Preview</strong>
            <p className="muted">Secondary text sits here.</p>
            <SnakePreview tokens={derived} />
            <span className="pal-preview-btn">Button</span>
          </div>
        </div>
        {/* One button, so this doesn't need a bar of its own along the bottom obscuring the
            presets. Everything else saves itself. */}
        <button
          className="btn pal-reset"
          onClick={() => {
            setSeed(DEFAULT_SEED)
            savePalette(null)
            onActiveChange(false)
            applyPalette(null)
          }}
          title="Forget my colours and go back to the built-in themes"
        >
          Reset to built-in themes
        </button>
      </aside>
    </div>
  )
}
