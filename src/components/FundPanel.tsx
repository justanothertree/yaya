import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

/**
 * Money set aside for the family that has not been invested yet.
 *
 * ⚠️ THIS FILE USED TO ANSWER A BIGGER QUESTION, AND THE COMMENT EXPLAINING WHY OUTLIVED THE
 * ANSWER. It said contributions could not be derived from the trades — true when it was
 * written, because designation did not exist yet and three derivations over the same trades
 * gave "behind $8,376", "ahead $41,313" and "$770 invested". Once every trade was marked
 * family or personal the walk became exact, and docs/2026-08-23-cash-and-derived-contributions
 * .sql moved contributions to finance.account_ledger. Nobody came back for this panel, so its
 * hero number went on reading the typed table and disagreeing with the derived one by $13,792.
 *
 * What survives is the one thing the trades genuinely cannot know: money promised and set
 * aside that has not reached the market. It is reported as a total, with no comparison to the
 * promise — ahead-or-behind has exactly one home, portfolioTotals(), and it is not this.
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

  const perPerson = status && status.accounts > 0 ? status.contributed / status.accounts : 0

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Money set aside for the family that has <strong>not been invested yet</strong>. The trades
        cannot know about it, so this is the one thing here that has to be typed.
      </p>

      {/**
       * ⚠️ THIS PANEL NO LONGER ANSWERS "ARE WE KEEPING THE PROMISE".
       *
       * It used to, from finance.family_contributions — the TYPED ledger — and
       * docs/2026-08-23-cash-and-derived-contributions.sql superseded that months ago:
       * contributions are DERIVED from the trades now, by finance.account_ledger. Nobody
       * removed the hero number, so the two answers were both on screen, two clicks apart:
       *
       *   Admin -> Fund          $33.00 set aside vs $8,514.00 promised  ->  "$8,481.00 behind"
       *   Investments -> All     $13,825.02 put in vs $8,514.00 promised ->  "$5,311.02 ahead"
       *
       * Same question, opposite verdict, $13,792 apart. The $33 is the single test row that
       * OPEN-DECISIONS §2 describes as inert because "nothing reads it today" — it was the
       * input to a 1.6rem hero number.
       *
       * What the table IS still for, per that same entry, is money set aside but NOT YET
       * INVESTED, which the trades genuinely cannot know. That is a real quantity and it is
       * not comparable to the promise, so it is reported as a total and nothing else.
       * Ahead-or-behind has exactly one home: portfolioTotals(), from the derived ledger.
       */}
      {status && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{money(status.contributed)}</div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            set aside and not yet invested · {status.accounts}{' '}
            {status.accounts === 1 ? 'person' : 'people'}
            {status.contributed > 0 && ` · ${money(perPerson)} each`}
          </div>
          <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>
            Whether the dollar-a-day promise is being kept is worked out from the trades, on
            Investments — not from this. Money here has not reached the market yet.
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
