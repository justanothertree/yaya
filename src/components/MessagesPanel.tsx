import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

/**
 * What people sent through the contact form.
 *
 * ⚠️ This exists because the form no longer trusts an email to be the record. It used to post
 * only to Formspree, so whether a stranger reached Evan depended on somebody else's free tier —
 * a monthly cap, a spam filter, an outage nobody here would hear about. Messages land in the
 * database first now; the email is a ping. This is the actual inbox, and it cannot silently
 * lose anything.
 */

type Message = {
  id: string
  created_at: string
  name: string
  email: string
  body: string
  handled: boolean
}

export function MessagesPanel() {
  const [rows, setRows] = useState<Message[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const sb = getSupabaseClient()
    const { data, error } = await sb.rpc('admin_list_contact_messages', { p_limit: 200 })
    if (error) setErr(error.message)
    else {
      setErr(null)
      setRows((data ?? []) as Message[])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function setHandled(id: string, handled: boolean) {
    setBusy(id)
    const { error } = await getSupabaseClient().rpc('admin_set_contact_handled', {
      p_id: id,
      p_handled: handled,
    })
    setBusy(null)
    if (error) {
      setErr(error.message)
      return
    }
    setRows((prev) => (prev ?? []).map((m) => (m.id === id ? { ...m, handled } : m)))
  }

  if (err) return <p style={{ color: '#f46b6b' }}>{err}</p>
  if (!rows) return <p className="muted">Loading…</p>

  const open = rows.filter((m) => !m.handled)
  const done = rows.filter((m) => m.handled)

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Everything sent through the contact form, whether or not the email notification made it.
        Marking one done keeps it here — nothing is deleted.
      </p>

      {rows.length === 0 && <p className="muted">Nobody has written yet.</p>}

      {open.length > 0 && (
        <>
          <div className="cz-sec" style={{ margin: '0.5rem 0' }}>
            Needs a reply ({open.length})
          </div>
          {open.map((m) => (
            <MessageCard key={m.id} m={m} busy={busy === m.id} onHandled={setHandled} />
          ))}
        </>
      )}

      {done.length > 0 && (
        <>
          <div className="cz-sec" style={{ margin: '1rem 0 0.5rem' }}>
            Done ({done.length})
          </div>
          {done.map((m) => (
            <MessageCard key={m.id} m={m} busy={busy === m.id} onHandled={setHandled} />
          ))}
        </>
      )}
    </div>
  )
}

function MessageCard({
  m,
  busy,
  onHandled,
}: {
  m: Message
  busy: boolean
  onHandled: (id: string, handled: boolean) => void
}) {
  return (
    <div className="card" style={{ marginBottom: '0.5rem', opacity: m.handled ? 0.62 : 1 }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong>{m.name}</strong>
        {/* mailto rather than a copy button: replying is the only thing you do from here */}
        <a href={`mailto:${encodeURIComponent(m.email)}`} style={{ fontSize: '0.85rem' }}>
          {m.email}
        </a>
        <span className="muted" style={{ fontSize: '0.78rem', marginLeft: 'auto' }}>
          {new Date(m.created_at).toLocaleString()}
        </span>
      </div>
      {/* plain text, never markup — the same rule as a bio */}
      <p style={{ margin: '0.5rem 0 0', whiteSpace: 'pre-wrap' }}>{m.body}</p>
      <div style={{ marginTop: '0.5rem' }}>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => onHandled(m.id, !m.handled)}
          style={{ fontSize: '0.78rem' }}
        >
          {m.handled ? 'Move back to needs a reply' : 'Mark done'}
        </button>
      </div>
    </div>
  )
}
