/**
 * Claiming a Circuit person is a REQUEST that an admin answers (OPEN-DECISIONS §19e).
 *
 * Until docs/2026-11-22-circuit-claims-need-approval.DRAFT.sql, pressing "This is me" put your
 * account on that person's board at once, which handed every day logged on it to whoever pressed
 * first. Now the three ways in (This is me, Add me with a matching name, joining with a code when
 * your first name matches) write a request and change nothing, and only an admin's approval sets
 * the owner. This module is what the screens need to say so, kept free of React so it can be
 * asked a question without a browser.
 */
import type { Person } from './types'

export type ClaimStatus = 'pending' | 'approved' | 'declined' | 'withdrawn'
export type ClaimVia = 'asked' | 'added' | 'joined'

/** One of the caller's own requests, from `my_person_claims`. */
export interface MyClaim {
  id: string
  personId: string
  personName: string
  status: ClaimStatus
  requestedAt: string
}

/** A request waiting on the admin, from `admin_list_person_claims`. */
export interface WaitingClaim {
  id: string
  personId: string
  personName: string
  username: string | null
  firstName: string | null
  via: ClaimVia
  requestedAt: string
  /** days logged on the person, which is what approving hands over */
  logs: number
  /** circuits the person and the asker are both in now */
  circuits: string[]
  /** the asker put the person into one of those circuits themselves */
  addedByThem: boolean
}

const STATUSES: ClaimStatus[] = ['pending', 'approved', 'declined', 'withdrawn']
const VIAS: ClaimVia[] = ['asked', 'added', 'joined']

type Row = Record<string, unknown>
const rows = (data: unknown): Row[] =>
  Array.isArray(data) ? data.filter((r): r is Row => !!r && typeof r === 'object') : []
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** A status or door this bundle does not know is dropped rather than guessed at. */
export function readMyClaims(data: unknown): MyClaim[] {
  return rows(data).flatMap((r) => {
    const status = r.status as ClaimStatus
    const id = text(r.id)
    const personId = text(r.person_id)
    if (!id || !personId || !STATUSES.includes(status)) return []
    return [
      {
        id,
        personId,
        personName: text(r.person_name) ?? '',
        status,
        requestedAt: text(r.requested_at) ?? '',
      },
    ]
  })
}

export function readWaitingClaims(data: unknown): WaitingClaim[] {
  return rows(data).flatMap((r) => {
    const via = r.via as ClaimVia
    const id = text(r.id)
    const personId = text(r.person_id)
    if (!id || !personId || !VIAS.includes(via)) return []
    return [
      {
        id,
        personId,
        personName: text(r.person_name) ?? '',
        username: text(r.username),
        firstName: text(r.first_name),
        via,
        requestedAt: text(r.requested_at) ?? '',
        logs: typeof r.logs === 'number' ? r.logs : 0,
        circuits: Array.isArray(r.circuits) ? r.circuits.filter((c) => typeof c === 'string') : [],
        addedByThem: r.added_by_them === true,
      },
    ]
  })
}

/**
 * What the claim list shows against an unclaimed person, from the caller's own requests.
 *
 * 'refused' is final: the server will not take a second request for the same person from the same
 * account. A withdrawn request reads as none, because asking again is allowed.
 */
export function claimState(personId: string, mine: MyClaim[]): 'none' | 'waiting' | 'refused' {
  const own = mine.filter((c) => c.personId === personId)
  if (own.some((c) => c.status === 'pending')) return 'waiting'
  if (own.some((c) => c.status === 'declined')) return 'refused'
  return 'none'
}

/**
 * The request the caller is waiting on in this circuit, if any.
 *
 * Offering "Add me" beside it would make a blank second board, and when the admin approved the
 * request the caller would own two boards in one circuit. The server already declines to make
 * one in that case; this is the screen not offering it.
 */
export function waitingIn(groupId: string, people: Person[], mine: MyClaim[]): MyClaim | null {
  return (
    mine.find(
      (c) =>
        c.status === 'pending' &&
        people.some((p) => p.id === c.personId && (p.groupIds ?? []).includes(groupId)),
    ) ?? null
  )
}

/**
 * What to say after "Add me". The server answers with a person's id either way: the caller's own
 * board (reused or new), or an unclaimed person of the typed name, which it has now ASKED for.
 */
export function addMeToast(returnedId: unknown, people: Person[]): string {
  const asked = people.find((p) => p.id === returnedId && !p.ownerUserId)
  return asked ? `Asked to be ${asked.name}. An admin will confirm it` : 'Added you to the circuit'
}

/** The door a request came through, in the words the admin reads. */
export const VIA_LABEL: Record<ClaimVia, string> = {
  asked: 'pressed This is me',
  added: 'typed this name into Add me',
  joined: 'joined with a code, and their first name matches',
}
