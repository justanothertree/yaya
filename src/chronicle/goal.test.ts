import { describe, expect, it } from 'vitest'
import {
  derived,
  finished,
  goalWindow,
  inScope,
  lastDay,
  reached,
  repeats,
  share,
  SCOPES,
  streakAsks,
  streakKey,
  streakOf,
  STREAK_BACK,
  likeForLike,
  marksOf,
  tallyAsks,
  weight,
  windowOf,
  type Goal,
  type Scope,
} from './goal'
import { localMidnight } from './record'

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
  activity: null,
  cat: null,
  counts: 'minutes',
  est: null,
  priority: 0,
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

/**
 * A day to ask the readers about. Any day works for a hand-moved goal — the argument exists for
 * the derived ones, which have a different answer per window.
 */
const DAY = '2026-10-12'

/**
 * The map a server would hand back, keyed BY THE ASK.
 *
 * ⚠️ BUILT FROM `tallyAsks` RATHER THAN FROM A KEY THIS FILE WRITES ITSELF. The claim under test
 * is that the side that ASKS and the side that READS agree about where an answer is filed, and a
 * test that spells the key out a second time asserts its own spelling instead — it would have
 * stayed green through the whole duplicate-key bug, because both halves of it were wrong in the
 * same way. Going through the ask is the only path that shares no arithmetic with the reader.
 */
const answered = (g: Goal, on: string, n: number): Record<string, number> =>
  Object.fromEntries(tallyAsks([g], on).map((a) => [a.key, n]))

describe('how far along a goal is', () => {
  /** ⚠️ a tick-box has no fraction — see share, and the progress bar it would otherwise invite */
  it('is nothing at all for a tick-box', () => {
    expect(share(goal(), undefined, DAY)).toBeNull()
    expect(share(goal({ target: 0, unit: 'x' }), undefined, DAY)).toBeNull()
  })

  it('and a share of the target for a quantity, never outside 0 to 1', () => {
    expect(share(goal({ target: 100, unit: 'points', progress: 0 }), undefined, DAY)).toBe(0)
    expect(share(goal({ target: 100, unit: 'points', progress: 40 }), undefined, DAY)).toBe(0.4)
    expect(share(goal({ target: 100, unit: 'points', progress: 100 }), undefined, DAY)).toBe(1)
    /* over-achieving is not 140% of a bar */
    expect(share(goal({ target: 100, unit: 'points', progress: 140 }), undefined, DAY)).toBe(1)
  })

  /** ⚠️ two ways to be finished, and a quantity that reached its target did not need ticking */
  it('and is finished either by being ticked or by reaching the number', () => {
    expect(finished(goal(), undefined, DAY)).toBe(false)
    expect(finished(goal({ done: true }), undefined, DAY)).toBe(true)
    expect(finished(goal({ target: 10, unit: 'min', progress: 10 }), undefined, DAY)).toBe(true)
    expect(finished(goal({ target: 10, unit: 'min', progress: 9 }), undefined, DAY)).toBe(false)
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
    expect(share(hundred, undefined, DAY)).toBeCloseTo(0.63, 10)
    expect(finished(hundred, undefined, DAY)).toBe(false)
  })
})

describe('a goal that reads the record instead of waiting to be told', () => {
  const mins = goal({
    title: '30 min drawing',
    scope: 'day',
    anchor: null,
    every: 1,
    target: 30,
    unit: 'min',
    activity: 'act-draw',
  })

  it('knows whether it has a source at all', () => {
    expect(derived(goal())).toBe(false)
    expect(derived(mins)).toBe(true)
    expect(derived(goal({ cat: 'life', target: 60, unit: 'min' }))).toBe(true)
  })

  /**
   * ⚠️ THE WORST THING THIS COULD DO IS FALL BACK TO ITS OWN COLUMN. A derived goal's `progress`
   * is never written — the server does not touch it and the room offers no way to — so using it
   * when the tally has not arrived would put a stale or empty number on screen wearing the
   * authority of a reading. Zero while it loads is honest; `progress` would be a lie with a
   * plausible shape. This is also the one that would survive code review, because the fallback
   * reads as defensive.
   */
  it('and shows nothing rather than its stale column when the tally is missing', () => {
    const stale = { ...mins, progress: 999 }
    expect(reached(stale, undefined, DAY)).toBe(0)
    expect(reached(stale, {}, DAY)).toBe(0)
    expect(share(stale, {}, DAY)).toBe(0)
    expect(finished(stale, {}, DAY)).toBe(false)
    /* and the tally, when it comes, is the number */
    expect(reached(stale, answered(stale, DAY, 20), DAY)).toBe(20)
    expect(share(stale, answered(stale, DAY, 15), DAY)).toBe(0.5)
    expect(finished(stale, answered(stale, DAY, 30), DAY)).toBe(true)
  })

  /**
   * ⚠️ THE BUG THIS WHOLE KEY EXISTS FOR, and it was live on the site. One load asks about a
   * repeating daily goal TWICE — today's window for the Today list, tomorrow's for the Tomorrow
   * list — and tomorrow's answer is zero every time, because tomorrow has not happened. Keyed by
   * goal id alone the two answers were the same entry, `jsonb_object_agg` kept the last, and
   * every repeating derived goal on the site read 0 of its target with the minutes sitting in the
   * day's totals two inches above it.
   *
   * ⚠️ AND THE TWO WINDOWS CARRY DIFFERENT NUMBERS HERE, which is what makes this a test rather
   * than a restatement. Give both windows 35 and a reader that looks up the wrong one still
   * passes; 35 today and 0 tomorrow can only be told apart by asking the right question.
   */
  it('and one load asking about two windows gets two answers, not the last one twice', () => {
    const on = '2026-10-12'
    const next = '2026-10-13'
    const asks = [...tallyAsks([mins], on), ...tallyAsks([mins], next)]
    expect(asks).toHaveLength(2)
    expect(asks[0].key).not.toBe(asks[1].key)

    /* 35 minutes drawn today; tomorrow has not happened */
    const got = { [asks[0].key]: 35, [asks[1].key]: 0 }
    expect(reached(mins, got, on)).toBe(35)
    expect(reached(mins, got, next)).toBe(0)
    expect(finished(mins, got, on)).toBe(true)
    expect(finished(mins, got, next)).toBe(false)
  })

  /**
   * ⚠️ AND A ONE-OFF IS ONE ASK FROM EITHER END, because its window comes from its anchor and not
   * from where you are standing. Looking at it from tomorrow must not invent a second question
   * about it — that would put the same goal in the batch twice for no reason and, before the key,
   * would have been a collision that happened to be harmless.
   */
  it('and a one-off is the same single question from whichever day you look', () => {
    const once = goal({
      scope: 'day',
      anchor: '2026-10-12',
      target: 30,
      unit: 'min',
      activity: 'a',
    })
    const a = tallyAsks([once], '2026-10-12')[0]
    const b = tallyAsks([once], '2026-10-13')[0]
    expect(b.key).toBe(a.key)
    expect(reached(once, { [a.key]: 30 }, '2026-10-13')).toBe(30)
  })

  it('and a hand-moved goal ignores the tally entirely', () => {
    const hand = goal({ target: 100, unit: 'points', progress: 40 })
    expect(reached(hand, { [hand.id]: 7 }, DAY)).toBe(40)
    expect(share(hand, { [hand.id]: 7 }, DAY)).toBe(0.4)
  })

  /** ⚠️ ticking by hand still finishes a derived goal — the record is evidence, not a jailer */
  it('and can still be ticked done by hand', () => {
    expect(finished({ ...mins, done: true }, {}, DAY)).toBe(true)
  })

  /**
   * ⚠️ THE ASKS CARRY THE WINDOW THIS SIDE WORKED OUT, which is the whole reason the server is
   * not allowed to compute one: date_trunc('week') in postgres starts on Monday and this site
   * starts on Sunday. A week ask must therefore begin on the same Sunday `windowOf` names.
   */
  it('and asks for its own window, in local instants', () => {
    const weekly = goal({
      scope: 'week',
      anchor: null,
      every: 1,
      target: 300,
      unit: 'min',
      activity: 'a',
    })
    const asks = tallyAsks([weekly, goal(), mins], '2026-10-14')
    /* the hand-moved one is not asked about */
    expect(asks.map((a) => a.id)).toEqual([weekly.id, mins.id])

    const w = asks[0]
    /* ⚠️ local midnight, not UTC midnight: parsed from the ISO it sends, the hour must be 0 local */
    expect(new Date(w.from).getHours()).toBe(0)
    expect(new Date(w.from).getDay(), 'the week ask starts on a Sunday').toBe(0)
    /* and it matches the window the view would show, rather than a second opinion */
    const shown = windowOf('week', '2026-10-14')!
    expect(new Date(w.from).getDate()).toBe(Number(shown.from.slice(8)))
    expect(new Date(w.to).getDate()).toBe(Number(shown.to.slice(8)))
  })

  it('and a lifetime goal with a source is not asked about, having no window', () => {
    const forever = goal({ scope: 'life', anchor: null, target: 100, unit: 'min', activity: 'a' })
    expect(tallyAsks([forever], '2026-10-14')).toEqual([])
  })
})

describe('how many windows in a row', () => {
  const daily = goal({
    title: '30 min a day',
    scope: 'day',
    anchor: null,
    every: 1,
    target: 30,
    unit: 'min',
    activity: 'a1',
  })

  /** met on the given window offsets, missed on the rest */
  const run = (hits: number[]): Record<string, number> => {
    const out: Record<string, number> = {}
    for (let i = 0; i <= STREAK_BACK; i++) out[streakKey(daily.id, i)] = hits.includes(i) ? 40 : 0
    return out
  }

  /**
   * ⚠️ THE DECISION THE WHOLE FEATURE TURNS ON. A five day streak at nine in the morning on the
   * sixth day is still five — today is not a failure, it is unfinished. Counting the current
   * window as a miss would make every streak read zero every morning, which is the exact opposite
   * of what a streak is for, and it is the version somebody writes first.
   */
  it('is not broken by the window you are still in', () => {
    /* yesterday and the four before it, nothing today yet */
    expect(streakOf(daily, run([1, 2, 3, 4, 5]))).toBe(5)
    /* and doing today adds to it rather than starting again */
    expect(streakOf(daily, run([0, 1, 2, 3, 4, 5]))).toBe(6)
  })

  it('and stops at the first window that was missed', () => {
    expect(streakOf(daily, run([0, 1, 3, 4]))).toBe(2)
    expect(streakOf(daily, run([0]))).toBe(1)
    expect(streakOf(daily, run([]))).toBe(0)
    /* a gap at yesterday with today done is a streak of exactly one */
    expect(streakOf(daily, run([0, 2, 3]))).toBe(1)
  })

  it('and needs the target met, not merely approached', () => {
    const nearly: Record<string, number> = {}
    for (let i = 0; i <= 3; i++) nearly[streakKey(daily.id, i)] = 29
    expect(streakOf(daily, nearly)).toBe(0)
    nearly[streakKey(daily.id, 0)] = 30
    expect(streakOf(daily, nearly)).toBe(1)
  })

  /** ⚠️ a goal with no run of windows, or no per-window history, has no streak to measure */
  it('and is nothing at all for a goal that cannot have one', () => {
    const once = goal({
      scope: 'day',
      anchor: '2026-10-12',
      target: 30,
      unit: 'min',
      activity: 'a1',
    })
    expect(streakOf(once, run([0, 1, 2]))).toBe(0)
    const byHand = goal({ scope: 'day', anchor: null, every: 1, target: 30, unit: 'min' })
    expect(streakOf(byHand, run([0, 1, 2]))).toBe(0)
    const tickBox = goal({ scope: 'day', anchor: null, every: 1, activity: 'a1' })
    expect(streakOf(tickBox, run([0, 1, 2]))).toBe(0)
  })

  /**
   * ⚠️ THE ASKS STEP BY CALENDAR, NOT BY MULTIPLES OF A DAY. A month back from 31 March is not
   * thirty-one days, and a year back across a leap day is not 365 — so a monthly streak asked for
   * in multiples of 86,400,000 would drift a day per step and eventually land in the wrong month.
   */
  it('and asks for its own windows, stepping back by the right unit', () => {
    const monthly = goal({
      scope: 'month',
      anchor: null,
      every: 1,
      target: 4,
      unit: 'maps',
      activity: 'a1',
    })
    const asks = streakAsks([monthly], '2026-03-31', 3)
    expect(asks.length).toBe(4)
    /* each ask begins on the first of a month, and they walk backwards one month at a time */
    const firsts = asks.map((a) => new Date(a.from).getMonth())
    expect(firsts).toEqual([2, 1, 0, 11])
    for (const a of asks) expect(new Date(a.from).getDate(), a.key).toBe(1)
  })

  it('and asks nothing for goals that cannot have a streak', () => {
    const once = goal({
      scope: 'day',
      anchor: '2026-10-12',
      target: 30,
      unit: 'min',
      activity: 'a1',
    })
    const byHand = goal({ scope: 'day', anchor: null, every: 1, target: 30, unit: 'min' })
    expect(streakAsks([once, byHand], '2026-10-12', 3)).toEqual([])
    expect(streakAsks([daily], '2026-10-12', 3).length).toBe(4)
  })
})

describe('what a window still asks of you', () => {
  const DAY = '2026-10-12'
  const todo = (title: string, est: number | null, over: Partial<Goal> = {}) =>
    goal({ id: title, title, scope: 'day', anchor: DAY, est, ...over })

  /**
   * ⚠️ THE CLAIM THE OBVIOUS VERSION GETS WRONG. An estimate is optional, so summing the ones that
   * exist and handing back a single figure understates the day by however many were never guessed
   * — silently, which is the bad part, because the number looks complete. Five things of which two
   * are guessed at twenty minutes each is not a forty-minute day. So `vague` is part of the
   * answer, and a caller cannot render the total without also being handed the gap.
   */
  it('reports what it could not count, rather than a total that looks complete', () => {
    const w = weight(
      [todo('a', 20), todo('b', 20), todo('c', null), todo('d', null), todo('e', null)],
      {},
      'day',
      DAY,
    )
    expect(w).toEqual({ left: 5, mins: 40, vague: 3 })
  })

  it('and a list nobody has guessed at is five things and no minutes, not an empty day', () => {
    const w = weight([todo('a', null), todo('b', null)], {}, 'day', DAY)
    expect(w).toEqual({ left: 2, mins: 0, vague: 2 })
  })

  /** ⚠️ the unfinished only, or the weight of a day would go UP as the day went well */
  it('and drops things as they are finished', () => {
    const list = [todo('a', 30), todo('b', 45, { done: true }), todo('c', 15)]
    expect(weight(list, {}, 'day', DAY)).toEqual({ left: 2, mins: 45, vague: 0 })
  })

  /**
   * ⚠️ AND IT ASKS `finished` RATHER THAN `done`, so a derived goal that the record has already
   * satisfied drops out too — the same question the window strip asks one line above it. A weight
   * that only noticed hand-ticked goals would keep counting half an hour of drawing you had
   * already done.
   */
  it('and a derived goal the record has already met drops out as well', () => {
    const drawing = goal({
      id: 'g-draw',
      title: '30 minutes drawing',
      scope: 'day',
      anchor: DAY,
      target: 30,
      unit: 'minutes',
      activity: 'act-draw',
      est: 30,
    })
    const ask = tallyAsks([drawing], DAY)[0]
    expect(weight([drawing], { [ask.key]: 10 }, 'day', DAY)).toEqual({
      left: 1,
      mins: 30,
      vague: 0,
    })
    expect(weight([drawing], { [ask.key]: 35 }, 'day', DAY)).toEqual({
      left: 0,
      mins: 0,
      vague: 0,
    })
  })

  it('and only this window — a yearly goal is not part of today', () => {
    const year = goal({ id: 'y', title: 'big', scope: 'year', anchor: '2026-01-01', est: 600 })
    expect(weight([year], {}, 'day', DAY)).toEqual({ left: 0, mins: 0, vague: 0 })
    expect(weight([year], {}, 'year', DAY)).toEqual({ left: 1, mins: 600, vague: 0 })
  })

  /** ⚠️ a nonsense estimate counts as no estimate, rather than as zero minutes of work */
  it('and treats a zero or negative guess as no guess at all', () => {
    expect(weight([todo('a', 0), todo('b', -30)], {}, 'day', DAY)).toEqual({
      left: 2,
      mins: 0,
      vague: 2,
    })
  })
})

describe('this window against the one before it', () => {
  const HOUR = 3_600_000
  const DAY = 86_400_000
  /* Tue 13 Oct 2026. The site's week starts on Sunday, so this week began Sun 11 Oct. */
  const TUE = '2026-10-13'
  const at = (iso: string, h: number) => localMidnight(iso).getTime() + h * HOUR

  /**
   * ⚠️ THE CLAIM THE NAIVE VERSION GETS WRONG, and it gets it wrong every single morning. On
   * Tuesday "this week" is two and a bit days and last week was seven, so comparing them reports
   * the calendar as a collapse in effort — "4h less than last week" is true and useless. The two
   * stretches have to be the SAME LENGTH, so the assertion is about their lengths rather than
   * about any particular hour.
   */
  it('compares the same number of hours on both sides, mid-week', () => {
    const got = likeForLike('week', TUE, at(TUE, 10))
    expect(got).not.toBeNull()
    const now = got!.now.toMs - got!.now.fromMs
    const before = got!.before.toMs - got!.before.fromMs
    expect(now).toBe(before)
    /* Sunday 00:00 to Tuesday 10:00 is two days and ten hours */
    expect(now).toBe(2 * DAY + 10 * HOUR)
    expect(got!.part).toBe(true)
  })

  it('and the earlier stretch is the week before, starting on its own Sunday', () => {
    const got = likeForLike('week', TUE, at(TUE, 10))!
    expect(got.now.fromMs).toBe(localMidnight('2026-10-11').getTime())
    expect(got.before.fromMs).toBe(localMidnight('2026-10-04').getTime())
  })

  /** ⚠️ a window that has finished compares whole against whole, with no "so far" about it */
  it('and a window already over compares all of itself with all of the one before', () => {
    const got = likeForLike('week', '2026-09-15', at(TUE, 10))!
    expect(got.now.toMs - got.now.fromMs).toBe(7 * DAY)
    expect(got.before.toMs - got.before.fromMs).toBe(7 * DAY)
    expect(got.part).toBe(false)
  })

  /**
   * ⚠️ AND THE EARLIER RANGE CANNOT RUN PAST ITS OWN WINDOW. Without the clamp a stretch longer
   * than the window would bleed the "before" range forward into the current one, and a week would
   * be partly compared against itself — which flatters every reading by exactly the overlap.
   */
  it('and the earlier stretch never reaches into the window it is being compared with', () => {
    for (const scope of ['day', 'week', 'month', 'quarter', 'year'] as const) {
      const got = likeForLike(scope, TUE, at(TUE, 23))
      expect(got).not.toBeNull()
      expect(got!.before.toMs).toBeLessThanOrEqual(got!.now.fromMs)
      expect(got!.before.fromMs).toBeLessThan(got!.before.toMs)
    }
  })

  /**
   * ⚠️ THE CLAMP ONLY MATTERS WHERE CONSECUTIVE WINDOWS DIFFER IN LENGTH, and the first version
   * of the test above missed that: it swept a mid-October date, where every window is the same
   * size as the one before it, so removing the clamp changed nothing and the test stayed green.
   * A perturbation found it. The case that bites is the END OF A LONG MONTH after a short one —
   * 31 March has thirty-one days elapsed and February had twenty-eight, so without the clamp the
   * "before" range runs three days into MARCH and the month is partly compared against itself,
   * flattering every reading by exactly the overlap.
   */
  it('and a long month after a short one does not compare against its own first days', () => {
    const END = '2026-03-31'
    const got = likeForLike('month', END, at(END, 23))!
    /* February 2026 has 28 days, so the stretch elapsed in March is longer than February is */
    expect(got.now.toMs - got.now.fromMs).toBeGreaterThan(got.before.toMs - got.before.fromMs)
    expect(got.before.toMs).toBe(localMidnight('2026-03-01').getTime())
    expect(got.before.toMs).toBeLessThanOrEqual(got.now.fromMs)
  })

  it('and a month compares with the month before, not with thirty days before', () => {
    /* ⚠️ February is the case that tells calendar steps from day arithmetic */
    const got = likeForLike('month', '2026-03-10', at('2026-03-10', 12))!
    expect(got.now.fromMs).toBe(localMidnight('2026-03-01').getTime())
    expect(got.before.fromMs).toBe(localMidnight('2026-02-01').getTime())
  })

  it('and a lifetime goal has no window to compare', () => {
    expect(likeForLike('life', TUE, at(TUE, 10))).toBeNull()
  })

  /** ⚠️ the very first instant of a window is not "part way through" it — there is nothing yet */
  it('and the stroke of midnight compares nothing with nothing', () => {
    const got = likeForLike('day', TUE, localMidnight(TUE).getTime())!
    expect(got.now.toMs - got.now.fromMs).toBe(0)
    expect(got.before.toMs - got.before.fromMs).toBe(0)
  })
})

describe('the last thirty windows, drawn', () => {
  const daily = goal({
    id: 'g-run',
    title: '30 minutes drawing',
    scope: 'day',
    anchor: null,
    every: 1,
    target: 30,
    unit: 'min',
    activity: 'act-draw',
  })
  /** what the server would hand back for a list of windows, newest first */
  const answers = (mins: number[]) =>
    Object.fromEntries(mins.map((m, i) => [streakKey(daily.id, i), m]))

  /**
   * ⚠️ THE MARKS AND THE NUMBER HAVE TO TELL THE SAME STORY, and this is the only test that can
   * catch them drifting apart. They are computed separately from the same answers — a chip saying
   * "🔥 4" above a row whose right-hand end shows three filled marks is two readings of one fact
   * disagreeing on screen, and nobody would know which to believe.
   */
  it('ends in a run of met marks exactly as long as the streak says', () => {
    for (const mins of [
      [35, 40, 31, 50, 0, 38, 33],
      /* ⚠️ EXACTLY ON THE TARGET, because the first version of this sweep had no value equal
         to it — every fixture was comfortably over or well under 30. A mark that required
         BEATING the target while the streak only required reaching it would have drawn a gap
         under an unbroken run, and the sweep stayed green through that perturbation. The
         boundary is where the two readings can part. */
      [30, 30, 30, 29, 30],
      [29, 30, 30],
      [0, 40, 31, 50],
      [35, 35, 35, 35, 35, 35],
      [10, 10, 10],
      [],
    ]) {
      const got = answers(mins)
      const marks = marksOf(daily, got)
      const run = streakOf(daily, got)
      /* ⚠️ TWO BRANCHES, BECAUSE TODAY DOES NOT BREAK A STREAK. When today has been met it is
         a 'met' mark and counts in the run; when it has not, it is 'now' and the run is the
         met marks BEHIND it. A single tail count would be wrong every morning. */
      const end = marks.length - (marks[marks.length - 1] === 'now' ? 2 : 1)
      let tail = 0
      for (let i = end; i >= 0 && marks[i] === 'met'; i--) tail++
      expect(tail).toBe(run)
    }
  })

  /** ⚠️ oldest first, so the row reads left to right and today is the last mark */
  it('is oldest first, one mark per window, today last', () => {
    const marks = marksOf(daily, answers([35, 0, 40]))
    expect(marks).toHaveLength(STREAK_BACK + 1)
    expect(marks[marks.length - 1]).toBe('met') /* today, 35 >= 30 */
    expect(marks[marks.length - 2]).toBe('missed') /* yesterday, 0 */
    expect(marks[marks.length - 3]).toBe('met') /* the day before, 40 */
  })

  /**
   * ⚠️ TODAY UNFINISHED IS ITS OWN MARK, not a miss. At nine in the morning nothing has been done
   * yet and drawing that as a gap would make every streak look broken every day — the same rule
   * streakOf is built on, and the reason a third kind of mark exists at all.
   */
  it('and today still going is "now", never "missed"', () => {
    const marks = marksOf(daily, answers([0, 40, 31]))
    expect(marks[marks.length - 1]).toBe('now')
    /* and the streak is unbroken behind it */
    expect(streakOf(daily, answers([0, 40, 31]))).toBe(2)
  })

  it('and a day long past with nothing in it is a miss, not a "now"', () => {
    const marks = marksOf(daily, answers([35, 0]))
    expect(marks.filter((m) => m === 'now')).toHaveLength(0)
    expect(marks[marks.length - 2]).toBe('missed')
  })

  it('and a goal with nothing to draw gets no row at all', () => {
    expect(marksOf(goal({ target: null }), {})).toEqual([])
    expect(marksOf(goal({ every: null, target: 30, activity: 'a' }), {})).toEqual([])
    expect(marksOf(goal({ every: 1, target: 30 }), {})).toEqual([])
  })
})
