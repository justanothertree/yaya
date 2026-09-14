// What colour a visual mode should draw in, read off the page it is drawing on.
//
// ⚠️ ONE DEFINITION, because there are two surfaces running these modes now — the visualiser
// room and the panel beside the instrument — and a second copy of this is a second place for
// "which custom property holds the accent" to drift. Every mode asks for colour the same way
// (see hue() in visualModes), so getting this wrong does not break one drawing, it recolours all
// of them.
//
// ⚠️ READ FROM THE ELEMENT, not from :root. The canvas inherits whatever theme is in force where
// it actually sits — a profile showing its owner's colours, a canvas-mode window, the instrument
// room under a Look — and reading the document would paint every surface with the site default
// instead.
import { paletteById } from './palettes'
import type { Ink } from './visualModes'

/**
 * ⚠️ Six-digit hex only, by design. These are the site's own tokens and they are written as
 * hex; accepting rgb()/hsl() here would mean a colour parser whose failure mode is a wrong
 * colour rather than an obvious one. Anything unparsed falls back to the value it shipped with.
 */
export function readInk(el: Element, paletteId: string): Ink {
  const s = getComputedStyle(el)
  const read = (name: string, fallback: [number, number, number]): [number, number, number] => {
    const v = s.getPropertyValue(name).trim()
    const m = /^#?([0-9a-f]{6})$/i.exec(v)
    if (!m) return fallback
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  return {
    accent: read('--accent', [34, 197, 94]),
    accent2: read('--accent-2', [239, 68, 68]),
    ink: read('--text', [238, 238, 248]),
    // empty for Theme, which is what makes hue() fall back to the accent pair
    stops: paletteById(paletteId).stops,
    // the visualiser replaces this every frame from its Lift dial; surfaces without one leave it
    lift: 0,
    // likewise the Morph dial: a surface that does not offer one gets a ramp that holds still
    morph: 0,
  }
}
