import { describe, expect, it } from 'vitest'
import {
  finished,
  goalWindow,
  inScope,
  lastDay,
  repeats,
  share,
  SCOPES,
  windowOf,
  type Goal,
  type Scope,
} from './goal'

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  title: 'a goal',
  scope: 'day',
  anchor: '2026-10-12',
  every: null,
  target: null,
  unit: null,
  progress: 0,
  done: false,
  note: null,
  sort: 0,
  ...over,
})

const dated: Scope[] = ['day', 'week', 'month', 'quarter', 'year']

describe('the window a goal is judged over', () => {
  /**
   * ⚠️ THE ONE PROPERTY WORTH ASSERTING, and it is not a pair of dates. Windows have to TILE:
   * every window's exclusive end is the next window's inclusive start, with no gap and no overlap.
   * Written as a pair of expected dates this test would agree with whatever the arithmetic said;
   * written as tiling it fails the moment a +1 goes missing or lands twice, which is where every
   * off-by-one in calendar code actually lives.
   */
  it('tiles — one window ends exactly where the next begins', () => {
    for (const scope of dated) {
      let at = '2025-11-20'
      for (let i = 0; i < 40; i++) {
        const w = windowOf(scope, at)!
        expect(w.from <= at, `${scope} ${at} is not before its own window`).toBe(true)
        expect(at < w.to, `${scope} ${at} is inside its own window`).toBe(true)
        const next = windowOf(scope, w.to)!
        expect(next.from, `${scope} after ${w.from}`).toBe(w.to)
        at = w.to
      }
    }
  })

  /**
   * ⚠️ DST IS WHERE DATE MATHS DIES, so the two days it happens on are asked about by name. In
   * 2026 the US springs forward on 8 March and falls back on 1 November.
   *
   * ⚠️ AND IT TAKES TWO MISTAKES AT ONCE TO MAKE THIS FAIL, which was measured rather than
   * assumed and is the reason it is written down. The module has two independent guards — a noon
   * anchor and calendar-day arithmetic — and breaking either ALONE leaves this green: noon
   * absorbs the hour a millisecond sum gets wrong, and setDate is right about a day whatever hour
   * it starts from. Only midnight plus milliseconds together turns it red.
   *
   * So this test does not prove either guard is necessary; it proves the pair is. Anybody who
   * deletes one of them as redundant will find this still passing, which is precisely why the
   * module says so beside both of them.
   */
  it('and survives both ends of daylight saving', () => {
    expect(windowOf('day', '2026-03-08')).toEqual({ from: '2026-03-08', to: '2026-03-09' })
    expect(windowOf('day', '2026-11-01')).toEqual({ from: '2026-11-01', to: '2026-11-02' })
    /* and a week containing a shift is still seven days */
    for (const on of ['2026-03-08', '2026-11-01']) {
      const w = windowOf('week', on)!
      const days = (Date.parse(w.to + 'T12:00') - Date.parse(w.from + 'T12:00')) / 86_400_000
      expect(Math.round(days), `week around ${on}`).toBe(7)
    }
  })

  /**
   * ⚠️ SUNDAY, BECAUSE THE SITE ALREADY SAYS SUNDAY — the Circuit's calendar does
   * `getDate() - getDay()` with the comment "back to Sunday". A chronicle week starting Monday
   * would put the same two days in different weeks depending which room you were looking at.
   */
  it('and a week starts on a Sunday, like the rest of the site', () => {
    /* 11 Oct 2026 is a Sunday; the whole week from it must share one window */
    for (let i = 0; i < 7; i++) {
      const day = `2026-10-${String(11 + i).padStart(2, '0')}`
      expect(windowOf('week', day), day).toEqual({ from: '2026-10-11', to: '2026-10-18' })
    }
    /* and the Saturday before belongs to the week before */
    expect(windowOf('week', '2026-10-10')!.from).toBe('2026-10-04')
  })

  /** ⚠️ every day of a month, not two fixtures — month lengths and leap years are the trap */
  it('and every day of a month lands in that month', () => {
    for (const [first, len] of [
      ['2026-02-01', 28],
      ['2028-02-01', 29],
      ['2026-04-01', 30],
      ['2026-12-01', 31],
    ] as const) {
      const w = windowOf('month', first)!
      for (let i = 0; i < len; i++) {
        const day = `${first.slice(0, 8)}${String(i + 1).padStart(2, '0')}`
        expect(windowOf('month', day), day).toEqual(w)
      }
    }
    /* the leap day is in February and in its year */
    expect(windowOf('month', '2028-02-29')!.to).toBe('2028-03-01')
    expect(windowOf('year', '2028-02-29')).toEqual({ from: '2028-01-01', to: '2029-01-01' })
  })

  it('and quarters are three months, four to a year', () => {
    const starts = new Set<string>()
    for (let m = 1; m <= 12; m++) {
      const w = windowOf('quarter', `2026-${String(m).padStart(2, '0')}-15`)!
      starts.add(w.from)
    }
    expect([...starts].sort()).toEqual(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'])
  })

  /**
   * ⚠️ THE DAY A WINDOW ENDS ON IS NOT THE DAY IT ENDS AT, and this is the one place the
   * half-open window reaches the screen. The room prints "1 Oct – 31 Oct"; printing `to` would
   * say "1 Oct – 1 Nov", which is a month and a day and reads as a bug in the planner.
   */
  it('and the last day it covers is the one before its exclusive end', () => {
    expect(lastDay(windowOf('month', '2026-10-12')!)).toBe('2026-10-31')
    expect(lastDay(windowOf('month', '2028-02-10')!)).toBe('2028-02-29')
    expect(lastDay(windowOf('year', '2026-06-01')!)).toBe('2026-12-31')
    expect(lastDay(windowOf('week', '2026-10-12')!)).toBe('2026-10-17')
    expect(lastDay(windowOf('quarter', '2026-10-12')!)).toBe('2026-12-31')
    /* and it is always inside the window it describes, for every scope and either DST edge */
    for (const scope of dated) {
      for (const on of ['2026-03-08', '2026-11-01', '2026-10-12']) {
        const w = windowOf(scope, on)!
        const last = lastDay(w)
        expect(last >= w.from, `${scope} ${on}`).toBe(true)
        expect(last < w.to, `${scope} ${on}`).toBe(true)
      }
    }
  })

  it('and a lifetime goal has no window at all', () => {
    expect(windowOf('life', '2026-10-12')).toBeNull()
    expect(goalWindow(goal({ scope: 'life', anchor: null }), '2026-10-12')).toBeNull()
  })
})

describe('which list a goal shows up in', () => {
  /**
   * ⚠️ EXACTLY ONE OF THE SIX, which is the whole reason `inScope` matches on scope and not just
   * on dates. A hundred points over a year is not a thing to do today, even though today is
   * inside the year — overlap alone would put every yearly goal in all six lists, and six lists
   * showing the same things is a wall of text rather than a planner.
   */
  it('appears at its own cadence and nowhere else', () => {
    const on = '2026-10-12'
    for (const scope of SCOPES) {
      const g =
        scope === 'life'
          ? goal({ scope, anchor: null })
          : goal({ scope, anchor: windowOf(scope, on)!.from })
      const shown = SCOPES.filter((s) => inScope(g, s, on))
      expect(shown, `a ${scope} goal`).toEqual([scope])
    }
  })

  it('and a one-off shows only in the window its anchor names', () => {
    const g = goal({ scope: 'day', anchor: '2026-10-13' })
    expect(inScope(g, 'day', '2026-10-13')).toBe(true)
    expect(inScope(g, 'day', '2026-10-12')).toBe(false)
  })

  /** ⚠️ a repeating goal is in every window of its scope, which is what "daily" means */
  it('and a repeat shows in every window of its own size', () => {
    const g = goal({ scope: 'day', anchor: null, every: 1 })
    expect(repeats(g)).toBe(true)
    for (const day of ['2026-10-12', '2026-10-13', '2027-01-01', '2028-02-29']) {
      expect(inScope(g, 'day', day), day).toBe(true)
      expect(goalWindow(g, day)!.from, day).toBe(day)
    }
  })

  it('and a goal with no anchor and no repeat shows nowhere, rather than everywhere', () => {
    const g = goal({ scope: 'week', anchor: null, every: null })
    expect(inScope(g, 'week', '2026-10-12')).toBe(false)
  })
})

describe('how far along a goal is', () => {
  /** ⚠️ a tick-box has no fraction — see share, and the progress bar it would otherwise invite */
  it('is nothing at all for a tick-box', () => {
    expect(share(goal())).toBeNull()
    expect(share(goal({ target: 0, unit: 'x' }))).toBeNull()
  })

  it('and a share of the target for a quantity, never outside 0 to 1', () => {
    expect(share(goal({ target: 100, unit: 'points', progress: 0 }))).toBe(0)
    expect(share(goal({ target: 100, unit: 'points', progress: 40 }))).toBe(0.4)
    expect(share(goal({ target: 100, unit: 'points', progress: 100 }))).toBe(1)
    /* over-achieving is not 140% of a bar */
    expect(share(goal({ target: 100, unit: 'points', progress: 140 }))).toBe(1)
  })

  /** ⚠️ two ways to be finished, and a quantity that reached its target did not need ticking */
  it('and is finished either by being ticked or by reaching the number', () => {
    expect(finished(goal())).toBe(false)
    expect(finished(goal({ done: true }))).toBe(true)
    expect(finished(goal({ target: 10, unit: 'min', progress: 10 }))).toBe(true)
    expect(finished(goal({ target: 10, unit: 'min', progress: 9 }))).toBe(false)
  })

  /**
   * ⚠️ THE CIRCUIT'S HUNDRED, EXPRESSED HERE, which is the claim the whole model was chosen for:
   * "similar concept to how i have the circuit goal of 100 points but it doesnt have to be
   * points". If this cannot be said in chronicle's vocabulary then the vocabulary is wrong.
   */
  it('and the Circuit hundred is sayable in this vocabulary', () => {
    const hundred = goal({
      title: '100 points',
      scope: 'year',
      anchor: '2026-01-01',
      target: 100,
      unit: 'points',
      progress: 63,
    })
    expect(inScope(hundred, 'year', '2026-10-12')).toBe(true)
    expect(inScope(hundred, 'day', '2026-10-12')).toBe(false)
    expect(share(hundred)).toBeCloseTo(0.63, 10)
    expect(finished(hundred)).toBe(false)
  })
})
