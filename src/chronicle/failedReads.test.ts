import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Two Chronicle reads that something is then WRITTEN from, and what they must do when they fail.
 *
 * supabase-js does not throw on failure: a dropped connection, a 5xx, a timeout all come back as
 * `{ data: null, error }`. The 27 Nov 2026 audit (docs/2026-11-27-supabase-failure-audit.md) found
 * both of these reading that as an answer:
 *
 * - `chronicle_goal_marks_for` failing read as "no marks", so a repeating goal showed 0 and its
 *   − or + wrote 0 ± 1 over the window's real count.
 * - `chronicle_sets_between` failing read as "no sets", so Save sent the plain editor rather than
 *   the day editor, and a sitting moved across midnight left its sets on the old day.
 *
 * The client here is a stand-in that answers each call as the test says. The question is what the
 * room does with an answer, not what the server would have said: supabase/tests/ asks that.
 */
type Answer = { data: unknown; error: unknown }
const FAILED: Answer = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } }
let answer: (name: string, args: Record<string, unknown>) => Answer = () => FAILED
const asked: string[] = []
const fake = {
  rpc(name: string, args: Record<string, unknown>) {
    asked.push(name)
    return Promise.resolve(answer(name, args))
  },
}
vi.mock('../finance/client', () => ({ getSupabaseClient: () => fake }))

const { marksFor, setsBetween } = await import('./cloud')
const { asOf, bumpTo, markAsks, tickTo } = await import('./marks')
const { savePath, setsOf } = await import('./sets')
const { today, windowKey } = await import('./goal')
type Goal = import('./goal').Goal

beforeEach(() => {
  asked.length = 0
  answer = () => FAILED
})

/**
 * Every field away from its default — above all the ROW's own `progress` and `done`, which a
 * repeating goal must never be moved from, so a rule that fell back to them would show.
 */
const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'floss',
  title: 'Floss',
  scope: 'day',
  anchor: null,
  every: 1,
  target: 30,
  unit: 'minutes',
  shared: true,
  visibility: 'friends',
  progress: 17,
  done: true,
  note: 'why',
  sort: 3,
  activity: null,
  cat: null,
  counts: 'minutes',
  est: 5,
  priority: 1,
  ...over,
})

describe('the marks of a repeating goal, when the read fails', () => {
  const day = today()
  const floss = goal()
  /** the room's own two steps: read the marks, then the goal as it stands in today's window */
  const readAndShow = async () => {
    const read = await marksFor(markAsks([floss], [day]))
    return { read, shown: asOf(floss, read?.marks ?? {}, day, read?.legacy) }
  }

  it('is not the answer "no marks"', async () => {
    expect(await marksFor(markAsks([floss], [day]))).toBeNull()
    expect(asked).toEqual(['chronicle_goal_marks_for'])
  })

  it('is not half an answer when only a later batch fails', async () => {
    /* 1,201 asks are two batches; the first is answered, the second is not */
    const asks = Array.from({ length: 1201 }, (_, i) => ({ id: `g${i}`, from: day }))
    let calls = 0
    answer = () =>
      ++calls === 1
        ? { data: { marks: { [windowKey('g0', day)]: { progress: 5, done: true } } }, error: null }
        : FAILED
    expect(await marksFor(asks)).toBeNull()
    expect(calls).toBe(2)
  })

  it('is not believed when it answers something that is not marks', async () => {
    answer = () => ({ data: null, error: null })
    expect(await marksFor(markAsks([floss], [day]))).toBeNull()
  })

  it('leaves − with nothing to write over the count it could not read', async () => {
    const { read, shown } = await readAndShow()
    expect(bumpTo(shown, day, -1, read !== null)).toBeNull()
  })

  it('leaves + with nothing to write either', async () => {
    const { read, shown } = await readAndShow()
    expect(bumpTo(shown, day, 1, read !== null)).toBeNull()
  })

  it('leaves the tick with nothing to write', async () => {
    const { read, shown } = await readAndShow()
    expect(tickTo(shown, day, read !== null)).toBeNull()
  })
})

describe('the marks of a repeating goal, when the read works', () => {
  const day = today()
  const floss = goal()

  it('can honestly be none, which is an untouched window', async () => {
    answer = () => ({ data: { marks: {}, legacy: {} }, error: null })
    const read = await marksFor(markAsks([floss], [day]))
    expect(read).toEqual({ marks: {}, legacy: {} })
    expect(asOf(floss, read!.marks, day, read!.legacy)).toMatchObject({ progress: 0, done: false })
  })

  it("moves the window's own count, not the row's", async () => {
    answer = () => ({
      data: { marks: { [windowKey('floss', day)]: { progress: 5, done: false } }, legacy: {} },
      error: null,
    })
    const read = await marksFor(markAsks([floss], [day]))
    const shown = asOf(floss, read!.marks, day, read!.legacy)
    expect([bumpTo(shown, day, 1, true), bumpTo(shown, day, -1, true)]).toMatchObject([
      { at: { from: day }, progress: 6, done: null },
      { at: { from: day }, progress: 4, done: null },
    ])
    expect(tickTo(shown, day, true)).toMatchObject({
      at: { from: day },
      progress: null,
      done: true,
    })
  })
})

describe('a goal that does not repeat', () => {
  it('is moved through its row, which the marks read never held, so it does not wait on it', () => {
    const day = today()
    const once = goal({ id: 'once', every: null, anchor: day, done: false })
    expect([bumpTo(once, day, 1, false), tickTo(once, day, false)]).toEqual([
      { at: null, progress: 18, done: false },
      { at: null, progress: 17, done: true },
    ])
  })
})

/** One set as chronicle_sets_between answers it, every field filled. */
const row = (id: string, entry: string) => ({
  id,
  entry,
  person: 'p1',
  exercise: 'ex-bench',
  name: 'Bench',
  now: 'Bench press',
  on: '2026-11-26',
  value: 12,
  counted: true,
})

describe("a sitting's sets, when the read fails", () => {
  it('are not the answer "no sets"', async () => {
    expect(await setsBetween('2026-11-26', '2026-11-27')).toBeNull()
    expect(asked).toEqual(['chronicle_sets_between'])
  })

  it('are not believed when the answer is not a list', async () => {
    answer = () => ({ data: { not: 'a list' }, error: null })
    expect(await setsBetween('2026-11-26', '2026-11-27')).toBeNull()
  })

  it('leave Save with no call to make, rather than the one for a sitting with none', async () => {
    const got = await setsBetween('2026-11-26', '2026-11-27')
    expect(savePath(setsOf(got, 'e1'))).toBeNull()
  })
})

describe("a sitting's sets, when the read works", () => {
  it('send a sitting that has some through the day editor, which moves them with it', async () => {
    answer = () => ({ data: [row('s1', 'e1'), row('s2', 'e2')], error: null })
    const got = await setsBetween('2026-11-26', '2026-11-27')
    expect(savePath(setsOf(got, 'e1'))).toBe('day')
  })

  it('send a sitting that has none through the plain editor', async () => {
    answer = () => ({ data: [row('s2', 'e2')], error: null })
    const other = await setsBetween('2026-11-26', '2026-11-27')
    answer = () => ({ data: [], error: null })
    const none = await setsBetween('2026-11-26', '2026-11-27')
    expect([savePath(setsOf(other, 'e1')), savePath(setsOf(none, 'e1'))]).toEqual([
      'plain',
      'plain',
    ])
  })
})
