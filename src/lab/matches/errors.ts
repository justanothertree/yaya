/**
 * What went wrong with a match call, in words for the player, and why: a status the page can act
 * on (404 gone, 401 signed out, 409 the board moved on).
 */
export class MatchError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

export const SIGN_IN_TO_SEE =
  'Sign in to open this match. Only its two players can see it, and it is in Your games once you are in.'

/**
 * A match RPC's error as the player should read it.
 *
 * ⚠️ 42501 IS TWO DIFFERENT THINGS, so it is told apart by its words, not its code. The match SQL
 * raises it on purpose with a sentence written for the player ("not yours to do", "no longer
 * friends"), which is passed on as it is. Postgres raises it too, as "permission denied for
 * function lab_match_get", when the caller has no right to call the function at all: a visitor
 * who is not signed in, since every match function is revoked from anon. That one is not a
 * sentence anybody should be shown, and signing in is what fixes it.
 */
export function matchErrorOf(e: { code?: string; message?: string }): MatchError {
  const message = e.message ?? ''
  if (e.code === 'P0002') return new MatchError('There’s no match here for you.', 404)
  if (
    e.code === '28000' ||
    (e.code === '42501' && /^permission denied for /.test(message)) ||
    // PostgREST's own: a session that has run out or will not verify (PGRST301, PGRST302, …)
    /^PGRST30\d$/.test(e.code ?? '')
  )
    return new MatchError(SIGN_IN_TO_SEE, 401)
  return new MatchError(message || 'That did not work.', 400)
}
