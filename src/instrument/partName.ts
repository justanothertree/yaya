import { soleDrumPiece, type Layer } from '../audio/looper'
import { DRUMS, INSTRUMENTS } from '../audio/synth'
import { layerTitle } from './layerTitle'

/**
 * What a part's one-line row says, in two short lines — the #311 layout, 14 Nov 2026.
 *
 * The row lost everything but its name, its bars, its mute and its ⋯, so the name has to carry
 * what the row used to show beside it: WHAT the part is on the first line ("1. Beat") and the
 * detail under it ("Funk · Drums") — the style it was laid in, and the instrument, which was the
 * row's own dropdown and is now in the part's menu (PartPanel, Sound).
 *
 * ⚠️ A PART SOMEBODY PLAYED STILL COUNTS ITS NOTES, because that count is the handle for "show me
 * those notes" (see the name button in LayerList). A split kit row says WHICH drum first, because
 * after a split "3." and "4." are otherwise the same words.
 */
export function partLines(l: Layer, i: number): { name: string; detail: string } {
  const title = layerTitle(l)
  const cut = title ? title.indexOf(' · ') : -1
  const kind = title === null ? null : cut < 0 ? title : title.slice(0, cut)
  const style = title !== null && cut >= 0 ? title.slice(cut + 3) : null
  const piece = soleDrumPiece(l)
  const head = [
    `${i + 1}.`,
    piece !== null ? DRUMS[piece] : null,
    kind ?? (piece !== null ? null : `${l.events.filter((e) => e.on).length} notes`),
  ]
  const sound = INSTRUMENTS.find(([id]) => id === l.instrument)?.[2] ?? l.instrument
  return {
    name: head.filter(Boolean).join(' '),
    detail: [style, sound].filter(Boolean).join(' · '),
  }
}
