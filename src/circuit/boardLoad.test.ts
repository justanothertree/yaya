import { describe, expect, it } from 'vitest'
import {
  BOARD_READS,
  boardToShow,
  failedReads,
  mayCache,
  mayWrite,
  type BoardRead,
  type ReadAnswer,
} from './boardLoad'
import type { CircuitState } from './types'

/**
 * Whether a Circuit load is a board — the decisions supabaseAdapter.ts asks, here so they can be
 * asked without a client. The errors are the shapes supabase-js resolves with instead of throwing.
 */
const answered: ReadAnswer = { error: null }
const dropped: ReadAnswer = { error: { code: '', message: 'TypeError: Failed to fetch' } }
const notFound = (fn: string): ReadAnswer => ({
  error: {
    code: 'PGRST202',
    message: `Could not find the function public.${fn}(p_from, p_to) in the schema cache`,
  },
})
const answers = (over: Partial<Record<BoardRead, ReadAnswer>> = {}) =>
  Object.fromEntries(BOARD_READS.map((r) => [r, over[r] ?? answered])) as Record<
    BoardRead,
    ReadAnswer
  >

describe('which reads failed', () => {
  it('is none when every read answered', () => {
    expect(failedReads(answers())).toEqual([])
  })

  it('names every read that answered with an error', () => {
    expect(failedReads(answers({ circuit_logs: dropped, circuit_ratings: dropped }))).toEqual([
      'circuit_logs',
      'circuit_ratings',
    ])
  })

  it('counts a refusal and a timeout the same as a dropped connection', () => {
    const refused = { error: { code: '42501', message: 'permission denied for table pools' } }
    const timedOut = { error: { code: '57014', message: 'canceling statement due to timeout' } }
    expect(failedReads(answers({ pools: refused, circuit_people: timedOut }))).toEqual([
      'circuit_people',
      'pools',
    ])
  })

  it('does not count the conversion reader, which is not deployed', () => {
    expect(failedReads(answers({ circuit_manual_sums: notFound('circuit_manual_sums') }))).toEqual(
      [],
    )
  })

  it('counts the conversion reader when it is there and fails', () => {
    expect(failedReads(answers({ circuit_manual_sums: dropped }))).toEqual(['circuit_manual_sums'])
  })

  it('counts a session reader that is not found, because that one is deployed', () => {
    expect(
      failedReads(answers({ circuit_session_sums: notFound('circuit_session_sums') })),
    ).toEqual(['circuit_session_sums'])
  })
})

describe('whether a load may be kept on this device', () => {
  it('may when every read answered', () => {
    expect(mayCache([])).toBe(true)
  })

  it('may not when any read failed', () => {
    expect(mayCache(['pool_votes'])).toBe(false)
  })
})

describe('whether a write may go ahead', () => {
  const FROM_THE_BOARD = ['saveRating', 'deleteRating', 'saveLog', 'deleteLog'] as const

  it.each(FROM_THE_BOARD)('%s waits while the last load failed', (write) => {
    expect(mayWrite(write, ['pool_votes'])).toBe(false)
  })

  it.each(FROM_THE_BOARD)('%s goes ahead once a load has succeeded', (write) => {
    expect(mayWrite(write, [])).toBe(true)
  })

  it('lets through a write that carries everything it says', () => {
    expect(mayWrite('saveMovie', ['circuit_movies'])).toBe(true)
    expect(mayWrite('saveVote', ['pool_votes'])).toBe(true)
  })
})

describe('what the screen shows when a load lands', () => {
  const person = {
    id: 'p1',
    name: 'Sam',
    color: '#888',
    goal: 100,
    exercises: [],
    colLabels: [],
  }
  const onScreen: CircuitState = {
    people: [person],
    logs: [],
    movies: [],
    watchlist: [],
    groupsLoaded: true,
  }
  const blank: CircuitState = { people: [], logs: [], movies: [], watchlist: [] }

  it('keeps the board on screen when the load failed, and says so', () => {
    const shown = boardToShow(onScreen, { ...blank, loadFailed: ['circuit_people'] })
    expect(shown.people).toEqual([person])
    expect(shown.groupsLoaded).toBe(true)
    expect(shown.loadFailed).toEqual(['circuit_people'])
  })

  it('takes a board that loaded whole, and stops saying it failed', () => {
    const fresh: CircuitState = { ...blank, people: [{ ...person, name: 'Sam R' }] }
    const shown = boardToShow({ ...onScreen, loadFailed: ['circuit_people'] }, fresh)
    expect(shown).toEqual(fresh)
    expect(shown.loadFailed).toBeUndefined()
  })
})
