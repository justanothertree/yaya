/**
 * Whether a Circuit load is a board — the questions supabaseAdapter.ts has to ask of every load, put
 * where a test can ask them without a client.
 *
 * ⚠️ IT USED TO ASK NONE OF THEM. supabase-js does not throw on a failure: a dropped connection, a
 * 5xx, an RLS refusal and a timeout all resolve `{ data: null, error }`, and every read here became
 * `data ?? []`. So one table that did not answer was a board with nothing in it, and the 27 Nov 2026
 * audit (docs/2026-11-27-supabase-failure-audit.md) found what that cost:
 *   - it was CACHED over the good board, so the next visit painted the blank too;
 *   - ratings that failed to load opened a blank editor, and saving it erased the review and icons —
 *     pressing Save without touching anything deleted the rating;
 *   - days that failed to load were typed over, the row's other cells and its picture lost;
 *   - sessions that failed to load let a day holding Chronicle's sessions be deleted, because the
 *     guard in deleteLog asks the loaded board what sessions a day has.
 *
 * So a load where any read failed is not a board. It is not shown (the board on screen stays, with
 * "Couldn't load the board. Retry" over it), it is not cached, and the writes that are made FROM the
 * loaded rows wait until a load has succeeded.
 */
import type { CircuitAdapter } from './adapter'
import type { CircuitState } from './types'

/** Every read one load makes, by the table or function it asks. */
export const BOARD_READS = [
  'circuit_people',
  'circuit_logs',
  'circuit_movies',
  'circuit_watchlist',
  'circuit_person_groups',
  'circuit_groups',
  'pools',
  'pool_votes',
  'circuit_ratings',
  'circuit_session_sums',
  'circuit_manual_sums',
] as const
export type BoardRead = (typeof BOARD_READS)[number]

/** The part of a supabase-js answer that says whether it worked. */
export type ReadAnswer = { error: { code?: string; message?: string } | null }

export type CircuitWrite = Exclude<keyof CircuitAdapter, 'load' | 'reload' | 'subscribe'>

/** PostgREST's "no such function" (PGRST202), and Postgres's own (42883). */
const isMissingFunction = (e: NonNullable<ReadAnswer['error']>) =>
  /^(PGRST202|42883)$/.test(e.code ?? '') || /could not find the function/i.test(e.message ?? '')

/**
 * The reads that failed, in the order they are made. None means the load is a board.
 *
 * ⚠️ ONE EXCEPTION, AND IT IS DELIBERATE: `circuit_manual_sums` NOT BEING THERE. That reader belongs
 * to the conversion, which is a draft (docs/2026-11-09-circuit-logs-conversion.DRAFT.sql) and in no
 * applied migration, and Evan's answer to OPEN-DECISIONS §20d is that there is no cutover. So on
 * production every call is a function-not-found, and "nobody is converted" is the true answer to it.
 * Only that refusal is excused: the same reader failing for any other reason — the day it is
 * deployed and a connection drops — is a failure like any other, because it would read converted
 * people's cells from their pre-conversion rows.
 *
 * ⚠️ AND NOT `circuit_session_sums`, which this file's tests once excused the same way. That was a
 * server without the grid, and production has not been one since
 * 20261110025332_circuit_grid_sessions was applied. A session reader that is not found now is
 * something wrong, and "no sessions" is the answer that let a day holding them be deleted.
 */
export function failedReads(answers: Record<BoardRead, ReadAnswer>): BoardRead[] {
  return BOARD_READS.filter((read) => {
    const e = answers[read].error
    if (!e) return false
    return !(read === 'circuit_manual_sums' && isMissingFunction(e))
  })
}

/**
 * Whether a load may be kept on this device, to be painted first next visit. Only a whole one: a
 * table that did not answer is not a table with nothing in it, and keeping it would paint the blank
 * on every visit until a load happened to succeed.
 */
export function mayCache(failed: readonly BoardRead[]): boolean {
  return failed.length === 0
}

/**
 * The writes made FROM the loaded rows. A rating's editor opens on the rating the board holds and
 * Save writes the whole of it back (and deletes it, when it looks empty); a day's save is that day's
 * cells as the board has them, and both it and a delete ask the board what sessions are under them.
 * Made from a board that did not load, each of those is a write from an answer nobody got.
 *
 * Not here: the writes that carry everything they say — a new film, a vote (idempotent), a pool, a
 * pool option, a person's row.
 */
const FROM_THE_BOARD: ReadonlySet<CircuitWrite> = new Set([
  'saveRating',
  'deleteRating',
  'saveLog',
  'deleteLog',
])

/**
 * Whether a write may go ahead, given the reads the last load could not get.
 *
 * ⚠️ ANY failed read holds every one of them, not only the table it came from. A load that failed is
 * not shown at all, so everything on screen is the board from before it — the ratings as much as the
 * table that failed — and a load that failed is the one moment we know the board on screen is not
 * what the server has.
 */
export function mayWrite(write: CircuitWrite, failed: readonly BoardRead[]): boolean {
  return failed.length === 0 || !FROM_THE_BOARD.has(write)
}

/**
 * The board to show when a load lands on the one on screen. A load that failed changes nothing but
 * the mark that it failed; one that loaded whole replaces the board, and the mark goes with it.
 *
 * ⚠️ THE BOARD ON SCREEN, NOT THE ONE THE ADAPTER LAST LOADED. They differ by every write made since,
 * and putting the older one back would take somebody's own confirmed edits off the screen at the
 * moment it is telling them the board did not load.
 */
export function boardToShow(onScreen: CircuitState, incoming: CircuitState): CircuitState {
  return incoming.loadFailed?.length ? { ...onScreen, loadFailed: incoming.loadFailed } : incoming
}

/** A write refused because the last load failed — the store says so in its own words. */
export class BoardNotLoaded extends Error {
  constructor() {
    super('the board did not load')
    this.name = 'BoardNotLoaded'
  }
}
