import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The settings menu's step buttons — text size, status, theme — asked of the stylesheet.
 *
 * ⚠️ THEY WERE 23px TALL, under WCAG 2.5.8's 24, in a sheet that is only opened with a thumb on a
 * phone: 0.2rem of padding on an 0.8rem label and nothing saying how small that could get.
 * mobileAudit found all ten on 21 Nov 2026 with the phone settings sheet open; the rows around them
 * were 44px and the buttons inside them were not. Vitest has no layout and returns a CSS import
 * empty, so this reads the file, like motion-sweep and week-hours do.
 */

const css = readFileSync(join('src', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const px = (body, prop) => {
  const m = new RegExp(`(^|[\\s;])${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(body)
  return m ? Number(m[2]) : null
}

describe('the settings menu’s step buttons', () => {
  it('meet the 24px floor everywhere, in pixels', () => {
    const plain = [...css.matchAll(/(^|\})\s*\.nav-menu-steps \.btn\s*\{([^}]*)\}/g)].map(
      (m) => m[2],
    )
    expect(plain.length).toBeGreaterThan(0)
    expect(
      plain.some((b) => (px(b, 'min-height') ?? 0) >= 24 && (px(b, 'min-width') ?? 0) >= 24),
    ).toBe(true)
  })

  it('are thumb-sized on any touch screen, phone width or not', () => {
    const touch = [...css.matchAll(/@media ([^{]+)\{\s*\.nav-menu-steps \.btn\s*\{([^}]*)\}/g)]
      .filter(([, query]) => /pointer:\s*coarse/.test(query) && /max-width/.test(query))
      .map((m) => m[2])
    expect(touch.length).toBeGreaterThan(0)
    for (const b of touch) {
      expect(px(b, 'min-height')).toBeGreaterThanOrEqual(36)
      expect(px(b, 'min-width')).toBeGreaterThanOrEqual(36)
    }
  })
})
