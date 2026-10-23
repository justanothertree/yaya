import { describe, expect, it } from 'vitest'
import { bodiesWanted, slotKey, type Slot } from './kept'

/* the real rule from library/cloud.ts: only the park's records merge */
const merges = (k: string) => k === 'wins'

const has = (...keys: string[]) => new Set(keys)

describe('which bodies a browser actually has to fetch', () => {
  /**
   * ⚠️ THE CASE THE WHOLE CHANGE EXISTS FOR. A browser that already has everything asks for one
   * body — the merged kind — and nothing else. Measured against the live account that made this
   * worth doing: `library_list` is 2,187,984 bytes, the index is 6,285, and the one merged body
   * is 569.
   */
  it('asks for nothing it already has', () => {
    const remote: Slot[] = [
      { kind: 'art', name: 'Dawn' },
      { kind: 'song', name: 'A tune' },
      { kind: 'pet', name: 'Clawbert' },
    ]
    const here = has(slotKey('art', 'Dawn'), slotKey('song', 'A tune'), slotKey('pet', 'Clawbert'))
    expect(bodiesWanted(remote, here, merges)).toEqual([])
  })

  it('asks for what is missing, and only that', () => {
    const remote: Slot[] = [
      { kind: 'art', name: 'Dawn' },
      { kind: 'art', name: 'Dusk' },
      { kind: 'song', name: 'A tune' },
    ]
    const here = has(slotKey('art', 'Dawn'))
    expect(bodiesWanted(remote, here, merges)).toEqual([
      { kind: 'art', name: 'Dusk' },
      { kind: 'song', name: 'A tune' },
    ])
  })

  /**
   * ⚠️ A MERGED KIND IS ASKED FOR EVEN WHEN IT IS ALREADY HERE, and this is the one that would
   * silently lose data if it were wrong. For a park record both copies are real — the other
   * machine's time may be the quicker one — so "I have one of those" settles nothing. Skipping it
   * would mean a best time set elsewhere never arrived, with nothing to notice.
   */
  it('always asks for a merged kind, even holding one by that name', () => {
    const remote: Slot[] = [
      { kind: 'wins', name: 'park' },
      { kind: 'art', name: 'Dawn' },
    ]
    const here = has(slotKey('wins', 'park'), slotKey('art', 'Dawn'))
    expect(bodiesWanted(remote, here, merges)).toEqual([{ kind: 'wins', name: 'park' }])
  })

  /**
   * ⚠️ THE NAME IS MATCHED THE WAY THE SERVER MATCHES IT. `library_bodies` compares
   * `lower(btrim(name))`, and the browser's local stores are keyed the same way — so a drawing
   * kept as "dawn" and stored on the account as "  Dawn  " is ONE thing. If these disagreed, the
   * body would be fetched, found missing locally, and pushed back over the copy that was already
   * there.
   */
  it('treats a name as the same thing whatever its case or padding', () => {
    const remote: Slot[] = [{ kind: 'art', name: '  DAWN  ' }]
    expect(bodiesWanted(remote, has(slotKey('art', 'dawn')), merges)).toEqual([])
  })

  /**
   * ⚠️ AND IT ASKS ONCE. The server stores a name as it was typed, so "Dawn" and "dawn" are two
   * rows and one slot; asking for both would fetch the same bytes twice, which is the thing this
   * whole change is about not doing.
   */
  it('asks once for two rows that are one slot', () => {
    const remote: Slot[] = [
      { kind: 'art', name: 'Dawn' },
      { kind: 'art', name: 'dawn' },
    ]
    expect(bodiesWanted(remote, has(), merges)).toHaveLength(1)
  })

  it('asks for everything on a browser holding nothing', () => {
    const remote: Slot[] = [
      { kind: 'art', name: 'Dawn' },
      { kind: 'song', name: 'A tune' },
      { kind: 'wins', name: 'park' },
    ]
    expect(bodiesWanted(remote, has(), merges)).toHaveLength(3)
  })

  it('has nothing to ask for when the account is empty', () => {
    expect(bodiesWanted([], has(slotKey('art', 'Dawn')), merges)).toEqual([])
  })

  /**
   * ⚠️ THE SAVING, ASSERTED AS A SHAPE RATHER THAN A NUMBER. The claim is not "it fetches 6 kB";
   * it is that what gets fetched is proportional to what is MISSING, not to what exists. A
   * hundred things on the account and two of them new is two bodies and one merged one — and it
   * stays three whether the account holds a hundred or a thousand.
   */
  it('scales with what is missing rather than with what is there', () => {
    const remote: Slot[] = [{ kind: 'wins', name: 'park' }]
    for (let i = 0; i < 100; i++) remote.push({ kind: 'art', name: `one-${i}` })
    const here = has(
      slotKey('wins', 'park'),
      ...Array.from({ length: 98 }, (_, i) => slotKey('art', `one-${i}`)),
    )
    const want = bodiesWanted(remote, here, merges)
    expect(want).toHaveLength(3)
    expect(want.filter((w) => w.kind === 'wins')).toHaveLength(1)
    expect(
      want
        .filter((w) => w.kind === 'art')
        .map((w) => w.name)
        .sort(),
    ).toEqual(['one-98', 'one-99'])
  })
})
