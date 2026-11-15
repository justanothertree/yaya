import { getSupabaseClient } from '../../finance/client'

/**
 * A Lab match by turns, as the server shows it to one of its two players — and every way to ask
 * it something. Reads and the member writes (challenge, decline, resign, claim) are RPCs that
 * answer only a player who is still friends with the other one; a game and its moves change only
 * through the `lab-move` edge function, which plays each move by the toy's own rules first.
 * docs/2026-11-14-lab-async-matches-plan.md is the design; the migration
 * 20261115002456_lab_matches_and_results is the server half.
 */
export type Seat = 0 | 1
export type MatchStatus = 'invited' | 'expired' | 'active' | 'finished' | 'declined' | 'ended'
export type MatchView = {
  id: string
  demo: string
  mode: 'versus' | 'together'
  settings: Record<string, unknown>
  seats: [{ id: string; name: string | null }, { id: string; name: string | null }]
  /** which seat the viewer is in */
  you: Seat
  status: MatchStatus
  seq: number
  turn: Seat | null
  turnSince: string | null
  canClaim: boolean
  result: { winner: Seat | 'draw'; how: 'played' | 'resigned' | 'timeout'; score?: string } | null
  rematchOf: string | null
  updatedAt: string
  /** the game as the toy's `Rules.encode` gave it; absent from a list row */
  state?: unknown
}

const STATUSES: readonly MatchStatus[] = [
  'invited',
  'expired',
  'active',
  'finished',
  'declined',
  'ended',
]
const seatOf = (x: unknown): Seat | null => (x === 0 || x === 1 ? x : null)

/** one match from the server, or null if it is not the shape the migration returns */
export function readView(x: unknown): MatchView | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const seats = o.seats as { id?: unknown; name?: unknown }[] | undefined
  const you = seatOf(o.you)
  if (
    typeof o.id !== 'string' ||
    typeof o.demo !== 'string' ||
    (o.mode !== 'versus' && o.mode !== 'together') ||
    !Array.isArray(seats) ||
    seats.length !== 2 ||
    !seats.every((s) => s && typeof s.id === 'string') ||
    you === null ||
    !STATUSES.includes(o.status as MatchStatus) ||
    typeof o.seq !== 'number'
  )
    return null
  const r = o.result as Record<string, unknown> | null
  const winner = r ? (r.winner === 'draw' ? 'draw' : seatOf(r.winner)) : null
  return {
    id: o.id,
    demo: o.demo,
    mode: o.mode,
    settings: (o.settings && typeof o.settings === 'object' ? o.settings : {}) as Record<
      string,
      unknown
    >,
    seats: seats.map((s) => ({
      id: s.id as string,
      name: typeof s.name === 'string' ? s.name : null,
    })) as MatchView['seats'],
    you,
    status: o.status as MatchStatus,
    seq: o.seq,
    turn: seatOf(o.turn),
    turnSince: typeof o.turn_since === 'string' ? o.turn_since : null,
    canClaim: o.can_claim === true,
    result:
      r && winner !== null
        ? {
            winner,
            how: r.how === 'resigned' || r.how === 'timeout' ? r.how : 'played',
            ...(typeof r.score === 'string' ? { score: r.score } : {}),
          }
        : null,
    rematchOf: typeof o.rematch_of === 'string' ? o.rematch_of : null,
    updatedAt: typeof o.updated_at === 'string' ? o.updated_at : '',
    ...('state' in o ? { state: o.state } : {}),
  }
}

/** what went wrong, in the server's own words where it gave some */
export class MatchError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

async function rpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await getSupabaseClient().rpc(name, args)
  if (error)
    throw new MatchError(
      error.code === 'P0002' ? 'There’s no match here for you.' : error.message,
      error.code === 'P0002' ? 404 : 400,
    )
  return data
}
const one = (x: unknown) => {
  const v = readView(x)
  if (!v) throw new MatchError('The match came back in a shape this page does not know.')
  return v
}

export const getMatch = async (id: string) => one(await rpc('lab_match_get', { p_match: id }))
export const listMatches = async () => {
  const rows = await rpc('lab_match_list')
  return (Array.isArray(rows) ? rows : []).map(readView).filter((v): v is MatchView => v !== null)
}
export const declineMatch = async (id: string) =>
  one(await rpc('lab_match_decline', { p_match: id }))
export const resignMatch = async (id: string) => one(await rpc('lab_match_resign', { p_match: id }))
export const claimMatch = async (id: string) => one(await rpc('lab_match_claim', { p_match: id }))
export const challenge = async (
  friend: string,
  demo: string,
  mode: 'versus' | 'together',
  settings: Record<string, unknown>,
  rematchOf: string | null = null,
) =>
  one(
    await rpc('lab_match_challenge', {
      p_friend: friend,
      p_demo: demo,
      p_mode: mode,
      p_settings: settings,
      p_rematch_of: rematchOf,
    }),
  )

/**
 * ⚠️ THE EDGE FUNCTION'S REFUSALS ARRIVE AS A RESPONSE, NOT AS A MESSAGE. supabase-js turns any
 * non-2xx from a function into a FunctionsHttpError whose own message is a generic "Edge Function
 * returned a non-2xx status code"; the sentence the function wrote ("it is not your turn") is in
 * the response body, on `context`. Read it, or every refusal says the same useless thing.
 */
async function move(body: Record<string, unknown>): Promise<MatchView> {
  const { data, error } = await getSupabaseClient().functions.invoke('lab-move', { body })
  if (error) {
    const ctx = (error as { context?: unknown }).context
    if (ctx instanceof Response) {
      let said = ''
      try {
        said = ((await ctx.json()) as { error?: string }).error ?? ''
      } catch {
        /* not json: say what we can below */
      }
      throw new MatchError(said || `The move was refused (${ctx.status}).`, ctx.status)
    }
    throw new MatchError('The move could not be sent. Check your connection and try again.')
  }
  return one(data)
}
export const acceptMatch = (id: string) => move({ op: 'accept', match: id })
export const sendMove = (id: string, at: number, m: unknown) =>
  move({ op: 'move', match: id, at, move: m })

/** your friends, by id, for a challenge: accepted friendships only */
export async function challengeableFriends(): Promise<{ id: string; name: string }[]> {
  const rows = await rpc('list_member_directory')
  return (Array.isArray(rows) ? rows : [])
    .filter(
      (r: { user_id?: unknown; is_friend?: unknown }) =>
        r.is_friend === true && typeof r.user_id === 'string',
    )
    .map((r: { user_id: string; name?: unknown; username?: unknown }) => ({
      id: r.user_id,
      name:
        typeof r.name === 'string' && r.name.trim()
          ? r.name
          : typeof r.username === 'string'
            ? r.username
            : 'A friend',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
