import { describe, expect, it } from 'vitest'
import { slotKey } from './kept'
import {
  due,
  noteChanges,
  outcomeOf,
  packOutbox,
  readOutbox,
  retryDelay,
  RETRIES,
  shouldPush,
  type Item,
  type Outbox,
} from './outbox'

const item = (kind: string, name: string, body: unknown = { v: 1 }): Item => ({ kind, name, body })
const rows = (...items: Item[]) => new Map(items.map((i) => [slotKey(i.kind, i.name), i]))
const box = (...e: Array<['put' | 'drop', string, string]>): Outbox =>
  new Map(e.map(([op, kind, name]) => [slotKey(kind, name), { op, kind, name }]))
const ops = (b: Outbox) => [...b.values()].map((o) => `${o.op} ${o.kind}:${o.name}`).sort()

describe('what a change here owes the account', () => {
  it('owes a put for something new, and for something edited', () => {
    const before = rows(item('art', 'Dawn', { c: 1 }))
    const now = rows(item('art', 'Dawn', { c: 2 }), item('song', 'Tune'))
    expect(ops(noteChanges(new Map(), before, now).box)).toEqual(['put art:Dawn', 'put song:Tune'])
  })

  it('owes nothing for something that did not change', () => {
    const both = rows(item('art', 'Dawn'))
    const n = noteChanges(new Map(), both, rows(item('art', 'Dawn')))
    expect(n.box.size).toBe(0)
    expect(n.touched).toEqual([])
  })

  it('owes a drop for something deleted', () => {
    expect(ops(noteChanges(new Map(), rows(item('pet', 'Clawbert')), rows()).box)).toEqual([
      'drop pet:Clawbert',
    ])
  })

  it('keeps what was already owed', () => {
    const owed = box(['drop', 'art', 'Dusk'])
    expect(ops(noteChanges(owed, rows(), rows(item('art', 'Dawn'))).box)).toEqual([
      'drop art:Dusk',
      'put art:Dawn',
    ])
  })

  it('lets the latest intent for one thing win', () => {
    /* deleted and made again is a put; edited and then deleted is a drop */
    expect(
      ops(noteChanges(box(['drop', 'art', 'Dawn']), rows(), rows(item('art', 'Dawn'))).box),
    ).toEqual(['put art:Dawn'])
    expect(
      ops(noteChanges(box(['put', 'art', 'Dawn']), rows(item('art', 'Dawn')), rows()).box),
    ).toEqual(['drop art:Dawn'])
  })

  it('names every thing it touched, so a refusal can be asked about again', () => {
    const n = noteChanges(
      new Map(),
      rows(item('art', 'A'), item('art', 'B')),
      rows(item('art', 'B', 2)),
    )
    expect(n.touched.sort()).toEqual([slotKey('art', 'A'), slotKey('art', 'B')])
  })

  it('does not change the outbox it was given', () => {
    const owed = box(['drop', 'art', 'Dusk'])
    noteChanges(owed, rows(), rows(item('art', 'Dawn')))
    expect(ops(owed)).toEqual(['drop art:Dusk'])
  })
})

describe('what is sent', () => {
  it('sends the deletes first, because a delete makes room', () => {
    const owed = box(['put', 'art', 'Dawn'], ['drop', 'art', 'Dusk'], ['put', 'song', 'Tune'])
    const { send } = due(owed, rows(item('art', 'Dawn'), item('song', 'Tune')))
    expect(send.map((s) => s.op)).toEqual(['drop', 'put', 'put'])
  })

  it('sends a put with the body this machine has now', () => {
    const now = rows(item('art', 'Dawn', { c: 7 }))
    const [s] = due(box(['put', 'art', 'Dawn']), now).send
    expect(s.op === 'put' && s.item.body).toEqual({ c: 7 })
  })

  /**
   * ⚠️ NEVER DELETE FROM THE ACCOUNT WHAT THIS BROWSER STILL HOLDS. A drop for something that is
   * here again is stale, whatever road it came back by — the copy here is what wins.
   */
  it('lets a drop go, unsent, when the thing is here again', () => {
    const r = due(box(['drop', 'art', 'Dawn']), rows(item('art', 'Dawn')))
    expect(r.send).toEqual([])
    expect(r.stale).toEqual([slotKey('art', 'Dawn')])
  })

  it('lets a put go, unsent, when the thing is no longer here', () => {
    const r = due(box(['put', 'art', 'Dawn']), rows())
    expect(r.send).toEqual([])
    expect(r.stale).toEqual([slotKey('art', 'Dawn')])
  })

  it('holds back what the account refused this visit, without forgetting it', () => {
    const owed = box(['put', 'art', 'Dawn'], ['put', 'art', 'Dusk'])
    const r = due(
      owed,
      rows(item('art', 'Dawn'), item('art', 'Dusk')),
      new Set([slotKey('art', 'Dawn')]),
    )
    expect(r.send.map((s) => s.key)).toEqual([slotKey('art', 'Dusk')])
    expect(r.stale).toEqual([])
  })

  it('matches a name the way the server does', () => {
    const r = due(box(['drop', 'art', '  DAWN ']), rows(item('art', 'dawn')))
    expect(r.send).toEqual([])
  })
})

describe('how a send went', () => {
  it('is sent only when there was no error', () => {
    expect(outcomeOf(null)).toBe('sent')
    expect(outcomeOf(undefined)).toBe('sent')
  })

  it('is a failure when no answer came back', () => {
    expect(outcomeOf({ message: 'TypeError: Failed to fetch', code: '' })).toBe('failed')
    expect(outcomeOf({ message: 'upstream connect error', code: '503' })).toBe('failed')
    expect(outcomeOf(new Error('boom'))).toBe('failed')
  })

  it('is a refusal when the account said no with a reason about the thing', () => {
    for (const message of [
      'that one is too big to keep',
      'your library is full — delete something first',
      'your account is suspended',
    ])
      expect(outcomeOf({ message, code: 'P0001' })).toBe('refused')
  })

  it('is a failure, not a refusal, when the token was not there for a moment', () => {
    expect(outcomeOf({ message: 'not authenticated', code: 'P0001' })).toBe('failed')
  })
})

describe('when to ask again', () => {
  it('waits longer each time', () => {
    const waits = Array.from({ length: RETRIES }, (_, i) => retryDelay(i)!)
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThanOrEqual(waits[i - 1])
    expect(waits[waits.length - 1]).toBeGreaterThan(waits[0])
  })

  it('starts soon and never waits more than five minutes', () => {
    expect(retryDelay(0)!).toBeLessThanOrEqual(10_000)
    for (let i = 0; i < RETRIES; i++) expect(retryDelay(i)!).toBeLessThanOrEqual(5 * 60_000)
  })

  it('stops asking on a timer after a bounded number of tries', () => {
    expect(retryDelay(RETRIES)).toBeNull()
    expect(retryDelay(RETRIES + 100)).toBeNull()
    expect(retryDelay(-1)).toBeNull()
    expect(retryDelay(Number.NaN)).toBeNull()
  })
})

describe('whether sync pushes this machine’s copy', () => {
  const ask = (p: Partial<Parameters<typeof shouldPush>[0]>) =>
    shouldPush({ theyHaveIt: false, owed: false, merged: false, same: false, ...p })

  it('pushes what the account does not have', () => {
    expect(ask({})).toBe(true)
  })

  it('leaves an add-only thing the account already has', () => {
    expect(ask({ theyHaveIt: true })).toBe(false)
  })

  /** ⚠️ THE HALF THAT WAS MISSING: the account has this name and an older body under it. */
  it('pushes an edit that never landed, though the account has that name', () => {
    expect(ask({ theyHaveIt: true, owed: true })).toBe(true)
  })

  it('pushes a merged kind only when ours is different', () => {
    expect(ask({ theyHaveIt: true, merged: true })).toBe(true)
    expect(ask({ theyHaveIt: true, merged: true, same: true })).toBe(false)
  })

  it('does not push an owed thing that is already level', () => {
    expect(ask({ theyHaveIt: true, owed: true, same: true })).toBe(false)
  })
})

describe('an outbox written down and read back', () => {
  /* every field away from its default: both ops, several kinds, a name with case and padding */
  const full = box(
    ['drop', 'art', '  Dawn Light '],
    ['put', 'song', 'Tune'],
    ['put', 'wins', 'park'],
    ['drop', 'pet', 'Clawbert'],
  )

  it('comes back exactly', () => {
    const back = readOutbox(packOutbox(full))
    expect([...back.entries()]).toEqual([...full.entries()])
  })

  it('keys each entry from its own kind and name, not from what it was stored under', () => {
    const back = readOutbox(JSON.stringify([{ op: 'drop', kind: 'art', name: 'DAWN' }]))
    expect([...back.keys()]).toEqual([slotKey('art', 'dawn')])
  })

  it('leaves out anything that is not an op on a named thing', () => {
    const raw = JSON.stringify([
      { op: 'drop', kind: 'art', name: 'Dawn' },
      { op: 'erase', kind: 'art', name: 'Dusk' },
      { op: 'put', kind: '', name: 'Dusk' },
      { op: 'put', kind: 'art', name: '   ' },
      { op: 'put', kind: 'art' },
      null,
      'put art:Dusk',
    ])
    expect(ops(readOutbox(raw))).toEqual(['drop art:Dawn'])
  })

  it('reads nothing from nothing, and from garbage', () => {
    expect(readOutbox(null).size).toBe(0)
    expect(readOutbox('{not json').size).toBe(0)
    expect(readOutbox('{"op":"drop"}').size).toBe(0)
  })
})
