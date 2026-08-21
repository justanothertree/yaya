import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

/**
 * What has actually been set aside for the family, and how that compares to what was promised.
 *
 * ⚠️ WHY THIS IS TYPED IN RATHER THAN IMPORTED.
 *
 * The fund is commingled with Evan's own trading, and which shares were bought with the family
 * in mind was never recorded anywhere. So no broker export contains it, and nothing can be
 * derived from the trades either — three different derivations over the SAME trades give
 * "behind $8,376", "ahead $41,313" and "$770 invested". They aren't competing answers, they're
 * all noise from an input that doesn't exist. Those trades are $49,992 in and $49,221 out since
 * 2020, because money gets recycled through the same symbols and every rebuy looked like a
 * fresh contribution.
 *
 * Evan is the only source of the fact, so he states it. Everything else derives: promised is
 * exact arithmetic that never needs importing, and ahead/behind is contributed minus promised.
 */

type Status = {
  accounts: number
  promised: number
  contributed: number
  contributions: number
  lastContribution: string | null
  ready: boolean
}

type Row = {
  id: string
  amount: number
  contributed_on: string
  note: string | null
  per_person: number
}

const money = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

const today = () => new Date().toISOString().slice(0, 10)

export function FundPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [amount, setAmount] = useState('')
  const [on, setOn] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const sb = getSupabaseClient()
    if (!sb) return
    const [s, l] = await Promise.all([
      sb.rpc('admin_fund_status'),
      sb.rpc('admin_list_contributions'),
    ])
    if (s.error) setErr(s.error.message)
    else setStatus(s.data as Status)
    if (!l.error) setRows((l.data ?? []) as Row[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setErr('Enter an amount greater than zero.')
      return
    }
    const sb = getSupabaseClient()
    if (!sb) {
      setErr('Not connected.')
      return
    }
    setBusy(true)
    setErr(null)
    const { error } = await sb.rpc('admin_add_contribution', {
      p_amount: value,
      p_on: on,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    setAmount('')
    setNote('')
    await load()
  }

  async function remove(id: string) {
    const sb = getSupabaseClient()
    if (!sb) return
    setBusy(true)
    const { error } = await sb.rpc('admin_delete_contribution', { p_id: id })
    setBusy(false)
    if (error) setErr(error.message)
    else await load()
  }

  const behind = status ? status.promised - status.contributed : 0
  const perPerson = status && status.accounts > 0 ? status.contributed / status.accounts : 0
  const promisedEach = status && status.accounts > 0 ? status.promised / status.accounts : 0

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        What you&apos;ve actually set aside. Everything else on the dashboard is worked out from
        this — the promise itself is just arithmetic and never needs updating.
      </p>

      {status && !status.ready && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <strong>Nothing recorded yet.</strong>
          <p className="muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
            Until there&apos;s at least one entry here, nobody is shown an ahead-or-behind figure —
            their page says it&apos;s still being set up. That&apos;s deliberate: a confident zero
            would be a wrong answer rather than an honest blank.
          </p>
        </div>
      )}

      {/* One hero number, in Evan's words: are we keeping the promise or not. */}
      {status && status.ready && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div
            style={{
              fontSize: '1.6rem',
              fontWeight: 800,
              color: behind > 0 ? undefined : 'var(--ok, #4ade80)',
            }}
          >
            {behind > 0 ? `${money(behind)} behind` : `${money(-behind)} ahead`}
          </div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {money(status.contributed)} set aside against {money(status.promised)} promised ·{' '}
            {status.accounts} {status.accounts === 1 ? 'person' : 'people'}
          </div>
          <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>
            That&apos;s {money(perPerson)} each, against {money(promisedEach)} each promised.
          </div>
        </div>
      )}

      <form onSubmit={add} className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Record money set aside</div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 2 }}>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              Amount (total for everyone)
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="330.00"
              style={{ width: '9rem' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 2 }}>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              Date
            </span>
            {/* max=today: a future date would silently read as "ahead of schedule" */}
            <input type="date" value={on} max={today()} onChange={(e) => setOn(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 2, flex: '1 1 12rem' }}>
            <span className="muted" style={{ fontSize: '0.72rem' }}>
              Note (optional)
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="what this was"
            />
          </label>
          <button className="btn" disabled={busy}>
            Record
          </button>
        </div>
        {status && status.accounts > 0 && Number(amount) > 0 && (
          <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}>
            Splits to {money(Number(amount) / status.accounts)} each across {status.accounts}{' '}
            {status.accounts === 1 ? 'person' : 'people'}.
          </div>
        )}
        {err && (
          <p style={{ color: 'var(--bad, #f87171)', fontSize: '0.82rem', margin: '0.5rem 0 0' }}>
            {err}
          </p>
        )}
      </form>

      {rows.length > 0 && (
        <div>
          <div
            className="muted"
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.4rem',
            }}
          >
            Recorded ({rows.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {rows.map((r) => (
              <div
                key={r.id}
                className="card"
                style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem' }}
              >
                <strong style={{ minWidth: '5.5rem' }}>{money(r.amount)}</strong>
                <span className="muted" style={{ fontSize: '0.8rem', minWidth: '6rem' }}>
                  {r.contributed_on}
                </span>
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  {money(r.per_person)} each
                </span>
                <span style={{ flex: 1, fontSize: '0.82rem' }}>{r.note}</span>
                <button className="btn btn-ghost" disabled={busy} onClick={() => void remove(r.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
