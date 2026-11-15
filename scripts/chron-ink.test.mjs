import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CATS, inkOf } from '../src/chronicle/record.ts'

/**
 * The colour of an activity's dot, asked of the stylesheet.
 *
 * ⚠️ A DOT WITH AN UNDECLARED COLOUR IS INVISIBLE, NOT BROKEN. Every activity has a dot now, and
 * one with no colour of its own is drawn as `var(--chron-<kind>)` (`inkOf`). If a kind ever has no
 * such variable, `background:` resolves to nothing and that kind's rows simply lose their dot, with
 * no error anywhere. Vitest hands a CSS import back empty, so this reads the file, like
 * motion-sweep does.
 */

const css = readFileSync(join('src', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const root = [...css.matchAll(/(^|\})\s*:root\s*\{([^{}]*)\}/g)].map((m) => m[2]).join(';')

describe('an activity’s dot', () => {
  it('has a colour declared on :root for every kind an activity can be', () => {
    for (const [kind] of CATS) {
      const ink = inkOf({ colour: null, cat: kind })
      const name = /^var\((--[\w-]+)\)$/.exec(ink)?.[1]
      expect(name, ink).toBeTruthy()
      expect(root, `${name} on :root`).toMatch(
        new RegExp(`(^|[\\s;])${name}\\s*:\\s*#[0-9a-f]{6}`, 'i'),
      )
    }
  })
})
