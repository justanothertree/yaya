import { describe, expect, it } from 'vitest'
import { MatchError, SIGN_IN_TO_SEE, matchErrorOf } from './errors'

describe('a match call’s error, as the player reads it', () => {
  it('turns Postgres’s own "permission denied", which a signed-out visitor gets, into how to get in', () => {
    // what production answered a signed-out match link with, word for word
    const e = matchErrorOf({
      code: '42501',
      message: 'permission denied for function lab_match_get',
    })
    expect(e).toBeInstanceOf(MatchError)
    expect(e.status).toBe(401)
    expect(e.message).toBe(SIGN_IN_TO_SEE)
    expect(e.message).not.toMatch(/permission denied|lab_match/)
    // the match SQL's own "sign in first"
    expect(matchErrorOf({ code: '28000', message: 'sign in first' }).status).toBe(401)
    // a session that ran out: PostgREST refuses the token before any function is asked
    expect(matchErrorOf({ code: 'PGRST301', message: 'JWT expired' }).message).toBe(SIGN_IN_TO_SEE)
  })

  it('passes the match SQL’s own 42501 sentences on as they are: those are written for the player', () => {
    for (const message of ['that match is not yours to do', 'you are no longer friends'])
      expect(matchErrorOf({ code: '42501', message })).toMatchObject({ message, status: 400 })
  })

  it('says a missing match plainly, and anything else in the server’s words', () => {
    expect(matchErrorOf({ code: 'P0002', message: 'no such match' })).toMatchObject({
      message: 'There’s no match here for you.',
      status: 404,
    })
    expect(
      matchErrorOf({ code: '22023', message: 'that invitation is no longer open' }).message,
    ).toBe('that invitation is no longer open')
    expect(matchErrorOf({}).message).toBe('That did not work.')
  })
})
