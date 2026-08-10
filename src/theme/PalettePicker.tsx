import { useEffect, useState } from 'react'
import {
  type PaletteSeed,
  DEFAULT_SEED,
  applyPalette,
  contrast,
  derivePalette,
  loadPalette,
  parseHex,
  rate,
  savePalette,
} from './customTheme'

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

const SWATCHES: Array<{ label: string; seed: PaletteSeed }> = [
  { label: 'Midnight', seed: { bg: '#08080f', text: '#eeeef8', accent: '#22c55e' } },
  { label: 'Paper', seed: { bg: '#fbfbfd', text: '#14141c', accent: '#2563eb' } },
  { label: 'Ember', seed: { bg: '#120c0a', text: '#f6ece8', accent: '#f97316' } },
  { label: 'Deep sea', seed: { bg: '#06121a', text: '#e4f4ff', accent: '#22d3ee' } },
]

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
      <div className="pal-head">
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
      </div>

      <div className="pal-seeds">
        {(
          [
            ['bg', 'Background'],
            ['text', 'Text'],
            ['accent', 'Accent'],
          ] as Array<[keyof PaletteSeed, string]>
        ).map(([k, label]) => (
          <label className="pal-seed" key={k}>
            <span>{label}</span>
            <input
              type="color"
              value={parseHex(seed[k]) ? seed[k] : DEFAULT_SEED[k]}
              onChange={(e) => set(k)(e.target.value)}
              aria-label={label}
            />
            {/* the text field is for pasting a hex you already have; invalid input is simply
                ignored by the derivation rather than blowing up the page */}
            <input
              className="pal-hex"
              type="text"
              value={seed[k]}
              onChange={(e) => set(k)(e.target.value)}
              spellCheck={false}
              aria-label={`${label} hex code`}
            />
          </label>
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

      {/* What the derived tokens actually look like. Cheaper than describing them. */}
      <div className="pal-preview" style={derived as React.CSSProperties}>
        <div className="pal-preview-card">
          <strong>Preview</strong>
          <p className="muted">Secondary text sits here.</p>
          <span className="pal-preview-btn">Button</span>
        </div>
      </div>

      <div className="pal-actions">
        {SWATCHES.map((s) => (
          <button
            key={s.label}
            className="btn"
            onClick={() => setSeed(s.seed)}
            title={`Start from ${s.label}`}
          >
            {s.label}
          </button>
        ))}
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
