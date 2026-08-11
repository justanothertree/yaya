import { useCallback, useEffect, useRef, useState } from 'react'
import { hexToHsl, hslToHex, parseHex } from './customTheme'

/**
 * The colour controls: three compact rows, and ONE shade pad shared between them.
 *
 * `<input type="color">` was everything this needs functionally, and it felt wrong: clicking it
 * throws an operating-system dialog into the corner of the screen, miles from the thing you're
 * editing, and you can't see the site change while it's open. For a control whose whole point
 * is watching the site change as you drag, that's the wrong shape.
 *
 * The first attempt gave every row its own collapsible pad, and Evan put it exactly right —
 * "something is always shifting". Opening one moved everything below it; closing it moved it
 * back. So the pad is permanent now and the rows only choose what it edits. Nothing expands,
 * nothing collapses, and the dialog is the same height however you use it.
 */

/** One selectable row: a swatch, a name, and a hex box for pasting a colour you already have. */
export function ColorRow({
  label,
  value,
  selected,
  onSelect,
  onChange,
}: {
  label: string
  value: string
  selected: boolean
  onSelect: () => void
  onChange: (hex: string) => void
}) {
  const valid = !!parseHex(value)
  return (
    <div className={'cf-row' + (selected ? ' is-on' : '')}>
      <button
        type="button"
        className="cf-swatch"
        style={{ background: valid ? value : 'transparent' }}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`Edit ${label}, currently ${value}`}
      />
      <button type="button" className="cf-name" onClick={onSelect} aria-pressed={selected}>
        {label}
      </button>
      <input
        className="cf-hex"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onSelect}
        spellCheck={false}
        aria-label={`${label} hex code`}
      />
    </div>
  )
}

/**
 * The shade pad and hue rail. Always on screen, editing whichever row is selected.
 *
 * Pointer events rather than mouse events, so a finger works the same as a cursor, and
 * `setPointerCapture` so a drag that leaves the pad keeps tracking instead of sticking.
 */
export function ShadePad({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
}) {
  const padRef = useRef<HTMLDivElement>(null)
  const hsl = hexToHsl(parseHex(value) ? value : '#000000')
  // The hue is kept as well as derived, because a fully black or white colour has no hue of its
  // own — without this, dragging into a corner would silently reset the rail to red.
  const [hue, setHue] = useState(hsl.h)
  useEffect(() => {
    if (hsl.s > 0.02 && hsl.l > 0.02 && hsl.l < 0.98) setHue(hsl.h)
  }, [hsl.h, hsl.s, hsl.l])

  const fromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = padRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height))
      // x is saturation, y is lightness inverted: top of the pad is white, bottom is black
      onChange(hslToHex({ h: hue, s: x, l: 1 - y }))
    },
    [hue, onChange],
  )

  return (
    <div className="cf-pop">
      <div
        ref={padRef}
        className="cf-pad"
        style={{
          // white→transparent→black over a grey→hue ramp: the standard shade square, and it
          // reads correctly against the HSL maths above
          backgroundImage: `linear-gradient(to bottom, #fff 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0) 50%, #000 100%), linear-gradient(to right, hsl(${hue} 0% 50%), hsl(${hue} 100% 50%))`,
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          fromPoint(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) fromPoint(e.clientX, e.clientY)
        }}
        role="application"
        aria-label={`${label} shade`}
      >
        <span
          className="cf-dot"
          style={{ left: `${hsl.s * 100}%`, top: `${(1 - hsl.l) * 100}%` }}
          aria-hidden
        />
      </div>
      <input
        className="cf-hue"
        type="range"
        min={0}
        max={360}
        step={1}
        value={Math.round(hue)}
        onChange={(e) => {
          const h = parseFloat(e.target.value)
          setHue(h)
          onChange(hslToHex({ h, s: hsl.s || 0.6, l: hsl.l || 0.5 }))
        }}
        aria-label={`${label} hue`}
      />
    </div>
  )
}
