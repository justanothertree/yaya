// The Lab's keyboard-focus sweep: open each toy, press every control in it by keyboard (up to three
// times while it keeps the focus — a third roll is what disables a Roll button), and report each
// press after which the focus fell to the page body or sat on a disabled control.
//
// Why it exists: a control that removes or disables itself drops the focus on the page, and the next
// key goes nowhere. On 12 Nov 2026 this found 63 of 133 toys doing it; src/gpu/focusRescue.ts is the
// fix, and with it the sweep finds Poker's "Sit down" alone — the computers then take their turns
// with nothing to press, and the focus arrives on Fold when it is yours, after the 260ms this looks.
//
// It needs Playwright (preinstalled in the cloud sessions, not a dependency of this repository) and a
// running dev server:
//   node scripts/lab-focus-sweep.mjs http://localhost:5173/ ids.json out.jsonl
// where ids.json is a JSON list of Lab ids (src/lab/catalog.ts's META keys). One JSON line per toy:
// { id, pressed, drops: [{ i, label, press, where }] }.
/* the functions passed to page.evaluate and addInitScript run in the page, where these exist */
/* global document, localStorage, sessionStorage */
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const [B, list, outFile] = process.argv.slice(2)
const ids = JSON.parse(fs.readFileSync(list, 'utf8'))
const b = await chromium.launch({
  args: [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--enable-features=Vulkan',
  ],
})
for (const id of ids) {
  const ctx = await b.newContext({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  })
  const p = await ctx.newPage()
  p.on('dialog', (d) => d.dismiss().catch(() => {}))
  await p.addInitScript((id) => {
    if (sessionStorage.getItem('s')) return
    sessionStorage.setItem('s', '1')
    localStorage.clear()
    localStorage.setItem('lab_demo_v1', id)
  }, id)
  const drops = []
  let pressed = 0
  try {
    await p.goto(B + '#lab', { timeout: 20000 })
    await p.waitForSelector('.lab-picker', { timeout: 15000 })
    await p.waitForTimeout(1200)
    for (let i = 0; i < 30; i++) {
      const label = await p.evaluate((i) => {
        const lab = document.querySelector('.lab')
        const xs = [...lab.querySelectorAll('button, [role=button], input[type=checkbox]')].filter(
          (e) =>
            !e.closest(
              '.lab-picker, .lab-filter, .lab-feedback, .lab-report, details.lab-comments, .lab-votes, .lab-catalog, nav',
            ) &&
            e.checkVisibility() &&
            !e.disabled &&
            e.getAttribute('aria-disabled') !== 'true',
        )
        const e = xs[i]
        if (!e) return null
        e.focus()
        if (document.activeElement !== e) return '(not focusable)'
        return (e.getAttribute('aria-label') || e.textContent || e.title || e.tagName)
          .trim()
          .slice(0, 40)
      }, i)
      if (label === null) break
      if (label === '(not focusable)') continue
      // up to three presses of the same control while it keeps the focus: a third roll is what
      // disables a Roll button, and one press would never find that
      for (let k = 0; k < 3; k++) {
        await p.keyboard.press('Enter')
        pressed++
        await p.waitForTimeout(260)
        const where = await p.evaluate(() =>
          document.activeElement === document.body || !document.activeElement
            ? 'body'
            : document.activeElement.disabled
              ? 'disabled'
              : 'ok',
        )
        if (where !== 'ok') {
          drops.push({ i, label, press: k + 1, where })
          break
        }
      }
    }
  } catch (e) {
    drops.push({ error: String(e).slice(0, 80) })
  }
  fs.appendFileSync(outFile, JSON.stringify({ id, pressed, drops }) + '\n')
  await ctx.close()
}
await b.close()
