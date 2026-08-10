import { useCallback, useEffect, useRef, useState } from 'react'
import { hexToHsl, hslToHex, parseHex } from './customTheme'

/**
 * An inline colour picker.
 *
 * `<input type="color">` was everything this needs functionally, and it felt wrong: clicking it
 * throws an operating-system dialog into the top-left corner of the screen, miles from the
 * thing you're editing, and you can't see the site change while it's open. For a control whose
 * whole point is watching the site change as you drag, that's the wrong shape.
 *
 * So: a shade pad and a hue rail, both inline, both live. Drag anywhere and the site updates
 * under the dialog. The hex box stays for pasting a colour you already have.
 *
 * Pointer events rather than mouse events, so a finger on the pad works the same as a cursor,
 * and `setPointerCapture` so a drag that leaves the pad keeps tracking instead of sticking.
 */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
}) {
  const padRef = useRef<HTMLDivElement>(null)
  const valid = !!parseHex(value)
  const hsl = hexToHsl(valid ? value : '#000000')
  // The hue is kept here as well as derived, because a fully black or white colour has no hue
  // of its own — without this, dragging to a corner would silently reset the rail to red.
  const [hue, setHue] = useState(hsl.h)
  useEffect(() => {
    if (hsl.s > 0.02 && hsl.l > 0.02 && hsl.l < 0.98) setHue(hsl.h)
  }, [hsl.h, hsl.s, hsl.l])

  const [open, setOpen] = useState(false)

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
    <div className="cf">
      <button
        type="button"
        className="cf-swatch"
        style={{ background: valid ? value : 'transparent' }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${label}: ${value}. Click to ${open ? 'close' : 'open'} the picker`}
      />
      <span className="cf-label">{label}</span>
      <input
        className="cf-hex"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        spellCheck={false}
        aria-label={`${label} hex code`}
      />

      {open && (
        <div className="cf-pop">
          <div
            ref={padRef}
            className="cf-pad"
            style={{
              // white→transparent→black over a grey→hue ramp: the standard shade square, and
              // it reads correctly against the HSL maths above
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
      )}
    </div>
  )
}
