import { useState } from 'react'
import type { MyClaim, WaitingClaim } from '../circuit/claims'
import { ClaimableList } from '../circuit/ui/ClaimableList'
import { CircuitClaimsList } from '../circuit/ui/ClaimsAdmin'
import type { Person } from '../circuit/types'

/**
 * Both halves of claiming a Circuit person, with invented people, because neither can be looked at
 * otherwise: `#dev-admin` renders AdminPanel with no token, so its list is always empty, and the
 * member's list lives in the Circuits tab, which needs a session for anything to be unclaimed.
 *
 * The SHAPES are the point, and they are the ones that crowd a row:
 *   - each of the three states a member's row can be in: none, waiting, refused
 *   - a 26-character name, the longest the board's own rename box makes easy
 *   - a request through each door, one with no circuit shared any more, one whose board the asker
 *     put into that circuit themselves, and a board with one day on it so "1 day" reads right
 *
 * Nothing here writes. Answering removes the row after a tick, and the member's two buttons move
 * their row to the state the server would answer with, so both busy and settled can be read.
 */
const person = (id: string, name: string, color: string): Person => ({
  id,
  name,
  color,
  goal: 100,
  exercises: [],
  colLabels: [],
  ownerUserId: null,
  groupIds: ['pv-group'],
})

const PEOPLE = [
  person('pv-linda', 'Linda', '#f46b6b'),
  person('pv-gran', 'Gran', '#22c55e'),
  person('pv-long', 'Grandpa Bartholomew-Jones', '#38bdf8'),
]

const WAITING: WaitingClaim[] = [
  {
    id: 'pv-c1',
    personId: 'pv-linda',
    personName: 'Linda',
    username: 'lindab',
    firstName: 'Linda',
    via: 'joined',
    requestedAt: '2026-11-20T15:04:00Z',
    logs: 212,
    circuits: ['The Crew'],
    addedByThem: false,
  },
  {
    id: 'pv-c2',
    personId: 'pv-long',
    personName: 'Grandpa Bartholomew-Jones',
    username: 'a_handle_of_24_charsxxxx',
    firstName: null,
    via: 'asked',
    requestedAt: '2026-11-21T09:30:00Z',
    logs: 1,
    circuits: [],
    addedByThem: false,
  },
  {
    id: 'pv-c3',
    personId: 'pv-gran',
    personName: 'Gran',
    username: 'mo',
    firstName: 'Mo',
    via: 'added',
    requestedAt: '2026-11-22T18:10:00Z',
    logs: 48,
    circuits: ['Family', 'Mo’s new circuit'],
    addedByThem: true,
  },
]

const claim = (personId: string, status: MyClaim['status']): MyClaim => ({
  id: `pv-mine-${personId}`,
  personId,
  personName: PEOPLE.find((p) => p.id === personId)?.name ?? '',
  status,
  requestedAt: '2026-11-21T10:00:00Z',
})

export function CircuitClaimsPreview() {
  const [rows, setRows] = useState(WAITING)
  const [mine, setMine] = useState<MyClaim[]>([
    claim('pv-linda', 'pending'),
    claim('pv-gran', 'declined'),
  ])
  const [busy, setBusy] = useState(false)
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 150))

  const act = async (next: (m: MyClaim[]) => MyClaim[]) => {
    setBusy(true)
    await tick()
    setMine(next)
    setBusy(false)
  }

  return (
    <section className="card dev-bench">
      <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
        dev preview — claiming a Circuit person, invented people
      </p>
      <div className="cz-sec" style={{ marginBottom: '0.4rem' }}>
        A member’s list
      </div>
      <ClaimableList
        people={PEOPLE}
        mine={mine}
        busy={busy}
        onClaim={(id) =>
          void act((m) => [...m.filter((c) => c.personId !== id), claim(id, 'pending')])
        }
        onWithdraw={(claimId) =>
          void act((m) =>
            m.map((c) => (c.id === claimId ? { ...c, status: 'withdrawn' as const } : c)),
          )
        }
      />
      <div className="cz-sec" style={{ margin: '1.2rem 0 0.4rem' }}>
        The admin’s list
      </div>
      <CircuitClaimsList
        rows={rows}
        onDecide={async (id) => {
          await tick()
          setRows((r) => r.filter((c) => c.id !== id))
        }}
      />
    </section>
  )
}
