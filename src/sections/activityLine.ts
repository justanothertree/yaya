/**
 * One line of somebody's activity feed, in words.
 *
 * ⚠️ IT LIVES HERE RATHER THAN IN ProfileBlocks.tsx FOR TWO REASONS, AND THE SECOND IS THE
 * REPOSITORY'S OWN. A sentence with four shapes is a thing to ask a question of — `npm run test`
 * is for anything carrying a unit or an invariant, and the invariant here is that every kind of
 * event gets a sentence written for it. And Profile.tsx already carries a note saying a plain
 * constant cannot be exported from ProfileBlocks.tsx without breaking Fast Refresh, because the
 * file's other exports are components. So "just export it" was never available; a module of its
 * own was the only shape that is both testable and not a regression for whoever edits that file.
 */

export type ActivityItem = {
  kind: 'circuit_log' | 'rating' | 'snake_score' | 'snake_trophy'
  at: string
  /** for a circuit log this is the circuits you SHARE, and null when you share none */
  detail: string | null
  score: number | null
  /** circuit logs only: what was actually done, resolved against their own exercise list */
  items?: Array<{ name: string; unit: string | null; val: number; points: number }> | null
}

/** 2.5 -> "2.5", 40 -> "40" — a rep count should not read as 40.0 */
const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))

export function activityLine(a: ActivityItem): string {
  const when = new Date(a.at).toLocaleDateString()
  if (a.kind === 'circuit_log') {
    /**
     * "Logged a workout in The Crew" is the fact that activity happened, not the activity. The
     * circuit feed says what was done, and so does this now.
     *
     * `detail` is the circuits you SHARE with them and is null when you share none — the person
     * decides who sees their activity, but a group's NAME involves people other than them, so
     * you get the what without the where.
     */
    const did = (a.items ?? [])
      .map((it) => `${num(it.val)}${it.unit ? ' ' + it.unit : ''} ${it.name}`)
      .join(', ')
    const pts = a.score ? ` · ${a.score} pts` : ''
    const where = a.detail ? ` · ${a.detail}` : ''
    return (did || 'Logged a workout') + pts + where + ' · ' + when
  }
  /**
   * ⚠️ A SCORE OUT OF 100 IS NOT CALLED A SCORE HERE. "Rated Mistfall Hunter 94" reads as the
   * rating it is; "Scored 94" reads like the snake line below, which is a different thing
   * measured a different way — and reading like it is exactly what went wrong.
   *
   * ⚠️ AND `rating`, NOT `review`, BECAUSE A SECOND NAME FOR ONE EVENT IS HOW TWO CATALOGUES
   * DRIFT APART. It shipped as `review` for about an hour; `chronicle_moments` already called the
   * same event `rating`, and the app's own vocabulary agrees with it everywhere else
   * (`circuit_ratings`, MovieRate, "Rate it"). `review` is the prose column on that table, which
   * is a different thing again.
   *
   * ⚠️ `detail` IS NOT ALWAYS A FILM. The table is called `circuit_movies` and holds places too —
   * "Southport grocery & cafe" is in there with a score of its own. So the verb stays "Rated"
   * rather than anything that assumes a screen, and the title is quoted as given.
   */
  if (a.kind === 'rating')
    return (
      'Rated ' + (a.detail ?? 'something') + (a.score != null ? ' ' + a.score : '') + ' · ' + when
    )
  if (a.kind === 'snake_trophy')
    return 'Won ' + a.detail + ' in Snake (score ' + a.score + ') · ' + when
  if (a.kind === 'snake_score')
    return 'Scored ' + a.score + (a.detail ? ' · ' + a.detail : '') + ' · ' + when
  /**
   * ⚠️ NOT A DEFAULT BRANCH — AND THAT IS THE ACTUAL REPAIR.
   *
   * The snake-score line used to sit here with no `kind` test in front of it, so when `rating`
   * joined the union a film rendered as "Scored 94 · Mistfall Hunter": a sentence about the wrong
   * thing, which nothing threw about and nothing on screen gave away. A fallthrough cannot be
   * made loud, and a bug that cannot be made loud gets made again.
   *
   * `a.kind` is `never` by the time it reaches here, so assigning it to a `never` is a no-op
   * today and a TYPE ERROR the moment a kind is added without a sentence of its own. Verified by
   * perturbation: with the `rating` branch above removed, `npm run typecheck` fails on this line.
   */
  const noSentenceWritten: never = a.kind
  return String(noSentenceWritten)
}
