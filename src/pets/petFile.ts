import { GifEncoder } from '../draw/gif'
import type { Progress } from '../draw/export'
import { rigOf } from './rig'
import { paintPet } from './paint'
import type { Pet } from './pets'

/**
 * A pet, as a file you can send somebody.
 *
 * ⚠️ IT REUSES THE PAINT ROOM'S ENCODER AND NOTHING ELSE. GifEncoder takes frames of pixels and
 * knows nothing about drawings; paintPet is a plain function of time and knows nothing about
 * files. Putting a pet in a GIF is therefore a loop and a canvas, which is the payoff for having
 * written both of those as functions rather than as components with clocks inside them.
 *
 * ⚠️ IT DOES NOT LOOP SEAMLESSLY, AND SAYING SO IS THE HONEST OPTION. The rig runs nine different
 * frequencies at once — a wing at 7 radians a second, a tail at 3.4, a blink every 4.3 seconds —
 * and they share no common period, so there is no duration where all of them arrive back where
 * they started. Three seconds is long enough to catch a blink and short enough to stay small; the
 * seam at the restart is a fraction of a wingbeat. The alternatives were to bend the rig's
 * frequencies into whole-number ratios, which is changing how a pet moves so that a file can be
 * tidier, or a ping-pong that makes a walk cycle moonwalk.
 */

export const PET_WIDTHS: Array<[string, number]> = [
  ['Small', 160],
  ['Medium', 240],
  ['Big', 360],
]

const SECONDS = 3
const STEPS = 48
/** hundredths of a second per frame — 48 frames over 3 seconds is 16 a second */
const DELAY = Math.round((SECONDS * 100) / STEPS)

const shape = (pet: Pet, width: number) => {
  const wh = pet.art.ratio > 0.05 && pet.art.ratio < 20 ? pet.art.ratio : 1
  const w = Math.round(wh >= 1 ? width : width * wh)
  const h = Math.round(wh >= 1 ? width / wh : width)
  return { w: Math.max(8, w), h: Math.max(8, h) }
}

function surface(pet: Pet, width: number, opaque: boolean) {
  const { w, h } = shape(pet, width)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: opaque })
  return ctx ? { c, ctx, w, h } : null
}

/**
 * ⚠️ The paper goes behind, never into, the picture — see draw/export.ts for the full reason.
 * A pet usually has no paper at all, so a still is transparent and a GIF, which cannot be, gets
 * white.
 */
function paper(ctx: CanvasRenderingContext2D, pet: Pet, w: number, h: number, fallback: string) {
  ctx.clearRect(0, 0, w, h)
  const fill = pet.art.bg ?? fallback
  if (!fill) return
  ctx.save()
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, w, h)
  ctx.restore()
}

/** A still of the pet standing there — the resting pose, which is what it looks like at rest. */
export async function petStill(pet: Pet, width: number): Promise<Blob | null> {
  const s = surface(pet, width, false)
  if (!s) return null
  paper(s.ctx, pet, s.w, s.h, '')
  paintPet(s.ctx, pet.art, rigOf(pet.art), s.w, s.h, { t: 0, energy: 1 })
  return new Promise((done) => s.c.toBlob((b) => done(b), 'image/png'))
}

/** The pet moving, about three seconds of it. */
export async function petGif(pet: Pet, width: number, onStep?: Progress): Promise<Blob | null> {
  const s = surface(pet, width, true)
  if (!s) return null
  const { ctx, w, h } = s
  const parts = rigOf(pet.art)
  const enc = new GifEncoder(w, h)

  for (let i = 0; i < STEPS; i++) {
    paper(ctx, pet, w, h, '#ffffff')
    paintPet(ctx, pet.art, parts, w, h, { t: (i / STEPS) * SECONDS, energy: 1 })
    enc.add(ctx.getImageData(0, 0, w, h).data, DELAY)
    onStep?.(i + 1, STEPS)
    /* ⚠️ yields, for the same reason the drawing exporter does: a tab that stops answering is
       indistinguishable from a tab that has crashed */
    await new Promise((r) => setTimeout(r, 0))
  }

  const bytes = enc.finish()
  return bytes.length ? new Blob([bytes], { type: 'image/gif' }) : null
}

export const petSeconds = SECONDS
