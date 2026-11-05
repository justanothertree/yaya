import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Log today", pressed from somewhere the Circuit is not.
 *
 * The Board can be pinned over any page, so its button has to work when the Circuit itself is
 * unmounted. It used to call straight into that component's setState, which React silently drops
 * once the component is gone — so on every other tab **the button looked alive and did nothing at
 * all**. That is the failure these tests are about, and it is the kind nothing reports: no error,
 * no console line, just a press that goes nowhere.
 *
 * ⚠️ THE MODULE HOLDS STATE BETWEEN CALLS — one pending request and a set of listeners — so each
 * test gets a fresh copy via `vi.resetModules()`. A suite that shared it would pass or fail on
 * the order the tests happened to run in, which is the same class of bug as the one under test.
 */

type Mod = typeof import('./logIntent')

let mod: Mod
let hash: string

const atHash = (start: string) => {
  hash = start
  vi.stubGlobal('location', {
    get hash() {
      return hash
    },
    set hash(v: string) {
      hash = v.startsWith('#') ? v : `#${v}`
    },
  })
}

beforeEach(async () => {
  vi.resetModules()
  atHash('#home')
  mod = await import('./logIntent')
})

afterEach(() => vi.unstubAllGlobals())

describe('when the Circuit is listening', () => {
  it('hands the request straight over', () => {
    const seen: { personId: string; date: string }[] = []
    mod.onLogIntent((i) => seen.push({ personId: i.personId, date: i.date }))
    mod.requestLog('seed-person-1', '2026-11-05')
    expect(seen).toEqual([{ personId: 'seed-person-1', date: '2026-11-05' }])
  })

  it('leaves the page alone and stashes nothing', () => {
    /* both halves matter: a navigation would yank somebody off the tab they are reading, and a
       stash would fire the same log again the next time the Circuit mounts */
    mod.onLogIntent(() => {})
    mod.requestLog('seed-person-1', '2026-11-05')
    expect(hash).toBe('#home')
    expect(mod.takePendingLog()).toBeNull()
  })

  it('tells everyone who is listening', () => {
    /* the Board can be open on the canvas while the Circuit's own tab is mounted */
    let a = 0
    let b = 0
    mod.onLogIntent(() => a++)
    mod.onLogIntent(() => b++)
    mod.requestLog('p', '2026-11-05')
    expect([a, b]).toEqual([1, 1])
  })

  it('stops telling a listener that has gone', () => {
    let calls = 0
    const off = mod.onLogIntent(() => calls++)
    mod.requestLog('p', '2026-11-05')
    off()
    mod.requestLog('p', '2026-11-06')
    expect(calls).toBe(1)
    /* and with nobody left, the second request went to the stash instead of nowhere */
    expect(mod.takePendingLog()?.date).toBe('2026-11-06')
  })
})

describe('when nobody is home', () => {
  it('holds the request and takes you to where the log lives', () => {
    mod.requestLog('seed-person-1', '2026-11-05')
    expect(hash).toBe('#circuit')
    expect(mod.takePendingLog()).toMatchObject({ personId: 'seed-person-1', date: '2026-11-05' })
  })

  it('does not navigate when you are already in the Circuit', async () => {
    /* ⚠️ `split('?')[0]`, because the Circuit's own sub-tabs live in the query half of the hash.
       Without it, raising a request from the Board while sitting on `#circuit?tab=board` would
       rewrite the hash and throw the person back to the default tab — on the press that was
       supposed to open their log. */
    for (const start of ['#circuit', '#circuit?tab=log', '#circuit?tab=board&join=abc']) {
      vi.resetModules()
      atHash(start)
      const fresh = await import('./logIntent')
      fresh.requestLog('p', '2026-11-05')
      expect(hash, `from ${start}`).toBe(start)
      expect(fresh.takePendingLog()).not.toBeNull()
    }
  })

  it('hands the held request over exactly once', () => {
    /* the Circuit reads this as it mounts; a second read must find nothing, or a remount logs
       the same day again without anybody pressing anything */
    mod.requestLog('p', '2026-11-05')
    expect(mod.takePendingLog()).not.toBeNull()
    expect(mod.takePendingLog()).toBeNull()
  })

  it('keeps only the most recent request', () => {
    /* two presses before arriving: the second is what the person meant */
    mod.requestLog('p', '2026-11-05')
    mod.requestLog('q', '2026-11-06')
    expect(mod.takePendingLog()).toMatchObject({ personId: 'q', date: '2026-11-06' })
    expect(mod.takePendingLog()).toBeNull()
  })

  it('has nothing to hand over when nothing was asked', () => {
    expect(mod.takePendingLog()).toBeNull()
  })
})

describe('requestLogToday', () => {
  it('asks for today, as the local calendar has it', () => {
    /* not `toISOString().slice(0, 10)`: that is UTC, and an evening log in a western timezone
       would be filed on tomorrow's date. `todayISO` is the local one. */
    const seen: string[] = []
    mod.onLogIntent((i) => seen.push(i.date))
    mod.requestLogToday('p')
    const now = new Date()
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`
    expect(seen).toEqual([local])
  })
})
