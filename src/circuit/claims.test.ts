import { describe, expect, it } from 'vitest'
import {
  addMeToast,
  claimState,
  readMyClaims,
  readWaitingClaims,
  waitingIn,
  type MyClaim,
} from './claims'
import type { Person } from './types'

const person = (id: string, name: string, owner: string | null, groupIds: string[]): Person => ({
  id,
  name,
  color: '#888',
  goal: 100,
  exercises: [],
  colLabels: [],
  ownerUserId: owner,
  groupIds,
})

const claim = (
  personId: string,
  status: MyClaim['status'],
  id = `c-${personId}-${status}`,
): MyClaim => ({
  id,
  personId,
  personName: personId,
  status,
  requestedAt: '2026-11-22T12:00:00Z',
})

describe('claimState', () => {
  it('waits on a pending request, and a refusal is final', () => {
    expect(claimState('p', [claim('p', 'pending')])).toBe('waiting')
    expect(claimState('p', [claim('p', 'declined')])).toBe('refused')
    expect(claimState('p', [])).toBe('none')
  })

  it('reads a withdrawn request as none, and a later one over it', () => {
    expect(claimState('p', [claim('p', 'withdrawn')])).toBe('none')
    expect(claimState('p', [claim('p', 'withdrawn'), claim('p', 'pending')])).toBe('waiting')
  })

  it('is about the person asked, not any request of the caller', () => {
    expect(claimState('p', [claim('q', 'pending'), claim('r', 'declined')])).toBe('none')
  })
})

describe('waitingIn', () => {
  const people = [
    person('linda', 'Linda', null, ['g1']),
    person('gran', 'Gran', null, ['g2']),
    person('mine', 'Me', 'u1', ['g1']),
  ]

  it('finds the pending request for a person in that circuit', () => {
    expect(waitingIn('g1', people, [claim('linda', 'pending')])?.personId).toBe('linda')
  })

  it('ignores a request for a person in another circuit, and one no longer pending', () => {
    expect(waitingIn('g1', people, [claim('gran', 'pending')])).toBeNull()
    expect(
      waitingIn('g1', people, [claim('linda', 'declined'), claim('linda', 'withdrawn')]),
    ).toBeNull()
  })
})

describe('addMeToast', () => {
  const people = [person('linda', 'Linda', null, ['g1']), person('mine', 'Me', 'u1', ['g1'])]

  it('says an unclaimed person was asked for, not added', () => {
    expect(addMeToast('linda', people)).toBe('Asked to be Linda. An admin will confirm it')
  })

  it('says added for the caller’s own board, and for a new one the list has not loaded yet', () => {
    expect(addMeToast('mine', people)).toBe('Added you to the circuit')
    expect(addMeToast('brand-new-uuid', people)).toBe('Added you to the circuit')
  })
})

describe('readers', () => {
  it('maps every field of a request, each away from its default', () => {
    expect(
      readMyClaims([
        {
          id: 'c1',
          person_id: 'p1',
          person_name: 'Linda',
          status: 'declined',
          requested_at: '2026-11-21T09:30:00Z',
          decided_at: '2026-11-22T10:00:00Z',
        },
      ]),
    ).toEqual([
      {
        id: 'c1',
        personId: 'p1',
        personName: 'Linda',
        status: 'declined',
        requestedAt: '2026-11-21T09:30:00Z',
      },
    ])
    expect(
      readWaitingClaims([
        {
          id: 'c2',
          person_id: 'p2',
          person_name: 'Gran',
          user_id: 'u2',
          username: 'seedfriend',
          first_name: 'Friend',
          via: 'joined',
          requested_at: '2026-11-20T08:00:00Z',
          logs: 37,
          circuits: ['The Crew', 'Family'],
          added_by_them: true,
        },
      ]),
    ).toEqual([
      {
        id: 'c2',
        personId: 'p2',
        personName: 'Gran',
        username: 'seedfriend',
        firstName: 'Friend',
        via: 'joined',
        requestedAt: '2026-11-20T08:00:00Z',
        logs: 37,
        circuits: ['The Crew', 'Family'],
        addedByThem: true,
      },
    ])
  })

  it('drops a status or a door it does not know rather than guessing, and survives no answer', () => {
    expect(readMyClaims([{ id: 'c', person_id: 'p', status: 'maybe' }])).toEqual([])
    expect(readWaitingClaims([{ id: 'c', person_id: 'p', via: 'phoned' }])).toEqual([])
    expect(readMyClaims(null)).toEqual([])
    expect(readWaitingClaims({ error: 'admin only' })).toEqual([])
  })
})
