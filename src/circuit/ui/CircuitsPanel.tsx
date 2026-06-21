// "Circuits" — manage the groups you own/belong to (Phase D of data ownership).
// Create a circuit, share its join code, join someone else's, and claim your own
// person. Talks to the security-definer RPCs (create_circuit / join_circuit /
// my_circuits / leave_circuit / claim_person). Members-only; the tab is hidden when
// signed out, so this assumes an authenticated Supabase session.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSupabaseClient } from '../../finance/client'
import { useCircuit } from '../store'
import { showToast } from '../toast'

type CircuitRow = {
  id: string
  name: string
  join_code: string | null
  role: string
  member_count: number
  is_owner: boolean
}

export function CircuitsPanel() {
  const state = useCircuit()
  const sb = useMemo(() => getSupabaseClient(), [])
  const [rows, setRows] = useState<CircuitRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [uid, setUid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const { data, error } = await sb.rpc('my_circuits')
    if (error) setErr(error.message)
    else setRows((data as CircuitRow[]) ?? [])
  }, [sb])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void sb.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null))
  }, [sb])

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true)
    setErr(null)
    const { error } = await fn()
    setBusy(false)
    if (error) {
      setErr(error.message)
    } else {
      showToast(ok)
      await refresh()
    }
  }

  const create = () =>
    run(async () => {
      const r = await sb.rpc('create_circuit', { p_name: newName })
      if (!r.error) setNewName('')
      return r
    }, 'Circuit created')

  const join = () =>
    run(async () => {
      const r = await sb.rpc('join_circuit', { p_code: joinCode.trim() })
      if (!r.error) setJoinCode('')
      return r
    }, 'Joined circuit')

  const leave = (id: string) => run(() => sb.rpc('leave_circuit', { p_group: id }), 'Left circuit')

  const claim = (personId: string) =>
    run(
      () => sb.rpc('claim_person', { p_person_id: personId }),
      'Claimed — this is now your Circuit',
    )

  const setPublic = (personId: string, pub: boolean) =>
    run(
      () => sb.rpc('set_person_public', { p_person_id: personId, p_public: pub }),
      pub ? 'Now on the public board' : 'Removed from the public board',
    )

  const copyCode = (code: string) => {
    void navigator.clipboard?.writeText(code).then(
      () => showToast('Join code copied'),
      () => showToast('Copy failed — code: ' + code),
    )
  }

  const input: React.CSSProperties = { padding: '0.45rem 0.6rem', flex: 1, minWidth: 0 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem', maxWidth: 620 }}>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        A circuit is your crew. Everyone in it sees each other’s stats, but only you can edit your
        own. Share a join code to invite friends; nothing is public unless you choose it.
      </p>

      {/* your circuits */}
      <section>
        <div className="cz-sec" style={{ marginBottom: '0.5rem' }}>
          Your circuits
        </div>
        {rows === null ? (
          <p className="muted" style={{ margin: 0 }}>
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            You’re not in a circuit yet — create one below or join with a code.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {rows.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  flexWrap: 'wrap',
                  padding: '0.6rem 0.75rem',
                  background: 'var(--b1, rgba(127,127,127,0.06))',
                  borderRadius: 10,
                }}
              >
                <strong>{c.name}</strong>
                <span className="muted" style={{ fontSize: '0.76rem' }}>
                  {c.member_count} member{c.member_count === 1 ? '' : 's'} ·{' '}
                  {c.is_owner ? 'owner' : c.role}
                </span>
                {c.is_owner && c.join_code && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => copyCode(c.join_code!)}
                    style={{ fontSize: '0.78rem' }}
                    title="Copy the join code to invite friends"
                  >
                    🔗 Invite ({c.join_code})
                  </button>
                )}
                {!c.is_owner && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => leave(c.id)}
                    disabled={busy}
                    style={{ fontSize: '0.78rem', marginLeft: 'auto' }}
                  >
                    Leave
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* create + join */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <div>
          <div className="cz-sec" style={{ marginBottom: '0.4rem' }}>
            Start a circuit
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Circuit name (e.g. The Crew)"
              style={input}
            />
            <button
              className="btn"
              onClick={create}
              disabled={busy || !newName.trim()}
              style={{
                background: 'var(--accent,#7c6af7)',
                color: '#fff',
                borderColor: 'transparent',
              }}
            >
              Create
            </button>
          </div>
        </div>
        <div>
          <div className="cz-sec" style={{ marginBottom: '0.4rem' }}>
            Join with a code
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Paste a join code"
              style={input}
            />
            <button className="btn" onClick={join} disabled={busy || !joinCode.trim()}>
              Join
            </button>
          </div>
        </div>
      </section>

      {/* people in your circuits: ownership + public-board opt-in */}
      {state.people.length > 0 && (
        <section>
          <div className="cz-sec" style={{ marginBottom: '0.4rem' }}>
            People in your circuits
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {state.people.map((p) => {
              const mine = !!p.ownerUserId && !!uid && p.ownerUserId === uid
              const unclaimed = !p.ownerUserId
              return (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                    padding: '0.45rem 0.6rem',
                    background: 'var(--b1, rgba(127,127,127,0.06))',
                    borderRadius: 8,
                    borderLeft: `3px solid ${p.color}`,
                  }}
                >
                  <strong style={{ color: p.color }}>{p.name}</strong>
                  {mine ? (
                    <span className="muted" style={{ fontSize: '0.76rem' }}>
                      ✓ yours
                    </span>
                  ) : unclaimed ? (
                    <button
                      className="btn btn-ghost"
                      onClick={() => claim(p.id)}
                      disabled={busy}
                      style={{ fontSize: '0.78rem' }}
                      title="Claim this Circuit as yours"
                    >
                      This is me
                    </button>
                  ) : (
                    <span className="muted" style={{ fontSize: '0.76rem' }}>
                      claimed
                    </span>
                  )}
                  {mine && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => setPublic(p.id, !p.isPublic)}
                      disabled={busy}
                      style={{ fontSize: '0.74rem', marginLeft: 'auto' }}
                      title="Whether your Circuit shows on the signed-out public board"
                    >
                      {p.isPublic ? '🌎 Public — make private' : 'Make public'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.78rem' }}>
            Unclaimed people stay admin-managed until the real person signs in and claims them.
          </p>
        </section>
      )}

      {err && (
        <p style={{ color: '#ff5566', margin: 0, fontSize: '0.82rem' }} role="alert">
          {err}
        </p>
      )}
    </div>
  )
}
