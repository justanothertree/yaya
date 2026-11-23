// The unclaimed people a member could ask for, and where each of their requests stands.
// Asking changes nothing about the person: an admin answers it (OPEN-DECISIONS §19e).
import { claimState, type MyClaim } from '../claims'
import type { Person } from '../types'
import { personRow } from './personRow'

export function ClaimableList({
  people,
  mine,
  busy,
  onClaim,
  onWithdraw,
}: {
  people: Person[]
  mine: MyClaim[]
  busy: boolean
  onClaim: (personId: string) => void
  onWithdraw: (claimId: string) => void
}) {
  return (
    <div style={{ marginTop: '0.55rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
        If one of these is you, ask for it. An admin confirms it before its logs are yours.
      </p>
      {people.map((p) => {
        const state = claimState(p.id, mine)
        const pending = mine.find((c) => c.personId === p.id && c.status === 'pending')
        return (
          <div key={p.id} style={personRow(p.color)}>
            <strong style={{ color: p.color }}>{p.name}</strong>
            <span
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                flexWrap: 'wrap',
              }}
            >
              {state === 'waiting' && pending ? (
                <>
                  <span className="muted" style={{ fontSize: '0.76rem' }}>
                    Waiting for an admin
                  </span>
                  <button
                    className="btn btn-ghost"
                    onClick={() => onWithdraw(pending.id)}
                    disabled={busy}
                    style={{ fontSize: '0.78rem' }}
                    aria-label={`Withdraw: ${p.name}`}
                  >
                    Withdraw
                  </button>
                </>
              ) : state === 'refused' ? (
                <span className="muted" style={{ fontSize: '0.76rem' }}>
                  An admin said no
                </span>
              ) : (
                <button
                  className="btn btn-ghost"
                  onClick={() => onClaim(p.id)}
                  disabled={busy}
                  style={{ fontSize: '0.78rem' }}
                  aria-label={`This is me: ${p.name}`}
                >
                  This is me
                </button>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
