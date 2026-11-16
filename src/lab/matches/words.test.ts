import { describe, expect, it } from 'vitest'
import { hashParam } from '../links'
import { readView, type MatchView } from './cloud'
import { ago, matchHash, matchLine, noticeText, resultWords, rowWords, waitsOnYou } from './words'

/**
 * A row exactly as `lab_match_json` returns it (the 15 Nov migration), every field something
 * other than its default, so a field the reader drops shows up as a failure rather than as a
 * default that happened to match.
 */
const ROW = {
  id: '6f7e3c2a-1b4d-4c8e-9a10-2b3c4d5e6f70',
  demo: 'chess',
  mode: 'together',
  settings: { level: 'hard' },
  seats: [
    { id: '00000000-0000-4000-a000-0000000000aa', name: 'Ann' },
    { id: '00000000-0000-4000-a000-0000000000bb', name: 'Bo' },
  ],
  you: 1,
  status: 'finished',
  seq: 37,
  turn: 0,
  turn_since: '2026-11-14T10:00:00Z',
  can_claim: true,
  result: { winner: 1, how: 'resigned', score: '12–40' },
  rematch_of: '11111111-2222-4333-8444-555555555555',
  updated_at: '2026-11-15T01:02:03Z',
  state: { moves: ['e2e4'] },
}
const view = (over: Partial<MatchView> = {}): MatchView => ({ ...readView(ROW)!, ...over })

describe('reading a match from the server', () => {
  it('keeps every field', () => {
    expect(readView(ROW)).toEqual({
      id: ROW.id,
      demo: 'chess',
      mode: 'together',
      settings: { level: 'hard' },
      seats: ROW.seats,
      you: 1,
      status: 'finished',
      seq: 37,
      turn: 0,
      turnSince: '2026-11-14T10:00:00Z',
      canClaim: true,
      result: { winner: 1, how: 'resigned', score: '12–40' },
      rematchOf: ROW.rematch_of,
      updatedAt: '2026-11-15T01:02:03Z',
      state: { moves: ['e2e4'] },
    })
  })

  it('refuses a row that is not a match, rather than guessing', () => {
    for (const bad of [
      null,
      'match',
      { ...ROW, id: 7 },
      { ...ROW, mode: 'race' },
      { ...ROW, you: 2 },
      { ...ROW, status: 'paused' },
      { ...ROW, seats: [ROW.seats[0]] },
      { ...ROW, seats: [{ name: 'Ann' }, ROW.seats[1]] },
      { ...ROW, seq: '37' },
    ])
      expect(readView(bad)).toBeNull()
  })

  it('reads a list row without a game as a match without a game', () => {
    const row: Record<string, unknown> = { ...ROW }
    delete row.state
    expect(readView(row)).not.toHaveProperty('state')
  })
})

describe('the match’s own address', () => {
  it('names the toy and the match, and reads back', () => {
    const h = matchHash('reversi', ROW.id)
    expect(hashParam('demo', h)).toBe('reversi')
    expect(hashParam('match', h)).toBe(ROW.id)
  })
})

describe('what waits on you', () => {
  it('is your move, or a challenge to you, and nothing else', () => {
    expect(waitsOnYou(view({ status: 'active', turn: 1 }))).toBe(true)
    expect(waitsOnYou(view({ status: 'active', turn: 0 }))).toBe(false)
    expect(waitsOnYou(view({ status: 'invited', you: 1 }))).toBe(true)
    expect(waitsOnYou(view({ status: 'invited', you: 0 }))).toBe(false)
    for (const status of ['finished', 'declined', 'expired', 'ended'] as const)
      expect(waitsOnYou(view({ status, turn: 1 }))).toBe(false)
  })

  it('is what the bell says, and only that', () => {
    expect(noticeText(view({ status: 'active', turn: 1, mode: 'versus' }))).toBe(
      'Your move in Chess with Ann',
    )
    expect(noticeText(view({ status: 'invited', you: 1 }))).toBe('Ann challenged you to Chess')
    expect(noticeText(view({ status: 'active', turn: 0 }))).toBeNull()
    expect(noticeText(view({ status: 'finished' }))).toBeNull()
  })
})

describe('the status line', () => {
  const versus = (over: Partial<MatchView>) => view({ mode: 'versus', canClaim: false, ...over })
  it('says whose move it is, and that a chosen move still has to be sent', () => {
    expect(matchLine(versus({ status: 'active', turn: 1 }))).toBe('Your move.')
    expect(matchLine(versus({ status: 'active', turn: 1 }), true)).toMatch(/^Send your move/)
    expect(matchLine(versus({ status: 'active', turn: 0, turnSince: null }))).toBe('Ann’s move.')
    expect(matchLine(view({ status: 'active', turn: 1, canClaim: false }))).toBe(
      'Your turn to move for the two of you.',
    )
  })
  it('offers the claim only when the server says it may be made', () => {
    expect(matchLine(versus({ status: 'active', turn: 0, canClaim: true }))).toMatch(
      /hasn’t moved in 7 days/,
    )
  })
  it('says who challenged whom', () => {
    expect(matchLine(versus({ status: 'invited', you: 1 }))).toBe('Ann challenged you to Chess.')
    expect(matchLine(view({ status: 'invited', you: 1 }))).toBe(
      'Ann challenged you to Chess, the two of you against the computer.',
    )
    expect(matchLine(versus({ status: 'invited', you: 0 }))).toBe(
      'Waiting for Bo to accept your challenge.',
    )
  })
  it('names the result from your side of the board', () => {
    const fin = (result: MatchView['result'], over: Partial<MatchView> = {}) =>
      resultWords(versus({ status: 'finished', result, ...over }))
    expect(fin({ winner: 1, how: 'played', score: '40–24' })).toBe('🏆 You win, 40–24!')
    expect(fin({ winner: 0, how: 'played' })).toBe('Ann wins.')
    expect(fin({ winner: 'draw', how: 'played', score: '32–32' })).toBe('A draw, 32–32.')
    expect(fin({ winner: 0, how: 'resigned' })).toBe('You resigned. Ann wins.')
    expect(fin({ winner: 1, how: 'resigned' })).toBe('🏆 Ann resigned. You win.')
    expect(fin({ winner: 1, how: 'timeout' })).toMatch(/^🏆 You claimed the win/)
    expect(resultWords(view({ status: 'finished', result: { winner: 0, how: 'played' } }))).toBe(
      '🏆 You and Ann beat the computer.',
    )
    expect(resultWords(view({ status: 'finished', result: { winner: 1, how: 'resigned' } }))).toBe(
      'Resigned. The computer wins.',
    )
  })
})

describe('a row in Your games', () => {
  it('is urgent exactly when the match waits on you', () => {
    expect(rowWords(view({ status: 'active', turn: 1 })).urgent).toBe(true)
    expect(rowWords(view({ status: 'active', turn: 0 })).urgent).toBe(false)
    expect(rowWords(view({ status: 'active', turn: 0 })).title).toBe('Chess with Ann')
  })
})

describe('how long ago', () => {
  const now = Date.parse('2026-11-15T12:00:00Z')
  it('reads like a list, not like a clock', () => {
    expect(ago('2026-11-15T11:59:40Z', now)).toBe('just now')
    expect(ago('2026-11-15T11:15:00Z', now)).toBe('45 min')
    expect(ago('2026-11-15T07:00:00Z', now)).toBe('5 h')
    expect(ago(null, now)).toBe('')
    expect(ago('not a date', now)).toBe('')
  })
})
