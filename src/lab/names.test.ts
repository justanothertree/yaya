import { describe, expect, it } from 'vitest'
import registry from '../sections/labDemos.tsx?raw'
import { TOY_NAMES } from './names'

/** id and name of every entry in the Lab's own registry, read as text so no toy is loaded */
function fromRegistry(): Record<string, string> {
  const list = registry.slice(registry.indexOf('export const DEMOS'))
  return Object.fromEntries(
    list
      .split(/\n {2}\{\n/)
      .slice(1)
      .map((entry) => {
        const id = /\bid: '([a-z0-9-]+)'/.exec(entry)![1]
        const m = /\bname: (?:'((?:[^'\\]|\\.)*)'|"([^"]*)")/.exec(entry)!
        return [id, (m[1] ?? m[2]).replace(/\\'/g, "'")]
      }),
  )
}

describe('the light copy of toy names', () => {
  it('names exactly the toys the Lab has, the way the Lab names them', () => {
    const real = fromRegistry()
    expect(Object.keys(real).length).toBeGreaterThan(100)
    expect(TOY_NAMES).toEqual(real)
  })
})
