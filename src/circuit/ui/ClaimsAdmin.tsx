// The admin's half of claiming a Circuit person (OPEN-DECISIONS §19e): the requests waiting, with
// what the decision needs and nothing of the log itself, and an answer that is asked twice
// because approving hands over every day on the board and declining cannot be asked again.
import { useState } from 'react'
import { VIA_LABEL, type WaitingClaim } from '../claims'

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
const dayCount = (n: number) => `${n} day${n === 1 ? '' : 's'}`
const who = (c: WaitingClaim) => (c.username ? `@${c.username}` : 'a member')

export function CircuitClaimsList({
  rows,
  onDecide,
}: {
  rows: WaitingClaim[]
  onDecide: (claimId: string, approve: boolean) => Promise<void>
}) {
  const [asking, setAsking] = useState<{ id: string; approve: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<{ id: string; message: string } | null>(null)

  const decide = async (id: string, approve: boolean) => {
    setBusy(id)
    setErr(null)
    try {
      await onDecide(id, approve)
      setAsking(null)
    } catch (e: unknown) {
      setErr({ id, message: String((e as { message?: string })?.message ?? e) })
    } finally {
      setBusy(null)
    }
  }

  if (!rows.length) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Nobody is waiting.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {rows.map((c) => {
        const open = asking?.id === c.id ? asking : null
        return (
          <div
            key={c.id}
            className="admin-member-row"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.3rem',
              padding: '0.5rem 0.7rem',
              background: 'var(--b1,rgba(127,127,127,0.07))',
              borderRadius: 8,
              fontSize: '0.85rem',
            }}
          >
            <div
              style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}
            >
              <strong style={{ overflowWrap: 'anywhere' }}>{c.personName}</strong>
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                {dayCount(c.logs)} logged
              </span>
            </div>
            <div style={{ overflowWrap: 'anywhere' }}>
              {who(c)}
              {c.firstName ? ` (${c.firstName})` : ''} {VIA_LABEL[c.via]}
              <span className="muted"> · {when(c.requestedAt)}</span>
            </div>
            <div className="muted" style={{ fontSize: '0.78rem', overflowWrap: 'anywhere' }}>
              {c.circuits.length ? `Both in ${c.circuits.join(', ')}` : 'They share no circuit now'}
            </div>
            {c.addedByThem && (
              <div style={{ fontSize: '0.78rem' }}>
                ⚠️ They added this board to that circuit themselves
              </div>
            )}
            {open ? (
              <div
                style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}
              >
                <span style={{ fontSize: '0.8rem' }}>
                  {open.approve
                    ? `Give ${c.personName}’s board and its ${dayCount(c.logs)} to ${who(c)}?`
                    : `Say no to ${who(c)}? They can’t ask for this board again.`}
                </span>
                <button
                  className="btn"
                  disabled={busy === c.id}
                  onClick={() => void decide(c.id, open.approve)}
                >
                  {busy === c.id ? '…' : open.approve ? 'Yes, give it' : 'Yes, say no'}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={busy === c.id}
                  onClick={() => setAsking(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => setAsking({ id: c.id, approve: true })}>
                  Approve
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setAsking({ id: c.id, approve: false })}
                >
                  Decline
                </button>
              </div>
            )}
            {err?.id === c.id && (
              <p style={{ color: '#f46b6b', margin: 0, fontSize: '0.8rem' }} role="alert">
                {err.message}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
