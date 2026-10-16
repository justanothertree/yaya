import { describe, expect, it } from 'vitest'
import { tilesFor, type Sat } from './nowTiles'
import type { Activity } from './record'

const act = (over: Partial<Activity> & { id: string; name: string }): Activity => ({
  cat: 'free',
  colour: null,
  archived: false,
  auto: false,
  metric: null,
  session: null,
  ...over,
})

const NOW = Date.parse('2026-10-16T18:00:00.000Z')
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString()
const sat = (activity: string, fromMins: number, toMins: number | null): Sat => ({
  activity,
  start: ago(fromMins),
  end: toMins === null ? null : ago(toMins),
})

describe('the buttons the Now room offers', () => {
  const draw = act({ id: 'd', name: 'Drawing' })
  const gym = act({ id: 'g', name: 'Gym' })
  const dishes = act({ id: 'h', name: 'Dishes' })

  it('offers every activity, even one with no time against it', () => {
    expect(tilesFor([draw, gym, dishes], [], NOW).map((a) => a.id)).toEqual(['h', 'd', 'g'])
  })

  /**
   * ⚠️ THE ORDER IS THE ERGONOMICS. The two or three things somebody actually does should be
   * under the thumb without reading, so the claim is about MINUTES rather than about the order
   * the server happened to send.
   */
  it('puts the most-used first', () => {
    const log = [sat('g', 120, 60), sat('d', 30, 20)]
    expect(tilesFor([draw, gym, dishes], log, NOW).map((a) => a.id)).toEqual(['g', 'd', 'h'])
  })

  /** ⚠️ and the one you are IN counts to now, or it sits wherever it was this morning */
  it('counts the sitting that has not ended yet', () => {
    /* drawing has 10 recorded minutes; gym has been running for 40 and must overtake it */
    const log = [sat('d', 60, 50), sat('g', 40, null)]
    expect(tilesFor([draw, gym], log, NOW).map((a) => a.id)).toEqual(['g', 'd'])
  })

  it('breaks a tie by name, so an untouched screen does not shuffle between loads', () => {
    const z = act({ id: 'z', name: 'Admin' })
    expect(tilesFor([draw, gym, z], [], NOW).map((a) => a.name)).toEqual([
      'Admin',
      'Drawing',
      'Gym',
    ])
  })

  /**
   * ⚠️ BOTH EXCLUSIONS, for reasons that differ. `chronicle_start` refuses an activity with an
   * `archived_at`, so a tile for one is a button whose only answer is an error; an `auto`
   * activity is written by the room rather than started by a person.
   */
  it('leaves out an archived activity, which cannot be started at all', () => {
    const gone = act({ id: 'x', name: 'Guitar', archived: true })
    expect(tilesFor([draw, gone], [], NOW).map((a) => a.id)).toEqual(['d'])
  })

  it('leaves out an auto activity, which the room writes rather than you', () => {
    const auto = act({ id: 'c', name: 'Chronicle', auto: true })
    expect(tilesFor([draw, auto], [], NOW).map((a) => a.id)).toEqual(['d'])
  })

  /** ⚠️ even with minutes against it — an archived activity keeps its history and stays unstartable */
  it('and leaves an archived one out however much time it has', () => {
    const gone = act({ id: 'x', name: 'Guitar', archived: true })
    expect(tilesFor([draw, gone], [sat('x', 300, 0)], NOW).map((a) => a.id)).toEqual(['d'])
  })

  /** a log naming something that is not an activity any more must not throw or invent a tile */
  it('ignores a sitting whose activity is gone', () => {
    expect(tilesFor([draw], [sat('vanished', 60, 0)], NOW).map((a) => a.id)).toEqual(['d'])
  })

  it('survives a sitting with an unparseable date rather than sorting by NaN', () => {
    const junk: Sat = { activity: 'd', start: 'not a date', end: null }
    expect(tilesFor([draw, gym], [junk, sat('g', 30, 0)], NOW).map((a) => a.id)).toEqual(['g', 'd'])
  })
})
